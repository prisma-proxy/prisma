//! Proxy group management for Prisma client.
//!
//! Proxy groups organize multiple servers into logical groups with different
//! selection strategies:
//! - **Select**: manual selection by user
//! - **AutoUrl**: auto-select based on URL test latency
//! - **Fallback**: use first available, failover to next
//! - **LoadBalance**: round-robin or random distribution

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

/// Type of proxy group selection strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GroupType {
    /// Manual selection by user.
    Select,
    /// Auto-select based on URL test latency.
    AutoUrl,
    /// Use first available, failover to next.
    Fallback,
    /// Round-robin or random distribution.
    LoadBalance,
}

/// Load balancing strategy for `LoadBalance` groups.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LoadBalanceStrategy {
    #[default]
    RoundRobin,
    Random,
}

/// Configuration for a proxy group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyGroupConfig {
    /// Unique name for this group.
    pub name: String,
    /// Selection strategy type.
    pub group_type: GroupType,
    /// List of server names or indices that belong to this group.
    pub servers: Vec<String>,
    /// Currently selected server (for Select type, or auto-selected for others).
    #[serde(default)]
    pub selected: Option<String>,
    /// URL to test for latency (used by AutoUrl and Fallback).
    #[serde(default = "default_test_url")]
    pub test_url: String,
    /// Interval in seconds between URL tests.
    #[serde(default = "default_test_interval")]
    pub test_interval_secs: u64,
    /// Timeout in seconds for each URL test.
    #[serde(default = "default_test_timeout")]
    pub test_timeout_secs: u64,
    /// Load balancing strategy (only for LoadBalance type).
    #[serde(default)]
    pub lb_strategy: LoadBalanceStrategy,
    /// Tolerance in ms: servers within this range of the fastest are all
    /// considered equally fast (AutoUrl only).
    #[serde(default = "default_tolerance_ms")]
    pub tolerance_ms: u64,
}

fn default_test_url() -> String {
    "https://www.gstatic.com/generate_204".into()
}

fn default_test_interval() -> u64 {
    300 // 5 minutes
}

fn default_test_timeout() -> u64 {
    5
}

fn default_tolerance_ms() -> u64 {
    100
}

/// Latency test result for a single server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatencyResult {
    pub server: String,
    pub latency_ms: Option<u64>,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Runtime state for a single proxy group.
pub struct ProxyGroupState {
    pub config: ProxyGroupConfig,
    /// Latest latency results for each server.
    pub latencies: HashMap<String, LatencyResult>,
    /// Round-robin counter for LoadBalance groups.
    pub rr_counter: AtomicUsize,
}

impl ProxyGroupState {
    pub fn new(config: ProxyGroupConfig) -> Self {
        Self {
            latencies: HashMap::new(),
            rr_counter: AtomicUsize::new(0),
            config,
        }
    }

    /// Get the currently selected/active server for this group.
    pub fn active_server(&self) -> Option<&str> {
        match self.config.group_type {
            GroupType::Select => self.config.selected.as_deref(),
            GroupType::AutoUrl => self.best_by_latency(),
            GroupType::Fallback => self.first_available(),
            GroupType::LoadBalance => self.next_balanced(),
        }
    }

    /// Select a server manually (for Select groups).
    pub fn select(&mut self, server: &str) -> bool {
        if self.config.servers.contains(&server.to_string()) {
            self.config.selected = Some(server.to_string());
            true
        } else {
            false
        }
    }

    /// Get the best server by latency (lowest latency that is available).
    fn best_by_latency(&self) -> Option<&str> {
        let tolerance = self.config.tolerance_ms;
        let mut available: Vec<_> = self
            .config
            .servers
            .iter()
            .filter_map(|s| {
                self.latencies.get(s).and_then(|r| {
                    if r.available {
                        r.latency_ms.map(|ms| (s.as_str(), ms))
                    } else {
                        None
                    }
                })
            })
            .collect();

        if available.is_empty() {
            // Fall back to first server if no latency data
            return self.config.servers.first().map(|s| s.as_str());
        }

        available.sort_by_key(|(_, ms)| *ms);
        let fastest = available[0].1;
        // Among servers within tolerance of the fastest, prefer the first one
        // in the original config order (stable selection).
        for s in &self.config.servers {
            if let Some((_, ms)) = available.iter().find(|(name, _)| *name == s.as_str()) {
                if *ms <= fastest + tolerance {
                    return Some(s.as_str());
                }
            }
        }
        Some(available[0].0)
    }

    /// Get the first available server (for Fallback groups).
    fn first_available(&self) -> Option<&str> {
        for s in &self.config.servers {
            match self.latencies.get(s) {
                Some(r) if r.available => return Some(s.as_str()),
                None => return Some(s.as_str()), // No test result yet, assume available
                _ => continue,
            }
        }
        // If all tested and unavailable, return first server anyway
        self.config.servers.first().map(|s| s.as_str())
    }

    /// Get next server for load balancing.
    fn next_balanced(&self) -> Option<&str> {
        if self.config.servers.is_empty() {
            return None;
        }
        match self.config.lb_strategy {
            LoadBalanceStrategy::RoundRobin => {
                let idx =
                    self.rr_counter.fetch_add(1, Ordering::Relaxed) % self.config.servers.len();
                Some(self.config.servers[idx].as_str())
            }
            LoadBalanceStrategy::Random => {
                let idx = rand::random::<usize>() % self.config.servers.len();
                Some(self.config.servers[idx].as_str())
            }
        }
    }

    /// Update latency result for a server.
    pub fn update_latency(&mut self, result: LatencyResult) {
        self.latencies.insert(result.server.clone(), result);
    }
}

/// Manages all proxy groups at runtime.
pub struct ProxyGroupManager {
    groups: Arc<RwLock<HashMap<String, ProxyGroupState>>>,
}

impl ProxyGroupManager {
    /// Create a new manager from proxy group configs.
    pub fn new(configs: Vec<ProxyGroupConfig>) -> Self {
        let mut groups = HashMap::new();
        for config in configs {
            let name = config.name.clone();
            groups.insert(name, ProxyGroupState::new(config));
        }
        Self {
            groups: Arc::new(RwLock::new(groups)),
        }
    }

    /// Get the active server for a group.
    pub async fn active_server(&self, group_name: &str) -> Option<String> {
        let groups = self.groups.read().await;
        groups
            .get(group_name)
            .and_then(|g| g.active_server().map(|s| s.to_string()))
    }

    /// Manually select a server in a group. Returns true on success.
    pub async fn select(&self, group_name: &str, server: &str) -> bool {
        let mut groups = self.groups.write().await;
        if let Some(group) = groups.get_mut(group_name) {
            group.select(server)
        } else {
            false
        }
    }

    /// List all groups and their current state.
    pub async fn list(&self) -> Vec<ProxyGroupInfo> {
        let groups = self.groups.read().await;
        groups
            .values()
            .map(|g| ProxyGroupInfo {
                name: g.config.name.clone(),
                group_type: g.config.group_type,
                servers: g.config.servers.clone(),
                selected: g.active_server().map(|s| s.to_string()),
                test_url: g.config.test_url.clone(),
                test_interval_secs: g.config.test_interval_secs,
                lb_strategy: g.config.lb_strategy,
            })
            .collect()
    }

    /// Run a latency test for all servers in a group.
    /// Returns the latency results.
    pub async fn test_group(&self, group_name: &str) -> Option<Vec<LatencyResult>> {
        let (servers, test_url, timeout_secs) = {
            let groups = self.groups.read().await;
            let group = groups.get(group_name)?;
            (
                group.config.servers.clone(),
                group.config.test_url.clone(),
                group.config.test_timeout_secs,
            )
        };

        let timeout = Duration::from_secs(timeout_secs);
        let mut results = Vec::with_capacity(servers.len());

        for server in &servers {
            let result = test_server_latency(server, &test_url, timeout).await;
            results.push(result);
        }

        // Update latencies in state
        {
            let mut groups = self.groups.write().await;
            if let Some(group) = groups.get_mut(group_name) {
                for result in &results {
                    group.update_latency(result.clone());
                }
            }
        }

        Some(results)
    }

    /// Spawn background tasks for periodic URL testing (AutoUrl and Fallback groups).
    pub fn spawn_periodic_tests(self: &Arc<Self>) {
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            manager.run_periodic_tests().await;
        });
    }

    async fn run_periodic_tests(&self) {
        // Collect groups that need periodic testing
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        let mut last_test: HashMap<String, std::time::Instant> = HashMap::new();

        loop {
            interval.tick().await;

            let groups = self.groups.read().await;
            let now = std::time::Instant::now();

            for (name, group) in groups.iter() {
                match group.config.group_type {
                    GroupType::AutoUrl | GroupType::Fallback => {
                        let interval_dur = Duration::from_secs(group.config.test_interval_secs);
                        let should_test = last_test
                            .get(name)
                            .map(|t| now.duration_since(*t) >= interval_dur)
                            .unwrap_or(true);

                        if should_test {
                            last_test.insert(name.clone(), now);
                            let servers = group.config.servers.clone();
                            let test_url = group.config.test_url.clone();
                            let timeout = Duration::from_secs(group.config.test_timeout_secs);
                            let groups_arc = Arc::clone(&self.groups);
                            let group_name = name.clone();

                            // Spawn test task to avoid blocking the loop
                            tokio::spawn(async move {
                                let mut results = Vec::with_capacity(servers.len());
                                for server in &servers {
                                    let result =
                                        test_server_latency(server, &test_url, timeout).await;
                                    results.push(result);
                                }
                                let mut groups = groups_arc.write().await;
                                if let Some(group) = groups.get_mut(&group_name) {
                                    for result in results {
                                        group.update_latency(result);
                                    }
                                }
                            });
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    /// Get latency results for a group.
    pub async fn get_latencies(&self, group_name: &str) -> Option<Vec<LatencyResult>> {
        let groups = self.groups.read().await;
        groups.get(group_name).map(|g| {
            g.config
                .servers
                .iter()
                .map(|s| {
                    g.latencies.get(s).cloned().unwrap_or(LatencyResult {
                        server: s.clone(),
                        latency_ms: None,
                        available: false,
                        error: Some("not tested".into()),
                    })
                })
                .collect()
        })
    }
}

/// Summary info for a proxy group (serializable for APIs).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyGroupInfo {
    pub name: String,
    pub group_type: GroupType,
    pub servers: Vec<String>,
    pub selected: Option<String>,
    pub test_url: String,
    pub test_interval_secs: u64,
    pub lb_strategy: LoadBalanceStrategy,
}

/// Test a single server's latency by measuring TCP connect time.
/// In a real implementation this would go through the proxy to the test URL,
/// but for now we measure a simple TCP connect to the server address.
async fn test_server_latency(server: &str, _test_url: &str, timeout: Duration) -> LatencyResult {
    let start = std::time::Instant::now();
    match tokio::time::timeout(timeout, tokio::net::TcpStream::connect(server)).await {
        Ok(Ok(_)) => {
            let elapsed = start.elapsed().as_millis() as u64;
            LatencyResult {
                server: server.to_string(),
                latency_ms: Some(elapsed),
                available: true,
                error: None,
            }
        }
        Ok(Err(e)) => LatencyResult {
            server: server.to_string(),
            latency_ms: None,
            available: false,
            error: Some(e.to_string()),
        },
        Err(_) => LatencyResult {
            server: server.to_string(),
            latency_ms: None,
            available: false,
            error: Some("timeout".into()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_select_group() {
        let config = ProxyGroupConfig {
            name: "manual".into(),
            group_type: GroupType::Select,
            servers: vec!["server-a".into(), "server-b".into()],
            selected: Some("server-a".into()),
            test_url: default_test_url(),
            test_interval_secs: 300,
            test_timeout_secs: 5,
            lb_strategy: LoadBalanceStrategy::RoundRobin,
            tolerance_ms: 100,
        };
        let mut state = ProxyGroupState::new(config);
        assert_eq!(state.active_server(), Some("server-a"));

        assert!(state.select("server-b"));
        assert_eq!(state.active_server(), Some("server-b"));

        assert!(!state.select("nonexistent"));
        assert_eq!(state.active_server(), Some("server-b"));
    }

    #[test]
    fn test_fallback_group() {
        let config = ProxyGroupConfig {
            name: "fb".into(),
            group_type: GroupType::Fallback,
            servers: vec!["server-a".into(), "server-b".into(), "server-c".into()],
            selected: None,
            test_url: default_test_url(),
            test_interval_secs: 300,
            test_timeout_secs: 5,
            lb_strategy: LoadBalanceStrategy::RoundRobin,
            tolerance_ms: 100,
        };
        let mut state = ProxyGroupState::new(config);

        // No test results yet: first server is chosen
        assert_eq!(state.active_server(), Some("server-a"));

        // Mark server-a as unavailable
        state.update_latency(LatencyResult {
            server: "server-a".into(),
            latency_ms: None,
            available: false,
            error: Some("timeout".into()),
        });
        state.update_latency(LatencyResult {
            server: "server-b".into(),
            latency_ms: Some(50),
            available: true,
            error: None,
        });
        assert_eq!(state.active_server(), Some("server-b"));
    }

    #[test]
    fn test_autourl_group() {
        let config = ProxyGroupConfig {
            name: "auto".into(),
            group_type: GroupType::AutoUrl,
            servers: vec!["server-a".into(), "server-b".into(), "server-c".into()],
            selected: None,
            test_url: default_test_url(),
            test_interval_secs: 300,
            test_timeout_secs: 5,
            lb_strategy: LoadBalanceStrategy::RoundRobin,
            tolerance_ms: 50,
        };
        let mut state = ProxyGroupState::new(config);

        state.update_latency(LatencyResult {
            server: "server-a".into(),
            latency_ms: Some(200),
            available: true,
            error: None,
        });
        state.update_latency(LatencyResult {
            server: "server-b".into(),
            latency_ms: Some(100),
            available: true,
            error: None,
        });
        state.update_latency(LatencyResult {
            server: "server-c".into(),
            latency_ms: Some(120),
            available: true,
            error: None,
        });

        // server-b is fastest at 100ms, server-c at 120ms within tolerance of 50ms
        // server-a at 200ms is outside tolerance
        let active = state.active_server().unwrap();
        assert!(active == "server-b" || active == "server-c");
    }

    #[test]
    fn test_loadbalance_roundrobin() {
        let config = ProxyGroupConfig {
            name: "lb".into(),
            group_type: GroupType::LoadBalance,
            servers: vec!["a".into(), "b".into(), "c".into()],
            selected: None,
            test_url: default_test_url(),
            test_interval_secs: 300,
            test_timeout_secs: 5,
            lb_strategy: LoadBalanceStrategy::RoundRobin,
            tolerance_ms: 100,
        };
        let state = ProxyGroupState::new(config);

        assert_eq!(state.active_server(), Some("a"));
        assert_eq!(state.active_server(), Some("b"));
        assert_eq!(state.active_server(), Some("c"));
        assert_eq!(state.active_server(), Some("a")); // wraps around
    }

    #[test]
    fn test_empty_servers() {
        let config = ProxyGroupConfig {
            name: "empty".into(),
            group_type: GroupType::Select,
            servers: vec![],
            selected: None,
            test_url: default_test_url(),
            test_interval_secs: 300,
            test_timeout_secs: 5,
            lb_strategy: LoadBalanceStrategy::RoundRobin,
            tolerance_ms: 100,
        };
        let state = ProxyGroupState::new(config);
        assert_eq!(state.active_server(), None);
    }
}
