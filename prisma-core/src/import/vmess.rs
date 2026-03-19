//! VMess (V2Ray) URI parser.
//!
//! Format: `vmess://BASE64(JSON)`
//!
//! The JSON payload contains:
//! ```json
//! {
//!     "v": "2",
//!     "ps": "server name",
//!     "add": "host",
//!     "port": "443",
//!     "id": "uuid",
//!     "aid": "0",
//!     "scy": "auto",
//!     "net": "ws",
//!     "type": "none",
//!     "host": "example.com",
//!     "path": "/ws",
//!     "tls": "tls",
//!     "sni": "example.com"
//! }
//! ```

use serde::Deserialize;

use crate::config::client::ClientConfig;
use crate::error::ConfigError;

use super::{default_import_config, ImportProtocol, ImportedServer};

/// Raw VMess JSON fields. All fields are optional strings for maximum
/// compatibility with various V2Ray implementations.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct VMessJson {
    /// Protocol version (usually "2")
    #[serde(default)]
    v: Option<String>,
    /// Server name / remark
    #[serde(default)]
    ps: Option<String>,
    /// Server address
    #[serde(default)]
    add: Option<String>,
    /// Server port (sometimes integer, sometimes string)
    #[serde(default)]
    port: Option<serde_json::Value>,
    /// UUID
    #[serde(default)]
    id: Option<String>,
    /// Alter ID (legacy, usually "0")
    #[serde(default)]
    aid: Option<serde_json::Value>,
    /// Security / cipher: auto, aes-128-gcm, chacha20-poly1305, none
    #[serde(default)]
    scy: Option<String>,
    /// Network type: tcp, ws, grpc, h2, kcp, quic
    #[serde(default)]
    net: Option<String>,
    /// Header type (usually "none")
    #[serde(default, rename = "type")]
    header_type: Option<String>,
    /// Host header (for ws/h2)
    #[serde(default)]
    host: Option<String>,
    /// Path (for ws/h2/grpc)
    #[serde(default)]
    path: Option<String>,
    /// TLS: "tls" or ""
    #[serde(default)]
    tls: Option<String>,
    /// SNI override
    #[serde(default)]
    sni: Option<String>,
    /// ALPN
    #[serde(default)]
    alpn: Option<String>,
}

/// Map VMess security to Prisma cipher suite.
fn map_vmess_cipher(scy: &str) -> &'static str {
    match scy {
        "aes-128-gcm" | "aes-256-gcm" => "aes-256-gcm",
        "chacha20-poly1305" => "chacha20-poly1305",
        "auto" | "none" | "zero" | "" => "chacha20-poly1305",
        _ => "chacha20-poly1305",
    }
}

pub fn parse(uri: &str) -> Result<ImportedServer, ConfigError> {
    let rest = uri
        .strip_prefix("vmess://")
        .ok_or_else(|| ConfigError::ParseError("not a vmess:// URI".into()))?;

    let json_str = decode_base64(rest.trim())?;

    let vmess: VMessJson = serde_json::from_str(&json_str)
        .map_err(|e| ConfigError::ParseError(format!("invalid VMess JSON: {}", e)))?;

    let host = vmess
        .add
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ConfigError::ParseError("VMess: missing 'add' (server address)".into()))?
        .to_string();

    let port = parse_port(&vmess.port)?;

    let server_name = vmess
        .ps
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(&host)
        .to_string();

    let uuid = vmess
        .id
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ConfigError::ParseError("VMess: missing 'id' (UUID)".into()))?;

    let cipher = map_vmess_cipher(vmess.scy.as_deref().unwrap_or("auto"));
    let transport = super::map_transport(vmess.net.as_deref().unwrap_or("tcp"));
    let use_tls = vmess.tls.as_deref().unwrap_or("") == "tls";

    let sni = vmess
        .sni
        .as_deref()
        .filter(|s| !s.is_empty())
        .or(vmess.host.as_deref().filter(|s| !s.is_empty()));

    let mut config: ClientConfig = default_import_config();
    config.server_addr = format!("{}:{}", host, port);
    config.cipher_suite = cipher.to_string();
    config.transport = transport.to_string();

    // UUID as client_id, hex-encode it as auth_secret
    config.identity.client_id = uuid.to_string();
    config.identity.auth_secret = super::hex_encode_auth_secret(uuid);

    // TLS settings
    if use_tls && transport == "tcp" {
        config.tls_on_tcp = true;
    }
    if let Some(sni_val) = sni {
        config.tls_server_name = Some(sni_val.to_string());
    } else if host.parse::<std::net::IpAddr>().is_err() {
        config.tls_server_name = Some(host.clone());
    }

    // ALPN
    if let Some(ref alpn) = vmess.alpn {
        config.alpn_protocols = alpn.split(',').map(|s| s.trim().to_string()).collect();
    }

    // Transport-specific settings
    match transport {
        "ws" => {
            let ws_scheme = if use_tls { "wss" } else { "ws" };
            let ws_host = vmess
                .host
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or(&host);
            let ws_path = vmess.path.as_deref().unwrap_or("/");
            config.ws_url = Some(format!("{}://{}:{}{}", ws_scheme, ws_host, port, ws_path));
            if let Some(ref h) = vmess.host {
                if !h.is_empty() {
                    config.ws_host = Some(h.clone());
                }
            }
        }
        "grpc" => {
            let grpc_scheme = if use_tls { "https" } else { "http" };
            let service_name = vmess.path.as_deref().unwrap_or("GunService/Tun");
            config.grpc_url = Some(format!(
                "{}://{}:{}/{}",
                grpc_scheme, host, port, service_name
            ));
        }
        _ => {}
    }

    Ok(ImportedServer {
        original_protocol: ImportProtocol::VMess,
        server_name,
        host,
        port,
        config,
    })
}

/// Parse the port field which can be either a JSON number or string.
fn parse_port(value: &Option<serde_json::Value>) -> Result<u16, ConfigError> {
    match value {
        Some(serde_json::Value::Number(n)) => n
            .as_u64()
            .and_then(|v| u16::try_from(v).ok())
            .ok_or_else(|| ConfigError::ParseError("VMess: invalid port number".into())),
        Some(serde_json::Value::String(s)) => s
            .parse::<u16>()
            .map_err(|_| ConfigError::ParseError(format!("VMess: invalid port string: {}", s))),
        _ => Err(ConfigError::ParseError("VMess: missing 'port'".into())),
    }
}

/// Decode base64 (standard or URL-safe, with or without padding).
fn decode_base64(s: &str) -> Result<String, ConfigError> {
    use base64::Engine as _;

    // Try standard base64 first (most common for VMess)
    if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(s) {
        if let Ok(decoded) = String::from_utf8(bytes) {
            return Ok(decoded);
        }
    }
    // Try URL-safe no-pad
    if let Ok(bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(s) {
        if let Ok(decoded) = String::from_utf8(bytes) {
            return Ok(decoded);
        }
    }
    // Try standard without padding
    let padded = match s.len() % 4 {
        2 => format!("{}==", s),
        3 => format!("{}=", s),
        _ => s.to_string(),
    };
    if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(&padded) {
        if let Ok(decoded) = String::from_utf8(bytes) {
            return Ok(decoded);
        }
    }
    Err(ConfigError::ParseError(format!(
        "failed to base64-decode VMess payload (len={})",
        s.len()
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    fn make_vmess_uri(json: &str) -> String {
        let encoded = STANDARD.encode(json.as_bytes());
        format!("vmess://{}", encoded)
    }

    #[test]
    fn test_parse_basic_tcp() {
        let json = r#"{
            "v": "2",
            "ps": "My TCP Server",
            "add": "1.2.3.4",
            "port": "443",
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "aid": "0",
            "scy": "auto",
            "net": "tcp",
            "type": "none",
            "tls": "tls"
        }"#;
        let result = parse(&make_vmess_uri(json)).unwrap();
        assert_eq!(result.original_protocol, ImportProtocol::VMess);
        assert_eq!(result.host, "1.2.3.4");
        assert_eq!(result.port, 443);
        assert_eq!(result.server_name, "My TCP Server");
        assert_eq!(result.config.transport, "tcp");
        assert!(result.config.tls_on_tcp);
    }

    #[test]
    fn test_parse_ws_transport() {
        let json = r#"{
            "v": "2",
            "ps": "WS Server",
            "add": "cdn.example.com",
            "port": 443,
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "scy": "chacha20-poly1305",
            "net": "ws",
            "host": "cdn.example.com",
            "path": "/ws-path",
            "tls": "tls",
            "sni": "cdn.example.com"
        }"#;
        let result = parse(&make_vmess_uri(json)).unwrap();
        assert_eq!(result.config.transport, "ws");
        assert!(result.config.ws_url.as_ref().unwrap().contains("wss://"));
        assert!(result.config.ws_url.as_ref().unwrap().contains("/ws-path"));
        assert_eq!(result.config.cipher_suite, "chacha20-poly1305");
    }

    #[test]
    fn test_parse_grpc_transport() {
        let json = r#"{
            "v": "2",
            "ps": "gRPC",
            "add": "grpc.example.com",
            "port": "443",
            "id": "test-uuid",
            "net": "grpc",
            "path": "MyService/Tun",
            "tls": "tls"
        }"#;
        let result = parse(&make_vmess_uri(json)).unwrap();
        assert_eq!(result.config.transport, "grpc");
        assert!(result.config.grpc_url.is_some());
    }

    #[test]
    fn test_parse_port_as_number() {
        let json = r#"{
            "v": "2",
            "ps": "test",
            "add": "1.2.3.4",
            "port": 8443,
            "id": "uuid-here",
            "net": "tcp"
        }"#;
        let result = parse(&make_vmess_uri(json)).unwrap();
        assert_eq!(result.port, 8443);
    }

    #[test]
    fn test_parse_missing_add() {
        let json = r#"{"v":"2","port":"443","id":"uuid"}"#;
        assert!(parse(&make_vmess_uri(json)).is_err());
    }

    #[test]
    fn test_parse_missing_id() {
        let json = r#"{"v":"2","add":"1.2.3.4","port":"443"}"#;
        assert!(parse(&make_vmess_uri(json)).is_err());
    }

    #[test]
    fn test_cipher_mapping() {
        assert_eq!(map_vmess_cipher("auto"), "chacha20-poly1305");
        assert_eq!(map_vmess_cipher("aes-128-gcm"), "aes-256-gcm");
        assert_eq!(map_vmess_cipher("chacha20-poly1305"), "chacha20-poly1305");
        assert_eq!(map_vmess_cipher("none"), "chacha20-poly1305");
    }

    #[test]
    fn test_transport_mapping() {
        use super::super::map_transport;
        assert_eq!(map_transport("ws"), "ws");
        assert_eq!(map_transport("grpc"), "grpc");
        assert_eq!(map_transport("h2"), "ws");
        assert_eq!(map_transport("quic"), "quic");
        assert_eq!(map_transport("tcp"), "tcp");
        assert_eq!(map_transport("kcp"), "tcp");
    }
}
