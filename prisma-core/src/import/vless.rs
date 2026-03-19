//! VLESS URI parser.
//!
//! Format: `vless://uuid@host:port?encryption=none&type=...&security=...#tag`
//!
//! Query parameters:
//! - `encryption`: always "none" for VLESS
//! - `type`: transport type (tcp, ws, grpc, h2, quic)
//! - `security`: "tls", "reality", "xtls", or "" (default: tls)
//! - `sni`: TLS server name
//! - `host`: HTTP host header (for ws/h2)
//! - `path`: path for ws/h2/grpc
//! - `fp`: fingerprint (chrome, firefox, safari, etc.)
//! - `flow`: flow control (xtls-rprx-vision, etc.)
//! - `serviceName`: gRPC service name
//! - `alpn`: comma-separated ALPN protocols
//! - `pbk`: REALITY public key
//! - `sid`: REALITY short ID

use crate::config::client::ClientConfig;
use crate::error::ConfigError;

use super::{default_import_config, url_decode, ImportProtocol, ImportedServer};

pub fn parse(uri: &str) -> Result<ImportedServer, ConfigError> {
    let rest = uri
        .strip_prefix("vless://")
        .ok_or_else(|| ConfigError::ParseError("not a vless:// URI".into()))?;

    // Extract fragment (#tag)
    let (main, tag) = match rest.rfind('#') {
        Some(idx) => (&rest[..idx], url_decode(&rest[idx + 1..])),
        None => (rest, String::new()),
    };

    // Split uuid@host:port?query
    let at_idx = main
        .find('@')
        .ok_or_else(|| ConfigError::ParseError("VLESS URI must contain @ separator".into()))?;

    let uuid = url_decode(&main[..at_idx]);
    if uuid.is_empty() {
        return Err(ConfigError::ParseError("VLESS: UUID is empty".into()));
    }

    let hostport_query = &main[at_idx + 1..];

    // Split host:port from query
    let (hostport, query_str) = match hostport_query.find('?') {
        Some(idx) => (&hostport_query[..idx], &hostport_query[idx + 1..]),
        None => (hostport_query, ""),
    };

    let (host, port) = super::parse_host_port(hostport)?;
    let params = super::parse_query_string(query_str);

    let server_name = if tag.is_empty() {
        format!("{}:{}", host, port)
    } else {
        tag
    };

    let transport_type = params.get("type").map(String::as_str).unwrap_or("tcp");
    let transport = super::map_transport(transport_type);

    let security = params.get("security").map(String::as_str).unwrap_or("tls");
    let use_tls = security == "tls" || security == "xtls" || security == "reality";

    let sni = params.get("sni").cloned();

    let mut config: ClientConfig = default_import_config();
    config.server_addr = format!("{}:{}", host, port);
    config.cipher_suite = "chacha20-poly1305".to_string();
    config.transport = transport.to_string();

    // UUID as client_id, hex-encode as auth_secret
    config.identity.client_id = uuid.clone();
    config.identity.auth_secret = super::hex_encode_auth_secret(&uuid);

    // TLS settings
    if use_tls && transport == "tcp" {
        config.tls_on_tcp = true;
    }
    if let Some(ref sni_val) = sni {
        config.tls_server_name = Some(sni_val.clone());
    } else if host.parse::<std::net::IpAddr>().is_err() {
        config.tls_server_name = Some(host.clone());
    }

    // ALPN
    if let Some(alpn) = params.get("alpn") {
        let decoded = url_decode(alpn);
        config.alpn_protocols = decoded.split(',').map(|s| s.trim().to_string()).collect();
    }

    // Fingerprint
    if let Some(fp) = params.get("fp") {
        if !fp.is_empty() {
            config.fingerprint = fp.clone();
        }
    }

    // Transport-specific settings
    match transport {
        "ws" => {
            let ws_scheme = if use_tls { "wss" } else { "ws" };
            let ws_host = params.get("host").map(String::as_str).unwrap_or(&host);
            let ws_path = params.get("path").map(String::as_str).unwrap_or("/");
            config.ws_url = Some(format!("{}://{}:{}{}", ws_scheme, ws_host, port, ws_path));
            if let Some(h) = params.get("host") {
                config.ws_host = Some(h.clone());
            }
        }
        "grpc" => {
            let grpc_scheme = if use_tls { "https" } else { "http" };
            let service = params
                .get("serviceName")
                .or_else(|| params.get("path"))
                .map(String::as_str)
                .unwrap_or("GunService/Tun");
            config.grpc_url = Some(format!("{}://{}:{}/{}", grpc_scheme, host, port, service));
        }
        _ => {}
    }

    Ok(ImportedServer {
        original_protocol: ImportProtocol::Vless,
        server_name,
        host,
        port,
        config,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_basic_vless() {
        let uri = "vless://550e8400-e29b-41d4-a716-446655440000@example.com:443?encryption=none&security=tls&sni=example.com&type=tcp#MyVLESS";
        let result = parse(uri).unwrap();
        assert_eq!(result.original_protocol, ImportProtocol::Vless);
        assert_eq!(result.host, "example.com");
        assert_eq!(result.port, 443);
        assert_eq!(result.server_name, "MyVLESS");
        assert_eq!(result.config.transport, "tcp");
        assert!(result.config.tls_on_tcp);
        assert_eq!(
            result.config.identity.client_id,
            "550e8400-e29b-41d4-a716-446655440000"
        );
    }

    #[test]
    fn test_parse_vless_ws() {
        let uri = "vless://uuid-here@cdn.example.com:443?type=ws&host=cdn.example.com&path=/vless-ws&security=tls&sni=cdn.example.com#WS";
        let result = parse(uri).unwrap();
        assert_eq!(result.config.transport, "ws");
        assert!(result.config.ws_url.as_ref().unwrap().contains("wss://"));
        assert!(result.config.ws_url.as_ref().unwrap().contains("/vless-ws"));
    }

    #[test]
    fn test_parse_vless_grpc() {
        let uri =
            "vless://uuid@grpc.example.com:443?type=grpc&serviceName=MyService&security=tls#gRPC";
        let result = parse(uri).unwrap();
        assert_eq!(result.config.transport, "grpc");
        assert!(result
            .config
            .grpc_url
            .as_ref()
            .unwrap()
            .contains("MyService"));
    }

    #[test]
    fn test_parse_vless_reality() {
        let uri = "vless://uuid@1.2.3.4:443?encryption=none&type=tcp&security=reality&sni=www.google.com&fp=chrome&pbk=XXXYYY&sid=abcdef#REALITY";
        let result = parse(uri).unwrap();
        assert_eq!(result.server_name, "REALITY");
        assert!(result.config.tls_on_tcp);
        assert_eq!(result.config.fingerprint, "chrome");
        assert_eq!(
            result.config.tls_server_name,
            Some("www.google.com".to_string())
        );
    }

    #[test]
    fn test_parse_vless_no_security() {
        let uri = "vless://uuid@host.com:80?type=ws&path=/ws#NoTLS";
        let result = parse(uri).unwrap();
        assert_eq!(result.config.transport, "ws");
        // No TLS since security is not set and transport is ws
        assert!(!result.config.tls_on_tcp);
    }

    #[test]
    fn test_parse_vless_no_tag() {
        let uri = "vless://uuid@10.0.0.1:8443?type=tcp";
        let result = parse(uri).unwrap();
        assert_eq!(result.server_name, "10.0.0.1:8443");
    }

    #[test]
    fn test_parse_vless_ipv6() {
        let uri = "vless://uuid@[::1]:443?type=tcp#v6";
        let result = parse(uri).unwrap();
        assert_eq!(result.host, "::1");
        assert_eq!(result.port, 443);
    }

    #[test]
    fn test_parse_vless_with_alpn_and_fp() {
        let uri =
            "vless://uuid@host.com:443?type=tcp&security=tls&alpn=h2%2Chttp%2F1.1&fp=firefox#test";
        let result = parse(uri).unwrap();
        assert_eq!(result.config.alpn_protocols, vec!["h2", "http/1.1"]);
        assert_eq!(result.config.fingerprint, "firefox");
    }

    #[test]
    fn test_parse_vless_empty_uuid() {
        let uri = "vless://@host.com:443";
        assert!(parse(uri).is_err());
    }

    #[test]
    fn test_parse_vless_no_at() {
        let uri = "vless://no-at-sign";
        assert!(parse(uri).is_err());
    }
}
