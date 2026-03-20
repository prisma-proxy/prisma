use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;
use chrono::Utc;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, info, warn};
use uuid::Uuid;

use prisma_core::config::server::PortForwardingConfig;
use prisma_core::crypto::aead::AeadCipher;
use prisma_core::protocol::codec::*;
use prisma_core::protocol::types::*;
use prisma_core::router::parse_cidr_v4;
use prisma_core::state::{ForwardConnectionInfo, ForwardEntry, ForwardRegistry, ServerMetrics};
use prisma_core::types::MAX_FRAME_SIZE;

type StreamMap = Arc<Mutex<HashMap<u32, mpsc::Sender<bytes::Bytes>>>>;

/// Shared state for a multiplexed forward session.
struct ForwardCtx<W> {
    tunnel_write: Arc<Mutex<W>>,
    session_keys: Arc<Mutex<SessionKeys>>,
    cipher: Arc<dyn AeadCipher>,
    next_stream_id: Arc<AtomicU32>,
    streams: StreamMap,
    metrics: Arc<ServerMetrics>,
    bytes_up: Arc<AtomicU64>,
    bytes_down: Arc<AtomicU64>,
    forward_registry: ForwardRegistry,
    client_id: Option<Uuid>,
}

impl<W> Clone for ForwardCtx<W> {
    fn clone(&self) -> Self {
        Self {
            tunnel_write: self.tunnel_write.clone(),
            session_keys: self.session_keys.clone(),
            cipher: self.cipher.clone(),
            next_stream_id: self.next_stream_id.clone(),
            streams: self.streams.clone(),
            metrics: self.metrics.clone(),
            bytes_up: self.bytes_up.clone(),
            bytes_down: self.bytes_down.clone(),
            forward_registry: self.forward_registry.clone(),
            client_id: self.client_id,
        }
    }
}

/// Entry point when the first command has already been parsed by the handler.
#[allow(clippy::too_many_arguments)]
pub async fn run_forward_session_with_first_command<R, W>(
    tunnel_read: R,
    tunnel_write: W,
    cipher: Box<dyn AeadCipher>,
    session_keys: SessionKeys,
    forward_config: PortForwardingConfig,
    first_frame: DataFrame,
    metrics: Arc<ServerMetrics>,
    bytes_up: Arc<AtomicU64>,
    bytes_down: Arc<AtomicU64>,
    forward_registry: ForwardRegistry,
    client_id: Option<Uuid>,
) -> Result<()>
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let ctx = ForwardCtx {
        cipher: Arc::from(cipher),
        tunnel_write: Arc::new(Mutex::new(tunnel_write)),
        session_keys: Arc::new(Mutex::new(session_keys)),
        next_stream_id: Arc::new(AtomicU32::new(1)),
        streams: Arc::new(Mutex::new(HashMap::new())),
        metrics,
        bytes_up,
        bytes_down,
        forward_registry,
        client_id,
    };

    // Process the first frame
    dispatch_frame(first_frame, &forward_config, &ctx).await?;

    // Continue reading remaining frames
    let result = read_loop(tunnel_read, &forward_config, &ctx).await;

    // Cleanup: remove all forwards registered by this session
    cleanup_session_forwards(&ctx).await;

    result
}

/// Remove all forward entries for this client from the registry on session end.
async fn cleanup_session_forwards<W>(ctx: &ForwardCtx<W>) {
    if let Some(client_id) = ctx.client_id {
        let mut registry = ctx.forward_registry.write().await;
        let ports_to_remove: Vec<u16> = registry
            .iter()
            .filter(|(_, entry)| entry.client_id == Some(client_id))
            .map(|(&port, _)| port)
            .collect();
        for port in &ports_to_remove {
            if let Some(entry) = registry.remove(port) {
                entry.request_shutdown();
                info!(port, "Forward listener removed (session ended)");
            }
        }
    }
}

/// Manages multiplexed port forwarding over an encrypted tunnel.
async fn read_loop<R, W>(
    mut tunnel_read: R,
    forward_config: &PortForwardingConfig,
    ctx: &ForwardCtx<W>,
) -> Result<()>
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let mut frame_buf = Vec::with_capacity(MAX_FRAME_SIZE);
    loop {
        // Read length-prefixed encrypted frame
        let mut len_buf = [0u8; 2];
        if tunnel_read.read_exact(&mut len_buf).await.is_err() {
            break;
        }
        let frame_len = u16::from_be_bytes(len_buf) as usize;
        if frame_len > MAX_FRAME_SIZE {
            warn!(size = frame_len, "Frame too large from client");
            break;
        }
        frame_buf.resize(frame_len, 0);
        if tunnel_read
            .read_exact(&mut frame_buf[..frame_len])
            .await
            .is_err()
        {
            break;
        }

        // Count upstream bytes
        let frame_bytes = frame_len as u64 + 2;
        ctx.bytes_up.fetch_add(frame_bytes, Ordering::Relaxed);
        ctx.metrics
            .total_bytes_up
            .fetch_add(frame_bytes, Ordering::Relaxed);

        let (plaintext, _nonce) = match decrypt_frame(ctx.cipher.as_ref(), &frame_buf[..frame_len])
        {
            Ok(r) => r,
            Err(e) => {
                warn!("Decrypt error: {}", e);
                break;
            }
        };

        let frame = match decode_data_frame(&plaintext) {
            Ok(f) => f,
            Err(e) => {
                warn!("Frame decode error: {}", e);
                break;
            }
        };

        dispatch_frame(frame, forward_config, ctx).await?;
    }

    debug!("Forward session ended");
    Ok(())
}

async fn dispatch_frame<W: AsyncWrite + Unpin + Send + 'static>(
    frame: DataFrame,
    forward_config: &PortForwardingConfig,
    ctx: &ForwardCtx<W>,
) -> Result<()> {
    match frame.command {
        Command::RegisterForward {
            remote_port,
            name,
            protocol: _,
            bind_addr,
            max_connections: client_max_conns,
            allowed_ips: client_allowed_ips,
        } => {
            handle_register_forward(
                remote_port,
                name,
                bind_addr,
                client_max_conns,
                client_allowed_ips,
                forward_config,
                ctx,
            )
            .await?;
        }
        Command::Data(data) => {
            // Clone the sender outside the lock, then send without holding it
            let tx = ctx.streams.lock().await.get(&frame.stream_id).cloned();
            if let Some(tx) = tx {
                let _ = tx.send(data).await;
            }
        }
        Command::Close => {
            ctx.streams.lock().await.remove(&frame.stream_id);
        }
        Command::Ping(seq) => {
            send_frame(ctx, Command::Pong(seq), frame.stream_id).await?;
        }
        _ => {}
    }
    Ok(())
}

/// Send a ForwardReady error response.
async fn send_forward_error<W: AsyncWrite + Unpin>(
    ctx: &ForwardCtx<W>,
    remote_port: u16,
    reason: String,
) -> Result<()> {
    send_frame(
        ctx,
        Command::ForwardReady {
            remote_port,
            success: false,
            error_reason: Some(reason),
        },
        0,
    )
    .await
}

/// Handle a RegisterForward command with full validation.
#[allow(clippy::too_many_arguments)]
async fn handle_register_forward<W: AsyncWrite + Unpin + Send + 'static>(
    remote_port: u16,
    name: String,
    client_bind_addr: Option<String>,
    client_max_conns: Option<u32>,
    client_allowed_ips: Vec<String>,
    forward_config: &PortForwardingConfig,
    ctx: &ForwardCtx<W>,
) -> Result<()> {
    // Validation 1: Port allowed?
    if !forward_config.is_port_allowed(remote_port) {
        let reason = format!(
            "port {} not in allowed range ({}-{}) or denied",
            remote_port, forward_config.port_range_start, forward_config.port_range_end
        );
        warn!(port = remote_port, name = %name, reason = %reason, "Port forward denied");
        return send_forward_error(ctx, remote_port, reason).await;
    }

    // Validation 2: Max forwards per client
    if let Some(client_id) = ctx.client_id {
        let max_forwards = forward_config.effective_max_forwards_per_client();
        let current_count =
            prisma_core::state::count_client_forwards(&ctx.forward_registry, client_id).await;
        if current_count >= max_forwards {
            let reason = format!("max forwards exceeded ({}/{})", current_count, max_forwards);
            warn!(port = remote_port, name = %name, reason = %reason, "Port forward denied");
            return send_forward_error(ctx, remote_port, reason).await;
        }
    }

    // Validation 3: Port not already in use
    {
        let registry = ctx.forward_registry.read().await;
        if registry.contains_key(&remote_port) {
            let reason = "port already in use".to_string();
            warn!(port = remote_port, name = %name, reason = %reason, "Port forward denied");
            return send_forward_error(ctx, remote_port, reason).await;
        }
    }

    // Validation 4: Bind address policy
    let bind_ip = client_bind_addr.as_deref().unwrap_or("0.0.0.0");
    if !forward_config.is_bind_addr_allowed(bind_ip) {
        let reason = format!("bind address '{}' not allowed by server policy", bind_ip);
        warn!(port = remote_port, name = %name, reason = %reason, "Port forward denied");
        return send_forward_error(ctx, remote_port, reason).await;
    }

    let bind_addr = format!("{}:{}", bind_ip, remote_port);

    // Try to bind the listener before confirming success
    let listener = match TcpListener::bind(&bind_addr).await {
        Ok(l) => l,
        Err(e) => {
            let reason = format!("failed to bind {}: {}", bind_addr, e);
            warn!(port = remote_port, name = %name, reason = %reason, "Port forward denied");
            return send_forward_error(ctx, remote_port, reason).await;
        }
    };

    // Merge allowed_ips: server policy + client request
    let mut effective_allowed_ips = forward_config.allowed_ips.clone();
    if !client_allowed_ips.is_empty() && effective_allowed_ips.is_empty() {
        // Server has no restrictions, use client's list.
        // If server has restrictions, server policy takes precedence (client list ignored).
        effective_allowed_ips = client_allowed_ips;
    }

    // Register in the forward registry
    let entry = Arc::new(ForwardEntry::new(
        remote_port,
        name.clone(),
        ctx.client_id,
        bind_addr.clone(),
        effective_allowed_ips.clone(),
    ));
    {
        let mut registry = ctx.forward_registry.write().await;
        registry.insert(remote_port, entry.clone());
    }

    info!(port = remote_port, name = %name, bind = %bind_addr, "Registering port forward");

    send_frame(
        ctx,
        Command::ForwardReady {
            remote_port,
            success: true,
            error_reason: None,
        },
        0,
    )
    .await?;

    let ctx = ctx.clone();
    // Per-forward max connections: use client request if lower than server limit
    let server_max = forward_config.effective_max_connections_per_forward();
    let max_conns = match client_max_conns {
        Some(c) => (c as usize).min(server_max),
        None => server_max,
    };
    let idle_timeout_secs = forward_config.effective_idle_timeout_secs();
    let log_connections = forward_config.log_connections;

    tokio::spawn(async move {
        if let Err(e) = run_forward_listener(
            listener,
            remote_port,
            &ctx,
            &entry,
            max_conns,
            idle_timeout_secs,
            log_connections,
            &effective_allowed_ips,
        )
        .await
        {
            warn!(port = remote_port, error = %e, "Forward listener error");
        }
        // Remove from registry when listener stops
        ctx.forward_registry.write().await.remove(&remote_port);
    });

    Ok(())
}

/// Check whether a peer IP is allowed by the whitelist.
fn is_ip_allowed(peer: &SocketAddr, allowed_ips: &[String]) -> bool {
    if allowed_ips.is_empty() {
        return true;
    }
    let peer_ip = peer.ip();
    for cidr in allowed_ips {
        // Try CIDR match for IPv4
        if let IpAddr::V4(v4) = &peer_ip {
            if let Some((network, mask)) = parse_cidr_v4(cidr) {
                if (u32::from(*v4) & mask) == network {
                    return true;
                }
            }
        }
        // Exact IP match (works for both v4 and v6)
        if cidr.parse::<IpAddr>().ok() == Some(peer_ip) {
            return true;
        }
    }
    false
}

/// Listen on a forwarded port and relay incoming connections through the tunnel.
#[allow(clippy::too_many_arguments)]
async fn run_forward_listener<W: AsyncWrite + Unpin + Send + 'static>(
    listener: TcpListener,
    port: u16,
    ctx: &ForwardCtx<W>,
    entry: &Arc<ForwardEntry>,
    max_connections: usize,
    idle_timeout_secs: u64,
    log_connections: bool,
    allowed_ips: &[String],
) -> Result<()> {
    info!(addr = %entry.bind_addr, "Forward listener started");

    let mut shutdown_rx = entry.shutdown_tx.subscribe();

    loop {
        let accept = tokio::select! {
            result = listener.accept() => result,
            _ = shutdown_rx.recv() => {
                info!(port, "Forward listener shutting down (requested)");
                return Ok(());
            }
        };

        let (inbound, peer) = match accept {
            Ok(v) => v,
            Err(e) => {
                warn!(port, error = %e, "Accept error");
                continue;
            }
        };

        // IP whitelist check
        if !is_ip_allowed(&peer, allowed_ips) {
            warn!(port, peer = %peer, "Connection rejected: IP not in allowed list");
            drop(inbound);
            continue;
        }

        // Connection count enforcement
        let current = entry.active_connections.load(Ordering::Relaxed);
        if current >= max_connections {
            warn!(
                port,
                peer = %peer,
                active = current,
                max = max_connections,
                "Connection rejected: max connections reached"
            );
            drop(inbound);
            continue;
        }

        let stream_id = ctx.next_stream_id.fetch_add(1, Ordering::Relaxed);
        debug!(stream_id, peer = %peer, port, "New forwarded connection");

        // Update metrics
        entry.connections_total.fetch_add(1, Ordering::Relaxed);
        entry.active_connections.fetch_add(1, Ordering::Relaxed);

        // Record active connection info
        {
            let mut conns = entry.active_conns.write().await;
            conns.insert(
                stream_id,
                ForwardConnectionInfo {
                    stream_id,
                    peer_addr: peer.to_string(),
                    connected_at: Utc::now(),
                    bytes_up: 0,
                    bytes_down: 0,
                },
            );
        }

        // Create a channel for data from the tunnel dispatcher to this connection
        let (tx, rx) = mpsc::channel::<bytes::Bytes>(64);
        ctx.streams.lock().await.insert(stream_id, tx);

        // Notify the client about this new connection
        if let Err(e) = send_frame(
            ctx,
            Command::ForwardConnect { remote_port: port },
            stream_id,
        )
        .await
        {
            warn!(stream_id, "Failed to send ForwardConnect: {}", e);
            ctx.streams.lock().await.remove(&stream_id);
            entry.active_connections.fetch_sub(1, Ordering::Relaxed);
            entry.active_conns.write().await.remove(&stream_id);
            continue;
        }

        // Spawn bidirectional relay for this connection
        let ctx = ctx.clone();
        let entry = entry.clone();
        let peer_str = peer.to_string();
        tokio::spawn(async move {
            let start = Instant::now();
            let (up, down) =
                relay_forwarded(inbound, rx, &ctx, stream_id, idle_timeout_secs, &entry).await;

            // Send Close frame for clean stream teardown
            let _ = send_frame(&ctx, Command::Close, stream_id).await;
            ctx.streams.lock().await.remove(&stream_id);

            // Update forward entry metrics
            entry.active_connections.fetch_sub(1, Ordering::Relaxed);
            entry.bytes_up.fetch_add(up, Ordering::Relaxed);
            entry.bytes_down.fetch_add(down, Ordering::Relaxed);
            entry.active_conns.write().await.remove(&stream_id);

            let duration = start.elapsed();
            if log_connections {
                info!(
                    stream_id,
                    peer = %peer_str,
                    port,
                    duration_ms = duration.as_millis() as u64,
                    bytes_up = up,
                    bytes_down = down,
                    "Forwarded connection ended"
                );
            } else {
                debug!(stream_id, "Forwarded connection ended");
            }
        });
    }
}

/// Relay data between an inbound TCP connection and the encrypted tunnel, using stream_id.
/// Returns (bytes_up, bytes_down) transferred by this connection.
async fn relay_forwarded<W: AsyncWrite + Unpin + Send + 'static>(
    inbound: TcpStream,
    mut from_tunnel: mpsc::Receiver<bytes::Bytes>,
    ctx: &ForwardCtx<W>,
    stream_id: u32,
    idle_timeout_secs: u64,
    entry: &Arc<ForwardEntry>,
) -> (u64, u64) {
    let (mut tcp_read, mut tcp_write) = inbound.into_split();

    let conn_bytes_up = Arc::new(AtomicU64::new(0));
    let conn_bytes_down = Arc::new(AtomicU64::new(0));

    let idle_timeout = if idle_timeout_secs > 0 {
        Some(std::time::Duration::from_secs(idle_timeout_secs))
    } else {
        None
    };

    // inbound TCP -> tunnel
    let ctx2 = ctx.clone();
    let up_counter = conn_bytes_up.clone();
    let tcp_to_tunnel = tokio::spawn(async move {
        let mut buf = vec![0u8; 8192];
        loop {
            let read_result = if let Some(timeout) = idle_timeout {
                match tokio::time::timeout(timeout, tcp_read.read(&mut buf)).await {
                    Ok(result) => result,
                    Err(_) => {
                        debug!(stream_id, "Idle timeout reached (tcp->tunnel)");
                        break;
                    }
                }
            } else {
                tcp_read.read(&mut buf).await
            };

            match read_result {
                Ok(0) => break,
                Ok(n) => {
                    up_counter.fetch_add(n as u64, Ordering::Relaxed);
                    if send_frame(
                        &ctx2,
                        Command::Data(bytes::Bytes::copy_from_slice(&buf[..n])),
                        stream_id,
                    )
                    .await
                    .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // tunnel -> inbound TCP
    let down_counter = conn_bytes_down.clone();
    let tunnel_to_tcp = tokio::spawn(async move {
        loop {
            let recv_result = if let Some(timeout) = idle_timeout {
                match tokio::time::timeout(timeout, from_tunnel.recv()).await {
                    Ok(result) => result,
                    Err(_) => {
                        debug!(stream_id, "Idle timeout reached (tunnel->tcp)");
                        break;
                    }
                }
            } else {
                from_tunnel.recv().await
            };

            match recv_result {
                Some(data) => {
                    down_counter.fetch_add(data.len() as u64, Ordering::Relaxed);
                    if tcp_write.write_all(&data).await.is_err() {
                        break;
                    }
                }
                None => break,
            }
        }
        // Graceful TCP shutdown (send FIN)
        let _ = tcp_write.shutdown().await;
    });

    tokio::select! {
        _ = tcp_to_tunnel => {},
        _ = tunnel_to_tcp => {},
    }

    let up = conn_bytes_up.load(Ordering::Relaxed);
    let down = conn_bytes_down.load(Ordering::Relaxed);

    // Update active connection snapshot bytes (best-effort)
    {
        let mut conns = entry.active_conns.write().await;
        if let Some(info) = conns.get_mut(&stream_id) {
            info.bytes_up = up;
            info.bytes_down = down;
        }
    }

    (up, down)
}

/// Helper: encrypt and send a single frame through the tunnel.
async fn send_frame<W: AsyncWrite + Unpin>(
    ctx: &ForwardCtx<W>,
    command: Command,
    stream_id: u32,
) -> Result<()> {
    let frame = DataFrame {
        command,
        flags: 0,
        stream_id,
    };
    let frame_bytes = encode_data_frame(&frame);
    let nonce = ctx.session_keys.lock().await.next_server_nonce();
    let encrypted = encrypt_frame(ctx.cipher.as_ref(), &nonce, &frame_bytes)?;

    // Count downstream bytes
    let enc_len = encrypted.len() as u64 + 2;
    ctx.bytes_down.fetch_add(enc_len, Ordering::Relaxed);
    ctx.metrics
        .total_bytes_down
        .fetch_add(enc_len, Ordering::Relaxed);

    let len = (encrypted.len() as u16).to_be_bytes();
    let mut tw = ctx.tunnel_write.lock().await;
    tw.write_all(&len).await?;
    tw.write_all(&encrypted).await?;
    Ok(())
}
