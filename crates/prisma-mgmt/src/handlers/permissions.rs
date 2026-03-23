//! Client permissions management API endpoints.
//!
//! Provides granular control over what each client can do:
//! get/update permissions, kick/block clients.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;
use uuid::Uuid;

use prisma_core::permissions::{ClientPermissions, ClientPermissionsUpdate};

use crate::MgmtState;

/// GET /api/clients/:id/permissions -- Get permissions for a client.
pub async fn get_permissions(
    State(state): State<MgmtState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ClientPermissions>, StatusCode> {
    let id_str = id.to_string();

    // Verify client exists
    {
        let auth = state.auth_store.read().await;
        if !auth.clients.contains_key(&id) {
            return Err(StatusCode::NOT_FOUND);
        }
    }

    let perms = state.state.permission_store.get_permissions(&id_str).await;
    Ok(Json(perms))
}

/// PUT /api/clients/:id/permissions -- Update permissions (partial update).
pub async fn update_permissions(
    State(state): State<MgmtState>,
    Path(id): Path<Uuid>,
    Json(update): Json<ClientPermissionsUpdate>,
) -> Result<StatusCode, StatusCode> {
    let id_str = id.to_string();

    // Verify client exists
    {
        let auth = state.auth_store.read().await;
        if !auth.clients.contains_key(&id) {
            return Err(StatusCode::NOT_FOUND);
        }
    }

    state
        .state
        .permission_store
        .update_permissions(&id_str, &update)
        .await;

    Ok(StatusCode::OK)
}

/// POST /api/clients/:id/kick -- Disconnect a client immediately.
/// Removes all active connections for this client.
pub async fn kick_client(
    State(state): State<MgmtState>,
    Path(id): Path<Uuid>,
) -> Result<Json<KickResponse>, StatusCode> {
    // Verify client exists
    {
        let auth = state.auth_store.read().await;
        if !auth.clients.contains_key(&id) {
            return Err(StatusCode::NOT_FOUND);
        }
    }

    // Remove all connections belonging to this client
    let mut conns = state.state.connections.write().await;
    let before = conns.len();
    conns.retain(|_, conn| conn.client_id != Some(id));
    let removed = before - conns.len();

    Ok(Json(KickResponse {
        client_id: id,
        connections_removed: removed,
    }))
}

#[derive(Serialize)]
pub struct KickResponse {
    pub client_id: Uuid,
    pub connections_removed: usize,
}

/// POST /api/clients/:id/block -- Block a client (revoke auth).
/// Blocks the client and disconnects all their active connections.
pub async fn block_client(
    State(state): State<MgmtState>,
    Path(id): Path<Uuid>,
) -> Result<Json<BlockResponse>, StatusCode> {
    let id_str = id.to_string();

    // Verify client exists
    {
        let auth = state.auth_store.read().await;
        if !auth.clients.contains_key(&id) {
            return Err(StatusCode::NOT_FOUND);
        }
    }

    // Block the client in the permission store
    state.state.permission_store.block_client(&id_str).await;

    // Disable the client in the auth store
    {
        let mut auth = state.auth_store.write().await;
        if let Some(entry) = auth.clients.get_mut(&id) {
            entry.enabled = false;
        }
    }

    // Remove all connections belonging to this client
    let mut conns = state.state.connections.write().await;
    let before = conns.len();
    conns.retain(|_, conn| conn.client_id != Some(id));
    let removed = before - conns.len();

    Ok(Json(BlockResponse {
        client_id: id,
        blocked: true,
        connections_removed: removed,
    }))
}

#[derive(Serialize)]
pub struct BlockResponse {
    pub client_id: Uuid,
    pub blocked: bool,
    pub connections_removed: usize,
}

/// DELETE /api/clients/:id/block -- Unblock a client.
pub async fn unblock_client(
    State(state): State<MgmtState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let id_str = id.to_string();

    // Verify client exists
    {
        let auth = state.auth_store.read().await;
        if !auth.clients.contains_key(&id) {
            return Err(StatusCode::NOT_FOUND);
        }
    }

    // Unblock in permission store
    state.state.permission_store.unblock_client(&id_str).await;

    // Re-enable in auth store
    {
        let mut auth = state.auth_store.write().await;
        if let Some(entry) = auth.clients.get_mut(&id) {
            entry.enabled = true;
        }
    }

    Ok(StatusCode::OK)
}

/// GET /api/clients/permissions/defaults -- Get default permissions template.
pub async fn get_defaults(State(state): State<MgmtState>) -> Json<ClientPermissions> {
    let defaults = state.state.permission_store.get_defaults().await;
    Json(defaults)
}

/// PUT /api/clients/permissions/defaults -- Set default permissions template.
pub async fn set_defaults(
    State(state): State<MgmtState>,
    Json(defaults): Json<ClientPermissions>,
) -> StatusCode {
    state.state.permission_store.set_defaults(defaults).await;
    StatusCode::OK
}
