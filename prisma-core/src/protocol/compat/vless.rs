//! VLESS protocol implementation (version 0, xray-core compatible).
//!
//! VLESS is a lightweight proxy protocol with zero encryption overhead,
//! relying on TLS for encryption. It uses UUID-based authentication.
//!
//! ## Wire Format
//!
//! ```text
//! Client -> Server (request header):
//!   [version:1][uuid:16][addon_len:1][addon:var]
//!   [cmd:1][port:2][addr_type:1][addr:var]
//!   [payload...]
//!
//! Server -> Client (response header):
//!   [version:1][addon_len:1][addon:var]
//! ```
//!
//! ## Flow Control
//!
//! VLESS supports the `xtls-rprx-vision` flow for TLS-in-TLS detection avoidance.
//! When flow is enabled, the proxy inspects the inner TLS handshake and switches
//! between encrypted and direct-copy modes.
//!
//! ## Commands
//!
//! - 0x01: TCP connect
//! - 0x02: UDP associate
//! - 0x03: Mux (multiplexing)

use uuid::Uuid;

use crate::error::ProtocolError;
use crate::types::ProxyDestination;

use super::{CompatCommand, CompatProtocol, CompatRequest};

/// VLESS protocol version.
pub const VLESS_VERSION: u8 = 0x00;

/// VLESS command bytes.
pub const VLESS_CMD_TCP: u8 = 0x01;
pub const VLESS_CMD_UDP: u8 = 0x02;
pub const VLESS_CMD_MUX: u8 = 0x03;

/// VLESS flow control types.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VlessFlow {
    /// No flow control (standard mode).
    None,
    /// XTLS-RPRX-Vision: direct copy for inner TLS data after handshake.
    XtlsRprxVision,
}

impl VlessFlow {
    pub fn parse_flow(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "xtls-rprx-vision" => VlessFlow::XtlsRprxVision,
            "" => VlessFlow::None,
            _ => VlessFlow::None,
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            VlessFlow::None => "",
            VlessFlow::XtlsRprxVision => "xtls-rprx-vision",
        }
    }
}

/// VLESS client configuration.
#[derive(Debug, Clone)]
pub struct VlessClient {
    pub uuid: Uuid,
    pub flow: VlessFlow,
}

/// VLESS addon data (parsed from the addon field in the header).
#[derive(Debug, Clone)]
pub struct VlessAddon {
    /// Flow control type.
    pub flow: VlessFlow,
    /// Raw addon bytes for any extra data.
    pub seed: Option<Vec<u8>>,
}

impl Default for VlessAddon {
    fn default() -> Self {
        Self {
            flow: VlessFlow::None,
            seed: None,
        }
    }
}

impl VlessAddon {
    /// Encode the addon as protobuf bytes.
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        let flow_str = self.flow.as_str();
        if !flow_str.is_empty() {
            // Protobuf field 1, wire type 2 (length-delimited)
            buf.push(0x0A);
            buf.push(flow_str.len() as u8);
            buf.extend_from_slice(flow_str.as_bytes());
        }
        if let Some(ref seed) = self.seed {
            if !seed.is_empty() {
                // Protobuf field 2, wire type 2
                buf.push(0x12);
                buf.push(seed.len() as u8);
                buf.extend_from_slice(seed);
            }
        }
        buf
    }
}

/// VLESS command type (extended to support Mux).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VlessCommand {
    /// TCP connect (0x01).
    Tcp,
    /// UDP associate (0x02).
    Udp,
    /// Mux multiplexing (0x03).
    Mux,
}

impl VlessCommand {
    pub fn from_byte(b: u8) -> Result<Self, ProtocolError> {
        match b {
            VLESS_CMD_TCP => Ok(VlessCommand::Tcp),
            VLESS_CMD_UDP => Ok(VlessCommand::Udp),
            VLESS_CMD_MUX => Ok(VlessCommand::Mux),
            _ => Err(ProtocolError::InvalidCommand(b)),
        }
    }

    pub fn to_byte(self) -> u8 {
        match self {
            VlessCommand::Tcp => VLESS_CMD_TCP,
            VlessCommand::Udp => VLESS_CMD_UDP,
            VlessCommand::Mux => VLESS_CMD_MUX,
        }
    }

    /// Convert to the generic CompatCommand (Mux maps to TcpConnect).
    pub fn to_compat_command(self) -> CompatCommand {
        match self {
            VlessCommand::Tcp | VlessCommand::Mux => CompatCommand::TcpConnect,
            VlessCommand::Udp => CompatCommand::UdpAssociate,
        }
    }
}

/// Parsed VLESS request header.
#[derive(Debug)]
pub struct VlessRequest {
    /// VLESS version (should be 0).
    pub version: u8,
    /// Client UUID.
    pub uuid: Uuid,
    /// Addon data (flow control, etc.).
    pub addon: VlessAddon,
    /// Command (TCP connect, UDP associate, or Mux).
    pub vless_command: VlessCommand,
    /// Generic command for compat layer.
    pub command: CompatCommand,
    /// Target destination.
    pub destination: ProxyDestination,
    /// Whether this is a Mux connection.
    pub is_mux: bool,
    /// Any initial payload data after the header.
    pub initial_payload: Vec<u8>,
}

impl VlessRequest {
    /// Convert into a generic CompatRequest.
    pub fn into_compat_request(self) -> CompatRequest {
        CompatRequest {
            protocol: CompatProtocol::Vless,
            command: self.command,
            destination: self.destination,
            initial_payload: self.initial_payload,
        }
    }
}

/// Parse a VLESS request header from raw bytes.
///
/// Format:
/// ```text
/// [version:1][uuid:16][addon_len:1][addon:var]
/// [cmd:1][port:2][addr_type:1][addr:var]
/// ```
///
/// Returns the parsed request and the total bytes consumed.
pub fn parse_vless_request(data: &[u8]) -> Result<(VlessRequest, usize), ProtocolError> {
    // Minimum: version(1) + uuid(16) + addon_len(1) + cmd(1) + port(2) + addr_type(1) + addr(min 4)
    if data.len() < 24 {
        return Err(ProtocolError::InvalidFrame(
            "VLESS request header too short".into(),
        ));
    }

    let version = data[0];
    if version != VLESS_VERSION {
        return Err(ProtocolError::InvalidVersion(version));
    }

    // Parse UUID
    let uuid = Uuid::from_slice(&data[1..17])
        .map_err(|e| ProtocolError::InvalidFrame(format!("invalid VLESS UUID: {}", e)))?;

    // Parse addon
    let addon_len = data[17] as usize;
    let addon_end = 18 + addon_len;
    if data.len() < addon_end + 4 {
        return Err(ProtocolError::InvalidFrame(
            "VLESS header truncated at addon".into(),
        ));
    }

    let addon = if addon_len > 0 {
        parse_vless_addon(&data[18..addon_end])?
    } else {
        VlessAddon::default()
    };

    // Parse command
    let cmd_offset = addon_end;
    let vless_cmd = VlessCommand::from_byte(data[cmd_offset])?;
    let compat_cmd = vless_cmd.to_compat_command();
    let is_mux = vless_cmd == VlessCommand::Mux;

    // Parse destination: port(2) + addr_type(1) + addr(var)
    let port_offset = cmd_offset + 1;
    if data.len() < port_offset + 2 {
        return Err(ProtocolError::InvalidFrame(
            "VLESS header truncated at port".into(),
        ));
    }
    let port = u16::from_be_bytes([data[port_offset], data[port_offset + 1]]);

    let addr_offset = port_offset + 2;
    if addr_offset >= data.len() {
        return Err(ProtocolError::InvalidFrame(
            "VLESS header truncated at address".into(),
        ));
    }

    let addr_type = data[addr_offset];
    let (address, addr_consumed) = parse_vless_address(addr_type, &data[addr_offset + 1..])?;

    let destination = ProxyDestination { address, port };

    let header_end = addr_offset + 1 + addr_consumed;
    let initial_payload = if header_end < data.len() {
        data[header_end..].to_vec()
    } else {
        Vec::new()
    };

    Ok((
        VlessRequest {
            version,
            uuid,
            addon,
            vless_command: vless_cmd,
            command: compat_cmd,
            destination,
            is_mux,
            initial_payload,
        },
        header_end,
    ))
}

/// Build a VLESS request header (for client-side use).
pub fn build_vless_request(
    uuid: &Uuid,
    addon: &VlessAddon,
    command: VlessCommand,
    dest: &ProxyDestination,
) -> Vec<u8> {
    let addon_bytes = addon.encode();
    let addr = encode_vless_address(dest);

    let mut buf = Vec::with_capacity(1 + 16 + 1 + addon_bytes.len() + 1 + 2 + addr.len());
    buf.push(VLESS_VERSION);
    buf.extend_from_slice(uuid.as_bytes());
    buf.push(addon_bytes.len() as u8);
    buf.extend_from_slice(&addon_bytes);
    buf.push(command.to_byte());
    buf.extend_from_slice(&dest.port.to_be_bytes());
    buf.extend_from_slice(&addr);

    buf
}

/// Encode VLESS address (addr_type + addr, without port).
fn encode_vless_address(dest: &ProxyDestination) -> Vec<u8> {
    use crate::types::ProxyAddress;
    let mut buf = Vec::new();
    match &dest.address {
        ProxyAddress::Ipv4(ip) => {
            buf.push(0x01);
            buf.extend_from_slice(&ip.octets());
        }
        ProxyAddress::Domain(domain) => {
            buf.push(0x02);
            buf.push(domain.len() as u8);
            buf.extend_from_slice(domain.as_bytes());
        }
        ProxyAddress::Ipv6(ip) => {
            buf.push(0x03);
            buf.extend_from_slice(&ip.octets());
        }
    }
    buf
}

/// Parse a VLESS addon field.
///
/// The addon is a protobuf-like structure. For simplicity, we parse the
/// flow control string from it.
fn parse_vless_addon(data: &[u8]) -> Result<VlessAddon, ProtocolError> {
    let mut addon = VlessAddon::default();

    if data.is_empty() {
        return Ok(addon);
    }

    let mut offset = 0;
    while offset < data.len() {
        if offset >= data.len() {
            break;
        }
        let tag = data[offset];
        offset += 1;

        let field_number = tag >> 3;
        let wire_type = tag & 0x07;

        match (field_number, wire_type) {
            (1, 2) => {
                // Length-delimited: flow string
                if offset >= data.len() {
                    break;
                }
                let len = data[offset] as usize;
                offset += 1;
                if offset + len > data.len() {
                    break;
                }
                if let Ok(flow_str) = std::str::from_utf8(&data[offset..offset + len]) {
                    addon.flow = VlessFlow::parse_flow(flow_str);
                }
                offset += len;
            }
            (2, 2) => {
                // Length-delimited: seed
                if offset >= data.len() {
                    break;
                }
                let len = data[offset] as usize;
                offset += 1;
                if offset + len > data.len() {
                    break;
                }
                addon.seed = Some(data[offset..offset + len].to_vec());
                offset += len;
            }
            _ => {
                // Unknown field, skip
                break;
            }
        }
    }

    Ok(addon)
}

/// Parse VLESS address (without port, which is parsed separately).
fn parse_vless_address(
    addr_type: u8,
    data: &[u8],
) -> Result<(crate::types::ProxyAddress, usize), ProtocolError> {
    use crate::types::ProxyAddress;
    use std::net::{Ipv4Addr, Ipv6Addr};

    match addr_type {
        0x01 => {
            // IPv4
            if data.len() < 4 {
                return Err(ProtocolError::InvalidFrame(
                    "VLESS IPv4 address too short".into(),
                ));
            }
            let ip = Ipv4Addr::new(data[0], data[1], data[2], data[3]);
            Ok((ProxyAddress::Ipv4(ip), 4))
        }
        0x02 => {
            // Domain
            if data.is_empty() {
                return Err(ProtocolError::InvalidFrame(
                    "VLESS domain address empty".into(),
                ));
            }
            let domain_len = data[0] as usize;
            if data.len() < 1 + domain_len {
                return Err(ProtocolError::InvalidFrame(
                    "VLESS domain address truncated".into(),
                ));
            }
            let domain = String::from_utf8(data[1..1 + domain_len].to_vec())
                .map_err(|_| ProtocolError::InvalidFrame("invalid domain UTF-8".into()))?;
            Ok((ProxyAddress::Domain(domain), 1 + domain_len))
        }
        0x03 => {
            // IPv6
            if data.len() < 16 {
                return Err(ProtocolError::InvalidFrame(
                    "VLESS IPv6 address too short".into(),
                ));
            }
            let mut octets = [0u8; 16];
            octets.copy_from_slice(&data[..16]);
            let ip = Ipv6Addr::from(octets);
            Ok((ProxyAddress::Ipv6(ip), 16))
        }
        _ => Err(ProtocolError::InvalidAddressType(addr_type)),
    }
}

/// Build a VLESS server response header.
///
/// Format: `[version:1][addon_len:1]` (no addon for standard response)
pub fn build_vless_response() -> Vec<u8> {
    vec![VLESS_VERSION, 0x00]
}

/// Build a VLESS server response header with addon.
pub fn build_vless_response_with_addon(addon: &VlessAddon) -> Vec<u8> {
    let addon_bytes = addon.encode();
    let mut resp = vec![VLESS_VERSION, addon_bytes.len() as u8];
    resp.extend_from_slice(&addon_bytes);
    resp
}

/// Verify a VLESS UUID against authorized clients.
///
/// Uses constant-time comparison to prevent timing attacks.
pub fn verify_uuid(uuid: &Uuid, clients: &[VlessClient]) -> Option<VlessFlow> {
    for client in clients {
        if crate::util::ct_eq_slice(uuid.as_bytes(), client.uuid.as_bytes()) {
            return Some(client.flow.clone());
        }
    }
    None
}

/// XTLS-RPRX-Vision state for TLS-in-TLS detection avoidance.
///
/// When Vision flow is active, the proxy inspects the inner TLS handshake:
/// 1. During the TLS handshake phase, data is padded to look like normal TLS records.
/// 2. After the handshake completes (inner TLS established), the proxy switches to
///    direct copy mode (no padding/encryption overhead on the inner data).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VisionState {
    /// Initial state: inspecting for TLS ClientHello.
    Handshake,
    /// TLS handshake detected, applying padding.
    TlsPadding,
    /// Inner TLS established, direct copy mode.
    DirectCopy,
}

impl VisionState {
    /// Check if the data looks like a TLS ClientHello.
    pub fn is_tls_client_hello(data: &[u8]) -> bool {
        // TLS record: content_type=0x16 (handshake), version=0x0301/0x0303
        if data.len() < 5 {
            return false;
        }
        data[0] == 0x16 && data[1] == 0x03 && (data[2] == 0x01 || data[2] == 0x03)
    }

    /// Check if the data looks like a TLS record.
    pub fn is_tls_record(data: &[u8]) -> bool {
        if data.len() < 5 {
            return false;
        }
        // content_type: 0x14=ChangeCipherSpec, 0x15=Alert, 0x16=Handshake, 0x17=ApplicationData
        matches!(data[0], 0x14..=0x17) && data[1] == 0x03
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ProxyAddress;

    #[test]
    fn test_parse_vless_request_tcp_domain() {
        let uuid = Uuid::new_v4();
        let mut data = Vec::new();
        data.push(VLESS_VERSION); // version
        data.extend_from_slice(uuid.as_bytes()); // uuid
        data.push(0); // addon_len = 0
        data.push(0x01); // cmd = TCP connect
        data.extend_from_slice(&443u16.to_be_bytes()); // port
        data.push(0x02); // addr_type = domain
        data.push(11); // domain length
        data.extend_from_slice(b"example.com"); // domain

        let (req, consumed) = parse_vless_request(&data).unwrap();
        assert_eq!(req.version, VLESS_VERSION);
        assert_eq!(req.uuid, uuid);
        assert_eq!(req.command, CompatCommand::TcpConnect);
        assert_eq!(req.vless_command, VlessCommand::Tcp);
        assert!(!req.is_mux);
        assert_eq!(req.destination.port, 443);
        assert!(matches!(&req.destination.address, ProxyAddress::Domain(d) if d == "example.com"));
        assert_eq!(consumed, data.len());
    }

    #[test]
    fn test_parse_vless_request_udp_ipv4() {
        let uuid = Uuid::new_v4();
        let mut data = Vec::new();
        data.push(VLESS_VERSION);
        data.extend_from_slice(uuid.as_bytes());
        data.push(0); // no addon
        data.push(0x02); // cmd = UDP associate
        data.extend_from_slice(&53u16.to_be_bytes()); // port
        data.push(0x01); // addr_type = IPv4
        data.extend_from_slice(&[8, 8, 8, 8]); // 8.8.8.8

        let (req, _) = parse_vless_request(&data).unwrap();
        assert_eq!(req.command, CompatCommand::UdpAssociate);
        assert_eq!(req.vless_command, VlessCommand::Udp);
        assert_eq!(req.destination.port, 53);
        assert!(
            matches!(req.destination.address, ProxyAddress::Ipv4(ip) if ip == std::net::Ipv4Addr::new(8, 8, 8, 8))
        );
    }

    #[test]
    fn test_parse_vless_request_mux() {
        let uuid = Uuid::new_v4();
        let mut data = Vec::new();
        data.push(VLESS_VERSION);
        data.extend_from_slice(uuid.as_bytes());
        data.push(0); // no addon
        data.push(VLESS_CMD_MUX); // cmd = Mux
        data.extend_from_slice(&0u16.to_be_bytes()); // port 0
        data.push(0x01); // addr_type = IPv4
        data.extend_from_slice(&[0, 0, 0, 0]); // 0.0.0.0

        let (req, _) = parse_vless_request(&data).unwrap();
        assert!(req.is_mux);
        assert_eq!(req.vless_command, VlessCommand::Mux);
        assert_eq!(req.command, CompatCommand::TcpConnect);
    }

    #[test]
    fn test_parse_vless_request_with_addon() {
        let uuid = Uuid::new_v4();
        let mut data = Vec::new();
        data.push(VLESS_VERSION);
        data.extend_from_slice(uuid.as_bytes());

        // Build addon: protobuf field 1 (flow) = "xtls-rprx-vision"
        let flow_str = b"xtls-rprx-vision";
        let mut addon = Vec::new();
        addon.push(0x0A); // field 1, wire type 2
        addon.push(flow_str.len() as u8);
        addon.extend_from_slice(flow_str);

        data.push(addon.len() as u8);
        data.extend_from_slice(&addon);

        data.push(0x01); // TCP
        data.extend_from_slice(&80u16.to_be_bytes());
        data.push(0x01); // IPv4
        data.extend_from_slice(&[127, 0, 0, 1]);

        let (req, _) = parse_vless_request(&data).unwrap();
        assert_eq!(req.addon.flow, VlessFlow::XtlsRprxVision);
    }

    #[test]
    fn test_parse_vless_request_with_payload() {
        let uuid = Uuid::new_v4();
        let mut data = Vec::new();
        data.push(VLESS_VERSION);
        data.extend_from_slice(uuid.as_bytes());
        data.push(0); // no addon
        data.push(0x01); // TCP
        data.extend_from_slice(&80u16.to_be_bytes());
        data.push(0x01); // IPv4
        data.extend_from_slice(&[1, 2, 3, 4]);
        // Extra payload
        data.extend_from_slice(b"GET / HTTP/1.1\r\n");

        let (req, _) = parse_vless_request(&data).unwrap();
        assert_eq!(req.initial_payload, b"GET / HTTP/1.1\r\n");
    }

    #[test]
    fn test_build_vless_request_roundtrip() {
        let uuid = Uuid::new_v4();
        let addon = VlessAddon {
            flow: VlessFlow::XtlsRprxVision,
            seed: None,
        };
        let dest = ProxyDestination {
            address: ProxyAddress::Domain("example.com".into()),
            port: 443,
        };

        let wire = build_vless_request(&uuid, &addon, VlessCommand::Tcp, &dest);
        let (req, consumed) = parse_vless_request(&wire).unwrap();

        assert_eq!(req.uuid, uuid);
        assert_eq!(req.addon.flow, VlessFlow::XtlsRprxVision);
        assert_eq!(req.destination.port, 443);
        assert_eq!(consumed, wire.len());
    }

    #[test]
    fn test_build_vless_response() {
        let resp = build_vless_response();
        assert_eq!(resp, vec![0x00, 0x00]);
    }

    #[test]
    fn test_build_vless_response_with_addon() {
        let addon = VlessAddon {
            flow: VlessFlow::XtlsRprxVision,
            seed: None,
        };
        let resp = build_vless_response_with_addon(&addon);
        assert_eq!(resp[0], VLESS_VERSION);
        assert!(resp.len() > 2);
    }

    #[test]
    fn test_verify_uuid_match() {
        let uuid = Uuid::new_v4();
        let clients = vec![VlessClient {
            uuid,
            flow: VlessFlow::XtlsRprxVision,
        }];
        assert_eq!(
            verify_uuid(&uuid, &clients),
            Some(VlessFlow::XtlsRprxVision)
        );
    }

    #[test]
    fn test_verify_uuid_no_match() {
        let uuid = Uuid::new_v4();
        let other = Uuid::new_v4();
        let clients = vec![VlessClient {
            uuid: other,
            flow: VlessFlow::None,
        }];
        assert_eq!(verify_uuid(&uuid, &clients), None);
    }

    #[test]
    fn test_vless_flow_from_str() {
        assert_eq!(
            VlessFlow::parse_flow("xtls-rprx-vision"),
            VlessFlow::XtlsRprxVision
        );
        assert_eq!(
            VlessFlow::parse_flow("XTLS-RPRX-VISION"),
            VlessFlow::XtlsRprxVision
        );
        assert_eq!(VlessFlow::parse_flow(""), VlessFlow::None);
        assert_eq!(VlessFlow::parse_flow("unknown"), VlessFlow::None);
    }

    #[test]
    fn test_vless_version_rejection() {
        let mut data = vec![0x01]; // wrong version
        data.extend_from_slice(&[0u8; 17]); // uuid + addon_len
        data.extend_from_slice(&[0x01, 0x00, 0x50, 0x01, 1, 2, 3, 4]);
        assert!(parse_vless_request(&data).is_err());
    }

    #[test]
    fn test_addon_encode_roundtrip() {
        let addon = VlessAddon {
            flow: VlessFlow::XtlsRprxVision,
            seed: Some(b"test-seed".to_vec()),
        };
        let encoded = addon.encode();
        let decoded = parse_vless_addon(&encoded).unwrap();
        assert_eq!(decoded.flow, VlessFlow::XtlsRprxVision);
        assert_eq!(decoded.seed, Some(b"test-seed".to_vec()));
    }

    #[test]
    fn test_vision_state_tls_detection() {
        // TLS ClientHello
        let client_hello = [0x16, 0x03, 0x01, 0x00, 0x05, 0x01];
        assert!(VisionState::is_tls_client_hello(&client_hello));
        assert!(VisionState::is_tls_record(&client_hello));

        // Not TLS
        let http = b"GET / HTTP/1.1\r\n";
        assert!(!VisionState::is_tls_client_hello(http));
        assert!(!VisionState::is_tls_record(http));

        // TLS ApplicationData
        let app_data = [0x17, 0x03, 0x03, 0x00, 0x20];
        assert!(!VisionState::is_tls_client_hello(&app_data));
        assert!(VisionState::is_tls_record(&app_data));
    }

    #[test]
    fn test_vless_command_roundtrip() {
        assert_eq!(VlessCommand::from_byte(0x01).unwrap(), VlessCommand::Tcp);
        assert_eq!(VlessCommand::from_byte(0x02).unwrap(), VlessCommand::Udp);
        assert_eq!(VlessCommand::from_byte(0x03).unwrap(), VlessCommand::Mux);
        assert!(VlessCommand::from_byte(0x04).is_err());

        assert_eq!(VlessCommand::Tcp.to_byte(), 0x01);
        assert_eq!(VlessCommand::Udp.to_byte(), 0x02);
        assert_eq!(VlessCommand::Mux.to_byte(), 0x03);
    }
}
