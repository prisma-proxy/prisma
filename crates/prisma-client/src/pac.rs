//! PAC (Proxy Auto-Configuration) file generation and serving.
//!
//! Generates a `proxy.pac` JavaScript file from routing rules and serves it
//! over HTTP so that browsers and OS network settings can auto-configure
//! proxy usage.

use std::fmt::Write;
use std::sync::Arc;

use anyhow::Result;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tracing::{debug, info, warn};

use prisma_core::router::{RouteAction, Rule, RuleCondition};

/// Default PAC server port.
pub const DEFAULT_PAC_PORT: u16 = 8070;

/// Generate a PAC file JavaScript string from routing rules.
///
/// `proxy_addr` is the PROXY directive value, e.g. `"SOCKS5 127.0.0.1:1080"`
/// or `"PROXY 127.0.0.1:8080"`.
pub fn generate_pac(rules: &[Rule], proxy_addr: &str, default_action: RouteAction) -> String {
    let mut js = String::with_capacity(2048);

    js.push_str("function FindProxyForURL(url, host) {\n");
    js.push_str("  host = host.toLowerCase();\n");

    for rule in rules {
        match (&rule.condition, rule.action) {
            (RuleCondition::Domain(domain), action) => {
                let action_str = pac_action_str(action, proxy_addr);
                let _ = writeln!(
                    js,
                    "  if (host === {}) return {};",
                    js_string_literal(&domain.to_ascii_lowercase()),
                    js_string_literal(action_str),
                );
            }
            (RuleCondition::DomainSuffix(suffix), action) => {
                let action_str = pac_action_str(action, proxy_addr);
                let suffix_lower = suffix.to_ascii_lowercase();
                let dot_suffix = if suffix_lower.starts_with('.') {
                    suffix_lower.clone()
                } else {
                    format!(".{}", suffix_lower)
                };
                let _ = writeln!(
                    js,
                    "  if (host === {} || dnsDomainIs(host, {})) return {};",
                    js_string_literal(suffix_lower.trim_start_matches('.')),
                    js_string_literal(&dot_suffix),
                    js_string_literal(action_str),
                );
            }
            (RuleCondition::DomainKeyword(kw), action) => {
                let action_str = pac_action_str(action, proxy_addr);
                let _ = writeln!(
                    js,
                    "  if (host.indexOf({}) !== -1) return {};",
                    js_string_literal(&kw.to_ascii_lowercase()),
                    js_string_literal(action_str),
                );
            }
            (RuleCondition::IpCidr(cidr), action) if !cidr.contains(':') => {
                // Only IPv4 CIDRs are supported in PAC (isInNet)
                if let Some((network_str, mask_str)) = cidr_to_is_in_net(cidr) {
                    let action_str = pac_action_str(action, proxy_addr);
                    let _ = writeln!(
                        js,
                        "  if (isInNet(dnsResolve(host), {}, {})) return {};",
                        js_string_literal(&network_str),
                        js_string_literal(&mask_str),
                        js_string_literal(action_str),
                    );
                }
            }
            (RuleCondition::All, action) => {
                let action_str = pac_action_str(action, proxy_addr);
                let _ = writeln!(js, "  return {};", js_string_literal(action_str));
                // All is a catch-all; stop generating further rules
                js.push_str("}\n");
                return js;
            }
            // GeoIP, Port, and IPv6 CIDR cannot be expressed in PAC — skip them
            _ => {}
        }
    }

    // Default action
    let default_str = pac_action_str(default_action, proxy_addr);
    let _ = writeln!(js, "  return {};", js_string_literal(default_str));
    js.push_str("}\n");

    js
}

/// Convert a route action to a PAC return string.
fn pac_action_str(action: RouteAction, proxy_addr: &str) -> &str {
    match action {
        RouteAction::Proxy => proxy_addr,
        RouteAction::Direct => "DIRECT",
        RouteAction::Block => "DIRECT", // PAC has no "block"; closest is DIRECT
    }
}

/// Escape a string as a JavaScript string literal (with double quotes).
fn js_string_literal(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            _ => out.push(ch),
        }
    }
    out.push('"');
    out
}

/// Convert an IPv4 CIDR string (e.g. "192.168.0.0/16") to (network, mask)
/// strings suitable for PAC `isInNet(host, network, mask)`.
fn cidr_to_is_in_net(cidr: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = cidr.split('/').collect();
    if parts.len() != 2 {
        return None;
    }
    let ip: std::net::Ipv4Addr = parts[0].parse().ok()?;
    let prefix: u32 = parts[1].parse().ok()?;
    if prefix > 32 {
        return None;
    }
    let mask_u32 = if prefix == 0 {
        0
    } else {
        !0u32 << (32 - prefix)
    };
    let network_u32 = u32::from(ip) & mask_u32;

    let network = std::net::Ipv4Addr::from(network_u32);
    let mask = std::net::Ipv4Addr::from(mask_u32);
    Some((network.to_string(), mask.to_string()))
}

/// Build the proxy address directive for PAC from listen addresses.
///
/// Prefers HTTP proxy if available, otherwise uses SOCKS5.
pub fn build_proxy_directive(socks5_addr: &str, http_addr: Option<&str>) -> String {
    if let Some(http) = http_addr {
        format!("PROXY {http}; SOCKS5 {socks5_addr}; DIRECT")
    } else {
        format!("SOCKS5 {socks5_addr}; DIRECT")
    }
}

/// Serve the PAC file over HTTP at the given port.
///
/// Responds to any request path with the PAC content, but the canonical
/// URL is `/proxy.pac`.
pub async fn serve_pac(listen_addr: &str, pac_content: String) -> Result<()> {
    let listener = TcpListener::bind(listen_addr).await?;
    info!(addr = %listen_addr, "PAC server started");

    let pac_content: Arc<str> = Arc::from(pac_content);

    loop {
        match listener.accept().await {
            Ok((mut stream, peer)) => {
                let content = Arc::clone(&pac_content);
                tokio::spawn(async move {
                    debug!(peer = %peer, "PAC request");
                    // Read the request (we don't care about details, just consume it)
                    let mut buf = [0u8; 4096];
                    let _ = tokio::io::AsyncReadExt::read(&mut stream, &mut buf).await;

                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/x-ns-proxy-autoconfig\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-cache\r\n\r\n{}",
                        content.len(),
                        content,
                    );
                    if let Err(e) = stream.write_all(response.as_bytes()).await {
                        warn!(error = %e, "PAC response write error");
                    }
                });
            }
            Err(e) => {
                warn!(error = %e, "PAC accept error");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_pac_domain_rules() {
        let rules = vec![
            Rule {
                condition: RuleCondition::Domain("example.com".into()),
                action: RouteAction::Direct,
            },
            Rule {
                condition: RuleCondition::DomainSuffix("google.com".into()),
                action: RouteAction::Proxy,
            },
            Rule {
                condition: RuleCondition::DomainKeyword("ads".into()),
                action: RouteAction::Block,
            },
        ];
        let pac = generate_pac(&rules, "SOCKS5 127.0.0.1:1080", RouteAction::Proxy);

        assert!(pac.contains("FindProxyForURL"));
        assert!(pac.contains(r#"host === "example.com""#));
        assert!(pac.contains("DIRECT"));
        assert!(pac.contains(r#"dnsDomainIs(host, ".google.com")"#));
        assert!(pac.contains(r#"host.indexOf("ads")"#));
    }

    #[test]
    fn test_generate_pac_cidr_rule() {
        let rules = vec![Rule {
            condition: RuleCondition::IpCidr("192.168.0.0/16".into()),
            action: RouteAction::Direct,
        }];
        let pac = generate_pac(&rules, "SOCKS5 127.0.0.1:1080", RouteAction::Proxy);

        assert!(pac.contains(r#"isInNet(dnsResolve(host), "192.168.0.0", "255.255.0.0")"#));
    }

    #[test]
    fn test_generate_pac_catch_all() {
        let rules = vec![
            Rule {
                condition: RuleCondition::Domain("special.com".into()),
                action: RouteAction::Direct,
            },
            Rule {
                condition: RuleCondition::All,
                action: RouteAction::Proxy,
            },
        ];
        let pac = generate_pac(&rules, "SOCKS5 127.0.0.1:1080", RouteAction::Proxy);

        // The All rule should terminate with a return statement
        assert!(pac.contains(r#"return "SOCKS5 127.0.0.1:1080""#));
        // Should end after the catch-all
        let lines: Vec<&str> = pac.lines().collect();
        assert_eq!(lines.last().unwrap().trim(), "}");
    }

    #[test]
    fn test_generate_pac_empty_rules() {
        let pac = generate_pac(&[], "SOCKS5 127.0.0.1:1080", RouteAction::Proxy);
        assert!(pac.contains("FindProxyForURL"));
        assert!(pac.contains(r#"return "SOCKS5 127.0.0.1:1080""#));
    }

    #[test]
    fn test_generate_pac_default_direct() {
        let pac = generate_pac(&[], "SOCKS5 127.0.0.1:1080", RouteAction::Direct);
        assert!(pac.contains(r#"return "DIRECT""#));
    }

    #[test]
    fn test_cidr_to_is_in_net() {
        let (net, mask) = cidr_to_is_in_net("192.168.0.0/16").unwrap();
        assert_eq!(net, "192.168.0.0");
        assert_eq!(mask, "255.255.0.0");

        let (net, mask) = cidr_to_is_in_net("10.0.0.0/8").unwrap();
        assert_eq!(net, "10.0.0.0");
        assert_eq!(mask, "255.0.0.0");

        let (net, mask) = cidr_to_is_in_net("172.16.0.0/12").unwrap();
        assert_eq!(net, "172.16.0.0");
        assert_eq!(mask, "255.240.0.0");

        assert!(cidr_to_is_in_net("invalid").is_none());
        assert!(cidr_to_is_in_net("::1/128").is_none()); // IPv6 not supported
    }

    #[test]
    fn test_js_string_literal() {
        assert_eq!(js_string_literal("hello"), r#""hello""#);
        assert_eq!(js_string_literal(r#"say "hi""#), r#""say \"hi\"""#);
        assert_eq!(js_string_literal("a\\b"), r#""a\\b""#);
    }

    #[test]
    fn test_build_proxy_directive() {
        let d = build_proxy_directive("127.0.0.1:1080", None);
        assert_eq!(d, "SOCKS5 127.0.0.1:1080; DIRECT");

        let d = build_proxy_directive("127.0.0.1:1080", Some("127.0.0.1:8080"));
        assert_eq!(d, "PROXY 127.0.0.1:8080; SOCKS5 127.0.0.1:1080; DIRECT");
    }

    #[test]
    fn test_generate_pac_ipv6_cidr_skipped() {
        let rules = vec![Rule {
            condition: RuleCondition::IpCidr("2001:db8::/32".into()),
            action: RouteAction::Direct,
        }];
        let pac = generate_pac(&rules, "SOCKS5 127.0.0.1:1080", RouteAction::Proxy);
        // IPv6 CIDRs should be silently skipped
        assert!(!pac.contains("isInNet"));
    }

    #[test]
    fn test_generate_pac_geoip_skipped() {
        let rules = vec![Rule {
            condition: RuleCondition::GeoIp("cn".into()),
            action: RouteAction::Direct,
        }];
        let pac = generate_pac(&rules, "SOCKS5 127.0.0.1:1080", RouteAction::Proxy);
        // GeoIP rules can't be expressed in PAC; just check it doesn't crash
        assert!(pac.contains("FindProxyForURL"));
        assert!(!pac.contains("cn"));
    }

    #[test]
    fn test_generate_pac_domain_suffix_with_dot() {
        let rules = vec![Rule {
            condition: RuleCondition::DomainSuffix(".example.com".into()),
            action: RouteAction::Direct,
        }];
        let pac = generate_pac(&rules, "SOCKS5 127.0.0.1:1080", RouteAction::Proxy);
        assert!(pac.contains(r#"host === "example.com""#));
        assert!(pac.contains(r#"dnsDomainIs(host, ".example.com")"#));
    }
}
