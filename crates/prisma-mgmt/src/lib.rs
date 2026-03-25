pub mod auth;
mod handlers;
pub mod router;
mod ws;

use std::ops::Deref;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use prisma_core::bandwidth::{limiter::BandwidthLimiterStore, quota::QuotaStore};
use prisma_core::config::server::ManagementApiConfig;
use prisma_core::state::ServerState;
use tokio::sync::RwLock;
use tracing::info;

/// Alert thresholds configuration.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct AlertConfig {
    pub cert_expiry_days: u32,
    pub quota_warn_percent: u8,
    pub handshake_spike_threshold: u64,
}

impl Default for AlertConfig {
    fn default() -> Self {
        Self {
            cert_expiry_days: 30,
            quota_warn_percent: 80,
            handshake_spike_threshold: 100,
        }
    }
}

/// Extended management API state that wraps ServerState with additional stores.
#[derive(Clone)]
pub struct MgmtState {
    pub state: ServerState,
    pub bandwidth: Option<Arc<BandwidthLimiterStore>>,
    pub quotas: Option<Arc<QuotaStore>>,
    pub config_path: Option<PathBuf>,
    pub alert_config: Arc<RwLock<AlertConfig>>,
}

impl Deref for MgmtState {
    type Target = ServerState;
    fn deref(&self) -> &Self::Target {
        &self.state
    }
}

impl MgmtState {
    /// Persist the current in-memory ServerConfig to the TOML file.
    /// No-op if `config_path` is not set (e.g., running without a config file).
    pub async fn persist_config(&self) {
        let Some(ref path) = self.config_path else {
            return;
        };
        let cfg = self.state.config.read().await;
        let toml_str = match toml::to_string_pretty(&*cfg) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(error = %e, "Failed to serialize config for persistence");
                return;
            }
        };
        drop(cfg);
        // Atomic write: .tmp then rename for crash safety
        let tmp = path.with_extension("toml.tmp");
        if let Err(e) = tokio::fs::write(&tmp, &toml_str).await {
            tracing::warn!(error = %e, "Failed to write config temp file");
            return;
        }
        if let Err(e) = tokio::fs::rename(&tmp, path).await {
            tracing::warn!(error = %e, "Failed to rename config file");
        }
    }

    /// Sync the in-memory `auth_store` back to `ServerConfig.authorized_clients`.
    /// Preserves bandwidth/quota/permissions fields that only exist in the config.
    pub async fn sync_clients_to_config(&self) {
        let store = self.state.auth_store.read().await;
        let mut cfg = self.state.config.write().await;

        // Build a lookup of existing config entries to preserve bandwidth/quota fields
        let existing: std::collections::HashMap<
            String,
            &prisma_core::config::server::AuthorizedClient,
        > = cfg
            .authorized_clients
            .iter()
            .map(|c| (c.id.clone(), c))
            .collect();

        cfg.authorized_clients = store
            .clients
            .iter()
            .map(|(id, entry)| {
                let id_str = id.to_string();
                let base = existing.get(&id_str);
                prisma_core::config::server::AuthorizedClient {
                    id: id_str,
                    auth_secret: prisma_core::util::hex_encode(&entry.auth_secret),
                    name: entry.name.clone(),
                    bandwidth_up: base.and_then(|b| b.bandwidth_up.clone()),
                    bandwidth_down: base.and_then(|b| b.bandwidth_down.clone()),
                    quota: base.and_then(|b| b.quota.clone()),
                    quota_period: base.and_then(|b| b.quota_period.clone()),
                    permissions: base.and_then(|b| b.permissions.clone()),
                    tags: entry.tags.clone(),
                }
            })
            .collect();
    }
}

/// Spawn a background task that creates periodic auto-backups when configured.
fn spawn_periodic_backup(state: MgmtState) {
    tokio::spawn(async move {
        loop {
            let interval_mins = {
                let cfg = state.state.config.read().await;
                cfg.management_api.auto_backup_interval_mins
            };
            if interval_mins == 0 {
                // Disabled — check again in 60s in case it gets enabled via settings
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                continue;
            }
            tokio::time::sleep(std::time::Duration::from_secs(
                u64::from(interval_mins) * 60,
            ))
            .await;
            if state.config_path.is_some() {
                if let Err(e) = handlers::backup::auto_backup(&state).await {
                    tracing::warn!(error = ?e, "Periodic auto-backup failed");
                } else {
                    tracing::debug!(interval_mins, "Periodic auto-backup created");
                }
            }
        }
    });
}

/// Start the management API server (HTTPS when TLS is enabled and configured, HTTP otherwise).
///
/// TLS is only activated when **both** `config.tls_enabled` is `true` **and**
/// `config.tls` contains valid cert/key paths. This prevents accidental HTTPS
/// when `tls_enabled` is false but a `tls` section is present, and provides a
/// clear error when `tls_enabled` is true but no certificate is configured.
pub async fn serve(config: ManagementApiConfig, state: MgmtState) -> Result<()> {
    let app = router::build_router(config.clone(), state.clone());
    spawn_periodic_backup(state);

    if config.tls_enabled {
        let tls = config.tls.as_ref().ok_or_else(|| {
            anyhow::anyhow!(
                "Management API tls_enabled = true but no TLS certificate configured. \
                 Set [management_api.tls] or the top-level [tls] section."
            )
        })?;
        let rustls_config =
            axum_server::tls_rustls::RustlsConfig::from_pem_file(&tls.cert_path, &tls.key_path)
                .await?;
        let addr: std::net::SocketAddr = config.listen_addr.parse()?;
        info!(addr = %config.listen_addr, "Management API started (HTTPS)");
        axum_server::bind_rustls(addr, rustls_config)
            .serve(app.into_make_service())
            .await?;
    } else {
        if config.tls.is_some() {
            info!("Management API has TLS cert configured but tls_enabled = false; starting HTTP");
        }
        let listener = tokio::net::TcpListener::bind(&config.listen_addr).await?;
        info!(addr = %config.listen_addr, "Management API started (HTTP)");
        axum::serve(listener, app).await?;
    }

    Ok(())
}
