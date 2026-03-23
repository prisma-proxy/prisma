use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use anyhow::Result;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tracing::{debug, info, warn};

use prisma_core::crypto::aead::AeadCipher;
use prisma_core::protocol::anti_replay::AntiReplayWindow;
use prisma_core::protocol::codec::*;
use prisma_core::protocol::frame_encoder::{FrameDecoder, FrameEncoder};
use prisma_core::protocol::types::*;
use prisma_core::types::{CipherSuite, MAX_FRAME_SIZE};

use prisma_core::buffer_pool::BufferPool;
use prisma_core::state::ServerMetrics;

use crate::bandwidth::limiter::BandwidthLimiterStore;
use crate::bandwidth::quota::QuotaStore;

/// Shared buffer pool for server relay sessions.
static SERVER_BUFFER_POOL: std::sync::LazyLock<BufferPool> =
    std::sync::LazyLock::new(|| BufferPool::for_relay(64));

/// Whether to enable splice(2) zero-copy relay on Linux when conditions allow.
/// Set to `false` to force the standard userspace relay path even on Linux.
const SPLICE_ENABLED: bool = true;

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

    // Extract v5 header key for AAD binding (None for v4 backward compat)
    let header_key = session_keys.header_key;

    // tunnel -> destination (upload direction)
    let header_key_up = header_key;
    let mut tunnel_read = tunnel_read;
    let tunnel_to_dest = tokio::spawn(async move {
        let mut anti_replay = AntiReplayWindow::new();
        let mut frame_buf = SERVER_BUFFER_POOL.acquire();

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

            match FrameDecoder::unseal_data_frame_v5(
                &mut frame_buf[..frame_len],
                frame_len,
                cipher_t2d.as_ref(),
                header_key_up.as_ref(),
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
                                let seq = u32::from_be_bytes([
                                    payload[0], payload[1], payload[2], payload[3],
                                ]);
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
    let header_key_down = header_key;
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

                            match encoder.seal_data_frame_v5(
                                cipher.as_ref(),
                                &nonce,
                                n,
                                0,
                                &padding_range,
                                header_key_down.as_ref(),
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
    let bytes: [u8; 8] = [
        nonce[4], nonce[5], nonce[6], nonce[7], nonce[8], nonce[9], nonce[10], nonce[11],
    ];
    u64::from_be_bytes(bytes)
}

/// Returns `true` if the splice(2) zero-copy relay path should be used.
///
/// Conditions:
/// - `SPLICE_ENABLED` constant is `true`
/// - Cipher suite is `TransportOnly` (TLS/QUIC already encrypts)
/// - Running on Linux (compile-time check via `cfg`)
fn should_use_splice(cipher_suite: CipherSuite) -> bool {
    if !SPLICE_ENABLED {
        return false;
    }
    if cipher_suite != CipherSuite::TransportOnly {
        return false;
    }
    cfg!(target_os = "linux")
}

/// Zero-copy relay for `TransportOnly` sessions on Linux using splice(2).
///
/// When the transport layer (TLS/QUIC) already provides encryption, there is no
/// need to decrypt/re-encrypt in userspace. The splice(2) syscall moves data
/// directly between two file descriptors through a kernel pipe, avoiding copies
/// into userspace entirely. This can significantly reduce CPU usage and latency
/// for high-throughput relay sessions.
///
/// On non-Linux platforms or when conditions aren't met, falls back to
/// `tokio::io::copy_bidirectional`.
pub async fn relay_transport_only(
    tunnel: TcpStream,
    outbound: TcpStream,
    cipher_suite: CipherSuite,
    metrics: Arc<ServerMetrics>,
    bytes_up: Arc<AtomicU64>,
    bytes_down: Arc<AtomicU64>,
) -> Result<()> {
    if should_use_splice(cipher_suite) {
        #[cfg(target_os = "linux")]
        {
            info!("Using splice(2) zero-copy relay path");
            return splice_relay::relay(tunnel, outbound, metrics, bytes_up, bytes_down).await;
        }
    }

    // Fallback: standard userspace bidirectional copy
    info!("Using standard copy_bidirectional relay path");
    let (mut tunnel_read, mut tunnel_write) = tunnel.into_split();
    let (mut out_read, mut out_write) = outbound.into_split();

    let metrics_up = metrics.clone();
    let bytes_up_task = bytes_up.clone();

    let up = tokio::spawn(async move {
        let mut buf = [0u8; 32768];
        loop {
            match tunnel_read.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    bytes_up_task.fetch_add(n as u64, Ordering::Relaxed);
                    metrics_up
                        .total_bytes_up
                        .fetch_add(n as u64, Ordering::Relaxed);
                    if out_write.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = out_write.shutdown().await;
    });

    let down = tokio::spawn(async move {
        let mut buf = [0u8; 32768];
        loop {
            match out_read.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    bytes_down.fetch_add(n as u64, Ordering::Relaxed);
                    metrics
                        .total_bytes_down
                        .fetch_add(n as u64, Ordering::Relaxed);
                    if tunnel_write.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = tunnel_write.shutdown().await;
    });

    tokio::select! {
        _ = up => {},
        _ = down => {},
    }

    debug!("Transport-only relay session ended");
    Ok(())
}

// ---------------------------------------------------------------------------
// Linux splice(2) zero-copy relay implementation
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
mod splice_relay {
    use std::os::fd::{BorrowedFd, OwnedFd};
    use std::os::unix::io::AsRawFd;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    use anyhow::Result;
    use nix::fcntl::{splice, SpliceFFlags};
    use nix::unistd;
    use tokio::net::TcpStream;
    use tracing::{debug, warn};

    use prisma_core::state::ServerMetrics;

    /// Default pipe capacity hint (64KB, matching Linux default pipe size).
    const PIPE_SIZE: usize = 65536;

    /// Splice data from `src` to `dst` through a kernel pipe.
    ///
    /// Returns `Ok(())` on EOF from the source.
    fn splice_one_direction(
        src: BorrowedFd<'_>,
        dst: BorrowedFd<'_>,
        pipe_read: &OwnedFd,
        pipe_write: &OwnedFd,
        bytes_counter: &AtomicU64,
        metric_counter: &AtomicU64,
    ) -> Result<()> {
        let src_flags = SpliceFFlags::SPLICE_F_MOVE | SpliceFFlags::SPLICE_F_NONBLOCK;

        loop {
            // Move data from source socket into the pipe
            let n = match splice(src, None, pipe_write, None, PIPE_SIZE, src_flags) {
                Ok(0) => {
                    debug!("splice: source EOF");
                    return Ok(());
                }
                Ok(n) => n,
                Err(nix::errno::Errno::EAGAIN) => {
                    // Non-blocking source has no data; sleep briefly to avoid busy-spin.
                    std::thread::sleep(std::time::Duration::from_micros(100));
                    continue;
                }
                Err(e) => {
                    warn!("splice src->pipe error: {}", e);
                    return Err(e.into());
                }
            };

            // Move data from the pipe into the destination socket.
            // Handle partial writes by looping until all bytes are drained.
            // Use only SPLICE_F_MOVE here (no NONBLOCK) to avoid busy-spin.
            let mut remaining = n;
            while remaining > 0 {
                match splice(
                    pipe_read,
                    None,
                    dst,
                    None,
                    remaining,
                    SpliceFFlags::SPLICE_F_MOVE,
                ) {
                    Ok(0) => {
                        warn!("splice: destination closed mid-write");
                        return Err(anyhow::anyhow!("destination closed"));
                    }
                    Ok(written) => {
                        remaining -= written;
                    }
                    Err(nix::errno::Errno::EAGAIN) => {
                        std::thread::sleep(std::time::Duration::from_micros(100));
                    }
                    Err(e) => {
                        warn!("splice pipe->dst error: {}", e);
                        return Err(e.into());
                    }
                }
            }

            // Update metrics
            let transferred = n as u64;
            bytes_counter.fetch_add(transferred, Ordering::Relaxed);
            metric_counter.fetch_add(transferred, Ordering::Relaxed);
        }
    }

    /// Bidirectional splice relay between tunnel and outbound TCP streams.
    ///
    /// Each direction gets its own pipe and runs in a separate blocking task.
    /// The tokio `TcpStream`s are converted to `std::net::TcpStream` to allow
    /// safe fd access from blocking threads.
    pub async fn relay(
        tunnel: TcpStream,
        outbound: TcpStream,
        metrics: Arc<ServerMetrics>,
        bytes_up: Arc<AtomicU64>,
        bytes_down: Arc<AtomicU64>,
    ) -> Result<()> {
        // Convert to std streams so we own them and can safely share fds.
        let tunnel_std = tunnel.into_std()?;
        let outbound_std = outbound.into_std()?;

        // Set blocking mode (splice is a blocking syscall)
        tunnel_std.set_nonblocking(false)?;
        outbound_std.set_nonblocking(false)?;

        // Wrap in Arc so both blocking tasks can borrow the fds safely.
        let tunnel_std = Arc::new(tunnel_std);
        let outbound_std = Arc::new(outbound_std);

        // Create two pipe pairs: one for each direction
        let (up_pipe_read, up_pipe_write) = unistd::pipe()?;
        let (down_pipe_read, down_pipe_write) = unistd::pipe()?;

        let metrics_up = metrics.clone();
        let tunnel_up = tunnel_std.clone();
        let outbound_up = outbound_std.clone();

        // Upload: tunnel -> outbound
        let up_handle = tokio::task::spawn_blocking(move || {
            // SAFETY: The Arc<TcpStream> keeps the fds alive for the entire
            // duration of this closure. BorrowedFd is valid as long as the
            // Arc references are held.
            let src = unsafe { BorrowedFd::borrow_raw(tunnel_up.as_raw_fd()) };
            let dst = unsafe { BorrowedFd::borrow_raw(outbound_up.as_raw_fd()) };
            splice_one_direction(
                src,
                dst,
                &up_pipe_read,
                &up_pipe_write,
                &bytes_up,
                &metrics_up.total_bytes_up,
            )
        });

        let tunnel_down = tunnel_std.clone();
        let outbound_down = outbound_std.clone();

        // Download: outbound -> tunnel
        let down_handle = tokio::task::spawn_blocking(move || {
            let src = unsafe { BorrowedFd::borrow_raw(outbound_down.as_raw_fd()) };
            let dst = unsafe { BorrowedFd::borrow_raw(tunnel_down.as_raw_fd()) };
            splice_one_direction(
                src,
                dst,
                &down_pipe_read,
                &down_pipe_write,
                &bytes_down,
                &metrics.total_bytes_down,
            )
        });

        // Wait for either direction to finish (the other will error on closed fd)
        tokio::select! {
            result = up_handle => {
                if let Err(e) = result {
                    warn!("splice upload task panicked: {}", e);
                }
            }
            result = down_handle => {
                if let Err(e) = result {
                    warn!("splice download task panicked: {}", e);
                }
            }
        }

        // Explicit drops to document lifetime requirements.
        drop(tunnel_std);
        drop(outbound_std);

        debug!("Splice relay session ended");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_use_splice_transport_only() {
        // On non-Linux, this should always be false regardless of cipher suite
        let result = should_use_splice(CipherSuite::TransportOnly);
        if cfg!(target_os = "linux") {
            assert!(result);
        } else {
            assert!(!result);
        }
    }

    #[test]
    fn test_should_not_splice_encrypted_ciphers() {
        assert!(!should_use_splice(CipherSuite::ChaCha20Poly1305));
        assert!(!should_use_splice(CipherSuite::Aes256Gcm));
    }

    #[test]
    fn test_nonce_to_counter_extraction() {
        let mut nonce = [0u8; 12];
        // Set counter bytes (offset 4..12) to a known value
        nonce[4..12].copy_from_slice(&42u64.to_be_bytes());
        assert_eq!(nonce_to_counter(&nonce), 42);
    }

    #[tokio::test]
    async fn test_standard_relay_path_works() {
        // Verify the fallback copy path handles a simple echo scenario
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        // Spawn a simple echo server
        let echo = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let (mut r, mut w) = stream.split();
            tokio::io::copy(&mut r, &mut w).await.ok();
        });

        let tunnel_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let tunnel_addr = tunnel_listener.local_addr().unwrap();

        let metrics = Arc::new(ServerMetrics::default());
        let bytes_up = Arc::new(AtomicU64::new(0));
        let bytes_down = Arc::new(AtomicU64::new(0));

        let relay_task = tokio::spawn({
            let metrics = metrics.clone();
            let bytes_up = bytes_up.clone();
            let bytes_down = bytes_down.clone();
            async move {
                let (tunnel, _) = tunnel_listener.accept().await.unwrap();
                let outbound = TcpStream::connect(addr).await.unwrap();
                relay_transport_only(
                    tunnel,
                    outbound,
                    // Force standard path by using an encrypted cipher suite
                    CipherSuite::ChaCha20Poly1305,
                    metrics,
                    bytes_up,
                    bytes_down,
                )
                .await
            }
        });

        // Connect as client
        let mut client = TcpStream::connect(tunnel_addr).await.unwrap();
        let test_data = b"hello splice test";
        client.write_all(test_data).await.unwrap();

        let mut buf = [0u8; 64];
        let n = client.read(&mut buf).await.unwrap();
        assert_eq!(&buf[..n], test_data);

        // Shut down
        drop(client);
        // Allow relay to detect closure
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        relay_task.abort();
        echo.abort();
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn test_splice_relay_path() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let echo = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let (mut r, mut w) = stream.split();
            tokio::io::copy(&mut r, &mut w).await.ok();
        });

        let tunnel_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let tunnel_addr = tunnel_listener.local_addr().unwrap();

        let metrics = Arc::new(ServerMetrics::default());
        let bytes_up = Arc::new(AtomicU64::new(0));
        let bytes_down = Arc::new(AtomicU64::new(0));

        let relay_task = tokio::spawn({
            let metrics = metrics.clone();
            let bytes_up = bytes_up.clone();
            let bytes_down = bytes_down.clone();
            async move {
                let (tunnel, _) = tunnel_listener.accept().await.unwrap();
                let outbound = TcpStream::connect(addr).await.unwrap();
                relay_transport_only(
                    tunnel,
                    outbound,
                    CipherSuite::TransportOnly,
                    metrics,
                    bytes_up,
                    bytes_down,
                )
                .await
            }
        });

        let mut client = TcpStream::connect(tunnel_addr).await.unwrap();
        let test_data = b"hello zero-copy splice";
        client.write_all(test_data).await.unwrap();

        let mut buf = [0u8; 64];
        let n = client.read(&mut buf).await.unwrap();
        assert_eq!(&buf[..n], test_data);

        drop(client);
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        relay_task.abort();
        echo.abort();
    }
}
