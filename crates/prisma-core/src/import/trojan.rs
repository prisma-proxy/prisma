//! Trojan URI parser.
//!
//! Format: `trojan://password@host:port?sni=...&type=...&path=...#tag`
//!
//! Query parameters:
//! - `type` or `net`: transport type (tcp, ws, grpc, h2)
//! - `sni`: TLS server name
//! - `host`: HTTP host header (for ws/h2)
//! - `path`: path for ws/h2/grpc
//! - `security`: "tls", "xtls", "reality", or "" (default: tls)
//! - `alpn`: comma-separated ALPN protocols
//! - `fp`: fingerprint
//! - `serviceName`: gRPC service name

use crate::config::client::ClientConfig;
use crate::error::ConfigError;

use super::{default_import_config, url_decode, ImportProtocol, ImportedServer};

pub fn parse(uri: &str) -> Result<ImportedServer, ConfigError> {
    let rest = uri
        .strip_prefix("trojan://")
        .ok_or_else(|| ConfigError::ParseError("not a trojan:// URI".into()))?;

    // Extract fragment (#tag)
    let (main, tag) = match rest.rfind('#') {
        Some(idx) => (&rest[..idx], url_decode(&rest[idx + 1..])),
        None => (rest, String::new()),
    };

    // Split password@host:port?query
    let at_idx = main
        .find('@')
        .ok_or_else(|| ConfigError::ParseError("Trojan URI must contain @ separator".into()))?;

    let password = url_decode(&main[..at_idx]);
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

    let transport_type = params
        .get("type")
        .or_else(|| params.get("net"))
        .map(String::as_str)
        .unwrap_or("tcp");
    let transport = super::map_transport(transport_type);

    let security = params.get("security").map(String::as_str).unwrap_or("tls");
    let use_tls = security == "tls" || security == "xtls" || security == "reality";

    let sni = params.get("sni").or_else(|| params.get("peer")).cloned();

    let mut config: ClientConfig = default_import_config();
    config.server_addr = format!("{}:{}", host, port);
    config.cipher_suite = "chacha20-poly1305".to_string();
    config.transport = transport.to_string();

    // Trojan password as auth_secret (hex-encoded, padded to 32 bytes)
    config.identity.auth_secret = super::hex_encode_auth_secret(&password);
    config.identity.client_id = "trojan-imported".to_string();

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
            config.ws.url = Some(format!("{}://{}:{}{}", ws_scheme, ws_host, port, ws_path));
            if let Some(h) = params.get("host") {
                config.ws.host = Some(h.clone());
            }
        }
        "grpc" => {
            let grpc_scheme = if use_tls { "https" } else { "http" };
            let service = params
                .get("serviceName")
                .or_else(|| params.get("path"))
                .map(String::as_str)
                .unwrap_or("GunService/Tun");
            config.grpc.url = Some(format!("{}://{}:{}/{}", grpc_scheme, host, port, service));
        }
        _ => {}
    }

    Ok(ImportedServer {
        original_protocol: ImportProtocol::Trojan,
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
    fn test_parse_basic_trojan() {
        let uri = "trojan://my-secret-password@example.com:443#MyTrojan";
        let result = parse(uri).unwrap();
        assert_eq!(result.original_protocol, ImportProtocol::Trojan);
        assert_eq!(result.host, "example.com");
        assert_eq!(result.port, 443);
        assert_eq!(result.server_name, "MyTrojan");
        assert_eq!(result.config.transport, "tcp");
        assert!(result.config.tls_on_tcp);
        assert_eq!(
            result.config.tls_server_name,
            Some("example.com".to_string())
        );
    }

    #[test]
    fn test_parse_trojan_ws() {
        let uri = "trojan://pass@cdn.example.com:443?type=ws&host=cdn.example.com&path=/ws&sni=cdn.example.com#WS";
        let result = parse(uri).unwrap();
        assert_eq!(result.config.transport, "ws");
        assert!(result.config.ws.url.as_ref().unwrap().contains("wss://"));
        assert!(result.config.ws.url.as_ref().unwrap().contains("/ws"));
        assert_eq!(result.server_name, "WS");
    }

    #[test]
    fn test_parse_trojan_grpc() {
        let uri =
            "trojan://pass@grpc.example.com:443?type=grpc&serviceName=MyGrpc&security=tls#gRPC";
        let result = parse(uri).unwrap();
        assert_eq!(result.config.transport, "grpc");
        assert!(result.config.grpc.url.is_some());
        assert!(result.config.grpc.url.as_ref().unwrap().contains("MyGrpc"));
    }

    #[test]
    fn test_parse_trojan_with_alpn() {
        let uri = "trojan://pass@host.com:443?alpn=h2%2Chttp%2F1.1#test";
        let result = parse(uri).unwrap();
        assert_eq!(result.config.alpn_protocols, vec!["h2", "http/1.1"]);
    }

    #[test]
    fn test_parse_trojan_no_tag() {
        let uri = "trojan://password@10.0.0.1:8443";
        let result = parse(uri).unwrap();
        assert_eq!(result.server_name, "10.0.0.1:8443");
    }

    #[test]
    fn test_parse_trojan_ipv6() {
        let uri = "trojan://pass@[::1]:443#v6";
        let result = parse(uri).unwrap();
        assert_eq!(result.host, "::1");
        assert_eq!(result.port, 443);
    }

    #[test]
    fn test_parse_trojan_no_at() {
        let uri = "trojan://no-at-sign";
        assert!(parse(uri).is_err());
    }

    #[test]
    fn test_parse_trojan_url_encoded_password() {
        let uri = "trojan://pass%40word@host.com:443#test";
        let result = parse(uri).unwrap();
        // The password contains @ but is URL-encoded so parsing should succeed
        assert_eq!(result.host, "host.com");
    }
}
