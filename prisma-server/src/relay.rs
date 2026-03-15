use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use anyhow::Result;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tracing::{debug, warn};

use prisma_core::crypto::aead::AeadCipher;
use prisma_core::protocol::anti_replay::AntiReplayWindow;
use prisma_core::protocol::codec::*;
use prisma_core::protocol::frame_encoder::{FrameDecoder, FrameEncoder};
use prisma_core::protocol::types::*;
use prisma_core::types::MAX_FRAME_SIZE;

use prisma_core::state::ServerMetrics;

use crate::bandwidth::limiter::BandwidthLimiterStore;
use crate::bandwidth::quota::QuotaStore;

/// Per-client bandwidth and quota limits, passed as a bundle to avoid
/// duplicating the entire relay function for limited vs unlimited clients.
struct BandwidthQuota {
    client_id: String,
    bandwidth: Arc<BandwidthLimiterStore>,
    quotas: Arc<QuotaStore>,
}

/// Build an encrypted, length-prefixed Pong wire frame ready for `write_all`.
fn build_pong_wire(seq: u32, cipher: &dyn AeadCipher, nonce: &[u8; 12]) -> Option<Vec<u8>> {
    let pong = DataFrame {
        command: Command::Pong(seq),
        flags: 0,
        stream_id: 0,
    };
    let pong_bytes = encode_data_frame(&pong);
    let encrypted = encrypt_frame(cipher, nonce, &pong_bytes).ok()?;
    let mut wire = Vec::with_capacity(2 + encrypted.len());
    wire.extend_from_slice(&(encrypted.len() as u16).to_be_bytes());
    wire.extend_from_slice(&encrypted);
    Some(wire)
}

/// Bidirectional encrypted relay with optional per-client bandwidth limiting and quota enforcement.
///
/// Performance optimizations:
/// - 32KB read buffer (4x larger, reduces frame count for bulk transfers)
/// - Write coalescing (single syscall per frame instead of two)
/// - AtomicNonceCounter (lock-free nonce generation, eliminates mutex from hot path)
/// - mpsc channel for Pong (download task owns write half exclusively)
/// - FrameEncoder/FrameDecoder (zero-copy in-place encryption, no heap allocations)
///
/// When `limits` is `None`, bandwidth/quota checks are skipped entirely,
/// eliminating ~42K RwLock acquisitions/sec from the hot path.
#[allow(clippy::too_many_arguments)]
pub async fn relay_encrypted_with_limits<R, W>(
    tunnel_read: R,
    tunnel_write: W,
    outbound: TcpStream,
    cipher: Box<dyn AeadCipher>,
    session_keys: SessionKeys,
    metrics: Arc<ServerMetrics>,
    bytes_up: Arc<AtomicU64>,
    bytes_down: Arc<AtomicU64>,
    client_id: String,
    bandwidth: Arc<BandwidthLimiterStore>,
    quotas: Arc<QuotaStore>,
) -> Result<()>
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    if quotas.is_quota_exceeded(&client_id).await {
        return Err(anyhow::anyhow!(
            "Traffic quota exceeded for client {}",
            client_id
        ));
    }

    relay_encrypted_inner(
        tunnel_read,
        tunnel_write,
        outbound,
        cipher,
        session_keys,
        metrics,
        bytes_up,
        bytes_down,
        Some(BandwidthQuota {
            client_id,
            bandwidth,
            quotas,
        }),
    )
    .await
}

/// Fast-path relay: no bandwidth limiting or quota enforcement.
///
/// Used when the client has no bandwidth/quota configuration.
#[allow(clippy::too_many_arguments)]
pub async fn relay_encrypted<R, W>(
    tunnel_read: R,
    tunnel_write: W,
    outbound: TcpStream,
    cipher: Box<dyn AeadCipher>,
    session_keys: SessionKeys,
    metrics: Arc<ServerMetrics>,
    bytes_up: Arc<AtomicU64>,
    bytes_down: Arc<AtomicU64>,
) -> Result<()>
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    relay_encrypted_inner(
        tunnel_read,
        tunnel_write,
        outbound,
        cipher,
        session_keys,
        metrics,
        bytes_up,
        bytes_down,
        None,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn relay_encrypted_inner<R, W>(
    tunnel_read: R,
    tunnel_write: W,
    outbound: TcpStream,
    cipher: Box<dyn AeadCipher>,
    session_keys: SessionKeys,
    metrics: Arc<ServerMetrics>,
    bytes_up: Arc<AtomicU64>,
    bytes_down: Arc<AtomicU64>,
    limits: Option<BandwidthQuota>,
) -> Result<()>
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let (mut out_read, mut out_write) = outbound.into_split();
    let cipher: Arc<dyn AeadCipher> = Arc::from(cipher);
    let padding_range = session_keys.padding_range;

    let server_nonce = Arc::new(AtomicNonceCounter::new(
        session_keys.server_nonce_counter,
        false,
    ));

    let (pong_tx, mut pong_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(16);

    let cipher_t2d = cipher.clone();
    let server_nonce_ping = server_nonce.clone();
    let metrics_t2d = metrics.clone();
    let bytes_up_t2d = bytes_up.clone();

    // Split limits into upload/download halves (Arc-cloned where needed)
    let upload_limits = limits
        .as_ref()
        .map(|l| (l.client_id.clone(), l.bandwidth.clone(), l.quotas.clone()));
    let download_limits = limits.map(|l| (l.client_id, l.bandwidth, l.quotas));

    // tunnel -> destination (upload direction)
    let mut tunnel_read = tunnel_read;
    let tunnel_to_dest = tokio::spawn(async move {
        let mut anti_replay = AntiReplayWindow::new();
        let mut frame_buf = vec![0u8; MAX_FRAME_SIZE];

        loop {
            let mut len_buf = [0u8; 2];
            if tunnel_read.read_exact(&mut len_buf).await.is_err() {
                break;
            }
            let frame_len = u16::from_be_bytes(len_buf) as usize;
            if frame_len > MAX_FRAME_SIZE {
                break;
            }
            if tunnel_read
                .read_exact(&mut frame_buf[..frame_len])
                .await
                .is_err()
            {
                break;
            }

            let frame_bytes = frame_len as u64 + 2;

            if let Some((ref cid, ref bw, ref q)) = upload_limits {
                bw.wait_upload(cid, frame_bytes as u32).await;

                if let Some(usage) = q.get(cid).await {
                    usage.add_upload(frame_bytes);
                    if usage.quota_exceeded() {
                        warn!(client = %cid, "Upload quota exceeded mid-session");
                        break;
                    }
                }
            }

            bytes_up_t2d.fetch_add(frame_bytes, Ordering::Relaxed);
            metrics_t2d
                .total_bytes_up
                .fetch_add(frame_bytes, Ordering::Relaxed);

            match FrameDecoder::unseal_data_frame(
                &mut frame_buf[..frame_len],
                frame_len,
                cipher_t2d.as_ref(),
            ) {
                Ok((cmd, payload, nonce)) => {
                    let counter = nonce_to_counter(&nonce);
                    if let Err(e) = anti_replay.check_and_update(counter) {
                        warn!("Anti-replay check failed: {}", e);
                        break;
                    }

                    match cmd {
                        CMD_DATA => {
                            if out_write.write_all(payload).await.is_err() {
                                break;
                            }
                        }
                        CMD_CLOSE => break,
                        CMD_PING => {
                            if payload.len() >= 4 {
                                let seq = u32::from_be_bytes(payload[..4].try_into().unwrap());
                                let nonce = server_nonce_ping.next_nonce();
                                if let Some(wire) =
                                    build_pong_wire(seq, cipher_t2d.as_ref(), &nonce)
                                {
                                    let _ = pong_tx.send(wire).await;
                                }
                            }
                        }
                        _ => {}
                    }
                }
                Err(e) => {
                    warn!("Frame decrypt error: {}", e);
                    break;
                }
            }
        }
    });

    // destination -> tunnel (download direction)
    let dest_to_tunnel = tokio::spawn(async move {
        let mut tunnel_write = tunnel_write;
        let mut encoder = FrameEncoder::new();

        loop {
            tokio::select! {
                result = out_read.read(encoder.payload_mut()) => {
                    match result {
                        Ok(0) => break,
                        Ok(n) => {
                            if let Some((ref cid, ref bw, _)) = download_limits {
                                bw.wait_download(cid, n as u32).await;
                            }

                            let nonce = server_nonce.next_nonce();

                            match encoder.seal_data_frame(
                                cipher.as_ref(),
                                &nonce,
                                n,
                                0,
                                &padding_range,
                            ) {
                                Ok(wire) => {
                                    let enc_len = wire.len() as u64;
                                    bytes_down.fetch_add(enc_len, Ordering::Relaxed);
                                    metrics
                                        .total_bytes_down
                                        .fetch_add(enc_len, Ordering::Relaxed);

                                    if let Some((ref cid, _, ref q)) = download_limits {
                                        if let Some(usage) = q.get(cid).await {
                                            usage.add_download(enc_len);
                                        }
                                    }

                                    if tunnel_write.write_all(wire).await.is_err() {
                                        break;
                                    }
                                }
                                Err(e) => {
                                    warn!("Frame encrypt error: {}", e);
                                    break;
                                }
                            }
                        }
                        Err(_) => break,
                    }
                }
                Some(pong_wire) = pong_rx.recv() => {
                    if tunnel_write.write_all(&pong_wire).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    tokio::select! {
        _ = tunnel_to_dest => {},
        _ = dest_to_tunnel => {},
    }

    debug!("Relay session ended");
    Ok(())
}

/// Extract the 8-byte counter from a 12-byte nonce.
/// Nonce format: [direction:1][0:3][counter:8]
fn nonce_to_counter(nonce: &[u8; 12]) -> u64 {
    u64::from_be_bytes(nonce[4..12].try_into().unwrap())
}
