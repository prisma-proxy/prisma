//! Management API handlers for multi-protocol inbound configuration.
//!
//! Provides REST endpoints to list, inspect, and manage inbound protocol listeners
//! (VMess, VLESS, Shadowsocks, Trojan) and their associated clients.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::MgmtState;

/// Summary of an inbound listener for the list endpoint.
#[derive(Serialize)]
pub struct InboundSummary {
    pub tag: String,
    pub protocol: String,
    pub listen: String,
    pub transport: String,
    pub enabled: bool,
    pub client_count: usize,
}

/// Detailed view of an inbound listener.
#[derive(Serialize)]
pub struct InboundDetail {
    pub tag: String,
    pub protocol: String,
    pub listen: String,
    pub transport: String,
    pub enabled: bool,
    pub transport_settings: TransportSettingsView,
    pub clients: Vec<InboundClientView>,
    /// Shadowsocks-specific: cipher method.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
}

#[derive(Serialize)]
pub struct TransportSettingsView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_name: Option<String>,
}

#[derive(Serialize)]
pub struct InboundClientView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flow: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alter_id: Option<u16>,
    /// For Trojan: indicates password is set (never expose actual password).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_password: Option<bool>,
}

/// Request body for adding/removing clients from an inbound.
#[derive(Deserialize)]
pub struct UpdateClientsRequest {
    /// Clients to add.
    #[serde(default)]
    pub add: Vec<AddClientRequest>,
    /// Client IDs/emails to remove.
    #[serde(default)]
    pub remove: Vec<String>,
}

#[derive(Deserialize)]
pub struct AddClientRequest {
    /// UUID (VMess/VLESS).
    #[serde(default)]
    pub id: Option<String>,
    /// Alter ID (VMess).
    #[serde(default)]
    pub alter_id: Option<u16>,
    /// Flow control (VLESS).
    #[serde(default)]
    pub flow: Option<String>,
    /// Password (Trojan).
    #[serde(default)]
    pub password: Option<String>,
    /// Email/name for identification.
    #[serde(default)]
    pub email: Option<String>,
}

/// GET /api/inbounds — list all configured inbound protocol listeners.
pub async fn list_inbounds(State(state): State<MgmtState>) -> impl IntoResponse {
    let config = state.state.config.read().await;
    let inbounds: Vec<InboundSummary> = config
        .inbounds
        .iter()
        .map(|ib| {
            let client_count = if ib.protocol == "shadowsocks" {
                // Shadowsocks uses password-based auth, not per-client
                if ib.settings.password.is_some() {
                    1
                } else {
                    0
                }
            } else {
                ib.settings.clients.len()
            };
            InboundSummary {
                tag: ib.tag.clone(),
                protocol: ib.protocol.clone(),
                listen: ib.listen.clone(),
                transport: ib.transport.clone(),
                enabled: ib.enabled,
                client_count,
            }
        })
        .collect();

    Json(inbounds)
}

/// GET /api/inbounds/:tag — get detailed info for a specific inbound.
pub async fn get_inbound(
    State(state): State<MgmtState>,
    Path(tag): Path<String>,
) -> impl IntoResponse {
    let config = state.state.config.read().await;
    let inbound = config.inbounds.iter().find(|ib| ib.tag == tag);

    match inbound {
        Some(ib) => {
            let clients: Vec<InboundClientView> = ib
                .settings
                .clients
                .iter()
                .map(|c| InboundClientView {
                    id: c.id.clone(),
                    email: c.email.clone(),
                    flow: c.flow.clone(),
                    alter_id: c.alter_id,
                    has_password: c.password.as_ref().map(|p| !p.is_empty()),
                })
                .collect();

            let detail = InboundDetail {
                tag: ib.tag.clone(),
                protocol: ib.protocol.clone(),
                listen: ib.listen.clone(),
                transport: ib.transport.clone(),
                enabled: ib.enabled,
                transport_settings: TransportSettingsView {
                    path: ib.transport_settings.path.clone(),
                    service_name: ib.transport_settings.service_name.clone(),
                },
                clients,
                method: ib.settings.method.clone(),
            };

            (StatusCode::OK, Json(serde_json::to_value(detail).unwrap())).into_response()
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": format!("Inbound '{}' not found", tag)
            })),
        )
            .into_response(),
    }
}

/// PUT /api/inbounds/:tag/clients — add or remove clients from an inbound.
pub async fn update_inbound_clients(
    State(state): State<MgmtState>,
    Path(tag): Path<String>,
    Json(body): Json<UpdateClientsRequest>,
) -> impl IntoResponse {
    let mut config = state.state.config.write().await;
    let inbound = config.inbounds.iter_mut().find(|ib| ib.tag == tag);

    match inbound {
        Some(ib) => {
            // Remove clients by ID or email
            for remove_key in &body.remove {
                ib.settings.clients.retain(|c| {
                    let matches_id = c.id.as_deref() == Some(remove_key.as_str());
                    let matches_email = c.email.as_deref() == Some(remove_key.as_str());
                    let matches_password = c.password.as_deref() == Some(remove_key.as_str());
                    !(matches_id || matches_email || matches_password)
                });
            }

            // Add new clients
            for add in &body.add {
                let new_client = prisma_core::config::server::InboundClient {
                    id: add.id.clone(),
                    alter_id: add.alter_id,
                    security: None,
                    flow: add.flow.clone(),
                    password: add.password.clone(),
                    email: add.email.clone(),
                };
                ib.settings.clients.push(new_client);
            }

            let client_count = ib.settings.clients.len();
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "tag": tag,
                    "added": body.add.len(),
                    "removed": body.remove.len(),
                    "total_clients": client_count,
                })),
            )
                .into_response()
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": format!("Inbound '{}' not found", tag)
            })),
        )
            .into_response(),
    }
}
