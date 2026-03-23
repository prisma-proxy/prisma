//! Latency testing and best-server selection for Prisma client.
//!
//! Provides TCP connect + optional handshake latency measurement for server lists,
//! parallel testing of multiple servers, and automatic best-server selection.

use std::net::ToSocketAddrs;
use std::time::{Duration, Instant};

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};

/// Result of a latency test for a single server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatencyResult {
    /// Index into the original server list.
    pub index: usize,
    /// Server address tested.
    pub server_addr: String,
    /// Server name (human-readable).
    pub name: String,
    /// Measured latency (None if unreachable).
    pub latency_ms: Option<u64>,
    /// Whether the test was successful.
    pub success: bool,
    /// Error message if the test failed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Configuration for latency testing.
#[derive(Debug, Clone)]
pub struct LatencyTestConfig {
    /// Timeout for each TCP connect attempt.
    pub connect_timeout: Duration,
    /// Number of attempts per server (median is used).
    pub attempts: u32,
    /// Maximum number of servers to test concurrently.
    pub concurrency: usize,
}

impl Default for LatencyTestConfig {
    fn default() -> Self {
        Self {
            connect_timeout: Duration::from_secs(5),
            attempts: 3,
            concurrency: 10,
        }
    }
}

/// Server info for latency testing (minimal struct).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub name: String,
    pub server_addr: String,
}

/// Test TCP connect latency to a single server.
/// Performs multiple attempts and returns the median.
pub fn test_latency(addr: &str, config: &LatencyTestConfig) -> Result<Duration> {
    let sock_addr = addr
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| anyhow::anyhow!("Could not resolve address: {}", addr))?;

    let mut samples = Vec::with_capacity(config.attempts as usize);

    for attempt in 0..config.attempts {
        let start = Instant::now();
        match std::net::TcpStream::connect_timeout(&sock_addr, config.connect_timeout) {
            Ok(stream) => {
                let elapsed = start.elapsed();
                samples.push(elapsed);
                drop(stream);
                debug!(addr = %addr, attempt = attempt, ms = elapsed.as_millis(), "Latency sample");
            }
            Err(e) => {
                debug!(addr = %addr, attempt = attempt, error = %e, "Latency test attempt failed");
            }
        }
    }

    if samples.is_empty() {
        anyhow::bail!(
            "All {} latency test attempts to {} failed",
            config.attempts,
            addr
        );
    }

    samples.sort();
    // Return median
    Ok(samples[samples.len() / 2])
}

/// Test TCP connect latency to a single server (async version).
/// Uses tokio::net for non-blocking connects.
pub async fn test_latency_async(addr: &str, config: &LatencyTestConfig) -> Result<Duration> {
    let mut samples = Vec::with_capacity(config.attempts as usize);

    for attempt in 0..config.attempts {
        let start = Instant::now();
        match tokio::time::timeout(config.connect_timeout, tokio::net::TcpStream::connect(addr))
            .await
        {
            Ok(Ok(stream)) => {
                let elapsed = start.elapsed();
                samples.push(elapsed);
                drop(stream);
                debug!(addr = %addr, attempt = attempt, ms = elapsed.as_millis(), "Async latency sample");
            }
            Ok(Err(e)) => {
                debug!(addr = %addr, attempt = attempt, error = %e, "Async latency attempt failed");
            }
            Err(_) => {
                debug!(addr = %addr, attempt = attempt, "Async latency attempt timed out");
            }
        }
    }

    if samples.is_empty() {
        anyhow::bail!(
            "All {} latency test attempts to {} failed",
            config.attempts,
            addr
        );
    }

    samples.sort();
    Ok(samples[samples.len() / 2])
}

/// Test latency to all servers in parallel. Returns results sorted by latency (fastest first).
pub async fn test_all_servers(
    servers: &[ServerInfo],
    config: &LatencyTestConfig,
) -> Vec<LatencyResult> {
    use tokio::sync::Semaphore;
    let semaphore = std::sync::Arc::new(Semaphore::new(config.concurrency));

    let mut handles = Vec::with_capacity(servers.len());

    for (index, server) in servers.iter().enumerate() {
        let sem = semaphore.clone();
        let addr = server.server_addr.clone();
        let name = server.name.clone();
        let cfg = config.clone();

        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await;
            match test_latency_async(&addr, &cfg).await {
                Ok(duration) => LatencyResult {
                    index,
                    server_addr: addr,
                    name,
                    latency_ms: Some(duration.as_millis() as u64),
                    success: true,
                    error: None,
                },
                Err(e) => LatencyResult {
                    index,
                    server_addr: addr,
                    name,
                    latency_ms: None,
                    success: false,
                    error: Some(e.to_string()),
                },
            }
        }));
    }

    let mut results = Vec::with_capacity(handles.len());
    for handle in handles {
        match handle.await {
            Ok(result) => results.push(result),
            Err(e) => {
                warn!(error = %e, "Latency test task panicked");
            }
        }
    }

    // Sort by latency: successful results first (sorted by latency), then failures
    results.sort_by(|a, b| match (a.latency_ms, b.latency_ms) {
        (Some(la), Some(lb)) => la.cmp(&lb),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });

    results
}

/// Select the best (lowest latency) server from a list. Returns the index into the original array.
pub async fn select_best(servers: &[ServerInfo], config: &LatencyTestConfig) -> Option<usize> {
    let results = test_all_servers(servers, config).await;

    let best = results.first()?;
    if !best.success {
        warn!("No reachable servers found");
        return None;
    }

    info!(
        name = %best.name,
        addr = %best.server_addr,
        latency_ms = best.latency_ms.unwrap_or(0),
        "Selected best server"
    );

    Some(best.index)
}

/// Run a periodic latency re-test loop.
/// Calls `on_result` each time a test cycle completes.
pub async fn periodic_latency_test(
    servers: Vec<ServerInfo>,
    config: LatencyTestConfig,
    interval: Duration,
    on_result: impl Fn(Vec<LatencyResult>) + Send + Sync + 'static,
) {
    let on_result = std::sync::Arc::new(on_result);
    let mut ticker = tokio::time::interval(interval);

    loop {
        ticker.tick().await;
        let results = test_all_servers(&servers, &config).await;
        on_result(results);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_latency_test_config_defaults() {
        let config = LatencyTestConfig::default();
        assert_eq!(config.connect_timeout, Duration::from_secs(5));
        assert_eq!(config.attempts, 3);
        assert_eq!(config.concurrency, 10);
    }

    #[test]
    fn test_latency_result_serialization() {
        let result = LatencyResult {
            index: 0,
            server_addr: "1.2.3.4:8443".into(),
            name: "Test Server".into(),
            latency_ms: Some(42),
            success: true,
            error: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("42"));
        assert!(!json.contains("error"));
    }
}
