//! Configuration hot-reload support.
//!
//! Reloads the server config file and applies changes to live state without
//! dropping existing connections or restarting listeners.

use std::collections::HashSet;
use std::sync::Arc;

use anyhow::Result;
use prisma_core::config::load_server_config;
use prisma_core::config::server::{RoutingRule, ServerConfig};
use prisma_core::state::AuthStoreInner;
use tracing::{error, info, warn};

use crate::bandwidth::limiter::{parse_bandwidth, BandwidthLimit, BandwidthLimiterStore};
use crate::bandwidth::quota::{parse_quota, QuotaStore};
use crate::state::ServerContext;

/// Attempt to reload the server configuration from disk.
///
/// On success, updates the live state (auth store, bandwidth limits, quotas,
/// routing rules, and the config snapshot). On failure (invalid config, parse
/// error), logs the error and leaves the running config unchanged.
///
/// Returns `Ok(summary)` with a human-readable summary of what changed, or
/// `Err` if the reload failed entirely (old config is preserved).
pub async fn reload_config(config_path: &str, ctx: &ServerContext) -> Result<String> {
    info!(path = %config_path, "Reloading configuration");

    // Step 1: Parse and validate the new config. If this fails, bail early —
    // the running server is unaffected.
    let new_config = match load_server_config(config_path) {
        Ok(cfg) => cfg,
        Err(e) => {
            error!(error = %e, "Config reload failed: invalid configuration");
            return Err(anyhow::anyhow!("Invalid configuration: {}", e));
        }
    };

    let mut changes: Vec<String> = Vec::new();

    // Step 2: Update authorized clients
    let client_changes =
        update_authorized_clients(&new_config, &ctx.state, &ctx.bandwidth, &ctx.quotas).await;
    changes.extend(client_changes);

    // Step 3: Update routing rules from config
    let routing_changes = update_routing_rules(&new_config, &ctx.state).await;
    changes.extend(routing_changes);

    // Step 4: Update the config snapshot (read by handlers for padding, dns_upstream, etc.)
    {
        let mut cfg = ctx.state.config.write().await;
        // Track non-listener config changes
        if cfg.padding.min != new_config.padding.min || cfg.padding.max != new_config.padding.max {
            changes.push(format!(
                "Updated padding range: {}-{} -> {}-{}",
                cfg.padding.min, cfg.padding.max, new_config.padding.min, new_config.padding.max
            ));
        }
        if cfg.dns_upstream != new_config.dns_upstream {
            changes.push(format!(
                "Updated DNS upstream: {} -> {}",
                cfg.dns_upstream, new_config.dns_upstream
            ));
        }
        if cfg.performance.max_connections != new_config.performance.max_connections {
            changes.push(format!(
                "Updated max connections: {} -> {}",
                cfg.performance.max_connections, new_config.performance.max_connections
            ));
        }
        if cfg.performance.connection_timeout_secs != new_config.performance.connection_timeout_secs
        {
            changes.push(format!(
                "Updated connection timeout: {}s -> {}s",
                cfg.performance.connection_timeout_secs,
                new_config.performance.connection_timeout_secs
            ));
        }
        if cfg.allow_transport_only_cipher != new_config.allow_transport_only_cipher {
            changes.push(format!(
                "Updated allow_transport_only_cipher: {} -> {}",
                cfg.allow_transport_only_cipher, new_config.allow_transport_only_cipher
            ));
        }
        *cfg = new_config;
    }

    let (success, message) = if changes.is_empty() {
        let msg = "Configuration reloaded — no changes detected".to_string();
        info!("{}", msg);
        (true, msg)
    } else {
        for change in &changes {
            info!(change = %change, "Config reload");
        }
        let summary = format!(
            "Configuration reloaded successfully ({} change{}): {}",
            changes.len(),
            if changes.len() == 1 { "" } else { "s" },
            changes.join("; ")
        );
        info!("{}", summary);
        (true, summary)
    };

    // Broadcast reload event to WebSocket subscribers
    ctx.state
        .broadcast_reload_event(prisma_core::state::ReloadEvent {
            timestamp: chrono::Utc::now(),
            success,
            message: message.clone(),
            changes,
        });

    Ok(message)
}

/// Update the auth store, bandwidth limits, and quotas based on the new config.
/// Returns a list of human-readable change descriptions.
async fn update_authorized_clients(
    new_config: &ServerConfig,
    state: &prisma_core::state::ServerState,
    bandwidth: &Arc<BandwidthLimiterStore>,
    quotas: &Arc<QuotaStore>,
) -> Vec<String> {
    let mut changes = Vec::new();

    // Build new auth store from config
    let new_auth = match AuthStoreInner::from_config(&new_config.authorized_clients) {
        Ok(inner) => inner,
        Err(e) => {
            warn!(error = %e, "Failed to parse new client list, keeping old auth store");
            return vec![format!("WARNING: client update skipped: {}", e)];
        }
    };

    // Diff old vs new clients
    let old_client_ids: HashSet<uuid::Uuid> = {
        let old = state.auth_store.read().await;
        old.clients.keys().copied().collect()
    };
    let new_client_ids: HashSet<uuid::Uuid> = new_auth.clients.keys().copied().collect();

    // Removed clients
    for removed_id in old_client_ids.difference(&new_client_ids) {
        let name = {
            let old = state.auth_store.read().await;
            old.clients
                .get(removed_id)
                .and_then(|e| e.name.clone())
                .unwrap_or_else(|| removed_id.to_string())
        };
        changes.push(format!("Removed client: {}", name));
        bandwidth.remove_client(&removed_id.to_string()).await;
        quotas.remove_client(&removed_id.to_string()).await;
    }

    // Added clients
    for added_id in new_client_ids.difference(&old_client_ids) {
        let name = new_auth
            .clients
            .get(added_id)
            .and_then(|e| e.name.clone())
            .unwrap_or_else(|| added_id.to_string());
        changes.push(format!("Added client: {}", name));
    }

    // Updated clients (present in both)
    for common_id in old_client_ids.intersection(&new_client_ids) {
        let old_name = {
            let old = state.auth_store.read().await;
            old.clients
                .get(common_id)
                .and_then(|e| e.name.clone())
                .unwrap_or_default()
        };
        let new_name = new_auth
            .clients
            .get(common_id)
            .and_then(|e| e.name.clone())
            .unwrap_or_default();
        if old_name != new_name {
            changes.push(format!(
                "Renamed client {}: {} -> {}",
                common_id, old_name, new_name
            ));
        }
    }

    // Replace the auth store atomically
    {
        let mut store = state.auth_store.write().await;
        *store = new_auth;
    }

    // Rebuild bandwidth and quota limits from the new config
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

        if upload_bps > 0 || download_bps > 0 {
            bandwidth
                .set_limit(
                    &client.id,
                    &BandwidthLimit {
                        upload_bps,
                        download_bps,
                    },
                )
                .await;
        } else {
            // Client exists but has no bandwidth limits — remove any stale limits
            bandwidth.remove_client(&client.id).await;
        }

        if let Some(quota_str) = &client.quota {
            if let Some(quota_bytes) = parse_quota(quota_str) {
                quotas.set_quota(&client.id, quota_bytes).await;
            }
        } else {
            // No quota configured — remove any stale quota
            quotas.remove_client(&client.id).await;
        }
    }

    changes
}

/// Update routing rules from the new config. Only replaces static rules
/// (those with names starting with "static-"); dynamic rules added via the
/// management API are preserved.
async fn update_routing_rules(
    new_config: &ServerConfig,
    state: &prisma_core::state::ServerState,
) -> Vec<String> {
    let mut changes = Vec::new();

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

    // Remove old static rules, keep dynamic ones
    rules.retain(|r| !r.name.starts_with("static-"));

    let new_static_count = new_static_rules.len();
    rules.extend(new_static_rules);

    if old_static_count != new_static_count {
        changes.push(format!(
            "Updated routing rules: {} static -> {} static ({} dynamic preserved)",
            old_static_count,
            new_static_count,
            rules
                .iter()
                .filter(|r| !r.name.starts_with("static-"))
                .count()
        ));
    }

    changes
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_reload_module_exists() {
        // Smoke test: module compiles
    }
}
