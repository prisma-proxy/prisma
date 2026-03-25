use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use prisma_core::state::ClientEntry;

use crate::MgmtState;

#[derive(Serialize)]
pub struct ClientResponse {
    pub id: Uuid,
    pub name: Option<String>,
    pub enabled: bool,
    pub tags: Vec<String>,
}

#[derive(Deserialize)]
pub struct CreateClientRequest {
    pub name: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Serialize)]
pub struct CreateClientResponse {
    pub id: Uuid,
    pub name: Option<String>,
    pub auth_secret_hex: String,
}

#[derive(Deserialize)]
pub struct UpdateClientRequest {
    pub name: Option<String>,
    pub enabled: Option<bool>,
    pub tags: Option<Vec<String>>,
}

pub async fn list(State(state): State<MgmtState>) -> Json<Vec<ClientResponse>> {
    let store = state.auth_store.read().await;
    let clients: Vec<_> = store
        .clients
        .iter()
        .map(|(id, entry)| ClientResponse {
            id: *id,
            name: entry.name.clone(),
            enabled: entry.enabled,
            tags: entry.tags.clone(),
        })
        .collect();
    Json(clients)
}

pub async fn create(
    State(state): State<MgmtState>,
    Json(req): Json<CreateClientRequest>,
) -> Result<Json<CreateClientResponse>, StatusCode> {
    let id = Uuid::new_v4();

    // Generate random auth secret
    let mut secret = [0u8; 32];
    rand::Rng::fill(&mut rand::thread_rng(), &mut secret);
    let hex = prisma_core::util::hex_encode(&secret);

    let entry = ClientEntry {
        auth_secret: secret,
        name: req.name.clone(),
        enabled: true,
        tags: req.tags.clone().unwrap_or_default(),
    };

    state.auth_store.write().await.clients.insert(id, entry);

    // Persist to config file
    state.sync_clients_to_config().await;
    state.persist_config().await;

    Ok(Json(CreateClientResponse {
        id,
        name: req.name,
        auth_secret_hex: hex,
    }))
}

pub async fn update(
    State(state): State<MgmtState>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateClientRequest>,
) -> StatusCode {
    let result = {
        let mut store = state.auth_store.write().await;
        match store.clients.get_mut(&id) {
            Some(entry) => {
                if let Some(name) = req.name {
                    entry.name = Some(name);
                }
                if let Some(enabled) = req.enabled {
                    entry.enabled = enabled;
                }
                if let Some(tags) = req.tags {
                    entry.tags = tags;
                }
                true
            }
            None => false,
        }
    };

    if result {
        state.sync_clients_to_config().await;
        state.persist_config().await;
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

pub async fn remove(State(state): State<MgmtState>, Path(id): Path<Uuid>) -> StatusCode {
    let removed = {
        let mut store = state.auth_store.write().await;
        store.clients.remove(&id).is_some()
    };

    if removed {
        state.sync_clients_to_config().await;
        state.persist_config().await;
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}
