//! Per-client permission system for granular access control.
//!
//! Each client can have a set of permissions that control:
//! - Whether port forwarding is allowed
//! - Whether UDP relay is allowed
//! - Which destinations (CIDR/domain) are allowed or blocked
//! - Maximum concurrent connections
//! - Per-client bandwidth limits
//! - Which ports are allowed or blocked

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::router;
use crate::types::{ProxyAddress, ProxyDestination};

/// A port range (inclusive on both ends).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PortRange {
    pub start: u16,
    pub end: u16,
}

impl PortRange {
    pub fn new(start: u16, end: u16) -> Self {
        Self { start, end }
    }

    pub fn single(port: u16) -> Self {
        Self {
            start: port,
            end: port,
        }
    }

    pub fn contains(&self, port: u16) -> bool {
        port >= self.start && port <= self.end
    }
}

/// Per-client permissions controlling what a client can do.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientPermissions {
    /// Whether port forwarding is allowed (default: true).
    #[serde(default = "default_true")]
    pub allow_port_forwarding: bool,

    /// Whether UDP relay is allowed (default: true).
    #[serde(default = "default_true")]
    pub allow_udp: bool,

    /// Allowed destination patterns (CIDR or domain glob). Empty = allow all.
    #[serde(default)]
    pub allowed_destinations: Vec<String>,

    /// Blocked destination patterns (CIDR or domain glob). Empty = block none.
    /// Blocked takes precedence over allowed.
    #[serde(default)]
    pub blocked_destinations: Vec<String>,

    /// Maximum concurrent connections for this client (0 = unlimited).
    #[serde(default)]
    pub max_connections: u32,

    /// Per-client bandwidth limit in bytes/sec (None = unlimited).
    #[serde(default)]
    pub bandwidth_limit: Option<u64>,

    /// Allowed port ranges. Empty = allow all ports.
    #[serde(default)]
    pub allowed_ports: Vec<PortRange>,

    /// Blocked ports. Empty = block no ports.
    /// Blocked takes precedence over allowed.
    #[serde(default)]
    pub blocked_ports: Vec<u16>,
}

fn default_true() -> bool {
    true
}

impl Default for ClientPermissions {
    fn default() -> Self {
        Self {
            allow_port_forwarding: true,
            allow_udp: true,
            allowed_destinations: Vec::new(),
            blocked_destinations: Vec::new(),
            max_connections: 0,
            bandwidth_limit: None,
            allowed_ports: Vec::new(),
            blocked_ports: Vec::new(),
        }
    }
}

/// Partial update for client permissions (all fields optional).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ClientPermissionsUpdate {
    pub allow_port_forwarding: Option<bool>,
    pub allow_udp: Option<bool>,
    pub allowed_destinations: Option<Vec<String>>,
    pub blocked_destinations: Option<Vec<String>>,
    pub max_connections: Option<u32>,
    pub bandwidth_limit: Option<Option<u64>>,
    pub allowed_ports: Option<Vec<PortRange>>,
    pub blocked_ports: Option<Vec<u16>>,
}

impl ClientPermissions {
    /// Apply a partial update, merging only the provided fields.
    pub fn apply_update(&mut self, update: &ClientPermissionsUpdate) {
        if let Some(v) = update.allow_port_forwarding {
            self.allow_port_forwarding = v;
        }
        if let Some(v) = update.allow_udp {
            self.allow_udp = v;
        }
        if let Some(ref v) = update.allowed_destinations {
            self.allowed_destinations = v.clone();
        }
        if let Some(ref v) = update.blocked_destinations {
            self.blocked_destinations = v.clone();
        }
        if let Some(v) = update.max_connections {
            self.max_connections = v;
        }
        if let Some(v) = update.bandwidth_limit {
            self.bandwidth_limit = v;
        }
        if let Some(ref v) = update.allowed_ports {
            self.allowed_ports = v.clone();
        }
        if let Some(ref v) = update.blocked_ports {
            self.blocked_ports = v.clone();
        }
    }

    /// Check if a destination is allowed by this permission set.
    pub fn is_destination_allowed(&self, dest: &ProxyDestination) -> bool {
        let port = dest.port;

        // Check blocked ports first (takes precedence)
        if self.blocked_ports.contains(&port) {
            return false;
        }

        // Check allowed ports (if non-empty, only listed ports are allowed)
        if !self.allowed_ports.is_empty() && !self.allowed_ports.iter().any(|r| r.contains(port)) {
            return false;
        }

        let dest_str = dest_to_match_string(dest);

        // Check blocked destinations (takes precedence)
        if !self.blocked_destinations.is_empty()
            && self
                .blocked_destinations
                .iter()
                .any(|p| destination_matches(p, dest, &dest_str))
        {
            return false;
        }

        // Check allowed destinations (if non-empty, only listed are allowed)
        if !self.allowed_destinations.is_empty()
            && !self
                .allowed_destinations
                .iter()
                .any(|p| destination_matches(p, dest, &dest_str))
        {
            return false;
        }

        true
    }

    /// Check if the client is allowed to use port forwarding.
    pub fn is_port_forwarding_allowed(&self) -> bool {
        self.allow_port_forwarding
    }

    /// Check if the client is allowed to use UDP relay.
    pub fn is_udp_allowed(&self) -> bool {
        self.allow_udp
    }

    /// Check if a new connection is allowed given the current count.
    /// Returns true if under the limit or unlimited.
    pub fn is_connection_allowed(&self, current_count: usize) -> bool {
        if self.max_connections == 0 {
            return true; // Unlimited
        }
        current_count < self.max_connections as usize
    }
}

/// Convert a proxy destination to a string for matching.
fn dest_to_match_string(dest: &ProxyDestination) -> String {
    match &dest.address {
        ProxyAddress::Domain(d) => d.to_lowercase(),
        ProxyAddress::Ipv4(ip) => ip.to_string(),
        ProxyAddress::Ipv6(ip) => ip.to_string(),
    }
}

/// Check if a pattern matches a destination.
/// Supports: CIDR notation (e.g., "10.0.0.0/8"), domain globs (e.g., "*.google.com"),
/// exact domain (e.g., "example.com"), and exact IP.
fn destination_matches(pattern: &str, dest: &ProxyDestination, _dest_str: &str) -> bool {
    // CIDR match
    if pattern.contains('/') {
        return match &dest.address {
            ProxyAddress::Ipv4(ip) => router::parse_cidr_v4(pattern)
                .map(|(network, mask)| (u32::from(*ip) & mask) == network)
                .unwrap_or(false),
            ProxyAddress::Ipv6(ip) => router::parse_cidr_v6(pattern)
                .map(|(network, mask)| (u128::from(*ip) & mask) == network)
                .unwrap_or(false),
            ProxyAddress::Domain(_) => false,
        };
    }

    // Domain glob match
    if let Some(suffix) = pattern.strip_prefix("*.") {
        return match &dest.address {
            ProxyAddress::Domain(d) => {
                let d_lower = d.to_lowercase();
                let suffix_lower = suffix.to_lowercase();
                d_lower == suffix_lower || d_lower.ends_with(&format!(".{}", suffix_lower))
            }
            _ => false,
        };
    }

    // Exact domain or IP match
    match &dest.address {
        ProxyAddress::Domain(d) => d.eq_ignore_ascii_case(pattern),
        ProxyAddress::Ipv4(ip) => ip.to_string() == pattern,
        ProxyAddress::Ipv6(ip) => ip.to_string() == pattern,
    }
}

/// Reason for permission denial.
#[derive(Debug, Clone, Serialize)]
pub enum PermissionDeniedReason {
    PortForwardingNotAllowed,
    UdpNotAllowed,
    DestinationBlocked(String),
    MaxConnectionsExceeded(u32),
    PortBlocked(u16),
    ClientBlocked,
}

impl std::fmt::Display for PermissionDeniedReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PermissionDeniedReason::PortForwardingNotAllowed => {
                write!(f, "port forwarding not allowed for this client")
            }
            PermissionDeniedReason::UdpNotAllowed => {
                write!(f, "UDP relay not allowed for this client")
            }
            PermissionDeniedReason::DestinationBlocked(dest) => {
                write!(f, "destination blocked: {}", dest)
            }
            PermissionDeniedReason::MaxConnectionsExceeded(max) => {
                write!(f, "max connections ({}) exceeded", max)
            }
            PermissionDeniedReason::PortBlocked(port) => {
                write!(f, "port {} blocked", port)
            }
            PermissionDeniedReason::ClientBlocked => {
                write!(f, "client has been blocked")
            }
        }
    }
}

/// Store for managing client permissions at runtime.
/// Thread-safe and designed for concurrent access from handler tasks.
#[derive(Clone)]
pub struct PermissionStore {
    /// Per-client permissions, keyed by client UUID string.
    permissions: Arc<RwLock<HashMap<String, ClientPermissions>>>,
    /// Per-client active connection counters (atomic for lock-free hot path).
    connection_counts: Arc<dashmap::DashMap<String, Arc<AtomicUsize>>>,
    /// Default permissions template for new clients.
    defaults: Arc<RwLock<ClientPermissions>>,
    /// Blocked clients (revoked auth, immediate disconnect).
    blocked_clients: Arc<RwLock<std::collections::HashSet<String>>>,
}

impl PermissionStore {
    /// Create a new empty permission store with default permissions.
    pub fn new() -> Self {
        Self {
            permissions: Arc::new(RwLock::new(HashMap::new())),
            connection_counts: Arc::new(dashmap::DashMap::new()),
            defaults: Arc::new(RwLock::new(ClientPermissions::default())),
            blocked_clients: Arc::new(RwLock::new(std::collections::HashSet::new())),
        }
    }

    /// Get permissions for a client. Falls back to defaults if not set.
    pub async fn get_permissions(&self, client_id: &str) -> ClientPermissions {
        let perms = self.permissions.read().await;
        match perms.get(client_id) {
            Some(p) => p.clone(),
            None => self.defaults.read().await.clone(),
        }
    }

    /// Set permissions for a specific client.
    pub async fn set_permissions(&self, client_id: String, perms: ClientPermissions) {
        self.permissions.write().await.insert(client_id, perms);
    }

    /// Update permissions for a client (partial update).
    /// Creates from defaults if not already set.
    pub async fn update_permissions(&self, client_id: &str, update: &ClientPermissionsUpdate) {
        let mut perms = self.permissions.write().await;
        let entry = perms
            .entry(client_id.to_string())
            .or_insert_with(ClientPermissions::default);
        entry.apply_update(update);
    }

    /// Remove custom permissions for a client (reverts to defaults).
    pub async fn remove_permissions(&self, client_id: &str) -> bool {
        self.permissions.write().await.remove(client_id).is_some()
    }

    /// Get the default permissions template.
    pub async fn get_defaults(&self) -> ClientPermissions {
        self.defaults.read().await.clone()
    }

    /// Set the default permissions template.
    pub async fn set_defaults(&self, defaults: ClientPermissions) {
        *self.defaults.write().await = defaults;
    }

    /// Check if a client is blocked.
    pub async fn is_blocked(&self, client_id: &str) -> bool {
        self.blocked_clients.read().await.contains(client_id)
    }

    /// Block a client (revoke auth).
    pub async fn block_client(&self, client_id: &str) {
        self.blocked_clients
            .write()
            .await
            .insert(client_id.to_string());
    }

    /// Unblock a client.
    pub async fn unblock_client(&self, client_id: &str) -> bool {
        self.blocked_clients.write().await.remove(client_id)
    }

    /// Get or create the atomic connection counter for a client.
    pub fn connection_counter(&self, client_id: &str) -> Arc<AtomicUsize> {
        self.connection_counts
            .entry(client_id.to_string())
            .or_insert_with(|| Arc::new(AtomicUsize::new(0)))
            .value()
            .clone()
    }

    /// Increment connection count for a client. Returns the new count.
    pub fn increment_connections(&self, client_id: &str) -> usize {
        let counter = self.connection_counter(client_id);
        counter.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// Decrement connection count for a client.
    pub fn decrement_connections(&self, client_id: &str) {
        let counter = self.connection_counter(client_id);
        // Prevent underflow
        counter
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| {
                if v > 0 {
                    Some(v - 1)
                } else {
                    Some(0)
                }
            })
            .ok();
    }

    /// Get current connection count for a client.
    pub fn current_connections(&self, client_id: &str) -> usize {
        self.connection_counts
            .get(client_id)
            .map(|c| c.value().load(Ordering::Relaxed))
            .unwrap_or(0)
    }

    /// Check all permissions for a CMD_CONNECT. Returns Ok(()) or the denial reason.
    pub async fn check_connect(
        &self,
        client_id: &str,
        dest: &ProxyDestination,
    ) -> Result<(), PermissionDeniedReason> {
        // Check blocked
        if self.is_blocked(client_id).await {
            return Err(PermissionDeniedReason::ClientBlocked);
        }

        let perms = self.get_permissions(client_id).await;

        // Check connection limit
        let current = self.current_connections(client_id);
        if !perms.is_connection_allowed(current) {
            return Err(PermissionDeniedReason::MaxConnectionsExceeded(
                perms.max_connections,
            ));
        }

        // Check destination
        if !perms.is_destination_allowed(dest) {
            return Err(PermissionDeniedReason::DestinationBlocked(dest.to_string()));
        }

        Ok(())
    }

    /// Check permissions for port forwarding.
    pub async fn check_port_forward(&self, client_id: &str) -> Result<(), PermissionDeniedReason> {
        if self.is_blocked(client_id).await {
            return Err(PermissionDeniedReason::ClientBlocked);
        }
        let perms = self.get_permissions(client_id).await;
        if !perms.is_port_forwarding_allowed() {
            return Err(PermissionDeniedReason::PortForwardingNotAllowed);
        }
        Ok(())
    }

    /// Check permissions for UDP relay.
    pub async fn check_udp(&self, client_id: &str) -> Result<(), PermissionDeniedReason> {
        if self.is_blocked(client_id).await {
            return Err(PermissionDeniedReason::ClientBlocked);
        }
        let perms = self.get_permissions(client_id).await;
        if !perms.is_udp_allowed() {
            return Err(PermissionDeniedReason::UdpNotAllowed);
        }
        Ok(())
    }

    /// List all client IDs that have custom permissions.
    pub async fn list_clients_with_permissions(&self) -> Vec<String> {
        self.permissions.read().await.keys().cloned().collect()
    }
}

impl Default for PermissionStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn make_domain_dest(domain: &str, port: u16) -> ProxyDestination {
        ProxyDestination {
            address: ProxyAddress::Domain(domain.into()),
            port,
        }
    }

    fn make_ipv4_dest(ip: [u8; 4], port: u16) -> ProxyDestination {
        ProxyDestination {
            address: ProxyAddress::Ipv4(Ipv4Addr::new(ip[0], ip[1], ip[2], ip[3])),
            port,
        }
    }

    #[test]
    fn test_default_permissions_allow_all() {
        let perms = ClientPermissions::default();
        assert!(perms.is_destination_allowed(&make_domain_dest("example.com", 443)));
        assert!(perms.is_destination_allowed(&make_ipv4_dest([10, 0, 0, 1], 80)));
        assert!(perms.is_port_forwarding_allowed());
        assert!(perms.is_udp_allowed());
        assert!(perms.is_connection_allowed(1000));
    }

    #[test]
    fn test_blocked_destinations() {
        let perms = ClientPermissions {
            blocked_destinations: vec!["*.blocked.com".into(), "10.0.0.0/8".into()],
            ..Default::default()
        };

        assert!(!perms.is_destination_allowed(&make_domain_dest("www.blocked.com", 443)));
        assert!(!perms.is_destination_allowed(&make_domain_dest("blocked.com", 443)));
        assert!(perms.is_destination_allowed(&make_domain_dest("allowed.com", 443)));

        assert!(!perms.is_destination_allowed(&make_ipv4_dest([10, 1, 2, 3], 80)));
        assert!(perms.is_destination_allowed(&make_ipv4_dest([8, 8, 8, 8], 80)));
    }

    #[test]
    fn test_allowed_destinations_whitelist() {
        let perms = ClientPermissions {
            allowed_destinations: vec!["*.example.com".into(), "8.8.8.8".into()],
            ..Default::default()
        };

        assert!(perms.is_destination_allowed(&make_domain_dest("www.example.com", 443)));
        assert!(!perms.is_destination_allowed(&make_domain_dest("other.com", 443)));
        assert!(perms.is_destination_allowed(&make_ipv4_dest([8, 8, 8, 8], 53)));
        assert!(!perms.is_destination_allowed(&make_ipv4_dest([1, 1, 1, 1], 53)));
    }

    #[test]
    fn test_blocked_takes_precedence() {
        let perms = ClientPermissions {
            allowed_destinations: vec!["*.example.com".into()],
            blocked_destinations: vec!["bad.example.com".into()],
            ..Default::default()
        };

        assert!(perms.is_destination_allowed(&make_domain_dest("www.example.com", 443)));
        assert!(!perms.is_destination_allowed(&make_domain_dest("bad.example.com", 443)));
    }

    #[test]
    fn test_blocked_ports() {
        let perms = ClientPermissions {
            blocked_ports: vec![22, 25, 445],
            ..Default::default()
        };

        assert!(!perms.is_destination_allowed(&make_domain_dest("example.com", 22)));
        assert!(!perms.is_destination_allowed(&make_domain_dest("example.com", 25)));
        assert!(perms.is_destination_allowed(&make_domain_dest("example.com", 443)));
    }

    #[test]
    fn test_allowed_ports_whitelist() {
        let perms = ClientPermissions {
            allowed_ports: vec![
                PortRange::new(80, 80),
                PortRange::new(443, 443),
                PortRange::new(8000, 9000),
            ],
            ..Default::default()
        };

        assert!(perms.is_destination_allowed(&make_domain_dest("example.com", 80)));
        assert!(perms.is_destination_allowed(&make_domain_dest("example.com", 443)));
        assert!(perms.is_destination_allowed(&make_domain_dest("example.com", 8080)));
        assert!(!perms.is_destination_allowed(&make_domain_dest("example.com", 22)));
    }

    #[test]
    fn test_max_connections() {
        let perms = ClientPermissions {
            max_connections: 5,
            ..Default::default()
        };

        assert!(perms.is_connection_allowed(0));
        assert!(perms.is_connection_allowed(4));
        assert!(!perms.is_connection_allowed(5));
        assert!(!perms.is_connection_allowed(10));
    }

    #[test]
    fn test_unlimited_connections() {
        let perms = ClientPermissions {
            max_connections: 0,
            ..Default::default()
        };

        assert!(perms.is_connection_allowed(999_999));
    }

    #[test]
    fn test_partial_update() {
        let mut perms = ClientPermissions::default();
        let update = ClientPermissionsUpdate {
            allow_udp: Some(false),
            max_connections: Some(10),
            ..Default::default()
        };
        perms.apply_update(&update);

        assert!(!perms.allow_udp);
        assert_eq!(perms.max_connections, 10);
        assert!(perms.allow_port_forwarding); // Unchanged
    }

    #[tokio::test]
    async fn test_permission_store_operations() {
        let store = PermissionStore::new();

        // Default permissions
        let perms = store.get_permissions("client-1").await;
        assert!(perms.allow_port_forwarding);
        assert!(perms.allow_udp);

        // Set custom permissions
        let custom = ClientPermissions {
            allow_udp: false,
            max_connections: 5,
            ..Default::default()
        };
        store.set_permissions("client-1".into(), custom).await;

        let perms = store.get_permissions("client-1").await;
        assert!(!perms.allow_udp);
        assert_eq!(perms.max_connections, 5);

        // Update permissions
        store
            .update_permissions(
                "client-1",
                &ClientPermissionsUpdate {
                    allow_udp: Some(true),
                    ..Default::default()
                },
            )
            .await;

        let perms = store.get_permissions("client-1").await;
        assert!(perms.allow_udp); // Updated
        assert_eq!(perms.max_connections, 5); // Unchanged

        // Remove custom -> reverts to defaults
        assert!(store.remove_permissions("client-1").await);
        let perms = store.get_permissions("client-1").await;
        assert_eq!(perms.max_connections, 0); // Default
    }

    #[tokio::test]
    async fn test_permission_store_blocking() {
        let store = PermissionStore::new();

        assert!(!store.is_blocked("client-1").await);
        store.block_client("client-1").await;
        assert!(store.is_blocked("client-1").await);

        assert!(store.unblock_client("client-1").await);
        assert!(!store.is_blocked("client-1").await);
    }

    #[test]
    fn test_connection_counting() {
        let store = PermissionStore::new();

        assert_eq!(store.current_connections("client-1"), 0);
        assert_eq!(store.increment_connections("client-1"), 1);
        assert_eq!(store.increment_connections("client-1"), 2);
        assert_eq!(store.current_connections("client-1"), 2);

        store.decrement_connections("client-1");
        assert_eq!(store.current_connections("client-1"), 1);

        store.decrement_connections("client-1");
        assert_eq!(store.current_connections("client-1"), 0);

        // Should not underflow
        store.decrement_connections("client-1");
        assert_eq!(store.current_connections("client-1"), 0);
    }

    #[tokio::test]
    async fn test_check_connect() {
        let store = PermissionStore::new();
        let dest = make_domain_dest("example.com", 443);

        // Default: allowed
        assert!(store.check_connect("client-1", &dest).await.is_ok());

        // Block client
        store.block_client("client-1").await;
        assert!(store.check_connect("client-1", &dest).await.is_err());
        store.unblock_client("client-1").await;

        // Set max connections = 1
        store
            .set_permissions(
                "client-1".into(),
                ClientPermissions {
                    max_connections: 1,
                    ..Default::default()
                },
            )
            .await;

        // First connection OK
        assert!(store.check_connect("client-1", &dest).await.is_ok());
        store.increment_connections("client-1");

        // Second connection denied
        assert!(store.check_connect("client-1", &dest).await.is_err());
    }

    #[test]
    fn test_port_range() {
        let range = PortRange::new(8000, 9000);
        assert!(range.contains(8000));
        assert!(range.contains(8500));
        assert!(range.contains(9000));
        assert!(!range.contains(7999));
        assert!(!range.contains(9001));

        let single = PortRange::single(443);
        assert!(single.contains(443));
        assert!(!single.contains(80));
    }
}
