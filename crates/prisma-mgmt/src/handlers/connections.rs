use std::collections::HashMap;
use std::net::IpAddr;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Serialize;
use uuid::Uuid;

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub city: Option<String>,
}

/// Extract IP from peer_addr (strip port and brackets).
fn extract_ip(peer_addr: &str) -> Option<IpAddr> {
    let ip_str = peer_addr
        .rsplit_once(':')
        .map(|(host, _port)| host)
        .unwrap_or(peer_addr);
    let ip_str = ip_str.trim_start_matches('[').trim_end_matches(']');
    ip_str.parse().ok()
}

/// Lookup country, city, lat, lon from an MMDB reader.
pub(crate) fn lookup_geo(
    reader: &maxminddb::Reader<Vec<u8>>,
    ip: IpAddr,
) -> (Option<String>, Option<String>, Option<f64>, Option<f64>) {
    let Ok(city): Result<maxminddb::geoip2::City, _> = reader.lookup(ip) else {
        return (None, None, None, None);
    };
    let country = city.country.and_then(|c| c.iso_code).map(|s| s.to_string());
    let city_name = city
        .city
        .and_then(|c| c.names)
        .and_then(|n| n.get("en").copied())
        .map(|s| s.to_string());
    let lat = city.location.as_ref().and_then(|l| l.latitude);
    let lon = city.location.as_ref().and_then(|l| l.longitude);
    (country, city_name, lat, lon)
}

/// Try to open the MMDB file from the config path.
pub(crate) fn open_mmdb(
    state_config: &prisma_core::config::server::ServerConfig,
) -> Option<maxminddb::Reader<Vec<u8>>> {
    let path = state_config.routing.geoip_path.as_deref()?;
    match maxminddb::Reader::open_readfile(path) {
        Ok(r) => Some(r),
        Err(e) => {
            tracing::warn!(error = %e, path, "Failed to open MMDB GeoIP database");
            None
        }
    }
}

pub async fn list(State(state): State<MgmtState>) -> Json<Vec<ConnectionResponse>> {
    let cfg = state.config.read().await;
    let reader = open_mmdb(&cfg);
    drop(cfg);

    let conns = state.connections.read().await;
    let now = chrono::Utc::now();
    let list: Vec<_> = conns
        .values()
        .map(|c| {
            let duration = now
                .signed_duration_since(c.connected_at)
                .num_seconds()
                .max(0) as u64;

            let (country, city) = reader
                .as_ref()
                .and_then(|r| {
                    extract_ip(&c.peer_addr).map(|ip| {
                        let (co, ci, _lat, _lon) = lookup_geo(r, ip);
                        (co, ci)
                    })
                })
                .unwrap_or((None, None));

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
                destination: c.destination.clone(),
                matched_rule: c.matched_rule.clone(),
                duration_secs: duration,
                country,
                city,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub city: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lon: Option<f64>,
    pub count: u32,
}

/// GET /api/connections/geo — city-level distribution of active connections.
pub async fn geo_summary(State(state): State<MgmtState>) -> Json<Vec<GeoEntry>> {
    let cfg = state.config.read().await;
    let reader = open_mmdb(&cfg);
    drop(cfg);

    let Some(reader) = reader else {
        return Json(Vec::new());
    };

    let conns = state.connections.read().await;

    // Aggregate by (country, city) pair
    type GeoKey = (String, Option<String>);
    type GeoVal = (u32, Option<f64>, Option<f64>);
    let mut counts: HashMap<GeoKey, GeoVal> = HashMap::new();

    for conn in conns.values() {
        if let Some(ip) = extract_ip(&conn.peer_addr) {
            let (country, city, lat, lon) = lookup_geo(&reader, ip);
            if let Some(code) = country {
                let key = (code, city);
                let entry = counts.entry(key).or_insert((0, lat, lon));
                entry.0 += 1;
                // Preserve lat/lon from first lookup
                if entry.1.is_none() {
                    entry.1 = lat;
                }
                if entry.2.is_none() {
                    entry.2 = lon;
                }
            }
        }
    }

    let mut entries: Vec<GeoEntry> = counts
        .into_iter()
        .map(|((country, city), (count, lat, lon))| GeoEntry {
            country,
            city,
            lat,
            lon,
            count,
        })
        .collect();
    entries.sort_by(|a, b| b.count.cmp(&a.count));

    Json(entries)
}

// ── POST /api/data/download-all ───────────────────────────────────────────

#[derive(Serialize)]
pub struct DataDownloadResult {
    pub name: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

async fn download_to_file(url: &str, path: &std::path::Path) -> Result<(), String> {
    let resp = reqwest::get(url).await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    tokio::fs::write(path, &bytes)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// POST /api/data/download-all — download GeoIP MMDB + GeoSite DAT to ./data/.
pub async fn download_all_data(State(state): State<MgmtState>) -> Json<Vec<DataDownloadResult>> {
    let data_dir = std::path::PathBuf::from(GEOIP_DATA_DIR);
    let _ = tokio::fs::create_dir_all(&data_dir).await;
    let mut results = Vec::new();

    // Download GeoIP
    let geoip_path = data_dir.join(GEOIP_FILE_NAME);
    match download_to_file(GEOIP_DOWNLOAD_URL, &geoip_path).await {
        Ok(()) => {
            let abs = geoip_path
                .canonicalize()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| geoip_path.display().to_string());
            results.push(DataDownloadResult {
                name: "GeoIP".into(),
                success: true,
                error: None,
                path: Some(abs),
            });
        }
        Err(e) => {
            results.push(DataDownloadResult {
                name: "GeoIP".into(),
                success: false,
                error: Some(e),
                path: None,
            });
        }
    }

    // Download GeoSite
    let geosite_path = data_dir.join(GEOSITE_FILE_NAME);
    match download_to_file(GEOSITE_DOWNLOAD_URL, &geosite_path).await {
        Ok(()) => {
            let abs = geosite_path
                .canonicalize()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| geosite_path.display().to_string());
            results.push(DataDownloadResult {
                name: "GeoSite".into(),
                success: true,
                error: None,
                path: Some(abs),
            });
        }
        Err(e) => {
            results.push(DataDownloadResult {
                name: "GeoSite".into(),
                success: false,
                error: Some(e),
                path: None,
            });
        }
    }

    // Auto-configure paths in server config
    {
        let mut cfg = state.config.write().await;
        cfg.routing.geoip_path = Some("./data/GeoLite2-City.mmdb".into());
        cfg.routing.geosite_path = Some("./data/geosite.dat".into());
    }
    state.persist_config().await;

    Json(results)
}

// ── POST /api/geoip/download ─────────────────────────────────────────────

const GEOIP_DOWNLOAD_URL: &str =
    "https://github.com/P3TERX/GeoLite.mmdb/raw/download/GeoLite2-City.mmdb";
const GEOIP_DATA_DIR: &str = "./data";
const GEOIP_FILE_NAME: &str = "GeoLite2-City.mmdb";

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

// ── POST /api/geosite/download ─────────────────────────────────────────────

const GEOSITE_DOWNLOAD_URL: &str =
    "https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat";
const GEOSITE_FILE_NAME: &str = "geosite.dat";

/// POST /api/geosite/download — download GeoSite domain-list and auto-configure.
pub async fn download_geosite(State(state): State<MgmtState>) -> impl IntoResponse {
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

    // 2. Download the GeoSite database
    let bytes = match reqwest::get(GEOSITE_DOWNLOAD_URL).await {
        Ok(resp) => {
            if !resp.status().is_success() {
                let status = resp.status();
                tracing::error!(%status, "GeoSite download returned non-success status");
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
                    tracing::error!(error = %e, "Failed to read GeoSite download body");
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
            tracing::error!(error = %e, "GeoSite download request failed");
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
    let save_path = format!("{}/{}", GEOIP_DATA_DIR, GEOSITE_FILE_NAME);
    if let Err(e) = tokio::fs::write(&save_path, &bytes).await {
        tracing::error!(error = %e, path = %save_path, "Failed to write GeoSite database");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "success": false,
                "error": format!("Failed to write file: {}", e)
            })),
        );
    }

    tracing::info!(path = %save_path, size = bytes.len(), "GeoSite database downloaded");

    // 4. Canonicalize to absolute path
    let save_path = std::path::Path::new(&save_path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(save_path);

    // 5. Update config with geosite_path on routing
    {
        let mut cfg = state.config.write().await;
        cfg.routing.geosite_path = Some(save_path.clone());
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
