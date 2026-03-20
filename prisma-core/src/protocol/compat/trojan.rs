//! Trojan protocol implementation.
//!
//! Trojan is a TLS-based proxy protocol that authenticates using a SHA224 hash
//! of a password, transmitted as 56 hex characters. It relies entirely on TLS
//! for encryption.
//!
//! ## Wire Format
//!
//! ```text
//! Client → Server:
//!   [hex_password:56][crlf:2][cmd:1][addr_type:1][addr:var][port:2][crlf:2][payload...]
//!
//! Commands:
//!   0x01 = TCP connect
//!   0x03 = UDP associate
//!
//! Address types (SOCKS5 style):
//!   0x01 = IPv4 (4 bytes)
//!   0x03 = Domain (1-byte length + domain)
//!   0x04 = IPv6 (16 bytes)
//! ```
//!
//! ## Authentication
//!
//! The password is hashed with SHA224 and transmitted as 56 lowercase hex characters.
//! The server computes SHA224 of each authorized password and compares using
//! constant-time comparison.

use sha2::Digest;

use crate::error::ProtocolError;
use crate::types::ProxyDestination;

use super::{parse_address, CompatCommand, CompatProtocol, CompatRequest};

/// CRLF sequence used in Trojan protocol.
pub const CRLF: [u8; 2] = [0x0D, 0x0A];

/// Length of the SHA224 hex password in the Trojan header.
pub const TROJAN_PASSWORD_HEX_LEN: usize = 56;

/// Minimum header size: password(56) + CRLF(2) + cmd(1) + addr_type(1) + addr(min 4 for IPv4) + port(2) + CRLF(2)
pub const TROJAN_MIN_HEADER_SIZE: usize = 68;

/// Trojan client configuration.
#[derive(Debug, Clone)]
pub struct TrojanClient {
    /// Original password.
    pub password: String,
    /// Precomputed SHA224 hex hash of the password.
    pub password_hash: String,
}

impl TrojanClient {
    /// Create a new Trojan client with the given password.
    pub fn new(password: &str) -> Self {
        Self {
            password: password.to_string(),
            password_hash: compute_password_hash(password),
        }
    }
}

/// Compute the SHA224 hex hash of a Trojan password.
///
/// Returns a 56-character lowercase hex string.
pub fn compute_password_hash(password: &str) -> String {
    let hash = sha2::Sha224::digest(password.as_bytes());
    crate::util::hex_encode(&hash)
}

/// Verify a Trojan hex password against authorized clients.
///
/// Uses constant-time comparison to prevent timing attacks.
/// Returns the index of the matching client on success.
pub fn verify_password(hex_password: &str, clients: &[TrojanClient]) -> Option<usize> {
    let hex_bytes = hex_password.as_bytes();
    for (i, client) in clients.iter().enumerate() {
        if crate::util::ct_eq_slice(hex_bytes, client.password_hash.as_bytes()) {
            return Some(i);
        }
    }
    None
}

/// Parsed Trojan request.
#[derive(Debug)]
pub struct TrojanRequest {
    /// The hex SHA224 password from the header.
    pub password_hash: String,
    /// Command (TCP connect or UDP associate).
    pub command: CompatCommand,
    /// Target destination.
    pub destination: ProxyDestination,
    /// Any initial payload data after the header.
    pub initial_payload: Vec<u8>,
}

impl TrojanRequest {
    /// Convert into a generic CompatRequest.
    pub fn into_compat_request(self) -> CompatRequest {
        CompatRequest {
            protocol: CompatProtocol::Trojan,
            command: self.command,
            destination: self.destination,
            initial_payload: self.initial_payload,
        }
    }
}

/// Parse a Trojan request from raw bytes.
///
/// Format:
/// ```text
/// [hex_password:56][crlf:2][cmd:1][addr_type:1][addr:var][port:2][crlf:2][payload...]
/// ```
///
/// Returns the parsed request.
pub fn parse_trojan_request(data: &[u8]) -> Result<TrojanRequest, ProtocolError> {
    if data.len() < TROJAN_MIN_HEADER_SIZE {
        return Err(ProtocolError::InvalidFrame(format!(
            "Trojan header too short: {} < {}",
            data.len(),
            TROJAN_MIN_HEADER_SIZE
        )));
    }

    // Parse hex password (56 bytes)
    let password_bytes = &data[..TROJAN_PASSWORD_HEX_LEN];
    if !password_bytes.iter().all(|b| b.is_ascii_hexdigit()) {
        return Err(ProtocolError::InvalidFrame(
            "Trojan password contains non-hex characters".into(),
        ));
    }
    let password_hash = String::from_utf8(password_bytes.to_vec())
        .map_err(|_| ProtocolError::InvalidFrame("Trojan password not UTF-8".into()))?;

    // Verify CRLF after password
    if data[TROJAN_PASSWORD_HEX_LEN] != CRLF[0] || data[TROJAN_PASSWORD_HEX_LEN + 1] != CRLF[1] {
        return Err(ProtocolError::InvalidFrame(
            "Trojan: expected CRLF after password".into(),
        ));
    }

    // Parse command
    let cmd_offset = TROJAN_PASSWORD_HEX_LEN + 2;
    let command = CompatCommand::from_byte(data[cmd_offset])?;

    // Parse address: [addr_type:1][addr:var][port:2]
    let addr_offset = cmd_offset + 1;
    let (destination, addr_consumed) = parse_address(&data[addr_offset..])?;

    // Verify trailing CRLF
    let crlf_offset = addr_offset + addr_consumed;
    if data.len() < crlf_offset + 2 {
        return Err(ProtocolError::InvalidFrame(
            "Trojan: header truncated before trailing CRLF".into(),
        ));
    }
    if data[crlf_offset] != CRLF[0] || data[crlf_offset + 1] != CRLF[1] {
        return Err(ProtocolError::InvalidFrame(
            "Trojan: expected CRLF after address".into(),
        ));
    }

    let payload_offset = crlf_offset + 2;
    let initial_payload = if payload_offset < data.len() {
        data[payload_offset..].to_vec()
    } else {
        Vec::new()
    };

    Ok(TrojanRequest {
        password_hash,
        command,
        destination,
        initial_payload,
    })
}

/// Build a Trojan request header (for client-side use).
pub fn build_trojan_request(
    password: &str,
    command: CompatCommand,
    destination: &ProxyDestination,
) -> Vec<u8> {
    let hash = compute_password_hash(password);
    let addr = super::encode_address(destination);

    let mut buf = Vec::with_capacity(hash.len() + 2 + 1 + addr.len() + 2);
    buf.extend_from_slice(hash.as_bytes());
    buf.extend_from_slice(&CRLF);
    buf.push(command.to_byte());
    buf.extend_from_slice(&addr);
    buf.extend_from_slice(&CRLF);
    buf
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ProxyAddress;

    #[test]
    fn test_compute_password_hash() {
        let hash = compute_password_hash("test-password");
        // SHA224 produces 28 bytes = 56 hex chars
        assert_eq!(hash.len(), 56);
        // Should be deterministic
        assert_eq!(hash, compute_password_hash("test-password"));
        // Should be lowercase hex
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(hash, hash.to_lowercase());
    }

    #[test]
    fn test_trojan_client_new() {
        let client = TrojanClient::new("my-password");
        assert_eq!(client.password, "my-password");
        assert_eq!(client.password_hash.len(), 56);
    }

    #[test]
    fn test_verify_password_match() {
        let client = TrojanClient::new("test-password");
        let hash = compute_password_hash("test-password");
        let clients = vec![client];
        assert_eq!(verify_password(&hash, &clients), Some(0));
    }

    #[test]
    fn test_verify_password_no_match() {
        let client = TrojanClient::new("correct-password");
        let wrong_hash = compute_password_hash("wrong-password");
        let clients = vec![client];
        assert_eq!(verify_password(&wrong_hash, &clients), None);
    }

    #[test]
    fn test_parse_trojan_request_tcp_domain() {
        let password = "test-password";
        let dest = ProxyDestination {
            address: ProxyAddress::Domain("example.com".into()),
            port: 443,
        };
        let header = build_trojan_request(password, CompatCommand::TcpConnect, &dest);

        // Append some payload
        let mut data = header;
        data.extend_from_slice(b"GET / HTTP/1.1\r\n");

        let req = parse_trojan_request(&data).unwrap();
        assert_eq!(req.password_hash, compute_password_hash(password));
        assert_eq!(req.command, CompatCommand::TcpConnect);
        assert_eq!(req.destination.port, 443);
        assert!(matches!(&req.destination.address, ProxyAddress::Domain(d) if d == "example.com"));
        assert_eq!(req.initial_payload, b"GET / HTTP/1.1\r\n");
    }

    #[test]
    fn test_parse_trojan_request_udp_ipv4() {
        let password = "udp-test";
        let dest = ProxyDestination {
            address: ProxyAddress::Ipv4(std::net::Ipv4Addr::new(8, 8, 8, 8)),
            port: 53,
        };
        let data = build_trojan_request(password, CompatCommand::UdpAssociate, &dest);

        let req = parse_trojan_request(&data).unwrap();
        assert_eq!(req.command, CompatCommand::UdpAssociate);
        assert_eq!(req.destination.port, 53);
    }

    #[test]
    fn test_parse_trojan_request_ipv6() {
        let password = "v6-test";
        let dest = ProxyDestination {
            address: ProxyAddress::Ipv6(std::net::Ipv6Addr::LOCALHOST),
            port: 8080,
        };
        let data = build_trojan_request(password, CompatCommand::TcpConnect, &dest);

        let req = parse_trojan_request(&data).unwrap();
        assert_eq!(req.destination.port, 8080);
        assert!(
            matches!(req.destination.address, ProxyAddress::Ipv6(ip) if ip == std::net::Ipv6Addr::LOCALHOST)
        );
    }

    #[test]
    fn test_parse_trojan_request_too_short() {
        let data = [0u8; 20];
        assert!(parse_trojan_request(&data).is_err());
    }

    #[test]
    fn test_parse_trojan_request_bad_hex() {
        let mut data = vec![b'z'; 56]; // non-hex
        data.extend_from_slice(&CRLF);
        data.push(0x01);
        data.extend_from_slice(&[0x01, 127, 0, 0, 1, 0, 80]);
        data.extend_from_slice(&CRLF);
        assert!(parse_trojan_request(&data).is_err());
    }

    #[test]
    fn test_parse_trojan_request_missing_crlf() {
        let hash = compute_password_hash("test");
        let mut data = Vec::new();
        data.extend_from_slice(hash.as_bytes());
        data.extend_from_slice(&[0x00, 0x00]); // not CRLF
        data.push(0x01);
        data.extend_from_slice(&[0x01, 127, 0, 0, 1, 0, 80]);
        data.extend_from_slice(&CRLF);
        assert!(parse_trojan_request(&data).is_err());
    }

    #[test]
    fn test_build_trojan_request_roundtrip() {
        let password = "roundtrip-test";
        let dest = ProxyDestination {
            address: ProxyAddress::Domain("google.com".into()),
            port: 443,
        };
        let data = build_trojan_request(password, CompatCommand::TcpConnect, &dest);
        let req = parse_trojan_request(&data).unwrap();
        assert_eq!(req.destination, dest);
        assert_eq!(req.command, CompatCommand::TcpConnect);
    }

    #[test]
    fn test_into_compat_request() {
        let req = TrojanRequest {
            password_hash: "a".repeat(56),
            command: CompatCommand::TcpConnect,
            destination: ProxyDestination {
                address: ProxyAddress::Domain("test.com".into()),
                port: 80,
            },
            initial_payload: vec![1, 2, 3],
        };
        let compat = req.into_compat_request();
        assert_eq!(compat.protocol, CompatProtocol::Trojan);
        assert_eq!(compat.initial_payload, vec![1, 2, 3]);
    }
}
