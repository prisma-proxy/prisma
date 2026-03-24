use std::collections::HashMap;
use std::net::Ipv4Addr;

use axum::extract::{Path, State};
use axum::http::StatusCode;
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
