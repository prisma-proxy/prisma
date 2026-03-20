//! Compatibility protocol implementations for VMess, VLESS, Shadowsocks, and Trojan.
//!
//! These modules implement the wire formats and handshakes for popular proxy protocols,
//! allowing Prisma to serve as a drop-in replacement for xray-core/v2fly.
//! Each protocol handler parses the incoming connection into a standard
//! [`ProxyDestination`] + bidirectional stream, feeding into the existing relay infrastructure.

pub mod shadowsocks;
pub mod trojan;
pub mod vless;
pub mod vmess;

use std::fmt;
use std::net::{Ipv4Addr, Ipv6Addr};

use crate::error::{PrismaError, ProtocolError};
use crate::types::{ProxyAddress, ProxyDestination};

/// Protocol identifier for compat inbounds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CompatProtocol {
    VMess,
    Vless,
    Shadowsocks,
    Trojan,
}

impl fmt::Display for CompatProtocol {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CompatProtocol::VMess => write!(f, "vmess"),
            CompatProtocol::Vless => write!(f, "vless"),
            CompatProtocol::Shadowsocks => write!(f, "shadowsocks"),
            CompatProtocol::Trojan => write!(f, "trojan"),
        }
    }
}

impl std::str::FromStr for CompatProtocol {
    type Err = PrismaError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "vmess" => Ok(CompatProtocol::VMess),
            "vless" => Ok(CompatProtocol::Vless),
            "shadowsocks" | "ss" => Ok(CompatProtocol::Shadowsocks),
            "trojan" => Ok(CompatProtocol::Trojan),
            _ => Err(PrismaError::Config(crate::error::ConfigError::Invalid(
                format!("unknown protocol: {}", s),
            ))),
        }
    }
}

/// Command type in compat protocols.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompatCommand {
    /// TCP connect (0x01)
    TcpConnect,
    /// UDP associate (0x03)
    UdpAssociate,
}

impl CompatCommand {
    pub fn from_byte(b: u8) -> Result<Self, ProtocolError> {
        match b {
            0x01 => Ok(CompatCommand::TcpConnect),
            0x03 => Ok(CompatCommand::UdpAssociate),
            _ => Err(ProtocolError::InvalidCommand(b)),
        }
    }

    pub fn to_byte(self) -> u8 {
        match self {
            CompatCommand::TcpConnect => 0x01,
            CompatCommand::UdpAssociate => 0x03,
        }
    }
}

/// Result of parsing a compat protocol header.
#[derive(Debug)]
pub struct CompatRequest {
    /// Detected protocol.
    pub protocol: CompatProtocol,
    /// Command (connect or UDP associate).
    pub command: CompatCommand,
    /// Target destination.
    pub destination: ProxyDestination,
    /// Any remaining payload data after the header.
    pub initial_payload: Vec<u8>,
}

/// Parse a destination address from the standard SOCKS-style address format:
/// `[addr_type:1][addr:var][port:2]`
///
/// Address types:
/// - 0x01: IPv4 (4 bytes)
/// - 0x03: Domain (1-byte length + domain)
/// - 0x04: IPv6 (16 bytes)
///
/// Returns `(destination, bytes_consumed)`.
pub fn parse_address(data: &[u8]) -> Result<(ProxyDestination, usize), ProtocolError> {
    if data.is_empty() {
        return Err(ProtocolError::InvalidFrame("address data is empty".into()));
    }

    let addr_type = data[0];
    match addr_type {
        0x01 => {
            // IPv4: 4 bytes + 2 bytes port
            if data.len() < 7 {
                return Err(ProtocolError::InvalidFrame("IPv4 address too short".into()));
            }
            let ip = Ipv4Addr::new(data[1], data[2], data[3], data[4]);
            let port = u16::from_be_bytes([data[5], data[6]]);
            Ok((
                ProxyDestination {
                    address: ProxyAddress::Ipv4(ip),
                    port,
                },
                7,
            ))
        }
        0x03 => {
            // Domain: 1-byte length + domain + 2 bytes port
            if data.len() < 2 {
                return Err(ProtocolError::InvalidFrame(
                    "domain address too short".into(),
                ));
            }
            let domain_len = data[1] as usize;
            if data.len() < 2 + domain_len + 2 {
                return Err(ProtocolError::InvalidFrame(
                    "domain address truncated".into(),
                ));
            }
            let domain = String::from_utf8(data[2..2 + domain_len].to_vec())
                .map_err(|_| ProtocolError::InvalidFrame("invalid domain UTF-8".into()))?;
            let port_offset = 2 + domain_len;
            let port = u16::from_be_bytes([data[port_offset], data[port_offset + 1]]);
            Ok((
                ProxyDestination {
                    address: ProxyAddress::Domain(domain),
                    port,
                },
                2 + domain_len + 2,
            ))
        }
        0x04 => {
            // IPv6: 16 bytes + 2 bytes port
            if data.len() < 19 {
                return Err(ProtocolError::InvalidFrame("IPv6 address too short".into()));
            }
            let mut octets = [0u8; 16];
            octets.copy_from_slice(&data[1..17]);
            let ip = Ipv6Addr::from(octets);
            let port = u16::from_be_bytes([data[17], data[18]]);
            Ok((
                ProxyDestination {
                    address: ProxyAddress::Ipv6(ip),
                    port,
                },
                19,
            ))
        }
        _ => Err(ProtocolError::InvalidAddressType(addr_type)),
    }
}

/// Encode a destination address into the standard SOCKS-style wire format.
pub fn encode_address(dest: &ProxyDestination) -> Vec<u8> {
    let mut buf = Vec::new();
    match &dest.address {
        ProxyAddress::Ipv4(ip) => {
            buf.push(0x01);
            buf.extend_from_slice(&ip.octets());
        }
        ProxyAddress::Domain(domain) => {
            buf.push(0x03);
            buf.push(domain.len() as u8);
            buf.extend_from_slice(domain.as_bytes());
        }
        ProxyAddress::Ipv6(ip) => {
            buf.push(0x04);
            buf.extend_from_slice(&ip.octets());
        }
    }
    buf.extend_from_slice(&dest.port.to_be_bytes());
    buf
}

/// Detect which compat protocol a connection is using by peeking at initial bytes.
///
/// This is used when multiple protocols share the same port. The detection is
/// heuristic-based and depends on configuration context:
///
/// - **VLESS**: First byte is 0x00 (version 0)
/// - **Trojan**: First 56 bytes are hex ASCII characters followed by CRLF
/// - **VMess**: First 16 bytes are an auth hash (binary, non-ASCII)
/// - **Shadowsocks**: Encrypted blob (cannot be sniffed; detected by port/config assignment)
pub fn detect_protocol(peek: &[u8]) -> Option<CompatProtocol> {
    if peek.is_empty() {
        return None;
    }

    // VLESS: version byte 0x00
    if peek[0] == 0x00 && peek.len() >= 2 {
        return Some(CompatProtocol::Vless);
    }

    // Trojan: 56 hex chars + CRLF
    if peek.len() >= 58 {
        let is_hex = peek[..56].iter().all(|b| b.is_ascii_hexdigit());
        if is_hex && peek[56] == b'\r' && peek[57] == b'\n' {
            return Some(CompatProtocol::Trojan);
        }
    }

    // VMess: starts with 16-byte auth info (binary data).
    // This is the weakest heuristic. In practice, VMess detection relies on
    // knowing that VMess clients are configured for this port.
    if peek.len() >= 16 {
        let looks_binary = peek[..16]
            .iter()
            .any(|b| !b.is_ascii_graphic() && *b != b' ');
        if looks_binary {
            return Some(CompatProtocol::VMess);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_address_ipv4() {
        let data = [0x01, 192, 168, 1, 1, 0x01, 0xBB]; // 192.168.1.1:443
        let (dest, consumed) = parse_address(&data).unwrap();
        assert_eq!(consumed, 7);
        assert_eq!(dest.port, 443);
        assert!(
            matches!(dest.address, ProxyAddress::Ipv4(ip) if ip == Ipv4Addr::new(192, 168, 1, 1))
        );
    }

    #[test]
    fn test_parse_address_domain() {
        let mut data = vec![0x03, 11]; // domain type, length 11
        data.extend_from_slice(b"example.com");
        data.extend_from_slice(&80u16.to_be_bytes());
        let (dest, consumed) = parse_address(&data).unwrap();
        assert_eq!(consumed, 15);
        assert_eq!(dest.port, 80);
        assert!(matches!(&dest.address, ProxyAddress::Domain(d) if d == "example.com"));
    }

    #[test]
    fn test_parse_address_ipv6() {
        let mut data = vec![0x04];
        data.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]); // ::1
        data.extend_from_slice(&8080u16.to_be_bytes());
        let (dest, consumed) = parse_address(&data).unwrap();
        assert_eq!(consumed, 19);
        assert_eq!(dest.port, 8080);
        assert!(matches!(dest.address, ProxyAddress::Ipv6(ip) if ip == Ipv6Addr::LOCALHOST));
    }

    #[test]
    fn test_encode_address_roundtrip() {
        let dest = ProxyDestination {
            address: ProxyAddress::Domain("example.com".into()),
            port: 443,
        };
        let encoded = encode_address(&dest);
        let (decoded, _) = parse_address(&encoded).unwrap();
        assert_eq!(decoded, dest);
    }

    #[test]
    fn test_detect_protocol_vless() {
        let peek = [0x00, 0x01, 0x02, 0x03];
        assert_eq!(detect_protocol(&peek), Some(CompatProtocol::Vless));
    }

    #[test]
    fn test_detect_protocol_trojan() {
        let mut peek = Vec::new();
        // 56 hex chars
        peek.extend_from_slice(b"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");
        peek.push(b'\r');
        peek.push(b'\n');
        assert_eq!(detect_protocol(&peek), Some(CompatProtocol::Trojan));
    }

    #[test]
    fn test_compat_protocol_display() {
        assert_eq!(format!("{}", CompatProtocol::VMess), "vmess");
        assert_eq!(format!("{}", CompatProtocol::Vless), "vless");
        assert_eq!(format!("{}", CompatProtocol::Shadowsocks), "shadowsocks");
        assert_eq!(format!("{}", CompatProtocol::Trojan), "trojan");
    }

    #[test]
    fn test_compat_protocol_from_str() {
        assert_eq!(
            "vmess".parse::<CompatProtocol>().unwrap(),
            CompatProtocol::VMess
        );
        assert_eq!(
            "vless".parse::<CompatProtocol>().unwrap(),
            CompatProtocol::Vless
        );
        assert_eq!(
            "shadowsocks".parse::<CompatProtocol>().unwrap(),
            CompatProtocol::Shadowsocks
        );
        assert_eq!(
            "ss".parse::<CompatProtocol>().unwrap(),
            CompatProtocol::Shadowsocks
        );
        assert_eq!(
            "trojan".parse::<CompatProtocol>().unwrap(),
            CompatProtocol::Trojan
        );
        assert!("unknown".parse::<CompatProtocol>().is_err());
    }

    #[test]
    fn test_compat_command_roundtrip() {
        assert_eq!(
            CompatCommand::from_byte(0x01).unwrap(),
            CompatCommand::TcpConnect
        );
        assert_eq!(
            CompatCommand::from_byte(0x03).unwrap(),
            CompatCommand::UdpAssociate
        );
        assert_eq!(CompatCommand::TcpConnect.to_byte(), 0x01);
        assert_eq!(CompatCommand::UdpAssociate.to_byte(), 0x03);
        assert!(CompatCommand::from_byte(0x99).is_err());
    }
}
