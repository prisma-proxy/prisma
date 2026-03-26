//! Subscription management: fetch, parse, and auto-update server lists from URLs.
//!
//! Supports three common subscription formats:
//! 1. Base64-encoded line-separated URIs (prisma://)
//! 2. Clash-style YAML with a `proxies` array
//! 3. JSON array of server config objects

use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};

use crate::config::client::SubscriptionConfig;

/// A parsed server entry from a subscription.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerEntry {
    /// Human-readable name for this server.
    pub name: String,
    /// Server address (host:port).
    pub server_addr: String,
    /// Transport type: "quic", "ws", "grpc", "xhttp", "xporta", "prisma-tls".
    #[serde(default = "default_transport")]
    pub transport: String,
    /// Optional extra configuration as JSON value (transport-specific settings, etc.).
    #[serde(default)]
    pub extra: serde_json::Value,
}

fn default_transport() -> String {
    "quic".into()
}

/// Result of a subscription fetch operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionResult {
    /// Name of the subscription source.
    pub subscription_name: String,
    /// Number of servers found.
    pub count: usize,
    /// Parsed server entries.
    pub servers: Vec<ServerEntry>,
    /// Timestamp of this fetch (ISO 8601).
    pub fetched_at: String,
}

/// Fetch and parse a subscription URL. Supports base64, JSON, and YAML (Clash) formats.
pub async fn fetch_subscription(url: &str) -> Result<Vec<ServerEntry>, anyhow::Error> {
    info!(url = %url, "Fetching subscription");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Prisma/0.9.0")
        .build()?;

    let resp = client.get(url).send().await?;
    let status = resp.status();
    if !status.is_success() {
        anyhow::bail!("HTTP {} fetching subscription from {}", status, url);
    }

    let body = resp.text().await?;
    debug!(len = body.len(), "Subscription response received");

    // Try each format in order: JSON -> YAML-like -> base64
    if let Ok(servers) = parse_json_subscription(&body) {
        info!(count = servers.len(), "Parsed JSON subscription");
        return Ok(servers);
    }

    if let Ok(servers) = parse_yaml_subscription(&body) {
        info!(count = servers.len(), "Parsed YAML/Clash subscription");
        return Ok(servers);
    }

    if let Ok(servers) = parse_base64_subscription(&body) {
        info!(count = servers.len(), "Parsed base64 subscription");
        return Ok(servers);
    }

    anyhow::bail!(
        "Could not parse subscription from {}: not valid JSON, YAML, or base64",
        url
    )
}

/// Parse a JSON subscription. Expects either:
/// - A JSON array of ServerEntry objects
/// - A JSON object with a "servers" key containing the array
fn parse_json_subscription(body: &str) -> Result<Vec<ServerEntry>, anyhow::Error> {
    let val: serde_json::Value = serde_json::from_str(body)?;

    if let Some(arr) = val.as_array() {
        let servers: Vec<ServerEntry> = arr
            .iter()
            .filter_map(|v| serde_json::from_value(v.clone()).ok())
            .collect();
        if servers.is_empty() {
            anyhow::bail!("JSON array contained no valid server entries");
        }
        return Ok(servers);
    }

    if let Some(arr) = val.get("servers").and_then(|v| v.as_array()) {
        let servers: Vec<ServerEntry> = arr
            .iter()
            .filter_map(|v| serde_json::from_value(v.clone()).ok())
            .collect();
        if servers.is_empty() {
            anyhow::bail!("JSON servers array contained no valid entries");
        }
        return Ok(servers);
    }

    // Also support "proxies" key (Clash JSON format)
    if let Some(arr) = val.get("proxies").and_then(|v| v.as_array()) {
        let servers: Vec<ServerEntry> =
            arr.iter().filter_map(clash_proxy_to_server_entry).collect();
        if servers.is_empty() {
            anyhow::bail!("JSON proxies array contained no valid entries");
        }
        return Ok(servers);
    }

    anyhow::bail!("JSON is not a recognized subscription format")
}

/// Parse a YAML-like subscription (Clash format).
/// We do a lightweight parse without pulling in a full YAML library:
/// look for `proxies:` section and extract `name`, `server`, `port`, `type` fields.
fn parse_yaml_subscription(body: &str) -> Result<Vec<ServerEntry>, anyhow::Error> {
    // Quick check: must contain "proxies:" to be a Clash config
    if !body.contains("proxies:") {
        anyhow::bail!("Not a YAML/Clash subscription");
    }

    let mut servers = Vec::new();
    let mut in_proxies = false;
    let mut current_name = String::new();
    let mut current_server = String::new();
    let mut current_port: u16 = 0;
    let mut current_type = String::new();
    let mut has_entry = false;

    for line in body.lines() {
        let trimmed = line.trim();

        // Detect start of proxies section
        if trimmed == "proxies:" {
            in_proxies = true;
            continue;
        }

        // Detect end of proxies section (another top-level key)
        if in_proxies && !line.starts_with(' ') && !line.starts_with('\t') && trimmed.ends_with(':')
        {
            // Flush last entry
            if has_entry && !current_server.is_empty() {
                servers.push(ServerEntry {
                    name: if current_name.is_empty() {
                        format!("{}:{}", current_server, current_port)
                    } else {
                        current_name.clone()
                    },
                    server_addr: format!("{}:{}", current_server, current_port),
                    transport: yaml_type_to_transport(&current_type),
                    extra: serde_json::Value::Null,
                });
            }
            in_proxies = false;
            has_entry = false;
            continue;
        }

        if !in_proxies {
            continue;
        }

        // New proxy entry starts with "- "
        if trimmed.starts_with("- ") {
            // Flush previous entry
            if has_entry && !current_server.is_empty() {
                servers.push(ServerEntry {
                    name: if current_name.is_empty() {
                        format!("{}:{}", current_server, current_port)
                    } else {
                        current_name.clone()
                    },
                    server_addr: format!("{}:{}", current_server, current_port),
                    transport: yaml_type_to_transport(&current_type),
                    extra: serde_json::Value::Null,
                });
            }
            current_name.clear();
            current_server.clear();
            current_port = 0;
            current_type.clear();
            has_entry = true;

            // The "- " line might contain inline key-value: "- name: foo"
            let after_dash = trimmed.trim_start_matches("- ").trim();
            if let Some((key, val)) = parse_yaml_kv(after_dash) {
                apply_yaml_field(
                    &key,
                    &val,
                    &mut current_name,
                    &mut current_server,
                    &mut current_port,
                    &mut current_type,
                );
            }
            continue;
        }

        // Continuation of current entry
        if has_entry {
            if let Some((key, val)) = parse_yaml_kv(trimmed) {
                apply_yaml_field(
                    &key,
                    &val,
                    &mut current_name,
                    &mut current_server,
                    &mut current_port,
                    &mut current_type,
                );
            }
        }
    }

    // Flush last entry
    if has_entry && !current_server.is_empty() {
        servers.push(ServerEntry {
            name: if current_name.is_empty() {
                format!("{}:{}", current_server, current_port)
            } else {
                current_name
            },
            server_addr: format!("{}:{}", current_server, current_port),
            transport: yaml_type_to_transport(&current_type),
            extra: serde_json::Value::Null,
        });
    }

    if servers.is_empty() {
        anyhow::bail!("YAML proxies section contained no valid entries");
    }

    Ok(servers)
}

fn parse_yaml_kv(s: &str) -> Option<(String, String)> {
    let idx = s.find(':')?;
    let key = s[..idx].trim().to_lowercase();
    let val = s[idx + 1..]
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string();
    Some((key, val))
}

fn apply_yaml_field(
    key: &str,
    val: &str,
    name: &mut String,
    server: &mut String,
    port: &mut u16,
    proxy_type: &mut String,
) {
    match key {
        "name" => *name = val.to_string(),
        "server" => *server = val.to_string(),
        "port" => {
            if let Ok(p) = val.parse::<u16>() {
                *port = p;
            }
        }
        "type" => *proxy_type = val.to_lowercase(),
        _ => {}
    }
}

fn yaml_type_to_transport(t: &str) -> String {
    match t {
        "hysteria" | "hysteria2" | "tuic" => "quic".into(),
        "http" | "http2" | "h2" => "xhttp".into(),
        "ws" | "websocket" => "ws".into(),
        "grpc" => "grpc".into(),
        _ => "quic".into(),
    }
}

/// Convert a Clash-format JSON proxy object to a ServerEntry.
fn clash_proxy_to_server_entry(val: &serde_json::Value) -> Option<ServerEntry> {
    let name = val.get("name")?.as_str()?.to_string();
    let server = val.get("server")?.as_str()?;
    let port = val.get("port")?.as_u64()? as u16;
    let proxy_type = val
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("ss")
        .to_lowercase();

    Some(ServerEntry {
        name,
        server_addr: format!("{}:{}", server, port),
        transport: yaml_type_to_transport(&proxy_type),
        extra: val.clone(),
    })
}

/// Parse a base64-encoded subscription (line-separated URIs after decoding).
fn parse_base64_subscription(body: &str) -> Result<Vec<ServerEntry>, anyhow::Error> {
    use base64::Engine;

    let trimmed = body.trim();

    // Try standard base64 decode, then URL-safe
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(trimmed)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(trimmed))
        .or_else(|_| {
            // Try with padding stripped
            let no_pad = trimmed.trim_end_matches('=');
            base64::engine::general_purpose::STANDARD_NO_PAD
                .decode(no_pad)
                .or_else(|_| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(no_pad))
        })?;

    let text = String::from_utf8(decoded)?;
    let mut servers = Vec::new();

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if let Some(entry) = parse_uri_to_server_entry(line) {
            servers.push(entry);
        } else {
            debug!(uri = %line, "Skipping unrecognized URI");
        }
    }

    if servers.is_empty() {
        anyhow::bail!("Base64 decoded content contained no valid URIs");
    }

    Ok(servers)
}

/// Parse a single proxy URI (prisma://) into a ServerEntry.
fn parse_uri_to_server_entry(uri: &str) -> Option<ServerEntry> {
    // prisma://host:port#name or prisma://host:port?name=foo
    if let Some(rest) = uri.strip_prefix("prisma://") {
        return parse_simple_uri(rest, "quic");
    }

    // Fallback: try parsing as host:port
    if rest_is_host_port(uri) {
        return Some(ServerEntry {
            name: uri.to_string(),
            server_addr: uri.to_string(),
            transport: "quic".into(),
            extra: serde_json::Value::Null,
        });
    }

    None
}

fn rest_is_host_port(s: &str) -> bool {
    if let Some(idx) = s.rfind(':') {
        s[idx + 1..].parse::<u16>().is_ok()
    } else {
        false
    }
}

/// Parse a simple URI: [userinfo@]host:port[#fragment]
fn parse_simple_uri(rest: &str, default_transport: &str) -> Option<ServerEntry> {
    // Split off fragment (#name)
    let (main, fragment) = if let Some(idx) = rest.find('#') {
        (&rest[..idx], Some(urldecode(&rest[idx + 1..])))
    } else {
        (rest, None)
    };

    // Strip query params
    let main = if let Some(idx) = main.find('?') {
        &main[..idx]
    } else {
        main
    };

    // Strip userinfo
    let host_port_part = if let Some(idx) = main.rfind('@') {
        &main[idx + 1..]
    } else {
        main
    };

    // Extract host:port
    let addr = host_port_part.to_string();
    if !rest_is_host_port(&addr) {
        return None;
    }

    let name = fragment.unwrap_or_else(|| addr.clone());

    Some(ServerEntry {
        name,
        server_addr: addr,
        transport: default_transport.into(),
        extra: serde_json::Value::Null,
    })
}

fn urldecode(s: &str) -> String {
    let mut result = String::new();
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                result.push(byte as char);
            }
        } else if c == '+' {
            result.push(' ');
        } else {
            result.push(c);
        }
    }
    result
}

/// Run an auto-update loop that periodically refreshes subscriptions.
/// Returns a handle that can be used to stop the loop.
pub async fn auto_update_loop(
    subscriptions: Vec<SubscriptionConfig>,
    on_update: impl Fn(SubscriptionResult) + Send + Sync + 'static,
) {
    if subscriptions.is_empty() {
        return;
    }

    let on_update = std::sync::Arc::new(on_update);

    for sub in subscriptions {
        if sub.update_interval_secs == 0 {
            continue;
        }

        let interval = std::time::Duration::from_secs(sub.update_interval_secs);
        let sub_name = sub.name.clone();
        let sub_url = sub.url.clone();
        let callback = on_update.clone();

        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            // Skip the first immediate tick; let the caller do an initial fetch if desired
            ticker.tick().await;

            loop {
                ticker.tick().await;
                info!(name = %sub_name, "Auto-updating subscription");

                match fetch_subscription(&sub_url).await {
                    Ok(servers) => {
                        let result = SubscriptionResult {
                            subscription_name: sub_name.clone(),
                            count: servers.len(),
                            servers,
                            fetched_at: chrono::Utc::now().to_rfc3339(),
                        };
                        callback(result);
                    }
                    Err(e) => {
                        warn!(name = %sub_name, error = %e, "Subscription auto-update failed");
                    }
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_json_subscription() {
        let json = r#"[
            {"name": "Server 1", "server_addr": "1.2.3.4:8443", "transport": "quic"},
            {"name": "Server 2", "server_addr": "5.6.7.8:443", "transport": "ws"}
        ]"#;
        let servers = parse_json_subscription(json).unwrap();
        assert_eq!(servers.len(), 2);
        assert_eq!(servers[0].name, "Server 1");
        assert_eq!(servers[1].server_addr, "5.6.7.8:443");
    }

    #[test]
    fn test_parse_base64_subscription() {
        use base64::Engine;
        let lines = "prisma://1.2.3.4:8443#Server1\nprisma://5.6.7.8:443#Server2\n";
        let encoded = base64::engine::general_purpose::STANDARD.encode(lines);
        let servers = parse_base64_subscription(&encoded).unwrap();
        assert_eq!(servers.len(), 2);
        assert_eq!(servers[0].name, "Server1");
        assert_eq!(servers[1].server_addr, "5.6.7.8:443");
    }

    #[test]
    fn test_parse_yaml_subscription() {
        let yaml = r#"
proxies:
  - name: Tokyo
    server: jp.example.com
    port: 8443
    type: ss
  - name: London
    server: uk.example.com
    port: 443
    type: trojan
rules:
  - MATCH,DIRECT
"#;
        let servers = parse_yaml_subscription(yaml).unwrap();
        assert_eq!(servers.len(), 2);
        assert_eq!(servers[0].name, "Tokyo");
        assert_eq!(servers[0].server_addr, "jp.example.com:8443");
        assert_eq!(servers[1].name, "London");
    }

    #[test]
    fn test_parse_simple_uri() {
        let entry = parse_simple_uri("user@1.2.3.4:8443#MyServer", "quic").unwrap();
        assert_eq!(entry.name, "MyServer");
        assert_eq!(entry.server_addr, "1.2.3.4:8443");
    }
}
