use std::sync::atomic::Ordering;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tracing::{debug, info, warn};
use uuid::Uuid;

use prisma_core::state::ForwardEntry;

use crate::MgmtState;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct ForwardListResponse {
    pub forwards: Vec<ForwardInfo>,
}

#[derive(Serialize)]
pub struct ForwardInfo {
    pub remote_port: u16,
    pub name: String,
    pub client_id: Option<Uuid>,
    pub bind_addr: String,
    pub active_connections: usize,
    pub total_connections: u64,
    pub bytes_up: u64,
    pub bytes_down: u64,
    pub registered_at: String,
    pub protocol: String,
    pub allowed_ips: Vec<String>,
}

#[derive(Serialize)]
pub struct ForwardConnectionsResponse {
    pub remote_port: u16,
    pub connections: Vec<ForwardConnectionDetail>,
}

#[derive(Serialize)]
pub struct ForwardConnectionDetail {
    pub stream_id: u32,
    pub peer_addr: String,
    pub connected_at: String,
    pub bytes_up: u64,
    pub bytes_down: u64,
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

/// Request body for creating a new server-side port forward.
#[derive(Deserialize)]
pub struct CreateForwardRequest {
    /// Port to listen on.
    pub listen_port: u16,
    /// Target address to relay connections to (e.g., "127.0.0.1:3000").
    pub target_addr: String,
    /// Human-readable name for this forward.
    #[serde(default)]
    pub name: String,
    /// Bind address (defaults to "0.0.0.0").
    #[serde(default = "default_bind_addr")]
    pub bind_addr: String,
    /// IP CIDRs allowed to connect (empty = allow all).
    #[serde(default)]
    pub allowed_ips: Vec<String>,
}

/// Request body for updating an existing forward.
#[derive(Deserialize)]
pub struct UpdateForwardRequest {
    /// Target address to relay connections to (e.g., "127.0.0.1:3000").
    pub target_addr: String,
    /// Updated name.
    #[serde(default)]
    pub name: String,
    /// Bind address (defaults to "0.0.0.0").
    #[serde(default = "default_bind_addr")]
    pub bind_addr: String,
    /// IP CIDRs allowed to connect (empty = allow all).
    #[serde(default)]
    pub allowed_ips: Vec<String>,
}

/// JSON error body for forward operations.
#[derive(Serialize)]
pub(crate) struct ForwardError {
    error: String,
}

fn default_bind_addr() -> String {
    "0.0.0.0".into()
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/forwards — list all active port forwards with per-forward details.
pub async fn list(State(state): State<MgmtState>) -> Json<ForwardListResponse> {
    let registry = state.forward_registry.read().await;
    let forwards: Vec<ForwardInfo> = registry
        .values()
        .map(|entry| ForwardInfo {
            remote_port: entry.remote_port,
            name: entry.name.clone(),
            client_id: entry.client_id,
            bind_addr: entry.bind_addr.clone(),
            active_connections: entry.active_connections.load(Ordering::Relaxed),
            total_connections: entry.connections_total.load(Ordering::Relaxed),
            bytes_up: entry.bytes_up.load(Ordering::Relaxed),
            bytes_down: entry.bytes_down.load(Ordering::Relaxed),
            registered_at: entry.registered_at.to_rfc3339(),
            protocol: entry.protocol.clone(),
            allowed_ips: entry.allowed_ips.clone(),
        })
        .collect();
    Json(ForwardListResponse { forwards })
}

/// POST /api/forwards — create a new server-side port forward.
///
/// Binds a TCP listener on `listen_port` and relays each inbound connection
/// to `target_addr`. The forward is registered in the shared forward registry
/// so it appears in GET /api/forwards and can be managed via DELETE.
pub async fn create_forward(
    State(state): State<MgmtState>,
    Json(req): Json<CreateForwardRequest>,
) -> Result<(StatusCode, Json<ForwardInfo>), (StatusCode, Json<ForwardError>)> {
    let port = req.listen_port;

    // Validate: port not already in use
    {
        let registry = state.forward_registry.read().await;
        if registry.contains_key(&port) {
            return Err((
                StatusCode::CONFLICT,
                Json(ForwardError {
                    error: format!("port {} is already in use by an existing forward", port),
                }),
            ));
        }
    }

    // Validate: port within allowed range
    {
        let cfg = state.state.config.read().await;
        if cfg.port_forwarding.enabled && !cfg.port_forwarding.is_port_allowed(port) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ForwardError {
                    error: format!(
                        "port {} not in allowed range ({}-{}) or is denied",
                        port,
                        cfg.port_forwarding.port_range_start,
                        cfg.port_forwarding.port_range_end,
                    ),
                }),
            ));
        }
    }

    let bind_addr = format!("{}:{}", req.bind_addr, port);

    // Try to bind the listener
    let listener = TcpListener::bind(&bind_addr).await.map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(ForwardError {
                error: format!("failed to bind {}: {}", bind_addr, e),
            }),
        )
    })?;

    let name = if req.name.is_empty() {
        format!("mgmt-fwd-{}", port)
    } else {
        req.name
    };

    // Register entry
    let entry = Arc::new(ForwardEntry::new(
        port,
        name.clone(),
        None, // No client — management-created
        bind_addr.clone(),
        req.allowed_ips.clone(),
    ));
    {
        let mut registry = state.forward_registry.write().await;
        registry.insert(port, entry.clone());
    }

    info!(port, name = %name, bind = %bind_addr, target = %req.target_addr, "Management API: created server-side port forward");

    // Spawn standalone relay listener
    let target_addr = req.target_addr.clone();
    let allowed_ips = req.allowed_ips.clone();
    let forward_registry = state.forward_registry.clone();
    let entry_spawn = entry.clone();

    tokio::spawn(async move {
        run_standalone_forward_listener(listener, port, &target_addr, &entry_spawn, &allowed_ips)
            .await;
        // Remove from registry when listener stops
        forward_registry.write().await.remove(&port);
        info!(port, "Server-side forward listener stopped");
    });

    let info = ForwardInfo {
        remote_port: port,
        name,
        client_id: None,
        bind_addr,
        active_connections: 0,
        total_connections: 0,
        bytes_up: 0,
        bytes_down: 0,
        registered_at: entry.registered_at.to_rfc3339(),
        protocol: "tcp".into(),
        allowed_ips: req.allowed_ips,
    };

    Ok((StatusCode::CREATED, Json(info)))
}

/// PUT /api/forwards/:port — update an existing forward by replacing it.
///
/// Shuts down the current forward on the given port and creates a new one with
/// the updated configuration. Active connections on the old forward are closed.
pub async fn update_forward(
    State(state): State<MgmtState>,
    Path(port): Path<u16>,
    Json(req): Json<UpdateForwardRequest>,
) -> Result<Json<ForwardInfo>, (StatusCode, Json<ForwardError>)> {
    // Shut down existing forward
    {
        let mut registry = state.forward_registry.write().await;
        let entry = registry.remove(&port).ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ForwardError {
                    error: format!("no forward found on port {}", port),
                }),
            )
        })?;
        entry.request_shutdown();
    }

    // Small yield to let the old listener release the port
    tokio::task::yield_now().await;

    let bind_addr = format!("{}:{}", req.bind_addr, port);

    // Bind the new listener
    let listener = TcpListener::bind(&bind_addr).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ForwardError {
                error: format!("failed to re-bind {}: {}", bind_addr, e),
            }),
        )
    })?;

    let name = if req.name.is_empty() {
        format!("mgmt-fwd-{}", port)
    } else {
        req.name
    };

    let entry = Arc::new(ForwardEntry::new(
        port,
        name.clone(),
        None,
        bind_addr.clone(),
        req.allowed_ips.clone(),
    ));
    {
        let mut registry = state.forward_registry.write().await;
        registry.insert(port, entry.clone());
    }

    info!(port, name = %name, bind = %bind_addr, target = %req.target_addr, "Management API: updated server-side port forward");

    let target_addr = req.target_addr.clone();
    let allowed_ips = req.allowed_ips.clone();
    let forward_registry = state.forward_registry.clone();
    let entry_spawn = entry.clone();

    tokio::spawn(async move {
        run_standalone_forward_listener(listener, port, &target_addr, &entry_spawn, &allowed_ips)
            .await;
        forward_registry.write().await.remove(&port);
        info!(port, "Server-side forward listener stopped");
    });

    let info = ForwardInfo {
        remote_port: port,
        name,
        client_id: None,
        bind_addr,
        active_connections: 0,
        total_connections: 0,
        bytes_up: 0,
        bytes_down: 0,
        registered_at: entry.registered_at.to_rfc3339(),
        protocol: "tcp".into(),
        allowed_ips: req.allowed_ips,
    };

    Ok(Json(info))
}

/// DELETE /api/forwards/:port — forcefully close a forward.
pub async fn delete_forward(State(state): State<MgmtState>, Path(port): Path<u16>) -> StatusCode {
    let mut registry = state.forward_registry.write().await;
    if let Some(entry) = registry.remove(&port) {
        entry.request_shutdown();
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

/// GET /api/forwards/:port/connections — list active connections for a forward.
pub async fn list_connections(
    State(state): State<MgmtState>,
    Path(port): Path<u16>,
) -> Result<Json<ForwardConnectionsResponse>, StatusCode> {
    let registry = state.forward_registry.read().await;
    let entry = registry.get(&port).ok_or(StatusCode::NOT_FOUND)?;

    let conns = entry.active_conns.read().await;
    let connections: Vec<ForwardConnectionDetail> = conns
        .values()
        .map(|c| ForwardConnectionDetail {
            stream_id: c.stream_id,
            peer_addr: c.peer_addr.clone(),
            connected_at: c.connected_at.to_rfc3339(),
            bytes_up: c.bytes_up,
            bytes_down: c.bytes_down,
        })
        .collect();

    Ok(Json(ForwardConnectionsResponse {
        remote_port: port,
        connections,
    }))
}

// ---------------------------------------------------------------------------
// Standalone forward listener (server-side, no client tunnel)
// ---------------------------------------------------------------------------

/// Accept connections on `listener` and relay each to `target_addr` via plain TCP.
/// Runs until the forward's shutdown signal is received or the listener fails.
async fn run_standalone_forward_listener(
    listener: TcpListener,
    port: u16,
    target_addr: &str,
    entry: &Arc<ForwardEntry>,
    allowed_ips: &[String],
) {
    let mut shutdown_rx = entry.shutdown_tx.subscribe();
    let mut next_stream_id: u32 = 1;

    loop {
        let accept = tokio::select! {
            result = listener.accept() => result,
            _ = shutdown_rx.recv() => {
                info!(port, "Server-side forward listener shutting down (requested)");
                return;
            }
        };

        let (inbound, peer) = match accept {
            Ok(v) => v,
            Err(e) => {
                warn!(port, error = %e, "Accept error on server-side forward");
                continue;
            }
        };

        // IP whitelist check
        if !allowed_ips.is_empty() {
            let peer_ip = peer.ip();
            let allowed = allowed_ips.iter().any(|cidr| {
                // Exact IP match
                if let Ok(ip) = cidr.parse::<std::net::IpAddr>() {
                    return ip == peer_ip;
                }
                // CIDR match for IPv4
                if let std::net::IpAddr::V4(v4) = peer_ip {
                    if let Some((network, mask)) = prisma_core::router::parse_cidr_v4(cidr) {
                        return (u32::from(v4) & mask) == network;
                    }
                }
                false
            });
            if !allowed {
                warn!(port, peer = %peer, "Connection rejected: IP not in allowed list");
                drop(inbound);
                continue;
            }
        }

        let stream_id = next_stream_id;
        next_stream_id = next_stream_id.wrapping_add(1);

        entry.connections_total.fetch_add(1, Ordering::Relaxed);
        entry.active_connections.fetch_add(1, Ordering::Relaxed);

        {
            let mut conns = entry.active_conns.write().await;
            conns.insert(
                stream_id,
                prisma_core::state::ForwardConnectionInfo {
                    stream_id,
                    peer_addr: peer.to_string(),
                    connected_at: chrono::Utc::now(),
                    bytes_up: 0,
                    bytes_down: 0,
                },
            );
        }

        let target = target_addr.to_string();
        let entry_clone = entry.clone();

        tokio::spawn(async move {
            let (up, down) =
                relay_standalone_connection(inbound, &target, stream_id, &entry_clone).await;

            entry_clone
                .active_connections
                .fetch_sub(1, Ordering::Relaxed);
            entry_clone.bytes_up.fetch_add(up, Ordering::Relaxed);
            entry_clone.bytes_down.fetch_add(down, Ordering::Relaxed);
            entry_clone.active_conns.write().await.remove(&stream_id);

            debug!(
                stream_id,
                port = entry_clone.remote_port,
                bytes_up = up,
                bytes_down = down,
                "Server-side forwarded connection ended"
            );
        });
    }
}

/// Relay a single inbound TCP connection to the target address.
/// Returns (bytes_up, bytes_down) where up = inbound->target, down = target->inbound.
async fn relay_standalone_connection(
    inbound: TcpStream,
    target_addr: &str,
    stream_id: u32,
    entry: &Arc<ForwardEntry>,
) -> (u64, u64) {
    let outbound = match TcpStream::connect(target_addr).await {
        Ok(s) => s,
        Err(e) => {
            warn!(
                stream_id,
                target = target_addr,
                error = %e,
                "Failed to connect to forward target"
            );
            return (0, 0);
        }
    };

    let (mut in_read, mut in_write) = inbound.into_split();
    let (mut out_read, mut out_write) = outbound.into_split();

    let up_counter = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let down_counter = Arc::new(std::sync::atomic::AtomicU64::new(0));

    let up = up_counter.clone();
    let entry_up = entry.clone();
    let sid = stream_id;
    let inbound_to_target = tokio::spawn(async move {
        let mut buf = vec![0u8; 8192];
        loop {
            match tokio::io::AsyncReadExt::read(&mut in_read, &mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    up.fetch_add(n as u64, Ordering::Relaxed);
                    // Update live connection snapshot (best-effort)
                    if let Some(info) = entry_up.active_conns.write().await.get_mut(&sid) {
                        info.bytes_up = up.load(Ordering::Relaxed);
                    }
                    if out_write.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = out_write.shutdown().await;
    });

    let down = down_counter.clone();
    let entry_down = entry.clone();
    let sid = stream_id;
    let target_to_inbound = tokio::spawn(async move {
        let mut buf = vec![0u8; 8192];
        loop {
            match tokio::io::AsyncReadExt::read(&mut out_read, &mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    down.fetch_add(n as u64, Ordering::Relaxed);
                    if let Some(info) = entry_down.active_conns.write().await.get_mut(&sid) {
                        info.bytes_down = down.load(Ordering::Relaxed);
                    }
                    if in_write.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = in_write.shutdown().await;
    });

    // Wait for both directions to finish
    let _ = tokio::join!(inbound_to_target, target_to_inbound);

    (
        up_counter.load(Ordering::Relaxed),
        down_counter.load(Ordering::Relaxed),
    )
}
