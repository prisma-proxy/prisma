use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use prisma_core::config::server::UserRole;
use prisma_core::state::ClientEntry;

use crate::auth::UserInfo;
use crate::db;
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

/// Get the set of client IDs owned by a user. Returns `None` for admin/operator (no filtering).
pub async fn owned_client_ids(user: &UserInfo, state: &MgmtState) -> Option<Vec<String>> {
    if matches!(user.role, UserRole::Admin | UserRole::Operator) {
        return None; // Admin/Operator see everything
    }
    if let Some(ref database) = state.db {
        return Some(db::clients_by_owner(database, &user.username));
    }
    let cfg = state.config.read().await;
    Some(
        cfg.authorized_clients
            .iter()
            .filter(|c| c.owner.as_deref() == Some(&user.username))
            .map(|c| c.id.clone())
            .collect(),
    )
}

pub async fn list(State(state): State<MgmtState>, user: UserInfo) -> Json<Vec<ClientResponse>> {
    let owned = owned_client_ids(&user, &state).await;
    let store = state.auth_store.read().await;
    let clients: Vec<_> = store
        .clients
        .iter()
        .filter(|(id, _)| match &owned {
            Some(ids) => ids.iter().any(|oid| oid == &id.to_string()),
            None => true,
        })
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
    let (secret, hex) = db::generate_client_secret();

    let entry = ClientEntry {
        auth_secret: secret,
        name: req.name.clone(),
        enabled: true,
        tags: req.tags.clone().unwrap_or_default(),
    };

    state.auth_store.write().await.clients.insert(id, entry);

    // Persist to SQLite
    if let Some(ref database) = state.db {
        let db_client = db::DbClient {
            id: id.to_string(),
            auth_secret: hex.clone(),
            name: req.name.clone(),
            enabled: true,
            owner: None,
            bandwidth_up: None,
            bandwidth_down: None,
            quota: None,
            quota_period: None,
            tags: req.tags.clone().unwrap_or_default(),
        };
        db::insert_client(database, &db_client).ok();
    }

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
                if let Some(ref name) = req.name {
                    entry.name = Some(name.clone());
                }
                if let Some(enabled) = req.enabled {
                    entry.enabled = enabled;
                }
                if let Some(ref tags) = req.tags {
                    entry.tags = tags.clone();
                }
                true
            }
            None => false,
        }
    };

    if result {
        // Sync to SQLite
        if let Some(ref database) = state.db {
            db::update_client(
                database,
                &id.to_string(),
                req.name.as_deref(),
                req.enabled,
                req.tags.as_deref(),
            );
        }

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
        // Remove from SQLite
        if let Some(ref database) = state.db {
            db::delete_client(database, &id.to_string());
        }

        state.sync_clients_to_config().await;
        state.persist_config().await;
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

// -- GET /api/clients/{id}/secret ─────────────────────────────────────────

#[derive(Serialize)]
pub struct ClientSecretResponse {
    pub client_id: String,
    pub auth_secret: String,
}

pub async fn get_secret(
    State(state): State<MgmtState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ClientSecretResponse>, StatusCode> {
    // Try SQLite first
    if let Some(ref database) = state.db {
        if let Some(c) = db::get_client(database, &id.to_string()) {
            return Ok(Json(ClientSecretResponse {
                client_id: c.id,
                auth_secret: c.auth_secret,
            }));
        }
    }

    let cfg = state.config.read().await;
    let id_str = id.to_string();

    let client = cfg
        .authorized_clients
        .iter()
        .find(|c| c.id == id_str)
        .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(ClientSecretResponse {
        client_id: client.id.clone(),
        auth_secret: client.auth_secret.clone(),
    }))
}

// -- POST /api/clients/share ──────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ShareClientRequest {
    pub client_id: Uuid,
}

#[derive(Serialize)]
pub struct ShareClientResponse {
    pub toml: String,
    pub uri: String,
    pub qr_svg: String,
}

pub async fn share(
    State(state): State<MgmtState>,
    Json(req): Json<ShareClientRequest>,
) -> Result<Json<ShareClientResponse>, StatusCode> {
    let cfg = state.config.read().await;
    let id_str = req.client_id.to_string();

    // Find the client's auth_secret — try SQLite first, then fall back to config
    let db_client = state
        .db
        .as_ref()
        .and_then(|database| db::get_client(database, &id_str));

    let (client_id, auth_secret) = if let Some(c) = db_client {
        (c.id, c.auth_secret)
    } else {
        let c = cfg
            .authorized_clients
            .iter()
            .find(|c| c.id == id_str)
            .ok_or(StatusCode::NOT_FOUND)?;
        (c.id.clone(), c.auth_secret.clone())
    };

    // Determine transport from server config
    let transport = if cfg.cdn.enabled { "websocket" } else { "quic" };
    let server_addr = cfg.public_address.as_deref().unwrap_or(&cfg.listen_addr);

    let config_json = serde_json::json!({
        "server_addr": server_addr,
        "identity": {
            "client_id": client_id,
            "auth_secret": auth_secret,
        },
        "transport": transport,
    });

    let config_json_str =
        serde_json::to_string(&config_json).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let client_config: prisma_core::config::client::ClientConfig =
        serde_json::from_value(config_json.clone())
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let toml_str =
        toml::to_string_pretty(&client_config).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let encoded = URL_SAFE_NO_PAD.encode(config_json_str.as_bytes());
    let uri = format!("prisma://{}", encoded);

    let qr_code =
        qrcode::QrCode::new(uri.as_bytes()).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let qr_svg = qr_code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(200, 200)
        .build();

    Ok(Json(ShareClientResponse {
        toml: toml_str,
        uri,
        qr_svg,
    }))
}
