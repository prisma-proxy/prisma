use std::sync::atomic::Ordering;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;
use uuid::Uuid;

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
