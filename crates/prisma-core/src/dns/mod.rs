//! DNS handling for Prisma client.
//!
//! Supports three modes:
//! - **Smart**: Route blocked domain DNS through tunnel, resolve others directly
//! - **Fake**: Return fake IPs from a reserved pool (198.18.0.0/15), map back to real domains
//! - **Tunnel**: Route all DNS queries through the encrypted tunnel
//!
//! Supports multiple DNS protocols:
//! - **UDP**: Traditional plain-text DNS over UDP (default)
//! - **DoH**: DNS-over-HTTPS (RFC 8484) for encrypted DNS queries
//! - **DoT**: DNS-over-TLS (RFC 7858) for encrypted DNS queries

pub mod doh;
pub mod fake_ip;

use serde::{Deserialize, Serialize};

/// DNS resolution mode.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DnsMode {
    /// Smart DNS: tunnel DNS for blocked domains, resolve others directly.
    Smart,
    /// Fake DNS: return fake IPs from a reserved pool, zero DNS leaks.
    Fake,
    /// Tunnel all DNS through the proxy connection.
    Tunnel,
    /// Direct DNS resolution (no tunneling). Default mode.
    #[default]
    Direct,
}

/// DNS transport protocol.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DnsProtocol {
    /// Traditional plain-text DNS over UDP (default).
    #[default]
    Udp,
    /// DNS-over-HTTPS (RFC 8484).
    Doh,
    /// DNS-over-TLS (RFC 7858).
    Dot,
}

/// DNS configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsConfig {
    #[serde(default)]
    pub mode: DnsMode,
    /// DNS transport protocol: "udp" (default), "doh", or "dot".
    #[serde(default)]
    pub protocol: DnsProtocol,
    /// Path to GeoSite database for smart mode domain matching.
    #[serde(default)]
    pub geosite_path: Option<String>,
    /// CIDR range for fake DNS IPs (default: 198.18.0.0/15).
    #[serde(default = "default_fake_ip_range")]
    pub fake_ip_range: String,
    /// Upstream DNS server for direct resolution (used with UDP protocol).
    #[serde(default = "default_upstream_dns")]
    pub upstream: String,
    /// DoH server URL (used when protocol is "doh").
    #[serde(default = "default_doh_url")]
    pub doh_url: String,
    /// Local address for the DNS server to listen on (default: 127.0.0.1:53).
    #[serde(default = "default_dns_listen_addr")]
    pub dns_listen_addr: String,
}

impl Default for DnsConfig {
    fn default() -> Self {
        Self {
            mode: DnsMode::default(),
            protocol: DnsProtocol::default(),
            geosite_path: None,
            fake_ip_range: default_fake_ip_range(),
            upstream: default_upstream_dns(),
            doh_url: default_doh_url(),
            dns_listen_addr: default_dns_listen_addr(),
        }
    }
}

fn default_dns_listen_addr() -> String {
    "127.0.0.1:10053".into()
}

fn default_fake_ip_range() -> String {
    "198.18.0.0/15".into()
}

fn default_upstream_dns() -> String {
    "8.8.8.8:53".into()
}

fn default_doh_url() -> String {
    "https://cloudflare-dns.com/dns-query".into()
}

/// Check if a domain matches any entry in a blocklist.
/// Used by smart DNS mode to decide whether to tunnel a query.
pub fn domain_matches_blocklist(domain: &str, blocklist: &[String]) -> bool {
    let domain = domain.trim_end_matches('.');
    for entry in blocklist {
        let entry = entry.trim_start_matches('.');
        if domain == entry || domain.ends_with(&format!(".{}", entry)) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_exact_domain_match() {
        let blocklist = vec!["google.com".into()];
        assert!(domain_matches_blocklist("google.com", &blocklist));
        assert!(domain_matches_blocklist("google.com.", &blocklist));
    }

    #[test]
    fn test_subdomain_match() {
        let blocklist = vec!["google.com".into()];
        assert!(domain_matches_blocklist("www.google.com", &blocklist));
        assert!(domain_matches_blocklist("mail.google.com", &blocklist));
        assert!(domain_matches_blocklist("a.b.c.google.com", &blocklist));
    }

    #[test]
    fn test_no_match() {
        let blocklist = vec!["google.com".into()];
        assert!(!domain_matches_blocklist("notgoogle.com", &blocklist));
        assert!(!domain_matches_blocklist("example.com", &blocklist));
    }

    #[test]
    fn test_empty_blocklist() {
        assert!(!domain_matches_blocklist("anything.com", &[]));
    }

    #[test]
    fn test_dns_config_default() {
        let config = DnsConfig::default();
        assert_eq!(config.mode, DnsMode::Direct);
        assert_eq!(config.protocol, DnsProtocol::Udp);
        assert_eq!(config.fake_ip_range, "198.18.0.0/15");
        assert_eq!(config.doh_url, "https://cloudflare-dns.com/dns-query");
    }

    #[test]
    fn test_dns_protocol_default() {
        let protocol = DnsProtocol::default();
        assert_eq!(protocol, DnsProtocol::Udp);
    }

    #[test]
    fn test_dns_protocol_serde() {
        let json = serde_json::to_string(&DnsProtocol::Doh).unwrap();
        assert_eq!(json, "\"doh\"");

        let parsed: DnsProtocol = serde_json::from_str("\"doh\"").unwrap();
        assert_eq!(parsed, DnsProtocol::Doh);

        let parsed: DnsProtocol = serde_json::from_str("\"udp\"").unwrap();
        assert_eq!(parsed, DnsProtocol::Udp);

        let parsed: DnsProtocol = serde_json::from_str("\"dot\"").unwrap();
        assert_eq!(parsed, DnsProtocol::Dot);
    }

    #[test]
    fn test_dns_config_doh_serde() {
        let json = r#"{
            "protocol": "doh",
            "doh_url": "https://dns.google/dns-query"
        }"#;
        let config: DnsConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.protocol, DnsProtocol::Doh);
        assert_eq!(config.doh_url, "https://dns.google/dns-query");
        // Other fields should have defaults
        assert_eq!(config.mode, DnsMode::Direct);
        assert_eq!(config.upstream, "8.8.8.8:53");
    }
}
