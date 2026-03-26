//! Rule-based routing engine for Prisma client.
//!
//! Matches incoming connections against rules and decides:
//! - **Proxy**: send through the PrismaVeil tunnel
//! - **Direct**: connect directly (bypass proxy)
//! - **Block**: drop connection (e.g. ad blocking)

use std::net::IpAddr;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::geodata::GeoIPMatcher;

/// Action to take when a rule matches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RouteAction {
    #[serde(alias = "PROXY")]
    Proxy,
    #[serde(alias = "DIRECT")]
    Direct,
    #[serde(alias = "reject", alias = "REJECT", alias = "BLOCK")]
    Block,
    /// Unknown action from a future config version — treated as Proxy (default).
    #[serde(other)]
    Unknown,
}

/// A single routing rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    #[serde(flatten)]
    pub condition: RuleCondition,
    pub action: RouteAction,
}

/// Rule matching conditions.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "value")]
pub enum RuleCondition {
    /// Exact domain match.
    #[serde(rename = "domain")]
    Domain(String),
    /// Domain suffix match (e.g., ".google.com" matches "www.google.com").
    #[serde(rename = "domain-suffix")]
    DomainSuffix(String),
    /// Domain contains keyword.
    #[serde(rename = "domain-keyword")]
    DomainKeyword(String),
    /// IP CIDR range match (IPv4 or IPv6).
    #[serde(rename = "ip-cidr")]
    IpCidr(String),
    /// GeoIP country match (e.g., "cn", "us", "private").
    #[serde(rename = "geoip")]
    GeoIp(String),
    /// Port number or range (e.g., "80" or "8000-9000").
    #[serde(rename = "port")]
    Port(String),
    /// Match all connections (catch-all).
    #[serde(rename = "all")]
    All,
    /// Unknown condition from a future config version -- never matches.
    Unknown,
}

impl<'de> serde::Deserialize<'de> for RuleCondition {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = toml::Value::deserialize(deserializer)?;

        let table = match &value {
            toml::Value::Table(t) => t,
            toml::Value::String(s) => {
                return match s.as_str() {
                    "all" | "All" => Ok(RuleCondition::All),
                    _ => Ok(RuleCondition::Unknown),
                };
            }
            _ => return Ok(RuleCondition::Unknown),
        };

        let type_str = match table.get("type").and_then(|v| v.as_str()) {
            Some(s) => s,
            None => return Ok(RuleCondition::Unknown),
        };

        let val_str = || {
            table
                .get("value")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string()
        };

        match type_str {
            "domain" => Ok(RuleCondition::Domain(val_str())),
            "domain-suffix" => Ok(RuleCondition::DomainSuffix(val_str())),
            "domain-keyword" => Ok(RuleCondition::DomainKeyword(val_str())),
            "ip-cidr" => Ok(RuleCondition::IpCidr(val_str())),
            "geoip" => Ok(RuleCondition::GeoIp(val_str())),
            "port" => Ok(RuleCondition::Port(val_str())),
            "all" | "All" => Ok(RuleCondition::All),
            _ => Ok(RuleCondition::Unknown),
        }
    }
}

/// Pre-parsed CIDR for either IPv4 or IPv6.
#[derive(Debug, Clone, Copy)]
enum ParsedCidr {
    None,
    V4 { network: u32, mask: u32 },
    V6 { network: u128, mask: u128 },
}

/// The routing engine: evaluates rules top-to-bottom, first match wins.
pub struct Router {
    rules: Vec<Rule>,
    /// Pre-parsed CIDR entries for fast IP matching (one per rule slot).
    cidrs: Vec<ParsedCidr>,
    /// Optional GeoIP matcher for country-based routing.
    geoip: Option<Arc<GeoIPMatcher>>,
}

impl Router {
    /// Create a router from a list of rules.
    pub fn new(rules: Vec<Rule>) -> Self {
        Self::with_geoip(rules, None)
    }

    /// Create a router with an optional GeoIP matcher.
    pub fn with_geoip(rules: Vec<Rule>, geoip: Option<Arc<GeoIPMatcher>>) -> Self {
        let cidrs = rules
            .iter()
            .map(|r| {
                if let RuleCondition::IpCidr(ref cidr) = r.condition {
                    if cidr.contains(':') {
                        match parse_cidr_v6(cidr) {
                            Some((network, mask)) => ParsedCidr::V6 { network, mask },
                            None => ParsedCidr::None,
                        }
                    } else {
                        match parse_cidr_v4(cidr) {
                            Some((network, mask)) => ParsedCidr::V4 { network, mask },
                            None => ParsedCidr::None,
                        }
                    }
                } else {
                    ParsedCidr::None
                }
            })
            .collect();
        Self {
            rules,
            cidrs,
            geoip,
        }
    }

    /// Match a connection by domain, IP, and port.
    /// Returns the action for the first matching rule, or `Proxy` if no match.
    pub fn route(&self, domain: Option<&str>, ip: Option<IpAddr>, port: u16) -> RouteAction {
        for (i, rule) in self.rules.iter().enumerate() {
            if self.matches(i, &rule.condition, domain, ip, port) {
                return rule.action;
            }
        }
        RouteAction::Proxy // default: tunnel everything
    }

    /// Returns true if this router has any rules that require an IP address
    /// (GeoIP or IP-CIDR). Used by callers to decide whether to resolve DNS
    /// before routing so that domain-only connections can match GeoIP rules.
    pub fn needs_ip_for_routing(&self) -> bool {
        self.rules.iter().any(|r| {
            matches!(
                r.condition,
                RuleCondition::GeoIp(_) | RuleCondition::IpCidr(_)
            )
        })
    }

    fn matches(
        &self,
        idx: usize,
        condition: &RuleCondition,
        domain: Option<&str>,
        ip: Option<IpAddr>,
        port: u16,
    ) -> bool {
        match condition {
            RuleCondition::Domain(d) => {
                domain.is_some_and(|dom| dom.trim_end_matches('.').eq_ignore_ascii_case(d))
            }
            RuleCondition::DomainSuffix(suffix) => domain.is_some_and(|dom| {
                let dom = dom.trim_end_matches('.');
                let suffix = suffix.trim_start_matches('.');
                dom.eq_ignore_ascii_case(suffix)
                    || dom
                        .to_ascii_lowercase()
                        .ends_with(&format!(".{}", suffix.to_ascii_lowercase()))
            }),
            RuleCondition::DomainKeyword(kw) => domain
                .is_some_and(|dom| dom.to_ascii_lowercase().contains(&kw.to_ascii_lowercase())),
            RuleCondition::IpCidr(_) => match (ip, self.cidrs[idx]) {
                (Some(IpAddr::V4(v4)), ParsedCidr::V4 { network, mask }) => {
                    (u32::from(v4) & mask) == network
                }
                (Some(IpAddr::V6(v6)), ParsedCidr::V6 { network, mask }) => {
                    (u128::from(v6) & mask) == network
                }
                _ => false,
            },
            RuleCondition::GeoIp(code) => {
                if let (Some(geoip), Some(IpAddr::V4(v4))) = (&self.geoip, ip) {
                    geoip.matches(code, v4)
                } else {
                    false
                }
            }
            RuleCondition::Port(p) => parse_port_match(p, port),
            RuleCondition::All => true,
            RuleCondition::Unknown => false, // Unknown conditions never match
        }
    }
}

/// Parse an IPv4 CIDR string into (network_u32, mask_u32).
pub fn parse_cidr_v4(cidr: &str) -> Option<(u32, u32)> {
    let parts: Vec<&str> = cidr.split('/').collect();
    if parts.len() != 2 {
        return None;
    }
    let ip: std::net::Ipv4Addr = parts[0].parse().ok()?;
    let prefix: u32 = parts[1].parse().ok()?;
    if prefix > 32 {
        return None;
    }
    let mask = if prefix == 0 {
        0
    } else {
        !0u32 << (32 - prefix)
    };
    let network = u32::from(ip) & mask;
    Some((network, mask))
}

/// Parse an IPv6 CIDR string into (network_u128, mask_u128).
pub fn parse_cidr_v6(cidr: &str) -> Option<(u128, u128)> {
    let parts: Vec<&str> = cidr.split('/').collect();
    if parts.len() != 2 {
        return None;
    }
    let ip: std::net::Ipv6Addr = parts[0].parse().ok()?;
    let prefix: u32 = parts[1].parse().ok()?;
    if prefix > 128 {
        return None;
    }
    let mask = if prefix == 0 {
        0
    } else {
        !0u128 << (128 - prefix)
    };
    let network = u128::from(ip) & mask;
    Some((network, mask))
}

/// Match a port against a port spec (single port or range).
fn parse_port_match(spec: &str, port: u16) -> bool {
    if let Some((start, end)) = spec.split_once('-') {
        let start: u16 = start.parse().unwrap_or(0);
        let end: u16 = end.parse().unwrap_or(0);
        port >= start && port <= end
    } else {
        spec.parse::<u16>() == Ok(port)
    }
}

/// Routing configuration for config files.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RoutingConfig {
    #[serde(default)]
    pub rules: Vec<Rule>,
    /// Path to a v2fly geoip.dat file for GeoIP-based routing.
    #[serde(default)]
    pub geoip_path: Option<String>,
    /// Rule providers — remote rule lists fetched at startup and periodically.
    #[serde(default)]
    pub rule_providers: Vec<crate::rule_provider::RuleProviderConfig>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_domain_exact_match() {
        let rules = vec![Rule {
            condition: RuleCondition::Domain("example.com".into()),
            action: RouteAction::Direct,
        }];
        let router = Router::new(rules);

        assert_eq!(
            router.route(Some("example.com"), None, 443),
            RouteAction::Direct
        );
        assert_eq!(
            router.route(Some("example.com."), None, 443),
            RouteAction::Direct
        );
        assert_eq!(
            router.route(Some("other.com"), None, 443),
            RouteAction::Proxy
        );
    }

    #[test]
    fn test_domain_suffix_match() {
        let rules = vec![Rule {
            condition: RuleCondition::DomainSuffix("google.com".into()),
            action: RouteAction::Direct,
        }];
        let router = Router::new(rules);

        assert_eq!(
            router.route(Some("google.com"), None, 80),
            RouteAction::Direct
        );
        assert_eq!(
            router.route(Some("www.google.com"), None, 80),
            RouteAction::Direct
        );
        assert_eq!(
            router.route(Some("mail.google.com"), None, 80),
            RouteAction::Direct
        );
        assert_eq!(
            router.route(Some("notgoogle.com"), None, 80),
            RouteAction::Proxy
        );
    }

    #[test]
    fn test_domain_keyword_match() {
        let rules = vec![Rule {
            condition: RuleCondition::DomainKeyword("ads".into()),
            action: RouteAction::Block,
        }];
        let router = Router::new(rules);

        assert_eq!(
            router.route(Some("ads.example.com"), None, 80),
            RouteAction::Block
        );
        assert_eq!(
            router.route(Some("cdn-ads.tracker.com"), None, 80),
            RouteAction::Block
        );
        assert_eq!(
            router.route(Some("example.com"), None, 80),
            RouteAction::Proxy
        );
    }

    #[test]
    fn test_ip_cidr_match() {
        let rules = vec![Rule {
            condition: RuleCondition::IpCidr("192.168.0.0/16".into()),
            action: RouteAction::Direct,
        }];
        let router = Router::new(rules);

        let local_ip = "192.168.1.100".parse().ok();
        let public_ip = "8.8.8.8".parse().ok();

        assert_eq!(router.route(None, local_ip, 80), RouteAction::Direct);
        assert_eq!(router.route(None, public_ip, 80), RouteAction::Proxy);
    }

    #[test]
    fn test_ipv6_cidr_match() {
        let rules = vec![Rule {
            condition: RuleCondition::IpCidr("2001:db8::/32".into()),
            action: RouteAction::Direct,
        }];
        let router = Router::new(rules);

        let inside: Option<IpAddr> = "2001:db8::1".parse().ok();
        let outside: Option<IpAddr> = "2001:db9::1".parse().ok();
        let v4: Option<IpAddr> = "192.168.1.1".parse().ok();

        assert_eq!(router.route(None, inside, 443), RouteAction::Direct);
        assert_eq!(router.route(None, outside, 443), RouteAction::Proxy);
        // IPv4 address should not match an IPv6 CIDR rule
        assert_eq!(router.route(None, v4, 443), RouteAction::Proxy);
    }

    #[test]
    fn test_ipv6_cidr_loopback() {
        let rules = vec![Rule {
            condition: RuleCondition::IpCidr("::1/128".into()),
            action: RouteAction::Block,
        }];
        let router = Router::new(rules);

        let loopback: Option<IpAddr> = "::1".parse().ok();
        let other: Option<IpAddr> = "::2".parse().ok();

        assert_eq!(router.route(None, loopback, 80), RouteAction::Block);
        assert_eq!(router.route(None, other, 80), RouteAction::Proxy);
    }

    #[test]
    fn test_ipv6_cidr_ula() {
        // Unique Local Addresses: fc00::/7
        let rules = vec![Rule {
            condition: RuleCondition::IpCidr("fc00::/7".into()),
            action: RouteAction::Direct,
        }];
        let router = Router::new(rules);

        let ula: Option<IpAddr> = "fd12:3456:789a::1".parse().ok();
        let public: Option<IpAddr> = "2001:db8::1".parse().ok();

        assert_eq!(router.route(None, ula, 80), RouteAction::Direct);
        assert_eq!(router.route(None, public, 80), RouteAction::Proxy);
    }

    #[test]
    fn test_mixed_v4_v6_cidr_rules() {
        let rules = vec![
            Rule {
                condition: RuleCondition::IpCidr("192.168.0.0/16".into()),
                action: RouteAction::Direct,
            },
            Rule {
                condition: RuleCondition::IpCidr("2001:db8::/32".into()),
                action: RouteAction::Direct,
            },
        ];
        let router = Router::new(rules);

        let v4_match: Option<IpAddr> = "192.168.1.1".parse().ok();
        let v6_match: Option<IpAddr> = "2001:db8::1".parse().ok();
        let v4_no: Option<IpAddr> = "10.0.0.1".parse().ok();
        let v6_no: Option<IpAddr> = "2001:db9::1".parse().ok();

        assert_eq!(router.route(None, v4_match, 80), RouteAction::Direct);
        assert_eq!(router.route(None, v6_match, 80), RouteAction::Direct);
        assert_eq!(router.route(None, v4_no, 80), RouteAction::Proxy);
        assert_eq!(router.route(None, v6_no, 80), RouteAction::Proxy);
    }

    #[test]
    fn test_parse_cidr_v6() {
        // Valid CIDRs
        let (net, mask) = parse_cidr_v6("2001:db8::/32").unwrap();
        assert_eq!(mask, !0u128 << 96);
        assert_eq!(
            net,
            u128::from("2001:db8::".parse::<std::net::Ipv6Addr>().unwrap()) & mask
        );

        let (net, _mask) = parse_cidr_v6("::1/128").unwrap();
        assert_eq!(net, 1u128);

        let (net, mask) = parse_cidr_v6("fc00::/7").unwrap();
        assert_eq!(mask, !0u128 << 121);
        assert_eq!(
            net,
            u128::from("fc00::".parse::<std::net::Ipv6Addr>().unwrap()) & mask
        );

        // Full match (match everything)
        let (_net, mask) = parse_cidr_v6("::/0").unwrap();
        assert_eq!(mask, 0u128);

        // Invalid cases
        assert!(parse_cidr_v6("2001:db8::").is_none()); // missing prefix
        assert!(parse_cidr_v6("2001:db8::/129").is_none()); // prefix too large
        assert!(parse_cidr_v6("not-an-ip/32").is_none()); // invalid IP
    }

    #[test]
    fn test_ipv6_cidr_all_zeros() {
        // ::/0 should match everything
        let rules = vec![Rule {
            condition: RuleCondition::IpCidr("::/0".into()),
            action: RouteAction::Block,
        }];
        let router = Router::new(rules);

        let any_v6: Option<IpAddr> = "2001:db8::1".parse().ok();
        let loopback: Option<IpAddr> = "::1".parse().ok();

        assert_eq!(router.route(None, any_v6, 80), RouteAction::Block);
        assert_eq!(router.route(None, loopback, 80), RouteAction::Block);

        // IPv4 should not match IPv6 ::/0
        let v4: Option<IpAddr> = "1.2.3.4".parse().ok();
        assert_eq!(router.route(None, v4, 80), RouteAction::Proxy);
    }

    #[test]
    fn test_geoip_no_matcher() {
        let rules = vec![Rule {
            condition: RuleCondition::GeoIp("cn".into()),
            action: RouteAction::Direct,
        }];
        let router = Router::new(rules);

        // Without a GeoIP matcher, GeoIp rules never match
        let ip = "1.2.3.4".parse().ok();
        assert_eq!(router.route(None, ip, 80), RouteAction::Proxy);
    }

    #[test]
    fn test_geoip_with_matcher() {
        use std::collections::HashMap;
        use std::net::Ipv4Addr;

        // Build a mock matcher with 10.0.0.0/8 as "private"
        let mut entries = HashMap::new();
        let mask = !0u32 << 24;
        let network = u32::from(Ipv4Addr::new(10, 0, 0, 0)) & mask;
        entries.insert("private".to_string(), vec![(network, mask)]);
        let matcher = Arc::new(GeoIPMatcher::new_from_entries(entries));

        let rules = vec![
            Rule {
                condition: RuleCondition::GeoIp("private".into()),
                action: RouteAction::Direct,
            },
            Rule {
                condition: RuleCondition::All,
                action: RouteAction::Proxy,
            },
        ];
        let router = Router::with_geoip(rules, Some(matcher));

        let private_ip: Option<IpAddr> = "10.1.2.3".parse().ok();
        let public_ip: Option<IpAddr> = "8.8.8.8".parse().ok();

        assert_eq!(router.route(None, private_ip, 80), RouteAction::Direct);
        assert_eq!(router.route(None, public_ip, 80), RouteAction::Proxy);
    }

    #[test]
    fn test_port_match() {
        let rules = vec![
            Rule {
                condition: RuleCondition::Port("80".into()),
                action: RouteAction::Direct,
            },
            Rule {
                condition: RuleCondition::Port("8000-9000".into()),
                action: RouteAction::Block,
            },
        ];
        let router = Router::new(rules);

        assert_eq!(router.route(None, None, 80), RouteAction::Direct);
        assert_eq!(router.route(None, None, 8500), RouteAction::Block);
        assert_eq!(router.route(None, None, 443), RouteAction::Proxy);
    }

    #[test]
    fn test_all_catch_all() {
        let rules = vec![
            Rule {
                condition: RuleCondition::Domain("special.com".into()),
                action: RouteAction::Direct,
            },
            Rule {
                condition: RuleCondition::All,
                action: RouteAction::Block,
            },
        ];
        let router = Router::new(rules);

        assert_eq!(
            router.route(Some("special.com"), None, 80),
            RouteAction::Direct
        );
        assert_eq!(
            router.route(Some("anything.com"), None, 80),
            RouteAction::Block
        );
    }

    #[test]
    fn test_first_match_wins() {
        let rules = vec![
            Rule {
                condition: RuleCondition::Domain("example.com".into()),
                action: RouteAction::Direct,
            },
            Rule {
                condition: RuleCondition::DomainSuffix("example.com".into()),
                action: RouteAction::Block,
            },
        ];
        let router = Router::new(rules);

        // First rule matches exact domain
        assert_eq!(
            router.route(Some("example.com"), None, 80),
            RouteAction::Direct
        );
        // Second rule matches subdomain
        assert_eq!(
            router.route(Some("sub.example.com"), None, 80),
            RouteAction::Block
        );
    }

    #[test]
    fn test_default_proxy() {
        let router = Router::new(vec![]);
        assert_eq!(
            router.route(Some("anything.com"), None, 443),
            RouteAction::Proxy
        );
    }

    #[test]
    fn test_needs_ip_for_routing() {
        // No IP-dependent rules
        let rules = vec![Rule {
            condition: RuleCondition::Domain("example.com".into()),
            action: RouteAction::Direct,
        }];
        let router = Router::new(rules);
        assert!(!router.needs_ip_for_routing());

        // With GeoIP rule
        let rules = vec![
            Rule {
                condition: RuleCondition::GeoIp("cn".into()),
                action: RouteAction::Direct,
            },
            Rule {
                condition: RuleCondition::All,
                action: RouteAction::Proxy,
            },
        ];
        let router = Router::new(rules);
        assert!(router.needs_ip_for_routing());

        // With IP-CIDR rule
        let rules = vec![Rule {
            condition: RuleCondition::IpCidr("192.168.0.0/16".into()),
            action: RouteAction::Direct,
        }];
        let router = Router::new(rules);
        assert!(router.needs_ip_for_routing());

        // Empty rules
        let router = Router::new(vec![]);
        assert!(!router.needs_ip_for_routing());
    }

    #[test]
    fn test_geoip_case_insensitive() {
        use std::collections::HashMap;
        use std::net::Ipv4Addr;

        // Build a matcher with "cn" country code
        let mut entries = HashMap::new();
        let mask = !0u32 << 24;
        let network = u32::from(Ipv4Addr::new(1, 0, 0, 0)) & mask;
        entries.insert("cn".to_string(), vec![(network, mask)]);
        let matcher = Arc::new(GeoIPMatcher::new_from_entries(entries));

        let rules = vec![Rule {
            condition: RuleCondition::GeoIp("CN".into()), // uppercase in rule
            action: RouteAction::Direct,
        }];
        let router = Router::with_geoip(rules, Some(matcher));

        // Should match even though rule says "CN" and DB has "cn"
        let cn_ip: Option<IpAddr> = "1.0.0.1".parse().ok();
        assert_eq!(router.route(None, cn_ip, 80), RouteAction::Direct);

        let other_ip: Option<IpAddr> = "8.8.8.8".parse().ok();
        assert_eq!(router.route(None, other_ip, 80), RouteAction::Proxy);
    }

    #[test]
    fn test_parse_port_match() {
        assert!(parse_port_match("80", 80));
        assert!(!parse_port_match("80", 443));
        assert!(parse_port_match("8000-9000", 8500));
        assert!(!parse_port_match("8000-9000", 7999));
        assert!(parse_port_match("8000-9000", 8000));
        assert!(parse_port_match("8000-9000", 9000));
    }
}
