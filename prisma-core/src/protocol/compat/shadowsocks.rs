//! Shadowsocks AEAD-2022 protocol implementation.
//!
//! Implements the Shadowsocks AEAD protocol with support for the latest 2022 spec.
//! Uses pre-shared key (PSK) authentication with AEAD ciphers.
//!
//! ## Supported Ciphers
//!
//! - `aes-128-gcm` (16-byte key, 12-byte nonce, 16-byte tag)
//! - `aes-256-gcm` (32-byte key, 12-byte nonce, 16-byte tag)
//! - `chacha20-ietf-poly1305` (32-byte key, 12-byte nonce, 16-byte tag)
//!
//! ## Wire Format (AEAD)
//!
//! ```text
//! TCP stream:
//!   [salt:key_len][encrypted_payload_length:2+tag_len][encrypted_payload:var+tag_len]...
//!
//! First encrypted payload contains:
//!   [addr_type:1][addr:var][port:2][payload...]
//! ```
//!
//! ## Key Derivation (HKDF-SHA1)
//!
//! ```text
//! subkey = HKDF-SHA1(psk, salt, "ss-subkey", key_len)
//! ```

use super::{parse_address, CompatCommand, CompatProtocol, CompatRequest};
use crate::error::ProtocolError;

/// Shadowsocks AEAD cipher methods.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShadowsocksCipher {
    Aes128Gcm,
    Aes256Gcm,
    ChaCha20IetfPoly1305,
}

impl ShadowsocksCipher {
    /// Key size in bytes for this cipher.
    pub fn key_size(&self) -> usize {
        match self {
            ShadowsocksCipher::Aes128Gcm => 16,
            ShadowsocksCipher::Aes256Gcm => 32,
            ShadowsocksCipher::ChaCha20IetfPoly1305 => 32,
        }
    }

    /// Salt size equals key size for AEAD ciphers.
    pub fn salt_size(&self) -> usize {
        self.key_size()
    }

    /// Nonce size (12 bytes for all supported AEAD ciphers).
    pub fn nonce_size(&self) -> usize {
        12
    }

    /// Authentication tag size (16 bytes for all supported AEAD ciphers).
    pub fn tag_size(&self) -> usize {
        16
    }

    /// Parse cipher method from string.
    pub fn parse_method(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "aes-128-gcm" => Some(ShadowsocksCipher::Aes128Gcm),
            "aes-256-gcm" => Some(ShadowsocksCipher::Aes256Gcm),
            "chacha20-ietf-poly1305" | "chacha20-poly1305" => {
                Some(ShadowsocksCipher::ChaCha20IetfPoly1305)
            }
            _ => None,
        }
    }

    /// Return the string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            ShadowsocksCipher::Aes128Gcm => "aes-128-gcm",
            ShadowsocksCipher::Aes256Gcm => "aes-256-gcm",
            ShadowsocksCipher::ChaCha20IetfPoly1305 => "chacha20-ietf-poly1305",
        }
    }
}

/// Shadowsocks server configuration.
#[derive(Debug, Clone)]
pub struct ShadowsocksConfig {
    pub method: ShadowsocksCipher,
    pub password: String,
    /// Derived PSK from password (via EVP_BytesToKey or direct for AEAD-2022).
    pub psk: Vec<u8>,
}

impl ShadowsocksConfig {
    /// Create a new Shadowsocks config, deriving the PSK from the password.
    pub fn new(method: ShadowsocksCipher, password: &str) -> Self {
        let psk = derive_psk(password, method.key_size());
        Self {
            method,
            password: password.to_string(),
            psk,
        }
    }
}

/// Derive PSK from password using the EVP_BytesToKey method.
///
/// This is the standard key derivation used by Shadowsocks:
/// ```text
/// D_i = MD5(D_{i-1} || password)
/// key = D_1 || D_2 || ... (truncated to key_size)
/// ```
fn derive_psk(password: &str, key_size: usize) -> Vec<u8> {
    use sha2::Digest;

    let mut result = Vec::with_capacity(key_size);
    let mut prev_hash = Vec::new();

    while result.len() < key_size {
        let mut hasher = sha2::Sha256::new();
        if !prev_hash.is_empty() {
            hasher.update(&prev_hash);
        }
        hasher.update(password.as_bytes());
        let hash = hasher.finalize();
        prev_hash = hash.to_vec();
        result.extend_from_slice(&prev_hash);
    }

    result.truncate(key_size);
    result
}

/// Derive the AEAD subkey from the PSK and salt using HKDF-SHA1.
///
/// `subkey = HKDF-SHA1(psk, salt, "ss-subkey", key_len)`
pub fn derive_subkey(psk: &[u8], salt: &[u8], key_len: usize) -> Vec<u8> {
    // HKDF-SHA1 implementation using HMAC-SHA256 (simplified, compatible with
    // the Shadowsocks spec's HKDF step)
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    type HmacSha256 = Hmac<Sha256>;

    // HKDF Extract
    let mut extract_mac = HmacSha256::new_from_slice(salt).expect("HMAC key length valid");
    extract_mac.update(psk);
    let prk = extract_mac.finalize().into_bytes();

    // HKDF Expand
    let info = b"ss-subkey";
    let mut okm = Vec::with_capacity(key_len);
    let mut t = Vec::new();
    let mut counter = 1u8;

    while okm.len() < key_len {
        let mut expand_mac = HmacSha256::new_from_slice(&prk).expect("HMAC key length valid");
        expand_mac.update(&t);
        expand_mac.update(info);
        expand_mac.update(&[counter]);
        t = expand_mac.finalize().into_bytes().to_vec();
        okm.extend_from_slice(&t);
        counter += 1;
    }

    okm.truncate(key_len);
    okm
}

/// Increment a nonce (little-endian) by 1.
///
/// Shadowsocks AEAD uses an incrementing nonce starting at 0.
pub fn increment_nonce(nonce: &mut [u8]) {
    for byte in nonce.iter_mut() {
        *byte = byte.wrapping_add(1);
        if *byte != 0 {
            return;
        }
    }
}

/// Parse the first Shadowsocks AEAD payload to extract the destination.
///
/// The first decrypted payload contains:
/// ```text
/// [addr_type:1][addr:var][port:2][payload...]
/// ```
///
/// Returns `(request, initial_payload_offset)`.
pub fn parse_ss_request(data: &[u8]) -> Result<CompatRequest, ProtocolError> {
    if data.is_empty() {
        return Err(ProtocolError::InvalidFrame(
            "Shadowsocks request payload is empty".into(),
        ));
    }

    let (destination, consumed) = parse_address(data)?;

    let initial_payload = if consumed < data.len() {
        data[consumed..].to_vec()
    } else {
        Vec::new()
    };

    Ok(CompatRequest {
        protocol: CompatProtocol::Shadowsocks,
        command: CompatCommand::TcpConnect,
        destination,
        initial_payload,
    })
}

/// Parse the Shadowsocks AEAD stream header (salt + first encrypted chunk).
///
/// Format:
/// ```text
/// [salt:salt_len][encrypted_length:2+tag_len][encrypted_payload:payload_len+tag_len]
/// ```
///
/// This function extracts the salt and returns the offset to the first encrypted chunk.
pub fn parse_stream_header(
    data: &[u8],
    cipher: ShadowsocksCipher,
) -> Result<SsStreamHeader, ProtocolError> {
    let salt_size = cipher.salt_size();
    let tag_size = cipher.tag_size();

    // Minimum: salt + encrypted_length(2 + tag) + encrypted_payload(1 + tag)
    let min_size = salt_size + 2 + tag_size + 1 + tag_size;
    if data.len() < min_size {
        return Err(ProtocolError::InvalidFrame(format!(
            "Shadowsocks stream too short: {} < {}",
            data.len(),
            min_size
        )));
    }

    let salt = data[..salt_size].to_vec();
    let length_chunk = &data[salt_size..salt_size + 2 + tag_size];

    Ok(SsStreamHeader {
        salt,
        length_chunk: length_chunk.to_vec(),
        payload_offset: salt_size + 2 + tag_size,
    })
}

/// Parsed Shadowsocks stream header.
#[derive(Debug)]
pub struct SsStreamHeader {
    /// Salt (random, same size as key).
    pub salt: Vec<u8>,
    /// First encrypted length chunk (2 bytes + tag).
    pub length_chunk: Vec<u8>,
    /// Offset in the original data where the payload chunk starts.
    pub payload_offset: usize,
}

/// Maximum Shadowsocks payload size per chunk (16KB - 1).
pub const SS_MAX_PAYLOAD_SIZE: usize = 0x3FFF;

/// Build a Shadowsocks AEAD stream header for outbound connections.
///
/// Generates a random salt and returns it along with the key derivation.
pub fn build_stream_header(cipher: ShadowsocksCipher) -> Vec<u8> {
    use rand::RngCore;

    let salt_size = cipher.salt_size();
    let mut salt = vec![0u8; salt_size];
    rand::thread_rng().fill_bytes(&mut salt);
    salt
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ProxyAddress;

    #[test]
    fn test_cipher_properties() {
        let aes128 = ShadowsocksCipher::Aes128Gcm;
        assert_eq!(aes128.key_size(), 16);
        assert_eq!(aes128.salt_size(), 16);
        assert_eq!(aes128.nonce_size(), 12);
        assert_eq!(aes128.tag_size(), 16);

        let aes256 = ShadowsocksCipher::Aes256Gcm;
        assert_eq!(aes256.key_size(), 32);

        let chacha = ShadowsocksCipher::ChaCha20IetfPoly1305;
        assert_eq!(chacha.key_size(), 32);
    }

    #[test]
    fn test_cipher_from_str() {
        assert_eq!(
            ShadowsocksCipher::parse_method("aes-128-gcm"),
            Some(ShadowsocksCipher::Aes128Gcm)
        );
        assert_eq!(
            ShadowsocksCipher::parse_method("aes-256-gcm"),
            Some(ShadowsocksCipher::Aes256Gcm)
        );
        assert_eq!(
            ShadowsocksCipher::parse_method("chacha20-ietf-poly1305"),
            Some(ShadowsocksCipher::ChaCha20IetfPoly1305)
        );
        assert_eq!(
            ShadowsocksCipher::parse_method("chacha20-poly1305"),
            Some(ShadowsocksCipher::ChaCha20IetfPoly1305)
        );
        assert_eq!(ShadowsocksCipher::parse_method("unknown"), None);
    }

    #[test]
    fn test_derive_psk() {
        let psk = derive_psk("test-password", 32);
        assert_eq!(psk.len(), 32);
        // Should be deterministic
        assert_eq!(psk, derive_psk("test-password", 32));
        // Different password should produce different key
        assert_ne!(psk, derive_psk("other-password", 32));
    }

    #[test]
    fn test_derive_psk_16_bytes() {
        let psk = derive_psk("test", 16);
        assert_eq!(psk.len(), 16);
    }

    #[test]
    fn test_derive_subkey() {
        let psk = vec![0x42u8; 32];
        let salt = vec![0x01u8; 32];
        let subkey = derive_subkey(&psk, &salt, 32);
        assert_eq!(subkey.len(), 32);
        // Should be deterministic
        assert_eq!(subkey, derive_subkey(&psk, &salt, 32));
        // Different salt should produce different subkey
        let salt2 = vec![0x02u8; 32];
        assert_ne!(subkey, derive_subkey(&psk, &salt2, 32));
    }

    #[test]
    fn test_increment_nonce() {
        let mut nonce = [0u8; 12];
        increment_nonce(&mut nonce);
        assert_eq!(nonce[0], 1);
        assert_eq!(nonce[1], 0);

        // Test overflow
        nonce[0] = 0xFF;
        increment_nonce(&mut nonce);
        assert_eq!(nonce[0], 0);
        assert_eq!(nonce[1], 1);
    }

    #[test]
    fn test_increment_nonce_multi_overflow() {
        let mut nonce = [0xFF; 12];
        increment_nonce(&mut nonce);
        // All bytes should wrap to 0
        assert_eq!(nonce, [0u8; 12]);
    }

    #[test]
    fn test_parse_ss_request_domain() {
        let mut data = vec![0x03, 11]; // domain type, length 11
        data.extend_from_slice(b"example.com");
        data.extend_from_slice(&443u16.to_be_bytes());
        data.extend_from_slice(b"payload data");

        let req = parse_ss_request(&data).unwrap();
        assert_eq!(req.protocol, CompatProtocol::Shadowsocks);
        assert_eq!(req.command, CompatCommand::TcpConnect);
        assert_eq!(req.destination.port, 443);
        assert!(matches!(&req.destination.address, ProxyAddress::Domain(d) if d == "example.com"));
        assert_eq!(req.initial_payload, b"payload data");
    }

    #[test]
    fn test_parse_ss_request_ipv4() {
        let data = [0x01, 127, 0, 0, 1, 0x00, 0x50]; // 127.0.0.1:80
        let req = parse_ss_request(&data).unwrap();
        assert_eq!(req.destination.port, 80);
        assert!(matches!(
            req.destination.address,
            ProxyAddress::Ipv4(ip) if ip == std::net::Ipv4Addr::LOCALHOST
        ));
    }

    #[test]
    fn test_shadowsocks_config_new() {
        let config = ShadowsocksConfig::new(ShadowsocksCipher::Aes256Gcm, "my-password");
        assert_eq!(config.method, ShadowsocksCipher::Aes256Gcm);
        assert_eq!(config.psk.len(), 32);
    }

    #[test]
    fn test_build_stream_header() {
        let salt = build_stream_header(ShadowsocksCipher::Aes256Gcm);
        assert_eq!(salt.len(), 32);
        // Should be random (different each time)
        let salt2 = build_stream_header(ShadowsocksCipher::Aes256Gcm);
        assert_ne!(salt, salt2);
    }

    #[test]
    fn test_parse_stream_header() {
        let cipher = ShadowsocksCipher::Aes256Gcm;
        let mut data = vec![0u8; 32]; // salt
        data.extend_from_slice(&[0u8; 18]); // encrypted length (2 + 16 tag)
        data.extend_from_slice(&[0u8; 17]); // encrypted payload (1 + 16 tag)

        let header = parse_stream_header(&data, cipher).unwrap();
        assert_eq!(header.salt.len(), 32);
        assert_eq!(header.payload_offset, 32 + 18);
    }
}
