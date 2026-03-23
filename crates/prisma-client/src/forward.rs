use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio::time::timeout;
use tracing::{debug, error, info, warn};

use prisma_core::config::client::PortForwardConfig;
use prisma_core::crypto::aead::{create_cipher, AeadCipher};
use prisma_core::protocol::codec::*;
use prisma_core::protocol::handshake::PrismaHandshakeClient;
use prisma_core::protocol::types::*;
use prisma_core::types::MAX_FRAME_SIZE;
use prisma_core::util;

use crate::proxy::ProxyContext;

// ── Per-forward metrics ──────────────────────────────────────────────────────

/// Per-forward metrics, atomically updated and queryable from FFI/GUI.
#[derive(Debug)]
pub struct ForwardMetrics {
    pub name: String,
    pub remote_port: u16,
    pub local_addr: String,
    pub active_connections: AtomicU32,
    pub total_connections: AtomicU64,
    pub bytes_up: AtomicU64,
    pub bytes_down: AtomicU64,
    /// Unix timestamp (seconds) of the last accepted connection, or 0 if none.
    pub last_connection_at: AtomicU64,
    /// Whether the server has acknowledged registration.
    pub registered: AtomicBool,
}

impl ForwardMetrics {
    fn new(name: &str, remote_port: u16, local_addr: &str) -> Self {
        Self {
            name: name.to_owned(),
            remote_port,
            local_addr: local_addr.to_owned(),
            active_connections: AtomicU32::new(0),
            total_connections: AtomicU64::new(0),
            bytes_up: AtomicU64::new(0),
            bytes_down: AtomicU64::new(0),
            last_connection_at: AtomicU64::new(0),
            registered: AtomicBool::new(false),
        }
    }

    /// Create a serializable snapshot of the current metrics.
    pub fn snapshot(&self) -> ForwardMetricsSnapshot {
        ForwardMetricsSnapshot {
            name: self.name.clone(),
            remote_port: self.remote_port,
            local_addr: self.local_addr.clone(),
            active_connections: self.active_connections.load(Ordering::Relaxed),
            total_connections: self.total_connections.load(Ordering::Relaxed),
            bytes_up: self.bytes_up.load(Ordering::Relaxed),
            bytes_down: self.bytes_down.load(Ordering::Relaxed),
            last_connection_at: self.last_connection_at.load(Ordering::Relaxed),
            registered: self.registered.load(Ordering::Relaxed),
        }
    }
}

/// Serializable snapshot of forward metrics for FFI/GUI queries.
#[derive(Debug, Clone, Serialize)]
pub struct ForwardMetricsSnapshot {
    pub name: String,
    pub remote_port: u16,
    pub local_addr: String,
    pub active_connections: u32,
    pub total_connections: u64,
    pub bytes_up: u64,
    pub bytes_down: u64,
    pub last_connection_at: u64,
    pub registered: bool,
}

// ── Global forward manager ───────────────────────────────────────────────────

/// Shared state for the port-forward subsystem, accessible from FFI.
pub struct ForwardManager {
    /// Per-port metrics, keyed by remote_port.
    pub metrics: RwLock<HashMap<u16, Arc<ForwardMetrics>>>,
    /// Current set of forward configs (may be modified at runtime).
    pub configs: RwLock<Vec<PortForwardConfig>>,
    /// Channel to notify the tunnel loop of dynamic add/remove operations.
    pub control_tx: mpsc::Sender<ForwardControl>,
}

/// Dynamic control messages sent to the running tunnel loop.
pub enum ForwardControl {
    /// Dynamically add a port forward at runtime.
    Add(Box<PortForwardConfig>),
    /// Remove a port forward by remote_port at runtime.
    Remove(u16),
}

/// Global singleton for the forward manager, set when forwarding starts.
static FORWARD_MANAGER: std::sync::OnceLock<Arc<ForwardManager>> = std::sync::OnceLock::new();

/// Get the global forward manager (if forwarding is active).
pub fn global_forward_manager() -> Option<Arc<ForwardManager>> {
    FORWARD_MANAGER.get().cloned()
}

/// Return a JSON string with all forward metrics snapshots.
pub async fn get_forward_metrics_json() -> String {
    if let Some(mgr) = global_forward_manager() {
        let map = mgr.metrics.read().await;
        let snapshots: Vec<ForwardMetricsSnapshot> = map.values().map(|m| m.snapshot()).collect();
        serde_json::to_string(&snapshots).unwrap_or_else(|_| "[]".into())
    } else {
        "[]".into()
    }
}

// ── Tunnel establishment helper ──────────────────────────────────────────────

/// Holds the write half and crypto state for a tunnel session.
struct TunnelState<W> {
    tunnel_write: Arc<Mutex<W>>,
    session_keys: Arc<Mutex<SessionKeys>>,
    cipher: Arc<dyn AeadCipher>,
}

/// Establish and handshake a tunnel, returning the read half and shared write state.
async fn establish_tunnel(
    ctx: &ProxyContext,
) -> Result<(
    tokio::io::ReadHalf<crate::connector::TransportStream>,
    TunnelState<tokio::io::WriteHalf<crate::connector::TransportStream>>,
)> {
    let mut stream = ctx.connect().await?;

    let handshake = PrismaHandshakeClient::new(ctx.client_id, ctx.auth_secret, ctx.cipher_suite);
    let (client_state, init_bytes) = handshake.start();
    util::write_framed(&mut stream, &init_bytes).await?;

    let server_init_buf = util::read_framed(&mut stream).await?;

    // Verify server key pin if configured
    if let Some(ref pin) = ctx.server_key_pin {
        if server_init_buf.len() >= 32 {
            let mut server_pub = [0u8; 32];
            server_pub.copy_from_slice(&server_init_buf[..32]);
            util::verify_server_key_pin(pin, &server_pub)?;
            debug!("Server key pin verified successfully");
        }
    }

    let (session_keys, _bucket_sizes) = client_state.process_server_init(&server_init_buf)?;
    info!(session_id = %session_keys.session_id, "Forward tunnel established");

    let cipher: Arc<dyn AeadCipher> = Arc::from(create_cipher(
        session_keys.cipher_suite,
        &session_keys.session_key,
    ));
    let (tunnel_read, tunnel_write) = tokio::io::split(stream);
    let tunnel_write = Arc::new(Mutex::new(tunnel_write));
    let session_keys = Arc::new(Mutex::new(session_keys));

    Ok((
        tunnel_read,
        TunnelState {
            tunnel_write,
            session_keys,
            cipher,
        },
    ))
}

// ── Main entry point ─────────────────────────────────────────────────────────

/// Run the port forwarding client with reconnection, per-forward metrics,
/// connection limits, idle timeouts, and retry logic.
pub async fn run_port_forwards(ctx: ProxyContext, forwards: Vec<PortForwardConfig>) -> Result<()> {
    // Filter to enabled-only forwards
    let forwards: Vec<PortForwardConfig> = forwards.into_iter().filter(|f| f.enabled).collect();
    if forwards.is_empty() {
        info!("No enabled port forwards, skipping");
        return Ok(());
    }

    info!(count = forwards.len(), "Starting port forwarding");

    // Create the control channel for dynamic add/remove
    let (control_tx, control_rx) = mpsc::channel::<ForwardControl>(32);

    // Initialize forward manager with metrics
    let mut initial_metrics = HashMap::new();
    for fwd in &forwards {
        let m = Arc::new(ForwardMetrics::new(
            &fwd.name,
            fwd.remote_port,
            &fwd.local_addr,
        ));
        initial_metrics.insert(fwd.remote_port, m);
    }

    let manager = Arc::new(ForwardManager {
        metrics: RwLock::new(initial_metrics),
        configs: RwLock::new(forwards),
        control_tx,
    });

    // Store globally for FFI access
    let _ = FORWARD_MANAGER.set(manager.clone());

    // Run with reconnection
    run_with_reconnection(ctx, manager, control_rx).await
}

/// Outer reconnection loop: if the tunnel drops, reconnect with exponential backoff.
async fn run_with_reconnection(
    ctx: ProxyContext,
    manager: Arc<ForwardManager>,
    mut control_rx: mpsc::Receiver<ForwardControl>,
) -> Result<()> {
    let mut reconnect_delay = Duration::from_secs(1);
    let max_reconnect_delay = Duration::from_secs(60);

    loop {
        // Read current configs snapshot
        let forwards = manager.configs.read().await.clone();

        match run_tunnel_session(&ctx, &manager, &forwards, &mut control_rx).await {
            Ok(()) => {
                // Clean exit (e.g., control channel closed, no forwards left)
                info!("Forward tunnel session ended cleanly");
                return Ok(());
            }
            Err(e) => {
                warn!(
                    error = %e,
                    delay_secs = reconnect_delay.as_secs(),
                    "Forward tunnel disconnected, will reconnect"
                );

                // Reset all registered flags
                {
                    let metrics = manager.metrics.read().await;
                    for m in metrics.values() {
                        m.registered.store(false, Ordering::Relaxed);
                    }
                }

                tokio::time::sleep(reconnect_delay).await;

                // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 60s cap
                reconnect_delay = std::cmp::min(reconnect_delay * 2, max_reconnect_delay);
            }
        }
    }
}

/// A single tunnel session: establish, register, and relay until disconnection.
async fn run_tunnel_session(
    ctx: &ProxyContext,
    manager: &Arc<ForwardManager>,
    forwards: &[PortForwardConfig],
    control_rx: &mut mpsc::Receiver<ForwardControl>,
) -> Result<()> {
    let (mut tunnel_read, state) = establish_tunnel(ctx).await?;

    // Build port_map from current forwards (mutable for dynamic add/remove)
    let port_map: Arc<RwLock<HashMap<u16, PortForwardConfig>>> = Arc::new(RwLock::new(
        forwards
            .iter()
            .filter(|f| f.enabled)
            .map(|f| (f.remote_port, f.clone()))
            .collect(),
    ));

    // Register each enabled port forward
    for fwd in forwards {
        if !fwd.enabled {
            continue;
        }
        register_forward(&state, fwd).await?;
    }

    // Map of stream_id -> sender for data going to local TCP
    let streams: Arc<Mutex<HashMap<u32, mpsc::Sender<bytes::Bytes>>>> =
        Arc::new(Mutex::new(HashMap::new()));

    let mut frame_buf = Vec::with_capacity(MAX_FRAME_SIZE);

    loop {
        tokio::select! {
            // Handle dynamic control messages (add/remove at runtime)
            ctrl = control_rx.recv() => {
                match ctrl {
                    Some(ForwardControl::Add(fwd)) => {
                        info!(
                            name = %fwd.name,
                            remote_port = fwd.remote_port,
                            "Dynamically adding port forward"
                        );
                        // Add metrics entry
                        let m = Arc::new(ForwardMetrics::new(
                            &fwd.name, fwd.remote_port, &fwd.local_addr,
                        ));
                        manager.metrics.write().await.insert(fwd.remote_port, m);
                        // Add to port_map and configs
                        port_map.write().await.insert(fwd.remote_port, *fwd.clone());
                        manager.configs.write().await.push(*fwd.clone());
                        // Register with the server
                        register_forward(&state, &fwd).await?;
                    }
                    Some(ForwardControl::Remove(port)) => {
                        info!(remote_port = port, "Dynamically removing port forward");
                        manager.metrics.write().await.remove(&port);
                        port_map.write().await.remove(&port);
                        manager.configs.write().await.retain(|f| f.remote_port != port);
                    }
                    None => {
                        // Control channel closed (manager dropped)
                        debug!("Forward control channel closed");
                        return Ok(());
                    }
                }
            }
            // Read next frame from the tunnel
            result = read_next_frame(&mut tunnel_read, &mut frame_buf) => {
                let raw = result?;
                let (plaintext, _) = decrypt_frame(state.cipher.as_ref(), &raw)
                    .map_err(|e| anyhow::anyhow!("Decrypt error: {}", e))?;
                let frame = decode_data_frame(&plaintext)
                    .map_err(|e| anyhow::anyhow!("Frame decode error: {}", e))?;

                dispatch_frame(
                    frame,
                    &state,
                    &port_map,
                    manager,
                    &streams,
                ).await?;
            }
        }
    }
}

/// Register a single port forward with the server.
async fn register_forward<W: AsyncWrite + Unpin>(
    state: &TunnelState<W>,
    fwd: &PortForwardConfig,
) -> Result<()> {
    info!(
        name = %fwd.name,
        local = %fwd.local_addr,
        remote_port = fwd.remote_port,
        protocol = %fwd.protocol,
        max_connections = fwd.max_connections.unwrap_or(0),
        "Registering port forward"
    );
    send_frame(
        &state.tunnel_write,
        &state.session_keys,
        &state.cipher,
        Command::RegisterForward {
            remote_port: fwd.remote_port,
            name: fwd.name.clone(),
            protocol: fwd.protocol.clone(),
            bind_addr: fwd.bind_addr.clone(),
            max_connections: fwd.max_connections,
            allowed_ips: fwd.allowed_ips.clone(),
        },
        0,
    )
    .await
}

/// Dispatch a single decoded frame from the tunnel.
async fn dispatch_frame<W: AsyncWrite + Unpin + Send + 'static>(
    frame: DataFrame,
    state: &TunnelState<W>,
    port_map: &Arc<RwLock<HashMap<u16, PortForwardConfig>>>,
    manager: &Arc<ForwardManager>,
    streams: &Arc<Mutex<HashMap<u32, mpsc::Sender<bytes::Bytes>>>>,
) -> Result<()> {
    match frame.command {
        Command::ForwardReady {
            remote_port,
            success,
            error_reason,
        } => {
            if success {
                info!(port = remote_port, "Port forward registered successfully");
                if let Some(m) = manager.metrics.read().await.get(&remote_port) {
                    m.registered.store(true, Ordering::Relaxed);
                }
            } else {
                error!(
                    port = remote_port,
                    reason = error_reason.as_deref().unwrap_or("unknown"),
                    "Port forward registration DENIED by server"
                );
            }
        }
        Command::ForwardConnect { remote_port } => {
            let stream_id = frame.stream_id;
            let pmap = port_map.read().await;
            if let Some(fwd_config) = pmap.get(&remote_port).cloned() {
                drop(pmap);

                // Check max_connections limit
                let fwd_metrics = manager.metrics.read().await.get(&remote_port).cloned();

                if let Some(ref m) = fwd_metrics {
                    let max = fwd_config.max_connections.unwrap_or(0);
                    if max > 0 {
                        let active = m.active_connections.load(Ordering::Relaxed);
                        if active >= max {
                            warn!(
                                stream_id,
                                remote_port, active, max, "Connection limit reached, refusing"
                            );
                            let _ = send_frame(
                                &state.tunnel_write,
                                &state.session_keys,
                                &state.cipher,
                                Command::Close,
                                stream_id,
                            )
                            .await;
                            return Ok(());
                        }
                    }
                    // Update metrics
                    m.active_connections.fetch_add(1, Ordering::Relaxed);
                    m.total_connections.fetch_add(1, Ordering::Relaxed);
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs();
                    m.last_connection_at.store(now, Ordering::Relaxed);
                }

                debug!(
                    stream_id,
                    remote_port,
                    local = %fwd_config.local_addr,
                    "New forwarded connection"
                );

                let (tx, rx) = mpsc::channel::<bytes::Bytes>(64);
                streams.lock().await.insert(stream_id, tx);

                let tw = state.tunnel_write.clone();
                let sk = state.session_keys.clone();
                let c = state.cipher.clone();
                let st = streams.clone();
                let cfg = fwd_config.clone();
                let metrics_clone = fwd_metrics.clone();

                tokio::spawn(async move {
                    let local_stream = connect_local_with_retry(&cfg).await;
                    match local_stream {
                        Some(stream) => {
                            relay_local(
                                stream,
                                rx,
                                tw.clone(),
                                sk.clone(),
                                c.clone(),
                                stream_id,
                                &cfg,
                                metrics_clone.as_ref(),
                            )
                            .await;
                        }
                        None => {
                            warn!(
                                stream_id,
                                local = %cfg.local_addr,
                                "All connection attempts to local service failed"
                            );
                            let _ = send_frame(&tw, &sk, &c, Command::Close, stream_id).await;
                        }
                    }
                    st.lock().await.remove(&stream_id);
                    if let Some(ref m) = metrics_clone {
                        m.active_connections.fetch_sub(1, Ordering::Relaxed);
                    }
                });
            } else {
                drop(pmap);
                warn!(stream_id, remote_port, "ForwardConnect for unknown port");
                let _ = send_frame(
                    &state.tunnel_write,
                    &state.session_keys,
                    &state.cipher,
                    Command::Close,
                    stream_id,
                )
                .await;
            }
        }
        Command::Data(data) => {
            let tx = streams.lock().await.get(&frame.stream_id).cloned();
            if let Some(tx) = tx {
                let _ = tx.send(data).await;
            }
        }
        Command::Close => {
            streams.lock().await.remove(&frame.stream_id);
        }
        _ => {}
    }
    Ok(())
}

// ── Read helper ──────────────────────────────────────────────────────────────

/// Read a single length-prefixed encrypted frame from the tunnel.
async fn read_next_frame(
    tunnel_read: &mut tokio::io::ReadHalf<crate::connector::TransportStream>,
    frame_buf: &mut Vec<u8>,
) -> Result<Vec<u8>> {
    let mut len_buf = [0u8; 2];
    tunnel_read.read_exact(&mut len_buf).await?;
    let frame_len = u16::from_be_bytes(len_buf) as usize;
    if frame_len > MAX_FRAME_SIZE {
        return Err(anyhow::anyhow!(
            "Frame too large from server: {}",
            frame_len
        ));
    }
    frame_buf.resize(frame_len, 0);
    tunnel_read.read_exact(&mut frame_buf[..frame_len]).await?;
    Ok(frame_buf[..frame_len].to_vec())
}

// ── Local connection with retry ──────────────────────────────────────────────

/// Connect to the local service, with optional retry and connect timeout.
async fn connect_local_with_retry(cfg: &PortForwardConfig) -> Option<TcpStream> {
    let connect_timeout_dur = Duration::from_secs(cfg.connect_timeout_secs.unwrap_or(10));
    let max_attempts: u32 = if cfg.retry_on_failure { 3 } else { 1 };

    for attempt in 1..=max_attempts {
        match timeout(connect_timeout_dur, TcpStream::connect(&cfg.local_addr)).await {
            Ok(Ok(stream)) => return Some(stream),
            Ok(Err(e)) => {
                if attempt < max_attempts {
                    let backoff = Duration::from_millis(200 * 2u64.pow(attempt - 1));
                    warn!(
                        local = %cfg.local_addr,
                        attempt,
                        max_attempts,
                        backoff_ms = backoff.as_millis() as u64,
                        error = %e,
                        "Local connect failed, retrying"
                    );
                    tokio::time::sleep(backoff).await;
                } else {
                    warn!(
                        local = %cfg.local_addr,
                        attempt,
                        error = %e,
                        "Local connect failed (final attempt)"
                    );
                }
            }
            Err(_) => {
                if attempt < max_attempts {
                    let backoff = Duration::from_millis(200 * 2u64.pow(attempt - 1));
                    warn!(
                        local = %cfg.local_addr,
                        attempt,
                        max_attempts,
                        timeout_secs = connect_timeout_dur.as_secs(),
                        "Local connect timed out, retrying"
                    );
                    tokio::time::sleep(backoff).await;
                } else {
                    warn!(
                        local = %cfg.local_addr,
                        attempt,
                        timeout_secs = connect_timeout_dur.as_secs(),
                        "Local connect timed out (final attempt)"
                    );
                }
            }
        }
    }
    None
}

// ── Relay with idle timeout and per-forward metrics ──────────────────────────

/// Relay between a local TCP connection and the tunnel, supporting idle
/// timeout, configurable buffer size, and per-forward byte counters.
#[allow(clippy::too_many_arguments)]
async fn relay_local<W: AsyncWrite + Unpin + Send + 'static>(
    local: TcpStream,
    mut from_tunnel: mpsc::Receiver<bytes::Bytes>,
    tunnel_write: Arc<Mutex<W>>,
    session_keys: Arc<Mutex<SessionKeys>>,
    cipher: Arc<dyn AeadCipher>,
    stream_id: u32,
    cfg: &PortForwardConfig,
    metrics: Option<&Arc<ForwardMetrics>>,
) {
    let (mut tcp_read, mut tcp_write) = local.into_split();
    let buffer_size = cfg.buffer_size.unwrap_or(8192);
    let idle_dur = Duration::from_secs(cfg.idle_timeout_secs.unwrap_or(300));
    let metrics_up = metrics.cloned();
    let metrics_down = metrics.cloned();

    let tw = tunnel_write.clone();
    let sk = session_keys.clone();
    let c = cipher.clone();

    let local_to_tunnel = tokio::spawn(async move {
        let mut buf = vec![0u8; buffer_size];
        loop {
            let read_result = timeout(idle_dur, tcp_read.read(&mut buf)).await;
            match read_result {
                Ok(Ok(0)) => break,
                Ok(Ok(n)) => {
                    if let Some(ref m) = metrics_up {
                        m.bytes_up.fetch_add(n as u64, Ordering::Relaxed);
                    }
                    if send_frame(
                        &tw,
                        &sk,
                        &c,
                        Command::Data(bytes::Bytes::copy_from_slice(&buf[..n])),
                        stream_id,
                    )
                    .await
                    .is_err()
                    {
                        break;
                    }
                }
                Ok(Err(_)) => break,
                Err(_) => {
                    debug!(stream_id, "Idle timeout on local-to-tunnel");
                    break;
                }
            }
        }
        let _ = send_frame(&tw, &sk, &c, Command::Close, stream_id).await;
    });

    let tunnel_to_local = tokio::spawn(async move {
        loop {
            let recv_result = timeout(idle_dur, from_tunnel.recv()).await;
            match recv_result {
                Ok(Some(data)) => {
                    if let Some(ref m) = metrics_down {
                        m.bytes_down.fetch_add(data.len() as u64, Ordering::Relaxed);
                    }
                    if tcp_write.write_all(&data).await.is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(_) => {
                    debug!(stream_id, "Idle timeout on tunnel-to-local");
                    break;
                }
            }
        }
    });

    tokio::select! {
        _ = local_to_tunnel => {},
        _ = tunnel_to_local => {},
    }
}

// ── Frame send helper ────────────────────────────────────────────────────────

/// Encrypt and send a single frame through the tunnel.
async fn send_frame<W: AsyncWrite + Unpin>(
    tunnel_write: &Arc<Mutex<W>>,
    session_keys: &Arc<Mutex<SessionKeys>>,
    cipher: &Arc<dyn AeadCipher>,
    command: Command,
    stream_id: u32,
) -> Result<()> {
    let frame = DataFrame {
        command,
        flags: 0,
        stream_id,
    };
    let frame_bytes = encode_data_frame(&frame);
    let nonce = session_keys.lock().await.next_client_nonce();
    let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes)?;
    let len = (encrypted.len() as u16).to_be_bytes();
    let mut tw = tunnel_write.lock().await;
    tw.write_all(&len).await?;
    tw.write_all(&encrypted).await?;
    Ok(())
}
