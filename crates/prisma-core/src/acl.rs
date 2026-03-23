//! Access Control Lists (ACLs) for per-client traffic filtering on the server.
//!
//! Each client can have an ACL that determines which destinations are allowed
//! or denied. Rules are evaluated in order; first match wins.
//! Default policy is configurable (allow or deny).

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::router;
use crate::types::ProxyDestination;

/// Default ACL policy when no rule matches.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DefaultPolicy {
    #[default]
    Allow,
    Deny,
}

/// Action to take when a rule matches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AclAction {
    Allow,
    Deny,
}

/// A pattern matcher for ACL rules.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum AclMatcher {
    /// Match exact domain name.
    #[serde(rename = "domain")]
    Domain(String),
    /// Match domain suffix (e.g., ".google.com" matches "*.google.com").
    #[serde(rename = "domain-suffix")]
    DomainSuffix(String),
    /// Match domain containing keyword.
    #[serde(rename = "domain-keyword")]
    DomainKeyword(String),
    /// Match IP CIDR range (e.g., "192.168.0.0/16").
    #[serde(rename = "ip-cidr")]
    IpCidr(String),
    /// Match destination port (single or range, e.g., "80" or "8000-9000").
    #[serde(rename = "port")]
    Port(String),
    /// Match all destinations.
    #[serde(rename = "all")]
    All,
}

/// A single ACL rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AclRule {
    /// Action to take when matched.
    pub action: AclAction,
    /// Matcher pattern.
    pub matcher: AclMatcher,
    /// Optional human-readable description.
    #[serde(default)]
    pub description: Option<String>,
}

/// Access control list for a single client.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Acl {
    /// The client ID this ACL applies to.
    pub client_id: String,
    /// Ordered list of rules. First match wins.
    pub rules: Vec<AclRule>,
    /// Default policy when no rule matches.
    #[serde(default)]
    pub default_policy: DefaultPolicy,
    /// Whether this ACL is enabled.
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

impl Acl {
    /// Check whether a destination is allowed by this ACL.
    /// Returns true if the connection should be permitted.
    pub fn check(&self, dest: &ProxyDestination) -> bool {
        if !self.enabled {
            return true; // ACL disabled, allow all
        }

        let domain = dest.domain();
        let ip = dest.ip_addr();
        let port = dest.port;

        for rule in &self.rules {
            if matches_acl_rule(&rule.matcher, domain.as_deref(), ip, port) {
                return rule.action == AclAction::Allow;
            }
        }

        // No rule matched: use default policy
        self.default_policy == DefaultPolicy::Allow
    }
}

/// Check if a matcher matches the given destination.
fn matches_acl_rule(
    matcher: &AclMatcher,
    domain: Option<&str>,
    ip: Option<IpAddr>,
    port: u16,
) -> bool {
    match matcher {
        AclMatcher::Domain(d) => {
            domain.is_some_and(|dom| dom.trim_end_matches('.').eq_ignore_ascii_case(d))
        }
        AclMatcher::DomainSuffix(suffix) => domain.is_some_and(|dom| {
            let dom = dom.trim_end_matches('.');
            let suffix = suffix.trim_start_matches('.');
            dom.eq_ignore_ascii_case(suffix)
                || dom
                    .to_ascii_lowercase()
                    .ends_with(&format!(".{}", suffix.to_ascii_lowercase()))
        }),
        AclMatcher::DomainKeyword(kw) => {
            domain.is_some_and(|dom| dom.to_ascii_lowercase().contains(&kw.to_ascii_lowercase()))
        }
        AclMatcher::IpCidr(cidr) => match ip {
            Some(IpAddr::V4(v4)) => router::parse_cidr_v4(cidr)
                .map(|(network, mask)| (u32::from(v4) & mask) == network)
                .unwrap_or(false),
            Some(IpAddr::V6(v6)) => router::parse_cidr_v6(cidr)
                .map(|(network, mask)| (u128::from(v6) & mask) == network)
                .unwrap_or(false),
            None => false,
        },
        AclMatcher::Port(spec) => {
            if let Some((start, end)) = spec.split_once('-') {
                let start: u16 = start.parse().unwrap_or(0);
                let end: u16 = end.parse().unwrap_or(0);
                port >= start && port <= end
            } else {
                spec.parse::<u16>() == Ok(port)
            }
        }
        AclMatcher::All => true,
    }
}

/// Manages ACLs for all clients, shared between server handler and management API.
#[derive(Clone)]
pub struct AclStore {
    acls: Arc<RwLock<HashMap<String, Acl>>>,
}

impl AclStore {
    /// Create a new empty ACL store.
    pub fn new() -> Self {
        Self {
            acls: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create a store from a config map.
    pub fn from_config(acls: HashMap<String, Acl>) -> Self {
        Self {
            acls: Arc::new(RwLock::new(acls)),
        }
    }

    /// Check if a destination is allowed for a given client.
    /// Returns true if no ACL is set for this client (default allow).
    pub async fn check(&self, client_id: &str, dest: &ProxyDestination) -> bool {
        let acls = self.acls.read().await;
        match acls.get(client_id) {
            Some(acl) => acl.check(dest),
            None => true, // No ACL = allow all
        }
    }

    /// Set the ACL for a client (replaces existing).
    pub async fn set(&self, client_id: String, acl: Acl) {
        let mut acls = self.acls.write().await;
        acls.insert(client_id, acl);
    }

    /// Remove the ACL for a client.
    pub async fn remove(&self, client_id: &str) -> bool {
        let mut acls = self.acls.write().await;
        acls.remove(client_id).is_some()
    }

    /// Get the ACL for a specific client.
    pub async fn get(&self, client_id: &str) -> Option<Acl> {
        let acls = self.acls.read().await;
        acls.get(client_id).cloned()
    }

    /// List all ACLs.
    pub async fn list(&self) -> Vec<Acl> {
        let acls = self.acls.read().await;
        acls.values().cloned().collect()
    }
}

impl Default for AclStore {
    fn default() -> Self {
        Self::new()
    }
}

/// Extension trait for ProxyDestination to extract domain/IP for ACL matching.
trait ProxyDestExt {
    fn domain(&self) -> Option<String>;
    fn ip_addr(&self) -> Option<IpAddr>;
}

impl ProxyDestExt for ProxyDestination {
    fn domain(&self) -> Option<String> {
        match &self.address {
            crate::types::ProxyAddress::Domain(d) => Some(d.clone()),
            _ => None,
        }
    }

    fn ip_addr(&self) -> Option<IpAddr> {
        match &self.address {
            crate::types::ProxyAddress::Ipv4(ip) => Some(IpAddr::V4(*ip)),
            crate::types::ProxyAddress::Ipv6(ip) => Some(IpAddr::V6(*ip)),
            crate::types::ProxyAddress::Domain(_) => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ProxyAddress, ProxyDestination};
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
    fn test_acl_domain_allow() {
        let acl = Acl {
            client_id: "client-1".into(),
            rules: vec![
                AclRule {
                    action: AclAction::Allow,
                    matcher: AclMatcher::DomainSuffix("allowed.com".into()),
                    description: None,
                },
                AclRule {
                    action: AclAction::Deny,
                    matcher: AclMatcher::All,
                    description: None,
                },
            ],
            default_policy: DefaultPolicy::Deny,
            enabled: true,
        };

        assert!(acl.check(&make_domain_dest("www.allowed.com", 443)));
        assert!(acl.check(&make_domain_dest("allowed.com", 443)));
        assert!(!acl.check(&make_domain_dest("blocked.com", 443)));
    }

    #[test]
    fn test_acl_ip_cidr() {
        let acl = Acl {
            client_id: "client-2".into(),
            rules: vec![AclRule {
                action: AclAction::Deny,
                matcher: AclMatcher::IpCidr("10.0.0.0/8".into()),
                description: Some("Block private IPs".into()),
            }],
            default_policy: DefaultPolicy::Allow,
            enabled: true,
        };

        assert!(!acl.check(&make_ipv4_dest([10, 1, 2, 3], 80)));
        assert!(acl.check(&make_ipv4_dest([8, 8, 8, 8], 80)));
    }

    #[test]
    fn test_acl_port_range() {
        let acl = Acl {
            client_id: "client-3".into(),
            rules: vec![
                AclRule {
                    action: AclAction::Allow,
                    matcher: AclMatcher::Port("80".into()),
                    description: None,
                },
                AclRule {
                    action: AclAction::Allow,
                    matcher: AclMatcher::Port("443".into()),
                    description: None,
                },
                AclRule {
                    action: AclAction::Deny,
                    matcher: AclMatcher::All,
                    description: None,
                },
            ],
            default_policy: DefaultPolicy::Deny,
            enabled: true,
        };

        assert!(acl.check(&make_domain_dest("any.com", 80)));
        assert!(acl.check(&make_domain_dest("any.com", 443)));
        assert!(!acl.check(&make_domain_dest("any.com", 8080)));
    }

    #[test]
    fn test_acl_disabled() {
        let acl = Acl {
            client_id: "client-4".into(),
            rules: vec![AclRule {
                action: AclAction::Deny,
                matcher: AclMatcher::All,
                description: None,
            }],
            default_policy: DefaultPolicy::Deny,
            enabled: false,
        };

        // ACL disabled: everything allowed
        assert!(acl.check(&make_domain_dest("anything.com", 443)));
    }

    #[test]
    fn test_default_policy_deny() {
        let acl = Acl {
            client_id: "client-5".into(),
            rules: vec![], // No rules
            default_policy: DefaultPolicy::Deny,
            enabled: true,
        };

        assert!(!acl.check(&make_domain_dest("anything.com", 443)));
    }

    #[test]
    fn test_default_policy_allow() {
        let acl = Acl {
            client_id: "client-6".into(),
            rules: vec![], // No rules
            default_policy: DefaultPolicy::Allow,
            enabled: true,
        };

        assert!(acl.check(&make_domain_dest("anything.com", 443)));
    }

    #[tokio::test]
    async fn test_acl_store_operations() {
        let store = AclStore::new();

        // No ACL set: allow by default
        assert!(
            store
                .check("client-1", &make_domain_dest("example.com", 443))
                .await
        );

        // Set an ACL
        let acl = Acl {
            client_id: "client-1".into(),
            rules: vec![AclRule {
                action: AclAction::Deny,
                matcher: AclMatcher::Domain("blocked.com".into()),
                description: None,
            }],
            default_policy: DefaultPolicy::Allow,
            enabled: true,
        };
        store.set("client-1".into(), acl).await;

        assert!(
            store
                .check("client-1", &make_domain_dest("example.com", 443))
                .await
        );
        assert!(
            !store
                .check("client-1", &make_domain_dest("blocked.com", 443))
                .await
        );

        // Remove ACL
        assert!(store.remove("client-1").await);
        assert!(
            store
                .check("client-1", &make_domain_dest("blocked.com", 443))
                .await
        );

        // Remove non-existent
        assert!(!store.remove("client-1").await);
    }
}
