//! Config hot-reload endpoint.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Serialize;
use tracing::{error, info};

use prisma_core::bandwidth::limiter::{parse_bandwidth, BandwidthLimit};
use prisma_core::bandwidth::quota::parse_quota;
use prisma_core::config::load_server_config;
use prisma_core::config::server::RoutingRule;
use prisma_core::state::AuthStoreInner;

use crate::MgmtState;

#[derive(Serialize)]
pub struct ReloadResponse {
    pub success: bool,
    pub message: String,
    pub changes: Vec<String>,
}

/// POST /api/reload — Trigger a configuration hot-reload.
pub async fn reload_config(State(state): State<MgmtState>) -> impl IntoResponse {
    let config_path = match &state.config_path {
        Some(p) => p.to_string_lossy().to_string(),
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ReloadResponse {
                    success: false,
                    message: "Config path not available".into(),
                    changes: vec![],
                }),
            );
        }
    };

    info!(path = %config_path, "API-triggered config reload");

    // Parse and validate the new config
    let new_config = match load_server_config(&config_path) {
        Ok(cfg) => cfg,
        Err(e) => {
            error!(error = %e, "Config reload failed: invalid configuration");
            return (
                StatusCode::BAD_REQUEST,
                Json(ReloadResponse {
                    success: false,
                    message: format!("Invalid configuration: {}", e),
                    changes: vec![],
                }),
            );
        }
    };

    let mut changes: Vec<String> = Vec::new();

    // Update authorized clients
    match AuthStoreInner::from_config(&new_config.authorized_clients) {
        Ok(new_auth) => {
            let old_ids: std::collections::HashSet<uuid::Uuid> = {
                let old = state.auth_store.read().await;
                old.clients.keys().copied().collect()
            };
            let new_ids: std::collections::HashSet<uuid::Uuid> =
                new_auth.clients.keys().copied().collect();

            for removed_id in old_ids.difference(&new_ids) {
                let name = {
                    let old = state.auth_store.read().await;
                    old.clients
                        .get(removed_id)
                        .and_then(|e| e.name.clone())
                        .unwrap_or_else(|| removed_id.to_string())
                };
                changes.push(format!("Removed client: {}", name));
                if let Some(ref bw) = state.bandwidth {
                    bw.remove_client(&removed_id.to_string()).await;
                }
                if let Some(ref q) = state.quotas {
                    q.remove_client(&removed_id.to_string()).await;
                }
            }

            for added_id in new_ids.difference(&old_ids) {
                let name = new_auth
                    .clients
                    .get(added_id)
                    .and_then(|e| e.name.clone())
                    .unwrap_or_else(|| added_id.to_string());
                changes.push(format!("Added client: {}", name));
            }

            // Replace the auth store
            {
                let mut store = state.auth_store.write().await;
                *store = new_auth;
            }

            // Rebuild bandwidth and quota limits
            for client in &new_config.authorized_clients {
                let upload_bps = client
                    .bandwidth_up
                    .as_deref()
                    .and_then(parse_bandwidth)
                    .unwrap_or(0);
                let download_bps = client
                    .bandwidth_down
                    .as_deref()
                    .and_then(parse_bandwidth)
                    .unwrap_or(0);

                if let Some(ref bw) = state.bandwidth {
                    if upload_bps > 0 || download_bps > 0 {
                        bw.set_limit(
                            &client.id,
                            &BandwidthLimit {
                                upload_bps,
                                download_bps,
                            },
                        )
                        .await;
                    } else {
                        bw.remove_client(&client.id).await;
                    }
                }

                if let Some(ref q) = state.quotas {
                    if let Some(quota_str) = &client.quota {
                        if let Some(quota_bytes) = parse_quota(quota_str) {
                            q.set_quota(&client.id, quota_bytes).await;
                        }
                    } else {
                        q.remove_client(&client.id).await;
                    }
                }
            }
        }
        Err(e) => {
            changes.push(format!("WARNING: client update skipped: {}", e));
        }
    }

    // Update routing rules (replace static rules, preserve dynamic ones)
    {
        let new_static_rules: Vec<RoutingRule> = new_config
            .routing
            .rules
            .iter()
            .enumerate()
            .map(|(i, rule)| RoutingRule::from_router_rule(rule, 10000 + i as u32))
            .collect();

        let mut rules = state.routing_rules.write().await;
        let old_static_count = rules
            .iter()
            .filter(|r| r.name.starts_with("static-"))
            .count();
        rules.retain(|r| !r.name.starts_with("static-"));
        let new_static_count = new_static_rules.len();
        rules.extend(new_static_rules);

        if old_static_count != new_static_count {
            changes.push(format!(
                "Updated routing rules: {} static -> {} static",
                old_static_count, new_static_count
            ));
        }
    }

    // Update the config snapshot
    {
        let mut cfg = state.config.write().await;
        if cfg.padding.min != new_config.padding.min || cfg.padding.max != new_config.padding.max {
            changes.push(format!(
                "Updated padding: {}-{} -> {}-{}",
                cfg.padding.min, cfg.padding.max, new_config.padding.min, new_config.padding.max
            ));
        }
        if cfg.dns_upstream != new_config.dns_upstream {
            changes.push(format!(
                "Updated DNS upstream: {} -> {}",
                cfg.dns_upstream, new_config.dns_upstream
            ));
        }
        *cfg = new_config;
    }

    let message = if changes.is_empty() {
        "Configuration reloaded — no changes detected".to_string()
    } else {
        for change in &changes {
            info!(change = %change, "Config reload");
        }
        format!(
            "Configuration reloaded successfully ({} change{})",
            changes.len(),
            if changes.len() == 1 { "" } else { "s" }
        )
    };

    info!("{}", message);

    // Broadcast reload event to WebSocket subscribers
    state
        .state
        .broadcast_reload_event(prisma_core::state::ReloadEvent {
            timestamp: chrono::Utc::now(),
            success: true,
            message: message.clone(),
            changes: changes.clone(),
        });

    (
        StatusCode::OK,
        Json(ReloadResponse {
            success: true,
            message,
            changes,
        }),
    )
}
