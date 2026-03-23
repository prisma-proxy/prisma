//! PrismaMask — Dynamic mask server pool for active probing resistance.
//!
//! Replaces REALITY's single `dest` with a pool of mask servers.
//! Features:
//! - Health checks via TCP+TLS handshake every 60s
//! - Round-robin among healthy servers
//! - Auto-failover on mask server failure
//! - RTT measurement for PrismaFlow timing normalization

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

use crate::config::server::MaskServerEntry;

// ---------------------------------------------------------------------------
// Runtime types
// ---------------------------------------------------------------------------

/// Runtime state for a mask server.
pub struct MaskServer {
    pub config: MaskServerEntry,
    healthy: AtomicBool,
    avg_rtt_ms: AtomicU32,
}

impl MaskServer {
    /// Returns `true` if the server passed the last health check.
    pub fn is_healthy(&self) -> bool {
        self.healthy.load(Ordering::Relaxed)
    }

    /// Returns the last measured round-trip time in milliseconds.
    pub fn rtt_ms(&self) -> u32 {
        self.avg_rtt_ms.load(Ordering::Relaxed)
    }
}

/// Pool of mask servers with health monitoring.
pub struct PrismaMaskPool {
    servers: Vec<Arc<MaskServer>>,
    healthy_indices: RwLock<Vec<usize>>,
    current: AtomicUsize,
    health_check_interval: Duration,
}

impl PrismaMaskPool {
    /// Create a new mask pool from configuration.
    ///
    /// All servers start as healthy so that the first connections succeed
    /// before the health checker has had a chance to run.
    pub fn new(configs: Vec<MaskServerEntry>) -> Self {
        let servers: Vec<Arc<MaskServer>> = configs
            .into_iter()
            .map(|config| {
                Arc::new(MaskServer {
                    config,
                    healthy: AtomicBool::new(true),
                    avg_rtt_ms: AtomicU32::new(0),
                })
            })
            .collect();

        let healthy_indices: Vec<usize> = (0..servers.len()).collect();

        Self {
            servers,
            healthy_indices: RwLock::new(healthy_indices),
            current: AtomicUsize::new(0),
            health_check_interval: Duration::from_secs(60),
        }
    }

    /// Select the next healthy mask server using round-robin.
    ///
    /// Returns `None` when the pool is empty or every server is unhealthy.
    pub async fn select(&self) -> Option<Arc<MaskServer>> {
        let indices = self.healthy_indices.read().await;
        if indices.is_empty() {
            return None;
        }

        let idx = self.current.fetch_add(1, Ordering::Relaxed) % indices.len();
        let server_idx = indices[idx];
        Some(Arc::clone(&self.servers[server_idx]))
    }

    /// Relay a client connection to the selected mask server.
    ///
    /// Forwards `initial_bytes` (typically the ClientHello captured during
    /// REALITY authentication) and then bidirectionally proxies the
    /// remaining traffic so the client sees a genuine TLS session.
    pub async fn relay_to_mask(
        &self,
        mut client: TcpStream,
        initial_bytes: &[u8],
    ) -> anyhow::Result<()> {
        let server = self
            .select()
            .await
            .ok_or_else(|| anyhow::anyhow!("no healthy mask server available"))?;

        debug!(
            addr = %server.config.addr,
            "relaying connection to mask server"
        );

        let mut upstream = tokio::time::timeout(
            Duration::from_secs(10),
            TcpStream::connect(&server.config.addr),
        )
        .await
        .map_err(|_| anyhow::anyhow!("mask server connect timeout"))?
        .map_err(|e| anyhow::anyhow!("mask server connect failed: {e}"))?;

        // Forward the bytes that were already read from the client (e.g. the
        // ClientHello that was inspected during REALITY authentication).
        if !initial_bytes.is_empty() {
            upstream.write_all(initial_bytes).await?;
        }

        // Bidirectional copy until either side closes.
        let (mut client_rd, mut client_wr) = client.split();
        let (mut upstream_rd, mut upstream_wr) = upstream.split();

        let c2s = tokio::io::copy(&mut client_rd, &mut upstream_wr);
        let s2c = tokio::io::copy(&mut upstream_rd, &mut client_wr);

        tokio::select! {
            res = c2s => {
                if let Err(e) = res {
                    debug!(error = %e, "client -> mask copy ended");
                }
            }
            res = s2c => {
                if let Err(e) = res {
                    debug!(error = %e, "mask -> client copy ended");
                }
            }
        }

        Ok(())
    }

    /// Spawn a background task that periodically health-checks every server.
    pub fn spawn_health_checker(self: &Arc<Self>) {
        let pool = Arc::clone(self);
        tokio::spawn(async move {
            info!(
                interval_secs = pool.health_check_interval.as_secs(),
                servers = pool.servers.len(),
                "prisma-mask health checker started"
            );

            loop {
                tokio::time::sleep(pool.health_check_interval).await;
                pool.check_health().await;
            }
        });
    }

    /// Run a health check against every server **concurrently** and rebuild
    /// the `healthy_indices` list.
    pub async fn check_health(&self) {
        // Check all servers in parallel (independent TCP connects).
        let handles: Vec<_> = self
            .servers
            .iter()
            .map(|server| {
                let server = Arc::clone(server);
                tokio::spawn(async move { Self::check_server_health(&server).await })
            })
            .collect();
        let mut results = Vec::with_capacity(handles.len());
        for handle in handles {
            results.push(handle.await.unwrap_or(false));
        }

        let mut new_healthy = Vec::with_capacity(self.servers.len());
        for (i, ok) in results.into_iter().enumerate() {
            if ok {
                new_healthy.push(i);
                debug!(
                    addr = %self.servers[i].config.addr,
                    rtt_ms = self.servers[i].rtt_ms(),
                    "mask server healthy"
                );
            } else {
                warn!(addr = %self.servers[i].config.addr, "mask server unhealthy");
            }
        }

        info!(
            healthy = new_healthy.len(),
            total = self.servers.len(),
            "health check complete"
        );

        let mut indices = self.healthy_indices.write().await;
        *indices = new_healthy;
    }

    /// Check a single server's health via TCP connect and measure RTT.
    ///
    /// A successful TCP connection within the timeout is sufficient to mark
    /// the server healthy. The RTT is stored for PrismaFlow timing
    /// normalization.
    async fn check_server_health(server: &MaskServer) -> bool {
        let start = std::time::Instant::now();
        match tokio::time::timeout(
            Duration::from_secs(10),
            TcpStream::connect(&server.config.addr),
        )
        .await
        {
            Ok(Ok(_stream)) => {
                let rtt = start.elapsed().as_millis() as u32;
                server.avg_rtt_ms.store(rtt, Ordering::Relaxed);
                server.healthy.store(true, Ordering::Relaxed);
                true
            }
            _ => {
                server.healthy.store(false, Ordering::Relaxed);
                false
            }
        }
    }

    /// Average RTT in milliseconds across all currently healthy servers.
    ///
    /// Returns `None` when no healthy servers are available. Used by
    /// PrismaFlow to normalise packet timing so that observers cannot
    /// distinguish proxy traffic from direct connections to the mask
    /// servers.
    pub async fn avg_rtt_ms(&self) -> Option<u32> {
        let indices = self.healthy_indices.read().await;
        if indices.is_empty() {
            return None;
        }

        let sum: u64 = indices
            .iter()
            .map(|&i| self.servers[i].rtt_ms() as u64)
            .sum();

        Some((sum / indices.len() as u64) as u32)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::server::PrismaTlsConfig;

    fn sample_configs(n: usize) -> Vec<MaskServerEntry> {
        (0..n)
            .map(|i| MaskServerEntry {
                addr: format!("server-{i}.example.com:443"),
                names: vec![format!("server-{i}.example.com")],
            })
            .collect()
    }

    #[tokio::test]
    async fn test_pool_creation() {
        let pool = PrismaMaskPool::new(sample_configs(3));

        assert_eq!(pool.servers.len(), 3);

        let indices = pool.healthy_indices.read().await;
        assert_eq!(indices.len(), 3);

        // All servers start healthy.
        for server in &pool.servers {
            assert!(server.is_healthy());
        }
    }

    #[tokio::test]
    async fn test_round_robin_selection() {
        let pool = PrismaMaskPool::new(sample_configs(3));

        // Three consecutive selects should yield servers 0, 1, 2.
        let s0 = pool.select().await.unwrap();
        let s1 = pool.select().await.unwrap();
        let s2 = pool.select().await.unwrap();

        assert_eq!(s0.config.addr, "server-0.example.com:443");
        assert_eq!(s1.config.addr, "server-1.example.com:443");
        assert_eq!(s2.config.addr, "server-2.example.com:443");

        // Wraps around.
        let s3 = pool.select().await.unwrap();
        assert_eq!(s3.config.addr, "server-0.example.com:443");
    }

    #[tokio::test]
    async fn test_empty_pool() {
        let pool = PrismaMaskPool::new(Vec::new());

        assert!(pool.select().await.is_none());
        assert!(pool.avg_rtt_ms().await.is_none());
    }

    #[tokio::test]
    async fn test_all_unhealthy_returns_none() {
        let pool = PrismaMaskPool::new(sample_configs(2));

        // Mark all servers unhealthy.
        for server in &pool.servers {
            server.healthy.store(false, Ordering::Relaxed);
        }

        // Rebuild healthy indices.
        {
            let mut indices = pool.healthy_indices.write().await;
            *indices = Vec::new();
        }

        assert!(pool.select().await.is_none());
        assert!(pool.avg_rtt_ms().await.is_none());
    }

    #[tokio::test]
    async fn test_mask_server_config_deserialize() {
        let json = r#"{
            "addr": "www.microsoft.com:443",
            "names": ["www.microsoft.com", "microsoft.com"]
        }"#;

        let config: MaskServerEntry = serde_json::from_str(json).unwrap();
        assert_eq!(config.addr, "www.microsoft.com:443");
        assert_eq!(config.names.len(), 2);
        assert_eq!(config.names[0], "www.microsoft.com");
        assert_eq!(config.names[1], "microsoft.com");
    }

    #[tokio::test]
    async fn test_mask_server_config_deserialize_default_names() {
        let json = r#"{ "addr": "example.com:443" }"#;

        let config: MaskServerEntry = serde_json::from_str(json).unwrap();
        assert_eq!(config.addr, "example.com:443");
        assert!(config.names.is_empty());
    }

    #[tokio::test]
    async fn test_prisma_tls_config_default() {
        let config = PrismaTlsConfig::default();

        assert!(!config.enabled);
        assert!(config.mask_servers.is_empty());
        assert!(config.auth_secret.is_empty());
        assert_eq!(config.auth_rotation_hours, 1);
    }

    #[tokio::test]
    async fn test_prisma_tls_config_deserialize() {
        let json = r#"{
            "enabled": true,
            "mask_servers": [
                { "addr": "a.example.com:443" },
                { "addr": "b.example.com:443", "names": ["b.example.com"] }
            ],
            "auth_secret": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
            "auth_rotation_hours": 6
        }"#;

        let config: PrismaTlsConfig = serde_json::from_str(json).unwrap();
        assert!(config.enabled);
        assert_eq!(config.mask_servers.len(), 2);
        assert_eq!(config.auth_rotation_hours, 6);
        assert_eq!(
            config.auth_secret,
            "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
        );
    }

    #[tokio::test]
    async fn test_avg_rtt_ms() {
        let pool = PrismaMaskPool::new(sample_configs(3));

        // Set RTTs: 10, 20, 30
        pool.servers[0].avg_rtt_ms.store(10, Ordering::Relaxed);
        pool.servers[1].avg_rtt_ms.store(20, Ordering::Relaxed);
        pool.servers[2].avg_rtt_ms.store(30, Ordering::Relaxed);

        let avg = pool.avg_rtt_ms().await.unwrap();
        assert_eq!(avg, 20); // (10 + 20 + 30) / 3
    }

    #[tokio::test]
    async fn test_partial_unhealthy_skips_in_selection() {
        let pool = PrismaMaskPool::new(sample_configs(3));

        // Mark server-1 unhealthy and rebuild indices.
        pool.servers[1].healthy.store(false, Ordering::Relaxed);
        {
            let mut indices = pool.healthy_indices.write().await;
            *indices = vec![0, 2];
        }

        let s0 = pool.select().await.unwrap();
        let s1 = pool.select().await.unwrap();
        let s2 = pool.select().await.unwrap();

        // Should cycle through server-0 and server-2 only.
        assert_eq!(s0.config.addr, "server-0.example.com:443");
        assert_eq!(s1.config.addr, "server-2.example.com:443");
        assert_eq!(s2.config.addr, "server-0.example.com:443");
    }

    #[tokio::test]
    async fn test_avg_rtt_partial_healthy() {
        let pool = PrismaMaskPool::new(sample_configs(3));

        pool.servers[0].avg_rtt_ms.store(100, Ordering::Relaxed);
        pool.servers[1].avg_rtt_ms.store(200, Ordering::Relaxed);
        pool.servers[2].avg_rtt_ms.store(300, Ordering::Relaxed);

        // Only servers 0 and 2 are healthy.
        pool.servers[1].healthy.store(false, Ordering::Relaxed);
        {
            let mut indices = pool.healthy_indices.write().await;
            *indices = vec![0, 2];
        }

        let avg = pool.avg_rtt_ms().await.unwrap();
        assert_eq!(avg, 200); // (100 + 300) / 2
    }

    #[tokio::test]
    async fn test_mask_server_rtt_and_health() {
        let server = MaskServer {
            config: MaskServerEntry {
                addr: "example.com:443".into(),
                names: Vec::new(),
            },
            healthy: AtomicBool::new(true),
            avg_rtt_ms: AtomicU32::new(42),
        };

        assert!(server.is_healthy());
        assert_eq!(server.rtt_ms(), 42);

        server.healthy.store(false, Ordering::Relaxed);
        assert!(!server.is_healthy());
    }
}
