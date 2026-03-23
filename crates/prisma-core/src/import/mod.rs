//! Multi-protocol URI import support for Prisma v0.9.0.
//!
//! Supports importing server configurations from:
//! - Shadowsocks (`ss://...`)
//! - VMess / V2Ray (`vmess://...`)
//! - Trojan (`trojan://...`)
//! - VLESS (`vless://...`)
//!
//! Each URI is parsed into an [`ImportedServer`] containing the original protocol
//! metadata and a mapped [`ClientConfig`](crate::config::client::ClientConfig).

mod shadowsocks;
mod trojan;
mod vless;
mod vmess;

use serde::{Deserialize, Serialize};

use crate::config::client::ClientConfig;
use crate::error::ConfigError;

/// The original protocol of an imported URI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportProtocol {
    Shadowsocks,
    VMess,
    Trojan,
    Vless,
}

impl std::fmt::Display for ImportProtocol {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ImportProtocol::Shadowsocks => write!(f, "shadowsocks"),
            ImportProtocol::VMess => write!(f, "vmess"),
            ImportProtocol::Trojan => write!(f, "trojan"),
            ImportProtocol::Vless => write!(f, "vless"),
        }
    }
}

/// Result of importing a single URI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedServer {
    /// Which protocol the URI originally described.
    pub original_protocol: ImportProtocol,
    /// Human-readable server name / tag / remark.
    pub server_name: String,
    /// Remote host (IP or domain).
    pub host: String,
    /// Remote port.
    pub port: u16,
    /// Mapped Prisma client configuration ready for connection.
    pub config: ClientConfig,
}

/// Auto-detect the protocol from the URI scheme and parse into an [`ImportedServer`].
pub fn import_uri(uri: &str) -> Result<ImportedServer, ConfigError> {
    let uri = uri.trim();
    if uri.starts_with("ss://") {
        shadowsocks::parse(uri)
    } else if uri.starts_with("vmess://") {
        vmess::parse(uri)
    } else if uri.starts_with("trojan://") {
        trojan::parse(uri)
    } else if uri.starts_with("vless://") {
        vless::parse(uri)
    } else {
        Err(ConfigError::ParseError(format!(
            "unsupported URI scheme: {}",
            uri.split("://").next().unwrap_or("(empty)")
        )))
    }
}

/// Parse multiple URIs from a text block.
///
/// Accepts:
/// - Line-separated URIs (one per line)
/// - A base64-encoded block (common for subscription responses) that decodes
///   to line-separated URIs
///
/// Returns a `Vec` of results, one per detected URI. Blank lines are skipped.
pub fn import_batch(text: &str) -> Vec<Result<ImportedServer, ConfigError>> {
    let text = text.trim();

    // Try base64 decode first: subscription endpoints often return a base64 blob
    // containing newline-separated URIs.
    let lines = if looks_like_base64(text) {
        match base64_decode_text(text) {
            Some(decoded) => decoded,
            None => text.to_string(),
        }
    } else {
        text.to_string()
    };

    lines
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(import_uri)
        .collect()
}

/// Heuristic: text is likely base64 if it contains no "://" scheme markers
/// and consists only of base64-alphabet characters (plus whitespace).
fn looks_like_base64(text: &str) -> bool {
    if text.contains("://") {
        return false;
    }
    text.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=' || c.is_whitespace())
}

/// Attempt standard base64 decode of the text (ignoring whitespace).
fn base64_decode_text(text: &str) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let cleaned: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = STANDARD.decode(&cleaned).ok()?;
    String::from_utf8(bytes).ok()
}

/// Build a default [`ClientConfig`] scaffold that import parsers fill in.
///
/// This provides sensible Prisma defaults so that individual parsers only need
/// to set the fields relevant to the imported protocol.
fn default_import_config() -> ClientConfig {
    serde_json::from_str(
        r#"{
            "socks5_listen_addr": "127.0.0.1:1080",
            "server_addr": "127.0.0.1:443",
            "identity": { "client_id": "imported", "auth_secret": "0000000000000000000000000000000000000000000000000000000000000000" },
            "cipher_suite": "chacha20-poly1305",
            "transport": "tcp",
            "skip_cert_verify": true,
            "protocol_version": "v5"
        }"#,
    )
    .expect("default import config must parse")
}

/// Parse a host:port string, handling IPv6 bracket notation.
pub(crate) fn parse_host_port(s: &str) -> Result<(String, u16), crate::error::ConfigError> {
    use crate::error::ConfigError;
    // Handle IPv6 bracket notation: [::1]:port
    if let Some(bracket_end) = s.find(']') {
        let host = s
            .get(1..bracket_end)
            .ok_or_else(|| ConfigError::ParseError("malformed IPv6 address".into()))?
            .to_string();
        let rest = &s[bracket_end + 1..];
        let port_str = rest
            .strip_prefix(':')
            .ok_or_else(|| ConfigError::ParseError("missing port after IPv6 address".into()))?;
        let port: u16 = port_str
            .parse()
            .map_err(|_| ConfigError::ParseError(format!("invalid port: {}", port_str)))?;
        return Ok((host, port));
    }
    let colon = s
        .rfind(':')
        .ok_or_else(|| ConfigError::ParseError(format!("missing port in host:port \"{}\"", s)))?;
    let host = s[..colon].to_string();
    let port: u16 = s[colon + 1..]
        .parse()
        .map_err(|_| ConfigError::ParseError(format!("invalid port in \"{}\"", s)))?;
    if host.is_empty() {
        return Err(ConfigError::ParseError("host is empty".into()));
    }
    Ok((host, port))
}

/// Parse a query string into key-value pairs.
pub(crate) fn parse_query_string(query: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    if query.is_empty() {
        return map;
    }
    for pair in query.split('&') {
        if let Some(eq) = pair.find('=') {
            let key = url_decode(&pair[..eq]);
            let value = url_decode(&pair[eq + 1..]);
            map.insert(key, value);
        }
    }
    map
}

/// Hex-encode a password to a 64-char auth secret (padded or truncated).
pub(crate) fn hex_encode_auth_secret(password: &str) -> String {
    let auth_hex = hex::encode(password.as_bytes());
    if auth_hex.len() >= 64 {
        auth_hex[..64].to_string()
    } else {
        format!("{:0<64}", auth_hex)
    }
}

/// Map common transport aliases to Prisma transport names.
pub(crate) fn map_transport(t: &str) -> &'static str {
    match t.to_lowercase().as_str() {
        "ws" | "websocket" => "ws",
        "grpc" | "gun" => "grpc",
        "h2" | "http" => "ws",
        "quic" => "quic",
        "kcp" => "tcp",
        "tcp" | "" => "tcp",
        _ => "tcp",
    }
}

/// URL-decode a percent-encoded string (also handles `+` as space).
pub(crate) fn url_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let hi = chars.next();
            let lo = chars.next();
            if let (Some(h), Some(l)) = (hi, lo) {
                let hex = [h, l];
                if let Ok(s) = std::str::from_utf8(&hex) {
                    if let Ok(val) = u8::from_str_radix(s, 16) {
                        result.push(val as char);
                        continue;
                    }
                }
            }
            // Malformed percent encoding, just pass through
            result.push('%');
        } else if b == b'+' {
            result.push(' ');
        } else {
            result.push(b as char);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_import_uri_unknown_scheme() {
        let result = import_uri("http://example.com");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("unsupported URI scheme"), "got: {err}");
    }

    #[test]
    fn test_import_batch_line_separated() {
        // Two valid-ish URIs (will fail parsing but should produce two results)
        let text = "ss://bad1\nss://bad2\n";
        let results = import_batch(text);
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_import_batch_skips_blank_lines() {
        let text = "\n\nss://bad\n\n";
        let results = import_batch(text);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_import_batch_base64_block() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let raw_uris = "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@192.168.1.1:8388#test\n";
        let encoded = STANDARD.encode(raw_uris.as_bytes());
        let results = import_batch(&encoded);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_url_decode() {
        assert_eq!(url_decode("hello%20world"), "hello world");
        assert_eq!(url_decode("no%2Fslash"), "no/slash");
        assert_eq!(url_decode("plain"), "plain");
    }
}
