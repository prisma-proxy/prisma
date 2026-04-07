//! Config section CRUD endpoints (v14+ DB-first configuration).
//!
//! Each section is stored as a JSON blob in the `server_config` SQLite table.
//! Writes validate the JSON against the known config struct before saving.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;

use prisma_core::config::server::{
    AntiRttConfig, CamouflageConfig, CdnConfig, DnsUpstreamConfig, FallbackConfig, MiscConfig,
    PaddingConfig, PerformanceConfig, PortForwardingConfig, PrismaTlsConfig, SshServerConfig,
    CONFIG_SECTIONS,
};
use prisma_core::config::LoggingConfig;

use crate::db;
use crate::MgmtState;

// ─────────────────────────── Response types ────────────────────────────

#[derive(Serialize)]
pub struct SectionListResponse {
    pub sections: Vec<SectionEntry>,
}

#[derive(Serialize)]
pub struct SectionEntry {
    pub section: String,
    pub config: serde_json::Value,
}

#[derive(Serialize)]
pub struct SectionUpdateResponse {
    pub success: bool,
    pub restart_required: bool,
    pub message: String,
}

// ─────────────────────────── Handlers ──────────────────────────────────

/// GET /api/config/sections — list all config sections
pub async fn list_sections(
    State(state): State<MgmtState>,
) -> Result<Json<SectionListResponse>, StatusCode> {
    let db = state.require_db()?;
    let rows = db::list_config_sections(db);

    let mut sections: Vec<SectionEntry> = rows
        .into_iter()
        .filter_map(|(section, json)| {
            serde_json::from_str(&json)
                .ok()
                .map(|config| SectionEntry { section, config })
        })
        .collect();

    // Add defaults for any missing sections
    for &name in CONFIG_SECTIONS {
        if !sections.iter().any(|s| s.section == name) {
            if let Some(default_json) = default_section_json(name) {
                sections.push(SectionEntry {
                    section: name.to_string(),
                    config: default_json,
                });
            }
        }
    }

    sections.sort_by(|a, b| a.section.cmp(&b.section));

    Ok(Json(SectionListResponse { sections }))
}

/// GET /api/config/sections/{section} — get one section
pub async fn get_section(
    State(state): State<MgmtState>,
    Path(section): Path<String>,
) -> Result<Json<SectionEntry>, StatusCode> {
    let db = state.require_db()?;

    let json_str = db::get_config_section(db, &section);
    let config: serde_json::Value = match json_str {
        Some(s) => serde_json::from_str(&s).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
        None => default_section_json(&section).ok_or(StatusCode::NOT_FOUND)?,
    };

    Ok(Json(SectionEntry { section, config }))
}

/// PUT /api/config/sections/{section} — validate + save + hot-reload
pub async fn update_section(
    State(state): State<MgmtState>,
    Path(section): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<SectionUpdateResponse>, (StatusCode, String)> {
    let db = state
        .require_db()
        .map_err(|s| (s, "DB unavailable".into()))?;

    // Validate by deserializing into the appropriate config struct
    let json_str = serde_json::to_string(&body)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid JSON: {e}")))?;

    validate_section_json(&section, &json_str)?;

    // Save to DB
    db::set_config_section(db, &section, &json_str);

    // Update in-memory config
    let restart_required = apply_section_to_runtime(&state, &section, &json_str).await;

    // Broadcast reload event
    let _ = state.reload_tx.send(prisma_core::state::ReloadEvent {
        timestamp: chrono::Utc::now(),
        success: true,
        message: format!("Config section '{}' updated", section),
        changes: vec![format!("section:{}", section)],
    });

    // Increment reload notify
    state.reload_notify_tx.send_modify(|v| *v += 1);

    let message = if restart_required {
        format!(
            "Section '{}' updated. Server restart required for changes to take effect.",
            section
        )
    } else {
        format!("Section '{}' updated and applied.", section)
    };

    Ok(Json(SectionUpdateResponse {
        success: true,
        restart_required,
        message,
    }))
}

// ─────────────────────────── Validation ────────────────────────────────

fn validate_section_json(section: &str, json: &str) -> Result<(), (StatusCode, String)> {
    let err = |msg: String| (StatusCode::BAD_REQUEST, msg);

    match section {
        "logging" => {
            serde_json::from_str::<LoggingConfig>(json)
                .map_err(|e| err(format!("Invalid logging config: {e}")))?;
        }
        "performance" => {
            serde_json::from_str::<PerformanceConfig>(json)
                .map_err(|e| err(format!("Invalid performance config: {e}")))?;
        }
        "port_forwarding" => {
            serde_json::from_str::<PortForwardingConfig>(json)
                .map_err(|e| err(format!("Invalid port_forwarding config: {e}")))?;
        }
        "camouflage" => {
            serde_json::from_str::<CamouflageConfig>(json)
                .map_err(|e| err(format!("Invalid camouflage config: {e}")))?;
        }
        "cdn" => {
            serde_json::from_str::<CdnConfig>(json)
                .map_err(|e| err(format!("Invalid cdn config: {e}")))?;
        }
        "padding" => {
            let p: PaddingConfig = serde_json::from_str(json)
                .map_err(|e| err(format!("Invalid padding config: {e}")))?;
            if p.min > p.max {
                return Err(err("padding.min must be <= padding.max".into()));
            }
        }
        "congestion" => {
            serde_json::from_str::<prisma_core::config::client::CongestionConfig>(json)
                .map_err(|e| err(format!("Invalid congestion config: {e}")))?;
        }
        "port_hopping" => {
            serde_json::from_str::<prisma_core::port_hop::PortHoppingConfig>(json)
                .map_err(|e| err(format!("Invalid port_hopping config: {e}")))?;
        }
        "dns_upstream" => {
            serde_json::from_str::<DnsUpstreamConfig>(json)
                .map_err(|e| err(format!("Invalid dns_upstream config: {e}")))?;
        }
        "prisma_tls" => {
            serde_json::from_str::<PrismaTlsConfig>(json)
                .map_err(|e| err(format!("Invalid prisma_tls config: {e}")))?;
        }
        "traffic_shaping" => {
            serde_json::from_str::<prisma_core::traffic_shaping::TrafficShapingConfig>(json)
                .map_err(|e| err(format!("Invalid traffic_shaping config: {e}")))?;
        }
        "anti_rtt" => {
            serde_json::from_str::<AntiRttConfig>(json)
                .map_err(|e| err(format!("Invalid anti_rtt config: {e}")))?;
        }
        "routing" => {
            serde_json::from_str::<prisma_core::router::RoutingConfig>(json)
                .map_err(|e| err(format!("Invalid routing config: {e}")))?;
        }
        "wireguard" => {
            serde_json::from_str::<prisma_core::wireguard::WireGuardServerConfig>(json)
                .map_err(|e| err(format!("Invalid wireguard config: {e}")))?;
        }
        "fallback" => {
            serde_json::from_str::<FallbackConfig>(json)
                .map_err(|e| err(format!("Invalid fallback config: {e}")))?;
        }
        "ssh" => {
            serde_json::from_str::<SshServerConfig>(json)
                .map_err(|e| err(format!("Invalid ssh config: {e}")))?;
        }
        "misc" => {
            serde_json::from_str::<MiscConfig>(json)
                .map_err(|e| err(format!("Invalid misc config: {e}")))?;
        }
        _ => {
            return Err(err(format!("Unknown config section: {section}")));
        }
    }

    Ok(())
}

// ─────────────────────── Apply to runtime config ──────────────────────

/// Apply a validated section JSON to the in-memory ServerConfig.
/// Returns `true` if a server restart is required (e.g., listen address changes).
async fn apply_section_to_runtime(state: &MgmtState, section: &str, json: &str) -> bool {
    let mut cfg = state.state.config.write().await;

    match section {
        "logging" => {
            if let Ok(v) = serde_json::from_str(json) {
                cfg.logging = v;
            }
        }
        "performance" => {
            if let Ok(v) = serde_json::from_str(json) {
                cfg.performance = v;
            }
        }
        "port_forwarding" => {
            if let Ok(v) = serde_json::from_str(json) {
                cfg.port_forwarding = v;
            }
        }
        "camouflage" => {
            if let Ok(v) = serde_json::from_str(json) {
                cfg.camouflage = v;
            }
        }
        "cdn" => {
            if let Ok(v) = serde_json::from_str::<CdnConfig>(json) {
                let restart = v.enabled != cfg.cdn.enabled || v.listen_addr != cfg.cdn.listen_addr;
                cfg.cdn = v;
                return restart;
            }
        }
        "padding" => {
            if let Ok(v) = serde_json::from_str(json) {
                cfg.padding = v;
            }
        }
        "congestion" => {
            if let Ok(v) = serde_json::from_str(json) {
                cfg.congestion = v;
            }
        }
        "port_hopping" => {
            if let Ok(v) = serde_json::from_str(json) {
                cfg.port_hopping = v;
            }
        }
        "dns_upstream" => {
            if let Ok(v) = serde_json::from_str::<DnsUpstreamConfig>(json) {
                cfg.dns_upstream = v.value;
            }
        }
        "prisma_tls" => {
            if let Ok(v) = serde_json::from_str(json) {
                cfg.prisma_tls = v;
            }
        }
        "traffic_shaping" => {
            if let Ok(v) = serde_json::from_str(json) {
                cfg.traffic_shaping = v;
            }
        }
        "anti_rtt" => {
            if let Ok(v) = serde_json::from_str(json) {
                cfg.anti_rtt = v;
            }
        }
        "routing" => {
            if let Ok(v) = serde_json::from_str(json) {
                cfg.routing = v;
            }
        }
        "wireguard" => {
            if let Ok(v) = serde_json::from_str(json) {
                cfg.wireguard = v;
            }
        }
        "fallback" => {
            if let Ok(v) = serde_json::from_str(json) {
                cfg.fallback = v;
            }
        }
        "ssh" => {
            if let Ok(v) = serde_json::from_str::<SshServerConfig>(json) {
                let restart = v.enabled != cfg.ssh.enabled || v.listen_addr != cfg.ssh.listen_addr;
                cfg.ssh = v;
                return restart;
            }
        }
        "misc" => {
            if let Ok(v) = serde_json::from_str::<MiscConfig>(json) {
                cfg.allow_transport_only_cipher = v.allow_transport_only_cipher;
                cfg.shutdown_drain_timeout_secs = v.shutdown_drain_timeout_secs;
                cfg.config_watch = v.config_watch;
                cfg.ticket_rotation_hours = v.ticket_rotation_hours;
                cfg.public_address = v.public_address;
            }
        }
        _ => {}
    }

    false
}

// ─────────────────────── Default section JSON ─────────────────────────

fn default_section_json(section: &str) -> Option<serde_json::Value> {
    match section {
        "logging" => serde_json::to_value(LoggingConfig::default()).ok(),
        "performance" => serde_json::to_value(PerformanceConfig::default()).ok(),
        "port_forwarding" => serde_json::to_value(PortForwardingConfig::default()).ok(),
        "camouflage" => serde_json::to_value(CamouflageConfig::default()).ok(),
        "cdn" => serde_json::to_value(CdnConfig::default()).ok(),
        "padding" => serde_json::to_value(PaddingConfig::default()).ok(),
        "congestion" => {
            serde_json::to_value(prisma_core::config::client::CongestionConfig::default()).ok()
        }
        "port_hopping" => {
            serde_json::to_value(prisma_core::port_hop::PortHoppingConfig::default()).ok()
        }
        "dns_upstream" => serde_json::to_value(DnsUpstreamConfig::default()).ok(),
        "prisma_tls" => serde_json::to_value(PrismaTlsConfig::default()).ok(),
        "traffic_shaping" => {
            serde_json::to_value(prisma_core::traffic_shaping::TrafficShapingConfig::default()).ok()
        }
        "anti_rtt" => serde_json::to_value(AntiRttConfig::default()).ok(),
        "routing" => serde_json::to_value(prisma_core::router::RoutingConfig::default()).ok(),
        "wireguard" => {
            serde_json::to_value(prisma_core::wireguard::WireGuardServerConfig::default()).ok()
        }
        "fallback" => serde_json::to_value(FallbackConfig::default()).ok(),
        "ssh" => serde_json::to_value(SshServerConfig::default()).ok(),
        "misc" => serde_json::to_value(MiscConfig::default()).ok(),
        _ => None,
    }
}
