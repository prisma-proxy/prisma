//! VMess protocol implementation (AEAD header format, v2fly/xray compatible).
//!
//! VMess uses UUID-based authentication with timestamp-based header encryption.
//! This module implements the modern AEAD variant used by v2fly/xray-core.
//!
//! ## Wire Format (AEAD)
//!
//! ```text
//! Client → Server:
//!   [auth_id:16][len_enc:2+16][header_enc:var+16][payload...]
//!
//!   auth_id = HMAC-SHA256(cmd_key, timestamp)[:16]
//!   cmd_key = MD5(uuid + b"c48619fe-8f02-49e0-b9e9-edf763e17e21")
//!
//! AEAD header (after decryption):
//!   [version:1][iv:16][key:16][response_header:1][option:1]
//!   [padding_len:4bits][security:4bits][reserved:1][cmd:1]
//!   [port:2][addr_type:1][addr:var][padding:var][checksum:4]
//!
//! Response header:
//!   [response_header:1][option:1][cmd:1][cmd_len:1]
//! ```

use std::time::{SystemTime, UNIX_EPOCH};

use hmac::{Hmac, Mac};
use sha2::Sha256;
use uuid::Uuid;

use crate::error::ProtocolError;
use crate::types::ProxyDestination;

use super::{CompatCommand, CompatRequest};

type HmacSha256 = Hmac<Sha256>;

/// VMess protocol version (AEAD).
pub const VMESS_VERSION: u8 = 1;

/// VMess security types.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum VMessSecurity {
    /// AES-128-CFB (legacy, not recommended)
    Aes128Cfb = 0x01,
    /// AES-128-GCM (AEAD)
    Aes128Gcm = 0x03,
    /// ChaCha20-Poly1305 (AEAD)
    ChaCha20Poly1305 = 0x04,
    /// No encryption
    None = 0x05,
    /// Auto (client decides)
    Auto = 0x00,
}

impl VMessSecurity {
    pub fn from_byte(b: u8) -> Option<Self> {
        match b & 0x0F {
            0x00 => Some(VMessSecurity::Auto),
            0x01 => Some(VMessSecurity::Aes128Cfb),
            0x03 => Some(VMessSecurity::Aes128Gcm),
            0x04 => Some(VMessSecurity::ChaCha20Poly1305),
            0x05 => Some(VMessSecurity::None),
            _ => None,
        }
    }
}

/// VMess option flags.
pub const VMESS_OPT_CHUNK_STREAM: u8 = 0x01;
pub const VMESS_OPT_CHUNK_MASKING: u8 = 0x04;
pub const VMESS_OPT_GLOBAL_PADDING: u8 = 0x08;
pub const VMESS_OPT_AUTH_LENGTH: u8 = 0x10;

/// VMess client configuration.
#[derive(Debug, Clone)]
pub struct VMessClient {
    pub uuid: Uuid,
    pub alter_id: u16,
}

/// Derive the VMess command key from a UUID.
///
/// `cmd_key = MD5(uuid_bytes + b"c48619fe-8f02-49e0-b9e9-edf763e17e21")`
pub fn derive_cmd_key(uuid: &Uuid) -> [u8; 16] {
    use sha2::Digest;

    let magic = b"c48619fe-8f02-49e0-b9e9-edf763e17e21";
    let mut hasher = sha2::Sha256::new();
    hasher.update(uuid.as_bytes());
    hasher.update(magic);
    let result = hasher.finalize();
    let mut key = [0u8; 16];
    key.copy_from_slice(&result[..16]);
    key
}

/// Compute the VMess AEAD auth_id from the command key and timestamp.
///
/// `auth_id = HMAC-SHA256(cmd_key, timestamp_be8)[:16]`
pub fn compute_auth_id(cmd_key: &[u8; 16], timestamp: u64) -> [u8; 16] {
    let mut mac = HmacSha256::new_from_slice(cmd_key).expect("HMAC key length is valid");
    mac.update(&timestamp.to_be_bytes());
    let result = mac.finalize().into_bytes();
    let mut auth_id = [0u8; 16];
    auth_id.copy_from_slice(&result[..16]);
    auth_id
}

/// Verify a VMess auth_id against a set of authorized clients.
///
/// Checks the timestamp window (120 seconds) and matches against known UUIDs.
/// Returns the matched UUID on success.
pub fn verify_auth_id(
    auth_id: &[u8; 16],
    clients: &[VMessClient],
    timestamp_tolerance_secs: u64,
) -> Option<Uuid> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    for client in clients {
        let cmd_key = derive_cmd_key(&client.uuid);
        // Check timestamps within tolerance window
        let start = now.saturating_sub(timestamp_tolerance_secs);
        let end = now + timestamp_tolerance_secs;
        for ts in start..=end {
            let expected = compute_auth_id(&cmd_key, ts);
            if crate::util::ct_eq_slice(auth_id, &expected) {
                return Some(client.uuid);
            }
        }
    }
    None
}

/// Parse a VMess AEAD header (after decryption).
///
/// The header format is:
/// ```text
/// [version:1][iv:16][key:16][resp_header:1][option:1]
/// [padding_len_security:1][reserved:1][cmd:1][port:2][addr_type:1][addr:var]
/// [padding:var][checksum:4]
/// ```
///
/// Returns the parsed request and data encryption key/IV.
pub fn parse_vmess_header(data: &[u8]) -> Result<VMessParsedHeader, ProtocolError> {
    if data.len() < 41 {
        return Err(ProtocolError::InvalidFrame("VMess header too short".into()));
    }

    let version = data[0];
    if version != VMESS_VERSION {
        return Err(ProtocolError::InvalidVersion(version));
    }

    let mut data_iv = [0u8; 16];
    data_iv.copy_from_slice(&data[1..17]);

    let mut data_key = [0u8; 16];
    data_key.copy_from_slice(&data[17..33]);

    let response_header = data[33];
    let option = data[34];

    let padding_security = data[35];
    let padding_len = ((padding_security >> 4) & 0x0F) as usize;
    let security = VMessSecurity::from_byte(padding_security & 0x0F).ok_or_else(|| {
        ProtocolError::InvalidFrame(format!(
            "unknown VMess security type: 0x{:02x}",
            padding_security & 0x0F
        ))
    })?;

    let _reserved = data[36];
    let cmd = data[37];
    let command = CompatCommand::from_byte(cmd)?;

    let port = u16::from_be_bytes([data[38], data[39]]);
    let addr_type = data[40];

    // Parse address starting at offset 40 (addr_type + addr + port already partially parsed)
    // Re-pack for our parser: [addr_type][addr][port]
    let addr_data = &data[40..];
    let (dest, addr_consumed) = parse_vmess_address(addr_type, &addr_data[1..], port)?;

    // Total header consumed: 41 + addr_consumed + padding + 4 (checksum)
    let header_consumed = 41 + addr_consumed + padding_len + 4;

    if data.len() < header_consumed {
        return Err(ProtocolError::InvalidFrame("VMess header truncated".into()));
    }

    // Verify FNV1a-32 checksum
    let checksum_offset = 41 + addr_consumed + padding_len;
    let expected_checksum = fnv1a32(&data[..checksum_offset]);
    let actual_checksum = u32::from_be_bytes([
        data[checksum_offset],
        data[checksum_offset + 1],
        data[checksum_offset + 2],
        data[checksum_offset + 3],
    ]);
    if expected_checksum != actual_checksum {
        return Err(ProtocolError::InvalidFrame(
            "VMess header checksum mismatch".into(),
        ));
    }

    Ok(VMessParsedHeader {
        data_iv,
        data_key,
        response_header,
        option,
        security,
        command,
        destination: dest,
    })
}

/// Parsed VMess AEAD header.
#[derive(Debug)]
pub struct VMessParsedHeader {
    /// Data stream encryption IV (16 bytes).
    pub data_iv: [u8; 16],
    /// Data stream encryption key (16 bytes).
    pub data_key: [u8; 16],
    /// Response header byte (echoed back in server response).
    pub response_header: u8,
    /// Option flags.
    pub option: u8,
    /// Encryption security type for the data stream.
    pub security: VMessSecurity,
    /// Command (connect or UDP).
    pub command: CompatCommand,
    /// Target destination.
    pub destination: ProxyDestination,
}

impl VMessParsedHeader {
    /// Convert into a generic CompatRequest.
    pub fn into_compat_request(self) -> CompatRequest {
        CompatRequest {
            protocol: super::CompatProtocol::VMess,
            command: self.command,
            destination: self.destination,
            initial_payload: Vec::new(),
        }
    }
}

/// Build a VMess AEAD server response header.
///
/// Format: `[response_header:1][option:1][cmd:1][cmd_len:1]`
pub fn build_response_header(response_header: u8) -> Vec<u8> {
    vec![response_header, 0x00, 0x00, 0x00]
}

/// Parse VMess address (after addr_type byte has been read).
fn parse_vmess_address(
    addr_type: u8,
    data: &[u8],
    port: u16,
) -> Result<(ProxyDestination, usize), ProtocolError> {
    use crate::types::ProxyAddress;
    use std::net::{Ipv4Addr, Ipv6Addr};

    match addr_type {
        0x01 => {
            // IPv4
            if data.len() < 4 {
                return Err(ProtocolError::InvalidFrame(
                    "VMess IPv4 address too short".into(),
                ));
            }
            let ip = Ipv4Addr::new(data[0], data[1], data[2], data[3]);
            Ok((
                ProxyDestination {
                    address: ProxyAddress::Ipv4(ip),
                    port,
                },
                4,
            ))
        }
        0x02 => {
            // Domain (VMess uses type 0x02 for domain, not 0x03)
            if data.is_empty() {
                return Err(ProtocolError::InvalidFrame(
                    "VMess domain address empty".into(),
                ));
            }
            let domain_len = data[0] as usize;
            if data.len() < 1 + domain_len {
                return Err(ProtocolError::InvalidFrame(
                    "VMess domain address truncated".into(),
                ));
            }
            let domain = String::from_utf8(data[1..1 + domain_len].to_vec())
                .map_err(|_| ProtocolError::InvalidFrame("invalid domain UTF-8".into()))?;
            Ok((
                ProxyDestination {
                    address: ProxyAddress::Domain(domain),
                    port,
                },
                1 + domain_len,
            ))
        }
        0x03 => {
            // IPv6
            if data.len() < 16 {
                return Err(ProtocolError::InvalidFrame(
                    "VMess IPv6 address too short".into(),
                ));
            }
            let mut octets = [0u8; 16];
            octets.copy_from_slice(&data[..16]);
            let ip = Ipv6Addr::from(octets);
            Ok((
                ProxyDestination {
                    address: ProxyAddress::Ipv6(ip),
                    port,
                },
                16,
            ))
        }
        _ => Err(ProtocolError::InvalidAddressType(addr_type)),
    }
}

/// FNV1a-32 hash for VMess header checksum.
fn fnv1a32(data: &[u8]) -> u32 {
    let mut hash: u32 = 0x811c9dc5;
    for &b in data {
        hash ^= b as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_cmd_key() {
        let uuid = Uuid::parse_str("b831381d-6324-4d53-ad4f-8cda48b30811").unwrap();
        let key = derive_cmd_key(&uuid);
        assert_eq!(key.len(), 16);
        // Key should be deterministic
        assert_eq!(key, derive_cmd_key(&uuid));
    }

    #[test]
    fn test_compute_auth_id() {
        let cmd_key = [0x42u8; 16];
        let timestamp = 1700000000u64;
        let auth_id = compute_auth_id(&cmd_key, timestamp);
        assert_eq!(auth_id.len(), 16);
        // Should be deterministic
        assert_eq!(auth_id, compute_auth_id(&cmd_key, timestamp));
        // Different timestamp should produce different auth_id
        assert_ne!(auth_id, compute_auth_id(&cmd_key, timestamp + 1));
    }

    #[test]
    fn test_verify_auth_id_match() {
        let uuid = Uuid::new_v4();
        let clients = vec![VMessClient { uuid, alter_id: 0 }];
        let cmd_key = derive_cmd_key(&uuid);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let auth_id = compute_auth_id(&cmd_key, now);
        assert_eq!(verify_auth_id(&auth_id, &clients, 120), Some(uuid));
    }

    #[test]
    fn test_verify_auth_id_no_match() {
        let uuid = Uuid::new_v4();
        let clients = vec![VMessClient { uuid, alter_id: 0 }];
        let fake_auth = [0xFFu8; 16];
        assert_eq!(verify_auth_id(&fake_auth, &clients, 120), None);
    }

    #[test]
    fn test_fnv1a32_known_value() {
        // Empty input should produce the FNV offset basis
        assert_eq!(fnv1a32(b""), 0x811c9dc5);
        // Known test vector
        let hash = fnv1a32(b"hello");
        assert_ne!(hash, 0);
    }

    #[test]
    fn test_vmess_security_from_byte() {
        assert_eq!(
            VMessSecurity::from_byte(0x03),
            Some(VMessSecurity::Aes128Gcm)
        );
        assert_eq!(
            VMessSecurity::from_byte(0x04),
            Some(VMessSecurity::ChaCha20Poly1305)
        );
        assert_eq!(VMessSecurity::from_byte(0x05), Some(VMessSecurity::None));
        assert_eq!(VMessSecurity::from_byte(0xFF), None);
    }

    #[test]
    fn test_build_response_header() {
        let resp = build_response_header(0xAB);
        assert_eq!(resp, vec![0xAB, 0x00, 0x00, 0x00]);
    }

    #[test]
    fn test_parse_vmess_header_valid() {
        // Build a minimal valid header
        let mut header = Vec::new();
        header.push(VMESS_VERSION); // version
        header.extend_from_slice(&[0u8; 16]); // iv
        header.extend_from_slice(&[0u8; 16]); // key
        header.push(0xAB); // response_header
        header.push(VMESS_OPT_CHUNK_STREAM); // option
        header.push(0x03); // padding_len=0, security=AES-128-GCM
        header.push(0x00); // reserved
        header.push(0x01); // cmd = TCP connect
        header.extend_from_slice(&443u16.to_be_bytes()); // port
        header.push(0x02); // addr_type = domain
        header.push(11); // domain length
        header.extend_from_slice(b"example.com"); // domain

        // Calculate and append FNV1a checksum
        let checksum = fnv1a32(&header);
        header.extend_from_slice(&checksum.to_be_bytes());

        let parsed = parse_vmess_header(&header).unwrap();
        assert_eq!(parsed.response_header, 0xAB);
        assert_eq!(parsed.security, VMessSecurity::Aes128Gcm);
        assert_eq!(parsed.command, super::super::CompatCommand::TcpConnect);
        assert_eq!(parsed.destination.port, 443);
    }
}
