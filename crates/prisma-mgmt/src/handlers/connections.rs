use std::collections::HashMap;
use std::net::Ipv4Addr;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Serialize;
use uuid::Uuid;

use prisma_core::geodata::GeoIPMatcher;
use prisma_core::state::{SessionMode, Transport};

use crate::MgmtState;

#[derive(Serialize)]
pub struct ConnectionResponse {
    pub session_id: Uuid,
    pub client_id: Option<Uuid>,
    pub client_name: Option<String>,
    pub peer_addr: String,
    pub transport: Transport,
    pub mode: SessionMode,
    pub connected_at: String,
    pub bytes_up: u64,
    pub bytes_down: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_rule: Option<String>,
    pub duration_secs: u64,
}

pub async fn list(State(state): State<MgmtState>) -> Json<Vec<ConnectionResponse>> {
    let conns = state.connections.read().await;
    let now = chrono::Utc::now();
    let list: Vec<_> = conns
        .values()
        .map(|c| {
            let duration = now
                .signed_duration_since(c.connected_at)
                .num_seconds()
                .max(0) as u64;
            ConnectionResponse {
                session_id: c.session_id,
                client_id: c.client_id,
                client_name: c.client_name.clone(),
                peer_addr: c.peer_addr.clone(),
                transport: c.transport,
                mode: c.mode,
                connected_at: c.connected_at.to_rfc3339(),
                bytes_up: c.bytes_up_val(),
                bytes_down: c.bytes_down_val(),
                destination: None,
                matched_rule: None,
                duration_secs: duration,
            }
        })
        .collect();
    Json(list)
}

pub async fn disconnect(State(state): State<MgmtState>, Path(id): Path<Uuid>) -> StatusCode {
    let mut conns = state.connections.write().await;
    if conns.remove(&id).is_some() {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

#[derive(Serialize)]
pub struct GeoEntry {
    pub country: String,
    pub count: u32,
}

/// GET /api/connections/geo — country distribution of active connections.
pub async fn geo_summary(State(state): State<MgmtState>) -> Json<Vec<GeoEntry>> {
    // Read GeoIP path from config; if not configured, return empty.
    let geoip_path = {
        let cfg = state.config.read().await;
        cfg.routing.geoip_path.clone()
    };

    let Some(path) = geoip_path else {
        return Json(Vec::new());
    };

    // Load the GeoIP matcher. If the file can't be loaded, return empty.
    let matcher = match GeoIPMatcher::load(&path) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!(error = %e, "Failed to load GeoIP database for geo summary");
            return Json(Vec::new());
        }
    };

    let conns = state.connections.read().await;
    let mut counts: HashMap<String, u32> = HashMap::new();

    for conn in conns.values() {
        // Strip port from peer_addr (formats: "1.2.3.4:1234" or "[::1]:1234")
        let ip_str = conn
            .peer_addr
            .rsplit_once(':')
            .map(|(host, _port)| host)
            .unwrap_or(&conn.peer_addr);
        // Remove surrounding brackets for IPv6
        let ip_str = ip_str.trim_start_matches('[').trim_end_matches(']');

        if let Ok(ipv4) = ip_str.parse::<Ipv4Addr>() {
            if let Some(country) = matcher.lookup(ipv4) {
                *counts.entry(country.to_uppercase()).or_insert(0) += 1;
            }
        }
        // IPv6 addresses are silently skipped since GeoIPMatcher only supports IPv4.
    }

    let mut entries: Vec<GeoEntry> = counts
        .into_iter()
        .map(|(country, count)| GeoEntry { country, count })
        .collect();
    entries.sort_by(|a, b| b.count.cmp(&a.count));

    Json(entries)
}

// ── POST /api/geoip/download ─────────────────────────────────────────────

const GEOIP_DOWNLOAD_URL: &str =
    "https://github.com/P3TERX/GeoLite.mmdb/raw/download/GeoLite2-Country.mmdb";
const GEOIP_DATA_DIR: &str = "./data";
const GEOIP_FILE_NAME: &str = "GeoLite2-Country.mmdb";

/// POST /api/geoip/download — download GeoIP MMDB and auto-configure.
pub async fn download_geoip(State(state): State<MgmtState>) -> impl IntoResponse {
    // 1. Create data directory if it doesn't exist
    if let Err(e) = tokio::fs::create_dir_all(GEOIP_DATA_DIR).await {
        tracing::error!(error = %e, "Failed to create data directory");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "success": false,
                "error": format!("Failed to create data directory: {}", e)
            })),
        );
    }

    // 2. Download the GeoIP database
    let bytes = match reqwest::get(GEOIP_DOWNLOAD_URL).await {
        Ok(resp) => {
            if !resp.status().is_success() {
                let status = resp.status();
                tracing::error!(%status, "GeoIP download returned non-success status");
                return (
                    StatusCode::BAD_GATEWAY,
                    Json(serde_json::json!({
                        "success": false,
                        "error": format!("Download failed with HTTP status {}", status)
                    })),
                );
            }
            match resp.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    tracing::error!(error = %e, "Failed to read GeoIP download body");
                    return (
                        StatusCode::BAD_GATEWAY,
                        Json(serde_json::json!({
                            "success": false,
                            "error": format!("Failed to read download response: {}", e)
                        })),
                    );
                }
            }
        }
        Err(e) => {
            tracing::error!(error = %e, "GeoIP download request failed");
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({
                    "success": false,
                    "error": format!("Download request failed: {}", e)
                })),
            );
        }
    };

    // 3. Save to disk
    let save_path = format!("{}/{}", GEOIP_DATA_DIR, GEOIP_FILE_NAME);
    if let Err(e) = tokio::fs::write(&save_path, &bytes).await {
        tracing::error!(error = %e, path = %save_path, "Failed to write GeoIP database");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "success": false,
                "error": format!("Failed to write file: {}", e)
            })),
        );
    }

    tracing::info!(path = %save_path, size = bytes.len(), "GeoIP database downloaded");

    // 4. Canonicalize to absolute path so it resolves regardless of CWD
    let save_path = std::path::Path::new(&save_path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(save_path);

    // 5. Update config with geoip_path
    {
        let mut cfg = state.config.write().await;
        cfg.routing.geoip_path = Some(save_path.clone());
    }

    // 6. Persist config to disk
    state.persist_config().await;

    // 7. Return success
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "success": true,
            "path": save_path
        })),
    )
}
