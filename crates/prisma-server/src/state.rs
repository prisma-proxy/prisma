// Re-export state types from prisma-core for use throughout prisma-server.
pub use prisma_core::state::*;

use std::ops::Deref;
use std::sync::Arc;

use prisma_core::crypto::ticket_key_ring::TicketKeyRing;

use crate::bandwidth::limiter::BandwidthLimiterStore;
use crate::bandwidth::quota::QuotaStore;

/// Extended server context that bundles core state with prisma-server specific stores.
/// Derefs to `ServerState` for backward compatibility.
#[derive(Clone)]
pub struct ServerContext {
    pub state: ServerState,
    pub bandwidth: Arc<BandwidthLimiterStore>,
    pub quotas: Arc<QuotaStore>,
    /// Path to the server config file, used for hot-reload.
    pub config_path: String,
    /// Session ticket key ring with automatic rotation for forward secrecy.
    pub ticket_key_ring: TicketKeyRing,
    /// SQLite database handle (v14+ DB-first config). Shared with management API.
    pub db: Option<prisma_mgmt::db::Db>,
    /// Reloadable TLS config for the main server listener.
    pub server_tls: Option<axum_server::tls_rustls::RustlsConfig>,
    /// Reloadable TLS config for the management API listener.
    pub mgmt_tls: Option<axum_server::tls_rustls::RustlsConfig>,
    /// Reloadable TLS config for the CDN listener.
    pub cdn_tls: Option<axum_server::tls_rustls::RustlsConfig>,
    /// Data directory path (alongside config file).
    pub data_dir: Option<std::path::PathBuf>,
}

impl Deref for ServerContext {
    type Target = ServerState;
    fn deref(&self) -> &ServerState {
        &self.state
    }
}
