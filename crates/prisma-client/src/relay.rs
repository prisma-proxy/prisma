use anyhow::Result;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tracing::{debug, info, warn};

use prisma_core::buffer_pool::BufferPool;
use prisma_core::protocol::frame_encoder::{FrameDecoder, FrameEncoder};
use prisma_core::protocol::types::*;
use prisma_core::types::MAX_FRAME_SIZE;

use crate::metrics::ClientMetrics;
use crate::tunnel::TunnelConnection;

/// Shared buffer pool for client relay sessions.
static CLIENT_BUFFER_POOL: std::sync::LazyLock<BufferPool> =
    std::sync::LazyLock::new(|| BufferPool::for_relay(32));

/// Bidirectional relay between SOCKS5 client and encrypted tunnel.
///
/// SOCKS5 client ↔ [plain TCP] ↔ relay ↔ [encrypted frames] ↔ tunnel
///
/// Performance optimizations:
/// - 32KB read buffer (4x larger, reduces frame count for bulk transfers)
/// - FrameEncoder with zero-copy in-place encryption (no heap allocations)
/// - FrameDecoder with in-place decryption
/// - Write coalescing (single syscall per frame)
pub async fn relay(
    socks_stream: TcpStream,
    tunnel: TunnelConnection,
    metrics: ClientMetrics,
) -> Result<()> {
    info!("Client relay started");

    let (mut socks_read, mut socks_write) = socks_stream.into_split();
    let (mut tunnel_read, mut tunnel_write) = tokio::io::split(tunnel.stream);

    let cipher: Arc<dyn prisma_core::crypto::aead::AeadCipher> = Arc::from(tunnel.cipher);

    // SOCKS5 → tunnel: read raw data, encrypt into frames
    let mut client_keys = tunnel.session_keys.clone();
    let padding_range = client_keys.padding_range;
    let header_key = client_keys.header_key;
    let cipher_s2t = cipher.clone();
    let metrics_up = metrics.clone();
    let socks_to_tunnel = async move {
        let mut encoder = FrameEncoder::new();
        let mut first_upload = true;
        loop {
            match socks_read.read(encoder.payload_mut()).await {
                Ok(0) => break,
                Ok(n) => {
                    metrics_up.add_up(n as u64);
                    let nonce = client_keys.next_client_nonce();

                    match encoder.seal_data_frame_v5(
                        cipher_s2t.as_ref(),
                        &nonce,
                        n,
                        0,
                        &padding_range,
                        header_key.as_ref(),
                    ) {
                        Ok(wire) => {
                            if first_upload {
                                info!(bytes = n, "Client relay: first upload frame sent");
                                first_upload = false;
                            }
                            // Single write_all call (coalesced: outer_len + nonce + data + tag)
                            if tunnel_write.write_all(wire).await.is_err() {
                                break;
                            }
                        }
                        Err(e) => {
                            warn!("Encrypt error: {}", e);
                            break;
                        }
                    }
                }
                Err(_) => break,
            }
        }
    };

    // tunnel → SOCKS5: decrypt frames, send raw data
    let header_key_down = header_key;
    let tunnel_to_socks = async move {
        let mut frame_buf = CLIENT_BUFFER_POOL.acquire();
        let mut first_download = true;
        loop {
            let mut len_buf = [0u8; 2];
            if tunnel_read.read_exact(&mut len_buf).await.is_err() {
                break;
            }
            let frame_len = u16::from_be_bytes(len_buf) as usize;
            if frame_len > MAX_FRAME_SIZE {
                warn!(size = frame_len, max = MAX_FRAME_SIZE, "Frame too large");
                break;
            }
            if tunnel_read
                .read_exact(&mut frame_buf[..frame_len])
                .await
                .is_err()
            {
                break;
            }

            // Decrypt in-place using FrameDecoder (v5 with AAD)
            match FrameDecoder::unseal_data_frame_v5(
                &mut frame_buf[..frame_len],
                frame_len,
                cipher.as_ref(),
                header_key_down.as_ref(),
            ) {
                Ok((cmd, payload, _nonce)) => match cmd {
                    CMD_DATA => {
                        if first_download {
                            info!(
                                bytes = payload.len(),
                                "Client relay: first download frame received"
                            );
                            first_download = false;
                        }
                        metrics.add_down(payload.len() as u64);
                        if socks_write.write_all(payload).await.is_err() {
                            break;
                        }
                    }
                    CMD_CLOSE => break,
                    _ => {}
                },
                Err(e) => {
                    warn!("Decrypt error: {}", e);
                    break;
                }
            }
        }
    };

    tokio::select! {
        _ = socks_to_tunnel => {},
        _ = tunnel_to_socks => {},
    }

    info!("Client relay ended");
    Ok(())
}

/// Relay data between a smoltcp TCP socket (via TUN) and an encrypted PrismaVeil tunnel.
///
/// Reads data from the smoltcp socket, encrypts it, and sends through the tunnel.
/// Reads encrypted data from the tunnel, decrypts it, and writes to the smoltcp socket.
pub async fn relay_tun_tcp_encrypted<R, W>(
    handle: smoltcp::iface::SocketHandle,
    stack: Arc<tokio::sync::Mutex<crate::tun::tcp_stack::TcpStack>>,
    mut tunnel_read: R,
    mut tunnel_write: W,
    cipher: Box<dyn prisma_core::crypto::aead::AeadCipher>,
    mut session_keys: prisma_core::protocol::types::SessionKeys,
    metrics: ClientMetrics,
    device: Option<Arc<Box<dyn crate::tun::device::TunDevice>>>,
) -> Result<()>
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
    W: tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let cipher: Arc<dyn prisma_core::crypto::aead::AeadCipher> = Arc::from(cipher);
    let padding_range = session_keys.padding_range;
    let header_key = session_keys.header_key;

    // === Upload task: smoltcp socket → encrypt → tunnel ===
    let cipher_up = cipher.clone();
    let stack_up = stack.clone();
    let metrics_up = metrics.clone();
    let upload = async move {
        let mut encoder = FrameEncoder::new();
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(10));
        loop {
            interval.tick().await;
            let (n, is_closed) = {
                let mut s = stack_up.lock().await;
                let n = s.read_from_socket(handle, encoder.payload_mut());
                let closed = s.is_closed(handle);
                // If socket has data, also poll to generate ACKs
                if n > 0 {
                    let _ = s.poll();
                }
                (n, closed)
            };
            if n > 0 {
                metrics_up.add_up(n as u64);
                let nonce = session_keys.next_client_nonce();
                match encoder.seal_data_frame_v5(
                    cipher_up.as_ref(),
                    &nonce,
                    n,
                    0,
                    &padding_range,
                    header_key.as_ref(),
                ) {
                    Ok(wire) => {
                        if let Err(e) = tunnel_write.write_all(wire).await {
                            info!("TUN relay upload: write error: {}", e);
                            break;
                        }
                    }
                    Err(e) => {
                        info!("TUN relay upload: encrypt error: {}", e);
                        break;
                    }
                }
            }
            if is_closed {
                info!("TUN relay upload: smoltcp socket closed");
                break;
            }
        }
    };

    // === Download task: tunnel → decrypt → smoltcp socket → TUN ===
    let stack_down = stack.clone();
    let metrics_down = metrics;
    let download = async move {
        let mut frame_buf = CLIENT_BUFFER_POOL.acquire();
        loop {
            let mut len_buf = [0u8; 2];
            if let Err(e) = tunnel_read.read_exact(&mut len_buf).await {
                info!("TUN relay download: tunnel EOF: {}", e);
                break;
            }
            let frame_len = u16::from_be_bytes(len_buf) as usize;
            if frame_len > MAX_FRAME_SIZE {
                warn!(
                    frame_len,
                    "TUN relay: frame too large, stream likely corrupted"
                );
                break;
            }
            if tunnel_read
                .read_exact(&mut frame_buf[..frame_len])
                .await
                .is_err()
            {
                break;
            }

            match FrameDecoder::unseal_data_frame_v5(
                &mut frame_buf[..frame_len],
                frame_len,
                cipher.as_ref(),
                header_key.as_ref(),
            ) {
                Ok((cmd, payload, _nonce)) => match cmd {
                    CMD_DATA => {
                        metrics_down.add_down(payload.len() as u64);
                        let out = {
                            let mut s = stack_down.lock().await;
                            s.write_to_socket(handle, payload);
                            s.poll() // poll + release lock immediately
                        };
                        // Write to TUN outside the lock
                        if let Some(ref dev) = device {
                            for pkt in &out {
                                let _ = dev.send(pkt);
                            }
                        }
                    }
                    CMD_CLOSE => break,
                    _ => {}
                },
                Err(e) => {
                    warn!("TUN relay decrypt error: {}", e);
                    break;
                }
            }
        }
    };

    tokio::select! {
        _ = upload => { info!("TUN relay: upload task exited first"); }
        _ = download => { info!("TUN relay: download task exited first"); }
    }

    info!("TUN TCP relay session ended");
    Ok(())
}

/// Direct relay between local client and outbound connection (no encryption).
/// Used when routing rules select "direct" action.
pub async fn relay_direct(
    local: TcpStream,
    outbound: TcpStream,
    metrics: ClientMetrics,
) -> Result<()> {
    let (mut local_read, mut local_write) = local.into_split();
    let (mut out_read, mut out_write) = outbound.into_split();

    let metrics_up = metrics.clone();
    let l2o = async move {
        let mut buf = vec![0u8; 32768];
        loop {
            match local_read.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    metrics_up.add_up(n as u64);
                    if out_write.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                }
            }
        }
    };
    let o2l = async move {
        let mut buf = vec![0u8; 32768];
        loop {
            match out_read.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    metrics.add_down(n as u64);
                    if local_write.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                }
            }
        }
    };

    tokio::select! {
        _ = l2o => {},
        _ = o2l => {},
    }

    debug!("Direct relay session ended");
    Ok(())
}
