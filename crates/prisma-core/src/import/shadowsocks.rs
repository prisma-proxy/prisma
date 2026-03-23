//! Shadowsocks URI parser.
//!
//! Supports two formats:
//!
//! 1. Legacy: `ss://BASE64(method:password)@host:port#tag`
//! 2. SIP002: `ss://BASE64(method:password)@host:port/?plugin=...#tag`
//!
//! The parsed config is mapped to a Prisma client config using TCP transport
//! with TLS, since Prisma does not natively speak the Shadowsocks protocol.
//! The imported server details (host, port, encryption) are preserved for
//! reference and potential future Shadowsocks relay support.

use crate::config::client::ClientConfig;
use crate::error::ConfigError;

use super::{default_import_config, url_decode, ImportProtocol, ImportedServer};

/// Map Shadowsocks cipher names to the closest Prisma cipher suite.
fn map_ss_cipher(method: &str) -> &'static str {
    match method {
        "aes-256-gcm" | "aes-256-cfb" | "aes-256-ctr" => "aes-256-gcm",
        "chacha20-ietf-poly1305"
        | "chacha20-poly1305"
        | "chacha20-ietf"
        | "xchacha20-ietf-poly1305" => "chacha20-poly1305",
        // AEAD 2022 ciphers
        "2022-blake3-aes-256-gcm" => "aes-256-gcm",
        "2022-blake3-chacha20-poly1305" | "2022-blake3-chacha8-poly1305" => "chacha20-poly1305",
        // Fallback: use chacha20-poly1305 as the safe default
        _ => "chacha20-poly1305",
    }
}

pub fn parse(uri: &str) -> Result<ImportedServer, ConfigError> {
    // Strip scheme
    let rest = uri
        .strip_prefix("ss://")
        .ok_or_else(|| ConfigError::ParseError("not a ss:// URI".into()))?;

    // Extract fragment (#tag)
    let (main, tag) = match rest.rfind('#') {
        Some(idx) => (&rest[..idx], url_decode(&rest[idx + 1..]).to_string()),
        None => (rest, String::new()),
    };

    // Split userinfo@host:port — the userinfo part is base64-encoded
    // Two possible layouts:
    //   a) BASE64(method:password)@host:port[/?query]
    //   b) BASE64(method:password@host:port)  (legacy all-in-one encoding)
    let (method, password, host, port) = if let Some(at_idx) = main.rfind('@') {
        // Format (a): userinfo@host:port
        let userinfo_encoded = &main[..at_idx];
        let hostport_and_query = &main[at_idx + 1..];

        // Strip query string if present (SIP002 plugin params)
        // Also strip trailing '/' from paths like "host:port/?plugin=..."
        let hostport = hostport_and_query
            .split('?')
            .next()
            .unwrap_or(hostport_and_query)
            .trim_end_matches('/');

        let (host, port) = super::parse_host_port(hostport)?;
        let (method, password) = decode_userinfo(userinfo_encoded)?;
        (method, password, host, port)
    } else {
        // Format (b): entire payload is base64-encoded
        let decoded = decode_base64(main)?;
        parse_full_ss_string(&decoded)?
    };

    let server_name = if tag.is_empty() {
        format!("{}:{}", host, port)
    } else {
        tag
    };

    let cipher_suite = map_ss_cipher(&method);

    let mut config: ClientConfig = default_import_config();
    config.server_addr = format!("{}:{}", host, port);
    config.cipher_suite = cipher_suite.to_string();
    config.transport = "tcp".to_string();
    config.tls_on_tcp = true;
    config.tls_server_name = if host.parse::<std::net::IpAddr>().is_err() {
        Some(host.clone())
    } else {
        None
    };

    // Store the SS password as the auth_secret (hex-encoded).
    // This is a best-effort mapping — the actual SS protocol is not used.
    config.identity.auth_secret = super::hex_encode_auth_secret(&password);

    Ok(ImportedServer {
        original_protocol: ImportProtocol::Shadowsocks,
        server_name,
        host,
        port,
        config,
    })
}

/// Decode base64 userinfo into (method, password).
fn decode_userinfo(encoded: &str) -> Result<(String, String), ConfigError> {
    let decoded = decode_base64(encoded)?;
    split_method_password(&decoded)
}

/// Split "method:password" into its parts.
fn split_method_password(s: &str) -> Result<(String, String), ConfigError> {
    let colon = s
        .find(':')
        .ok_or_else(|| ConfigError::ParseError("SS userinfo must be method:password".into()))?;
    let method = s[..colon].to_string();
    let password = s[colon + 1..].to_string();
    if method.is_empty() {
        return Err(ConfigError::ParseError("SS method is empty".into()));
    }
    Ok((method, password))
}

/// Parse "method:password@host:port" (legacy all-in-one format).
fn parse_full_ss_string(s: &str) -> Result<(String, String, String, u16), ConfigError> {
    let at_idx = s
        .rfind('@')
        .ok_or_else(|| ConfigError::ParseError("SS legacy format must contain @".into()))?;
    let (method_pass, hostport) = (&s[..at_idx], &s[at_idx + 1..]);
    let (method, password) = split_method_password(method_pass)?;
    let (host, port) = super::parse_host_port(hostport)?;
    Ok((method, password, host, port))
}

/// Decode base64 (standard or URL-safe, with or without padding).
fn decode_base64(s: &str) -> Result<String, ConfigError> {
    use base64::Engine as _;

    // Try URL-safe no-pad first (most common in URI context)
    if let Ok(bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(s) {
        if let Ok(decoded) = String::from_utf8(bytes) {
            return Ok(decoded);
        }
    }
    // Try standard base64
    if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(s) {
        if let Ok(decoded) = String::from_utf8(bytes) {
            return Ok(decoded);
        }
    }
    // Try URL-safe with padding
    if let Ok(bytes) = base64::engine::general_purpose::URL_SAFE.decode(s) {
        if let Ok(decoded) = String::from_utf8(bytes) {
            return Ok(decoded);
        }
    }
    Err(ConfigError::ParseError(format!(
        "failed to base64-decode SS userinfo: \"{}\"",
        s
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

    #[test]
    fn test_parse_sip002_format() {
        // SIP002: ss://BASE64(method:password)@host:port#tag
        let userinfo = URL_SAFE_NO_PAD.encode(b"aes-256-gcm:my_password");
        let uri = format!("ss://{}@192.168.1.1:8388#MyServer", userinfo);
        let result = parse(&uri).unwrap();
        assert_eq!(result.original_protocol, ImportProtocol::Shadowsocks);
        assert_eq!(result.host, "192.168.1.1");
        assert_eq!(result.port, 8388);
        assert_eq!(result.server_name, "MyServer");
        assert_eq!(result.config.cipher_suite, "aes-256-gcm");
        assert_eq!(result.config.server_addr, "192.168.1.1:8388");
    }

    #[test]
    fn test_parse_sip002_with_plugin() {
        let userinfo = URL_SAFE_NO_PAD.encode(b"chacha20-ietf-poly1305:secret");
        let uri = format!(
            "ss://{}@example.com:443/?plugin=obfs-local%3Bobfs%3Dhttp#CDN",
            userinfo
        );
        let result = parse(&uri).unwrap();
        assert_eq!(result.host, "example.com");
        assert_eq!(result.port, 443);
        assert_eq!(result.config.cipher_suite, "chacha20-poly1305");
        assert_eq!(result.server_name, "CDN");
    }

    #[test]
    fn test_parse_legacy_format() {
        // Legacy: ss://BASE64(method:password@host:port)#tag
        let full = "aes-256-gcm:test_pass@10.0.0.1:1234";
        let encoded = URL_SAFE_NO_PAD.encode(full.as_bytes());
        let uri = format!("ss://{}#Legacy", encoded);
        let result = parse(&uri).unwrap();
        assert_eq!(result.host, "10.0.0.1");
        assert_eq!(result.port, 1234);
        assert_eq!(result.server_name, "Legacy");
    }

    #[test]
    fn test_parse_no_tag() {
        let userinfo = URL_SAFE_NO_PAD.encode(b"aes-256-gcm:pass");
        let uri = format!("ss://{}@1.2.3.4:5678", userinfo);
        let result = parse(&uri).unwrap();
        assert_eq!(result.server_name, "1.2.3.4:5678");
    }

    #[test]
    fn test_parse_ipv6() {
        let userinfo = URL_SAFE_NO_PAD.encode(b"aes-256-gcm:pass");
        let uri = format!("ss://{}@[::1]:8388#v6", userinfo);
        let result = parse(&uri).unwrap();
        assert_eq!(result.host, "::1");
        assert_eq!(result.port, 8388);
    }

    #[test]
    fn test_cipher_mapping() {
        assert_eq!(map_ss_cipher("aes-256-gcm"), "aes-256-gcm");
        assert_eq!(map_ss_cipher("chacha20-ietf-poly1305"), "chacha20-poly1305");
        assert_eq!(map_ss_cipher("2022-blake3-aes-256-gcm"), "aes-256-gcm");
        assert_eq!(map_ss_cipher("unknown-cipher"), "chacha20-poly1305");
    }

    #[test]
    fn test_invalid_uri() {
        assert!(parse("ss://").is_err());
        assert!(parse("ss://invalid-not-base64-!!!").is_err());
    }
}
