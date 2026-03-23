//! Fallback listener manager for the server.
//!
//! Monitors transport health and automatically starts fallback listeners
//! when the primary transport fails or encounters repeated errors.

use std::sync::Arc;
use std::time::Duration;

use prisma_core::cache::DnsCache;
use prisma_core::config::server::ServerConfig;
use prisma_core::state::{ServerState, TransportStatus};
use tracing::{info, warn};

use crate::auth::AuthStore;
use crate::state::ServerContext;

/// Run the fallback health check loop.
///
/// Periodically checks each transport in the fallback chain and triggers
/// fallback switching when transports become unhealthy.
pub async fn run_health_check_loop(
    config: Arc<ServerConfig>,
    state: ServerState,
    _auth: AuthStore,
    _dns_cache: DnsCache,
    _ctx: ServerContext,
) {
    let fallback_config = config.fallback.clone();
    if !fallback_config.enabled {
        return;
    }

    let interval = Duration::from_secs(fallback_config.health_check_interval);
    let mut ticker = tokio::time::interval(interval);

    info!(
        chain = ?fallback_config.chain,
        interval_secs = fallback_config.health_check_interval,
        "Fallback health check loop started"
    );

    // Mark the first transport as active
    {
        let chain = state.fallback_manager.chain.read().await;
        if let Some(first) = chain.first() {
            first.set_status(TransportStatus::Active);
        }
    }

    loop {
        ticker.tick().await;

        if state.is_shutting_down() {
            info!("Fallback health check loop stopping (shutdown)");
            break;
        }

        // Check each transport's health
        let snapshots = state.fallback_manager.snapshot().await;
        let active_transport = state.fallback_manager.active_transport().await;

        for snapshot in &snapshots {
            if snapshot.status == TransportStatus::Failed {
                warn!(
                    transport = %snapshot.name,
                    consecutive_failures = snapshot.consecutive_failures,
                    "Transport marked as failed"
                );
            }
        }

        // If primary (index 0) was failed but might be recovering,
        // check if we should migrate back
        if fallback_config.migrate_back_on_recovery {
            let chain = state.fallback_manager.chain.read().await;
            if let Some(primary) = chain.first() {
                let current_idx = state
                    .fallback_manager
                    .active_index
                    .load(std::sync::atomic::Ordering::Relaxed);

                if current_idx != 0 && primary.get_status() == TransportStatus::Active {
                    info!(
                        primary = %primary.name,
                        "Primary transport recovered, migrating back"
                    );
                    state
                        .fallback_manager
                        .active_index
                        .store(0, std::sync::atomic::Ordering::Relaxed);
                }
            }
        }

        if let Some(active) = &active_transport {
            tracing::debug!(
                active_transport = %active,
                "Fallback health check complete"
            );
        }
    }
}

/// Get the list of available fallback transports for the server.
/// This is used to populate the FallbackAdvertisement command sent to clients.
pub async fn get_available_transports(state: &ServerState) -> Vec<String> {
    if !state.config.read().await.fallback.enabled {
        return Vec::new();
    }
    state.fallback_manager.advertised_transports().await
}

/// Determine which transports are actually listening based on server config.
pub fn configured_transports(config: &ServerConfig) -> Vec<String> {
    let mut transports = Vec::new();

    // TCP is always available
    transports.push("tcp".into());

    // QUIC is always available (parallel listener)
    transports.push("quic".into());

    // CDN-based transports
    if config.cdn.enabled {
        transports.push("websocket".into());
        transports.push("grpc".into());
        transports.push("xhttp".into());
        if config.cdn.xporta.as_ref().is_some_and(|x| x.enabled) {
            transports.push("xporta".into());
        }
    }

    // SSH
    if config.ssh.enabled {
        transports.push("ssh".into());
    }

    // WireGuard
    if config.wireguard.enabled {
        transports.push("wireguard".into());
    }

    transports
}
