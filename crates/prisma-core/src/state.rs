use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, watch, RwLock};
use uuid::Uuid;

use crate::acl::AclStore;
use crate::config::server::{AuthorizedClient, RoutingRule, ServerConfig};
use crate::permissions::PermissionStore;
use crate::util;

/// Shared client entry data for the auth store.
#[derive(Clone, Serialize)]
pub struct ClientEntry {
    #[serde(skip)]
    pub auth_secret: [u8; 32],
    pub name: Option<String>,
    pub enabled: bool,
}

/// The mutable inner data of AuthStore, shared between server and management API.
#[derive(Clone)]
pub struct AuthStoreInner {
    pub clients: HashMap<Uuid, ClientEntry>,
}

impl AuthStoreInner {
    pub fn from_config(clients: &[AuthorizedClient]) -> Result<Self, anyhow::Error> {
        let mut map = HashMap::new();
        for c in clients {
            let uuid = Uuid::parse_str(&c.id)
                .map_err(|e| anyhow::anyhow!("Invalid client UUID '{}': {}", c.id, e))?;
            let secret_bytes = util::hex_decode_32(&c.auth_secret)
                .map_err(|e| anyhow::anyhow!("Invalid auth_secret for '{}': {}", c.id, e))?;
            map.insert(
                uuid,
                ClientEntry {
                    auth_secret: secret_bytes,
                    name: c.name.clone(),
                    enabled: true,
                },
            );
        }
        Ok(Self { clients: map })
    }
}

// ---------------------------------------------------------------------------
// Per-client metrics
// ---------------------------------------------------------------------------

/// Per-client metrics snapshot.
#[derive(Debug, Clone, Serialize)]
pub struct ClientMetrics {
    pub client_id: Uuid,
    pub client_name: Option<String>,
    pub bytes_up: u64,
    pub bytes_down: u64,
    pub connection_count: u64,
    pub active_connections: usize,
    pub last_seen: Option<DateTime<Utc>>,
    pub latency_p50_ms: Option<f64>,
    pub latency_p95_ms: Option<f64>,
    pub latency_p99_ms: Option<f64>,
}

/// Atomic per-client metrics accumulator (lock-free hot path).
pub struct ClientMetricsAccumulator {
    pub bytes_up: AtomicU64,
    pub bytes_down: AtomicU64,
    pub connection_count: AtomicU64,
    pub active_connections: AtomicUsize,
    pub last_seen_epoch_ms: AtomicU64,
    pub latency_samples: RwLock<VecDeque<u64>>,
}

impl ClientMetricsAccumulator {
    pub fn new() -> Self {
        Self {
            bytes_up: AtomicU64::new(0),
            bytes_down: AtomicU64::new(0),
            connection_count: AtomicU64::new(0),
            active_connections: AtomicUsize::new(0),
            last_seen_epoch_ms: AtomicU64::new(0),
            latency_samples: RwLock::new(VecDeque::with_capacity(1000)),
        }
    }

    pub fn record_connection(&self) {
        self.connection_count.fetch_add(1, Ordering::Relaxed);
        self.active_connections.fetch_add(1, Ordering::Relaxed);
        self.last_seen_epoch_ms
            .store(Utc::now().timestamp_millis() as u64, Ordering::Relaxed);
    }

    pub fn record_disconnect(&self) {
        self.active_connections.fetch_sub(1, Ordering::Relaxed);
    }

    pub fn add_bytes_up(&self, n: u64) {
        self.bytes_up.fetch_add(n, Ordering::Relaxed);
    }

    pub fn add_bytes_down(&self, n: u64) {
        self.bytes_down.fetch_add(n, Ordering::Relaxed);
    }

    pub async fn add_latency_sample(&self, latency_us: u64) {
        let mut samples = self.latency_samples.write().await;
        if samples.len() >= 1000 {
            samples.pop_front();
        }
        samples.push_back(latency_us);
    }

    pub async fn snapshot(&self, client_id: Uuid, client_name: Option<String>) -> ClientMetrics {
        let latencies = self.compute_latency_percentiles().await;
        let last_seen_ms = self.last_seen_epoch_ms.load(Ordering::Relaxed);
        let last_seen = if last_seen_ms > 0 {
            DateTime::from_timestamp_millis(last_seen_ms as i64)
        } else {
            None
        };
        ClientMetrics {
            client_id,
            client_name,
            bytes_up: self.bytes_up.load(Ordering::Relaxed),
            bytes_down: self.bytes_down.load(Ordering::Relaxed),
            connection_count: self.connection_count.load(Ordering::Relaxed),
            active_connections: self.active_connections.load(Ordering::Relaxed),
            last_seen,
            latency_p50_ms: latencies.0,
            latency_p95_ms: latencies.1,
            latency_p99_ms: latencies.2,
        }
    }

    async fn compute_latency_percentiles(&self) -> (Option<f64>, Option<f64>, Option<f64>) {
        let samples = self.latency_samples.read().await;
        if samples.is_empty() {
            return (None, None, None);
        }
        let mut sorted: Vec<u64> = samples.iter().copied().collect();
        sorted.sort_unstable();
        let len = sorted.len();
        let p50 = sorted[len * 50 / 100] as f64 / 1000.0;
        let p95 = sorted[len * 95 / 100] as f64 / 1000.0;
        let p99 = sorted[(len * 99 / 100).min(len - 1)] as f64 / 1000.0;
        (Some(p50), Some(p95), Some(p99))
    }
}

impl Default for ClientMetricsAccumulator {
    fn default() -> Self {
        Self::new()
    }
}

/// Historical data point for a single client.
#[derive(Debug, Clone, Serialize)]
pub struct ClientMetricsHistoryPoint {
    pub timestamp: DateTime<Utc>,
    pub bytes_up: u64,
    pub bytes_down: u64,
    pub active_connections: usize,
}

/// Event emitted when a config reload occurs.
#[derive(Debug, Clone, Serialize)]
pub struct ReloadEvent {
    pub timestamp: DateTime<Utc>,
    pub success: bool,
    pub message: String,
    pub changes: Vec<String>,
}

// ---------------------------------------------------------------------------
// Central server state
// ---------------------------------------------------------------------------

/// Central server state shared across all tasks.
#[derive(Clone)]
pub struct ServerState {
    pub metrics: Arc<ServerMetrics>,
    pub connections: Arc<RwLock<HashMap<Uuid, ConnectionInfo>>>,
    pub auth_store: Arc<RwLock<AuthStoreInner>>,
    pub config: Arc<RwLock<ServerConfig>>,
    pub routing_rules: Arc<RwLock<Vec<RoutingRule>>>,
    pub log_tx: broadcast::Sender<LogEntry>,
    pub metrics_tx: broadcast::Sender<MetricsSnapshot>,
    pub metrics_history: Arc<RwLock<VecDeque<MetricsSnapshot>>>,
    /// Per-client metrics accumulators (keyed by client UUID).
    pub per_client_metrics: Arc<dashmap::DashMap<Uuid, Arc<ClientMetricsAccumulator>>>,
    /// Per-client metrics history ring buffer.
    pub per_client_history: Arc<RwLock<HashMap<Uuid, VecDeque<ClientMetricsHistoryPoint>>>>,
    /// Broadcast channel for reload events.
    pub reload_tx: broadcast::Sender<ReloadEvent>,
    /// Watch channel for config reload notifications to running components.
    pub reload_notify: watch::Receiver<u64>,
    /// The sender side of the reload watch.
    pub reload_notify_tx: watch::Sender<u64>,
    /// Shutdown signal flag.
    pub shutdown: Arc<AtomicBool>,
    /// Notifies tasks when shutdown is requested.
    pub shutdown_tx: broadcast::Sender<()>,
    /// Per-client access control lists.
    pub acl_store: AclStore,
    /// Per-client permissions store (granular access control).
    pub permission_store: PermissionStore,
    /// Transport fallback manager.
    pub fallback_manager: FallbackManager,
    /// Registry of active port-forward listeners with per-forward metrics.
    pub forward_registry: ForwardRegistry,
}

impl ServerState {
    pub fn new(
        config: &ServerConfig,
        auth_store: AuthStoreInner,
        log_tx: broadcast::Sender<LogEntry>,
        metrics_tx: broadcast::Sender<MetricsSnapshot>,
    ) -> Self {
        let (reload_tx, _) = broadcast::channel::<ReloadEvent>(64);
        let (reload_notify_tx, reload_notify) = watch::channel(0u64);
        let (shutdown_tx, _) = broadcast::channel::<()>(1);

        // Initialize permission store from config
        let permission_store = PermissionStore::new();
        // Pre-populate permissions from authorized_clients config
        // (done synchronously since we are constructing — no await needed)
        // Actual population happens via `populate_permissions_from_config` after construction.

        Self {
            metrics: Arc::new(ServerMetrics::new()),
            connections: Arc::new(RwLock::new(HashMap::new())),
            auth_store: Arc::new(RwLock::new(auth_store)),
            config: Arc::new(RwLock::new(config.clone())),
            routing_rules: Arc::new(RwLock::new(Vec::new())),
            log_tx,
            metrics_tx,
            metrics_history: Arc::new(RwLock::new(VecDeque::with_capacity(86400))),
            per_client_metrics: Arc::new(dashmap::DashMap::new()),
            per_client_history: Arc::new(RwLock::new(HashMap::new())),
            reload_tx,
            reload_notify,
            reload_notify_tx,
            shutdown: Arc::new(AtomicBool::new(false)),
            shutdown_tx,
            acl_store: AclStore::from_config(config.acls.clone()),
            permission_store,
            fallback_manager: FallbackManager::new(&config.fallback),
            forward_registry: new_forward_registry(),
        }
    }

    /// Populate the permission store from authorized_clients config entries.
    /// Must be called after construction since it is async.
    pub async fn populate_permissions_from_config(&self, clients: &[AuthorizedClient]) {
        for client in clients {
            if let Some(ref perms) = client.permissions {
                self.permission_store
                    .set_permissions(client.id.clone(), perms.clone())
                    .await;
            }
        }
    }

    pub fn snapshot_metrics(&self) -> MetricsSnapshot {
        MetricsSnapshot {
            timestamp: Utc::now(),
            uptime_secs: self.metrics.started_at.elapsed().as_secs(),
            total_connections: self.metrics.total_connections.load(Ordering::Relaxed),
            active_connections: self.metrics.active_connections.load(Ordering::Relaxed),
            total_bytes_up: self.metrics.total_bytes_up.load(Ordering::Relaxed),
            total_bytes_down: self.metrics.total_bytes_down.load(Ordering::Relaxed),
            handshake_failures: self.metrics.handshake_failures.load(Ordering::Relaxed),
        }
    }

    /// Get or create the per-client metrics accumulator.
    pub fn client_accumulator(&self, client_id: Uuid) -> Arc<ClientMetricsAccumulator> {
        self.per_client_metrics
            .entry(client_id)
            .or_insert_with(|| Arc::new(ClientMetricsAccumulator::new()))
            .value()
            .clone()
    }

    /// Check if shutdown has been requested.
    pub fn is_shutting_down(&self) -> bool {
        self.shutdown.load(Ordering::Relaxed)
    }

    /// Initiate graceful shutdown.
    pub fn initiate_shutdown(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
        let _ = self.shutdown_tx.send(());
    }

    /// Broadcast a reload event to WebSocket subscribers.
    pub fn broadcast_reload_event(&self, event: ReloadEvent) {
        if self.reload_tx.receiver_count() > 0 {
            let _ = self.reload_tx.send(event);
        }
    }

    /// Notify running server components about a config change.
    pub fn notify_reload(&self) {
        self.reload_notify_tx.send_modify(|v| *v += 1);
    }
}

pub struct ServerMetrics {
    pub started_at: std::time::Instant,
    pub total_connections: AtomicU64,
    pub total_bytes_up: AtomicU64,
    pub total_bytes_down: AtomicU64,
    pub active_connections: AtomicUsize,
    pub handshake_failures: AtomicU64,
}

impl ServerMetrics {
    pub fn new() -> Self {
        Self {
            started_at: std::time::Instant::now(),
            total_connections: AtomicU64::new(0),
            total_bytes_up: AtomicU64::new(0),
            total_bytes_down: AtomicU64::new(0),
            active_connections: AtomicUsize::new(0),
            handshake_failures: AtomicU64::new(0),
        }
    }
}

impl Default for ServerMetrics {
    fn default() -> Self {
        Self::new()
    }
}

/// Tracks a single active connection.
#[derive(Debug, Clone, Serialize)]
pub struct ConnectionInfo {
    pub session_id: Uuid,
    pub client_id: Option<Uuid>,
    pub client_name: Option<String>,
    pub peer_addr: String,
    pub transport: Transport,
    pub mode: SessionMode,
    pub connected_at: DateTime<Utc>,
    #[serde(skip)]
    pub bytes_up: Arc<AtomicU64>,
    #[serde(skip)]
    pub bytes_down: Arc<AtomicU64>,
    /// The destination address this connection is proxying to (set after Connect command).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destination: Option<String>,
    /// The routing rule that matched this connection, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matched_rule: Option<String>,
}

impl ConnectionInfo {
    pub fn bytes_up_val(&self) -> u64 {
        self.bytes_up.load(Ordering::Relaxed)
    }

    pub fn bytes_down_val(&self) -> u64 {
        self.bytes_down.load(Ordering::Relaxed)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Transport {
    Tcp,
    Quic,
    WebSocket,
    Grpc,
    Xhttp,
    XPorta,
    Ssh,
    WireGuard,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum SessionMode {
    Unknown,
    Proxy,
    Forward,
    UdpRelay,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricsSnapshot {
    pub timestamp: DateTime<Utc>,
    pub uptime_secs: u64,
    pub total_connections: u64,
    pub active_connections: usize,
    pub total_bytes_up: u64,
    pub total_bytes_down: u64,
    pub handshake_failures: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    pub timestamp: DateTime<Utc>,
    pub level: String,
    pub target: String,
    pub message: String,
}

/// Produces MetricsSnapshot every second on the broadcast channel
/// and stores it in the ring buffer for historical queries.
/// Also snapshots per-client metrics history every 10 seconds.
pub async fn metrics_ticker(state: ServerState) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
    loop {
        interval.tick().await;
        let snapshot = state.snapshot_metrics();

        // Always push to the ring buffer for historical queries
        {
            let mut history = state.metrics_history.write().await;
            if history.len() >= 86400 {
                history.pop_front();
            }
            history.push_back(snapshot.clone());
        }

        // Snapshot per-client history every 10 seconds
        if snapshot.uptime_secs.is_multiple_of(10) {
            let mut client_history = state.per_client_history.write().await;
            for entry in state.per_client_metrics.iter() {
                let client_id = *entry.key();
                let acc = entry.value();
                let point = ClientMetricsHistoryPoint {
                    timestamp: Utc::now(),
                    bytes_up: acc.bytes_up.load(Ordering::Relaxed),
                    bytes_down: acc.bytes_down.load(Ordering::Relaxed),
                    active_connections: acc.active_connections.load(Ordering::Relaxed),
                };
                let history = client_history
                    .entry(client_id)
                    .or_insert_with(|| VecDeque::with_capacity(8640));
                if history.len() >= 8640 {
                    history.pop_front();
                }
                history.push_back(point);
            }
        }

        // Only broadcast when someone is listening
        if state.metrics_tx.receiver_count() > 0 {
            let _ = state.metrics_tx.send(snapshot);
        }
    }
}

// ---------------------------------------------------------------------------
// Forward registry — per-forward metrics and active connection tracking
// ---------------------------------------------------------------------------

/// Metrics and state for a single port-forward listener.
pub struct ForwardEntry {
    pub remote_port: u16,
    pub name: String,
    pub client_id: Option<Uuid>,
    pub bind_addr: String,
    pub protocol: String,
    pub allowed_ips: Vec<String>,
    pub registered_at: DateTime<Utc>,

    // Metrics (atomics for lock-free access)
    pub connections_total: AtomicU64,
    pub active_connections: AtomicUsize,
    pub bytes_up: AtomicU64,
    pub bytes_down: AtomicU64,

    /// Active connection details, keyed by stream_id.
    pub active_conns: RwLock<HashMap<u32, ForwardConnectionInfo>>,

    /// Shutdown signal to stop the listener.
    pub shutdown_tx: broadcast::Sender<()>,
}

impl ForwardEntry {
    pub fn new(
        remote_port: u16,
        name: String,
        client_id: Option<Uuid>,
        bind_addr: String,
        allowed_ips: Vec<String>,
    ) -> Self {
        let (shutdown_tx, _) = broadcast::channel::<()>(1);
        Self {
            remote_port,
            name,
            client_id,
            bind_addr,
            protocol: "tcp".into(),
            allowed_ips,
            registered_at: Utc::now(),
            connections_total: AtomicU64::new(0),
            active_connections: AtomicUsize::new(0),
            bytes_up: AtomicU64::new(0),
            bytes_down: AtomicU64::new(0),
            active_conns: RwLock::new(HashMap::new()),
            shutdown_tx,
        }
    }

    /// Request that the listener shut down.
    pub fn request_shutdown(&self) {
        let _ = self.shutdown_tx.send(());
    }
}

/// Information about a single active forwarded connection.
#[derive(Debug, Clone, Serialize)]
pub struct ForwardConnectionInfo {
    pub stream_id: u32,
    pub peer_addr: String,
    pub connected_at: DateTime<Utc>,
    pub bytes_up: u64,
    pub bytes_down: u64,
}

/// Registry of all active port forwards, keyed by remote port.
pub type ForwardRegistry = Arc<RwLock<HashMap<u16, Arc<ForwardEntry>>>>;

/// Create a new empty forward registry.
pub fn new_forward_registry() -> ForwardRegistry {
    Arc::new(RwLock::new(HashMap::new()))
}

/// Count how many forwards a given client owns in the registry.
pub async fn count_client_forwards(registry: &ForwardRegistry, client_id: Uuid) -> usize {
    let map = registry.read().await;
    map.values()
        .filter(|e| e.client_id == Some(client_id))
        .count()
}

// ---------------------------------------------------------------------------
// Transport fallback state
// ---------------------------------------------------------------------------

/// Health status of a single server-side transport listener.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum TransportStatus {
    /// Listener is active and accepting connections.
    Active,
    /// Listener failed to bind or encountered repeated errors.
    Failed,
    /// Listener is starting up.
    Starting,
    /// Listener is stopped (not in use).
    Stopped,
    /// Listener is in recovery (primary coming back online).
    Recovering,
}

/// State tracking for a single transport in the fallback chain.
#[derive(Debug)]
pub struct TransportFallbackEntry {
    /// Transport name (e.g., "tcp", "quic", "websocket").
    pub name: String,
    /// Current status.
    pub status: Arc<std::sync::RwLock<TransportStatus>>,
    /// Consecutive failure count.
    pub consecutive_failures: AtomicU64,
    /// Total connections handled by this transport.
    pub total_connections: AtomicU64,
    /// Time of last successful connection.
    pub last_success: Arc<std::sync::RwLock<Option<DateTime<Utc>>>>,
    /// Time of last failure.
    pub last_failure: Arc<std::sync::RwLock<Option<DateTime<Utc>>>>,
}

impl TransportFallbackEntry {
    pub fn new(name: String) -> Self {
        Self {
            name,
            status: Arc::new(std::sync::RwLock::new(TransportStatus::Stopped)),
            consecutive_failures: AtomicU64::new(0),
            total_connections: AtomicU64::new(0),
            last_success: Arc::new(std::sync::RwLock::new(None)),
            last_failure: Arc::new(std::sync::RwLock::new(None)),
        }
    }

    /// Record a successful connection.
    pub fn record_success(&self) {
        self.consecutive_failures.store(0, Ordering::Relaxed);
        self.total_connections.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut last) = self.last_success.write() {
            *last = Some(Utc::now());
        }
    }

    /// Record a failure. Returns the new consecutive failure count.
    pub fn record_failure(&self) -> u64 {
        let count = self.consecutive_failures.fetch_add(1, Ordering::Relaxed) + 1;
        if let Ok(mut last) = self.last_failure.write() {
            *last = Some(Utc::now());
        }
        count
    }

    /// Get current status.
    pub fn get_status(&self) -> TransportStatus {
        *self.status.read().unwrap_or_else(|e| e.into_inner())
    }

    /// Set status.
    pub fn set_status(&self, status: TransportStatus) {
        if let Ok(mut s) = self.status.write() {
            *s = status;
        }
    }
}

/// Serializable snapshot of transport fallback state.
#[derive(Debug, Clone, Serialize)]
pub struct TransportFallbackSnapshot {
    pub name: String,
    pub status: TransportStatus,
    pub consecutive_failures: u64,
    pub total_connections: u64,
    pub last_success: Option<DateTime<Utc>>,
    pub last_failure: Option<DateTime<Utc>>,
}

impl TransportFallbackEntry {
    /// Create a snapshot for API/monitoring.
    pub fn snapshot(&self) -> TransportFallbackSnapshot {
        TransportFallbackSnapshot {
            name: self.name.clone(),
            status: self.get_status(),
            consecutive_failures: self.consecutive_failures.load(Ordering::Relaxed),
            total_connections: self.total_connections.load(Ordering::Relaxed),
            last_success: self.last_success.read().ok().and_then(|v| *v),
            last_failure: self.last_failure.read().ok().and_then(|v| *v),
        }
    }
}

/// Manager for server-side transport fallback chain.
#[derive(Clone)]
pub struct FallbackManager {
    /// Ordered chain of transports.
    pub chain: Arc<RwLock<Vec<Arc<TransportFallbackEntry>>>>,
    /// Index of the currently active primary transport.
    pub active_index: Arc<std::sync::atomic::AtomicUsize>,
    /// Configuration.
    pub config: Arc<RwLock<crate::config::server::FallbackConfig>>,
}

impl FallbackManager {
    /// Create a new fallback manager from config.
    pub fn new(config: &crate::config::server::FallbackConfig) -> Self {
        let chain: Vec<Arc<TransportFallbackEntry>> = config
            .chain
            .iter()
            .map(|name| Arc::new(TransportFallbackEntry::new(name.clone())))
            .collect();

        Self {
            chain: Arc::new(RwLock::new(chain)),
            active_index: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            config: Arc::new(RwLock::new(config.clone())),
        }
    }

    /// Get the currently active transport name.
    pub async fn active_transport(&self) -> Option<String> {
        let chain = self.chain.read().await;
        let idx = self.active_index.load(Ordering::Relaxed);
        chain.get(idx).map(|e| e.name.clone())
    }

    /// Get all available transport names (those that are Active or Starting).
    pub async fn available_transports(&self) -> Vec<String> {
        let chain = self.chain.read().await;
        chain
            .iter()
            .filter(|e| {
                let status = e.get_status();
                status == TransportStatus::Active || status == TransportStatus::Starting
            })
            .map(|e| e.name.clone())
            .collect()
    }

    /// Record a failure for a transport. If max failures exceeded, trigger fallback.
    /// Returns true if a fallback switch occurred.
    pub async fn record_transport_failure(&self, transport_name: &str) -> bool {
        let chain = self.chain.read().await;
        let config = self.config.read().await;

        if let Some(entry) = chain.iter().find(|e| e.name == transport_name) {
            let failures = entry.record_failure();

            if config.auto_switch_on_failure && failures >= config.max_consecutive_failures as u64 {
                // Mark as failed
                entry.set_status(TransportStatus::Failed);

                // Try to switch to next available transport
                let current = self.active_index.load(Ordering::Relaxed);
                for i in 1..chain.len() {
                    let next = (current + i) % chain.len();
                    let next_status = chain[next].get_status();
                    if next_status != TransportStatus::Failed {
                        self.active_index.store(next, Ordering::Relaxed);
                        return true;
                    }
                }
            }
        }
        false
    }

    /// Record a success for a transport.
    pub async fn record_transport_success(&self, transport_name: &str) {
        let chain = self.chain.read().await;
        if let Some(entry) = chain.iter().find(|e| e.name == transport_name) {
            entry.record_success();
            entry.set_status(TransportStatus::Active);
        }
    }

    /// Get a snapshot of all transports for monitoring.
    pub async fn snapshot(&self) -> Vec<TransportFallbackSnapshot> {
        let chain = self.chain.read().await;
        chain.iter().map(|e| e.snapshot()).collect()
    }

    /// Get the list of transport names for fallback advertisement.
    pub async fn advertised_transports(&self) -> Vec<String> {
        let chain = self.chain.read().await;
        chain.iter().map(|e| e.name.clone()).collect()
    }
}
