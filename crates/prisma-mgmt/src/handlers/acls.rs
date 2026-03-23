use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;

use prisma_core::acl::Acl;

use crate::MgmtState;

/// List all ACLs.
pub async fn list(State(state): State<MgmtState>) -> Json<Vec<Acl>> {
    let acls = state.state.acl_store.list().await;
    Json(acls)
}

/// Get ACL for a specific client.
pub async fn get(
    State(state): State<MgmtState>,
    Path(client_id): Path<String>,
) -> Result<Json<Acl>, StatusCode> {
    match state.state.acl_store.get(&client_id).await {
        Some(acl) => Ok(Json(acl)),
        None => Err(StatusCode::NOT_FOUND),
    }
}

/// Set (create or replace) ACL for a client.
pub async fn set(
    State(state): State<MgmtState>,
    Path(client_id): Path<String>,
    Json(mut acl): Json<Acl>,
) -> StatusCode {
    // Ensure client_id in path matches the ACL body
    acl.client_id = client_id.clone();
    state.state.acl_store.set(client_id, acl).await;
    StatusCode::OK
}

/// Remove ACL for a client.
pub async fn remove(State(state): State<MgmtState>, Path(client_id): Path<String>) -> StatusCode {
    if state.state.acl_store.remove(&client_id).await {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}
