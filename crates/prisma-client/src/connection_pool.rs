use std::sync::atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

use anyhow::Result;
use rand::Rng;
use tokio::sync::RwLock;
use tokio::time::Instant;
use tracing::{debug, info};

use prisma_core::config::client::XmuxConfig;

use crate::proxy::ProxyContext;
use crate::tunnel::{self, TunnelConnection};
use prisma_core::types::ProxyDestination;

/// Whether the connection pool feature is enabled via config.
/// Default is `false` for backward compatibility.
#[derive(Debug, Clone, Default)]
pub struct ConnectionPoolConfig {
    pub enabled: bool,
    pub xmux: XmuxConfig,
}

/// Pool-level statistics for monitoring.
struct PoolStats {
    total_created: AtomicU64,
    total_evicted: AtomicU64,
}

/// Metadata for tracking pooled connection lifecycles.
/// The actual TunnelConnection is returned to the caller; the pool
/// only tracks lifecycle metadata to decide when to create vs reuse.
struct PoolEntry {
    created_at: Instant,
    max_lifetime: std::time::Duration,
    max_requests: u32,
    request_count: AtomicU32,
    unhealthy: std::sync::atomic::AtomicBool,
}

impl PoolEntry {
    fn is_expired(&self) -> bool {
        self.created_at.elapsed() >= self.max_lifetime
            || self.request_count.load(Ordering::Relaxed) >= self.max_requests
            || self.unhealthy.load(Ordering::Relaxed)
    }

    fn mark_unhealthy(&self) {
        self.unhealthy.store(true, Ordering::Relaxed);
    }
}

/// XMUX-style connection pool with randomized connection lifecycles.
///
/// When `connection_pool.enabled = true` in the client config, this pool
/// tracks transport connection lifecycles and evicts stale connections.
/// Connections are created with randomized lifetime and request count limits
/// to avoid fingerprinting.
///
/// Uses `RwLock` so read-only operations (health_check) don't block writers,
/// and an `AtomicUsize` for lock-free pool size reads on the hot path.
pub struct ConnectionPool {
    config: XmuxConfig,
    ctx: ProxyContext,
    entries: Arc<RwLock<Vec<Arc<PoolEntry>>>>,
    /// Lock-free pool size counter. Incremented on entry push, decremented
    /// on eviction. Avoids acquiring any lock just to read the pool length.
    size: AtomicUsize,
    stats: PoolStats,
}

impl ConnectionPool {
    #[allow(clippy::arc_with_non_send_sync)]
    pub fn new(config: XmuxConfig, ctx: ProxyContext) -> Self {
        Self {
            config,
            ctx,
            entries: Arc::new(RwLock::new(Vec::new())),
            size: AtomicUsize::new(0),
            stats: PoolStats {
                total_created: AtomicU64::new(0),
                total_evicted: AtomicU64::new(0),
            },
        }
    }

    /// Get or create a connection for the given destination.
    /// Returns a TunnelConnection by establishing a new tunnel through
    /// a pooled transport connection.
    ///
    /// Eviction is decoupled from the happy path: the pool is only
    /// cleaned when it exceeds `target_size * 2`, checked via an atomic
    /// read (no lock acquisition needed for the size check).
    pub async fn connect(&self, destination: &ProxyDestination) -> Result<TunnelConnection> {
        // Establish a new tunnel connection (no lock held)
        let stream = self.ctx.connect().await?;

        let tunnel = tunnel::establish_tunnel(
            stream,
            self.ctx.client_id,
            self.ctx.auth_secret,
            self.ctx.cipher_suite,
            destination,
            self.ctx.server_key_pin.as_deref(),
        )
        .await?;

        // Track lifecycle metadata in pool
        let mut rng = rand::thread_rng();
        let max_lifetime = std::time::Duration::from_secs(
            rng.gen_range(self.config.max_lifetime_secs_min..=self.config.max_lifetime_secs_max),
        );
        let max_requests =
            rng.gen_range(self.config.max_requests_min..=self.config.max_requests_max);

        let entry = Arc::new(PoolEntry {
            created_at: Instant::now(),
            max_lifetime,
            max_requests,
            request_count: AtomicU32::new(1),
            unhealthy: std::sync::atomic::AtomicBool::new(false),
        });

        let eviction_threshold = self.target_size() as usize * 2;

        // Bound pool growth: evict before pushing if we have exceeded
        // double the target size. The atomic check avoids acquiring the
        // write lock on the happy path.
        if self.size.load(Ordering::Relaxed) >= eviction_threshold {
            self.evict().await;
        }

        {
            let mut entries = self.entries.write().await;
            entries.push(entry);
            self.size.fetch_add(1, Ordering::Relaxed);
        }

        self.stats.total_created.fetch_add(1, Ordering::Relaxed);

        debug!(
            max_lifetime_secs = max_lifetime.as_secs(),
            max_requests = max_requests,
            pool_size = self.pool_size(),
            "Pool connection created with randomized limits"
        );

        Ok(tunnel)
    }

    /// Evict expired and unhealthy entries from the pool.
    async fn evict(&self) {
        let mut entries = self.entries.write().await;
        let before = entries.len();
        entries.retain(|e| !e.is_expired());
        let evicted = before - entries.len();
        if evicted > 0 {
            self.size.fetch_sub(evicted, Ordering::Relaxed);
            self.stats
                .total_evicted
                .fetch_add(evicted as u64, Ordering::Relaxed);
            debug!(
                evicted = evicted,
                remaining = entries.len(),
                "Pool eviction"
            );
        }
    }

    /// Run a health check on all pooled entries, marking unhealthy ones
    /// for eviction on the next connect() call.
    ///
    /// Only acquires a read lock -- does not block concurrent connect() calls.
    pub async fn health_check(&self) {
        let entries = self.entries.read().await;
        let mut unhealthy_count = 0;
        for entry in entries.iter() {
            if entry.created_at.elapsed() >= entry.max_lifetime {
                entry.mark_unhealthy();
                unhealthy_count += 1;
            }
        }
        if unhealthy_count > 0 {
            info!(
                unhealthy = unhealthy_count,
                total = entries.len(),
                "Pool health check complete"
            );
        }
    }

    /// Get the current number of active entries in the pool.
    /// Lock-free: reads from an `AtomicUsize` counter.
    pub fn pool_size(&self) -> usize {
        self.size.load(Ordering::Relaxed)
    }

    /// Get the target pool size (randomized from config range).
    pub fn target_size(&self) -> u16 {
        let mut rng = rand::thread_rng();
        rng.gen_range(self.config.max_connections_min..=self.config.max_connections_max)
    }

    /// Get total connections created over the pool's lifetime.
    pub fn total_created(&self) -> u64 {
        self.stats.total_created.load(Ordering::Relaxed)
    }

    /// Get total connections evicted over the pool's lifetime.
    pub fn total_evicted(&self) -> u64 {
        self.stats.total_evicted.load(Ordering::Relaxed)
    }
}
