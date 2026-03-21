//! Shadowsocks AEAD protocol implementation.
//!
//! Implements the Shadowsocks AEAD protocol with support for the standard spec.
//! Uses pre-shared key (PSK) authentication with AEAD ciphers.
//!
//! ## Supported Ciphers
//!
//! - `aes-128-gcm` (16-byte key, 12-byte nonce, 16-byte tag)
//! - `aes-256-gcm` (32-byte key, 12-byte nonce, 16-byte tag)
//! - `chacha20-ietf-poly1305` (32-byte key, 12-byte nonce, 16-byte tag)
//!
//! ## Wire Format (AEAD TCP)
//!
//! ```text
//! TCP stream:
//!   [salt:key_len][encrypted_chunks...]
//!
//! Each chunk:
//!   [encrypted_length:2+tag(16)][encrypted_payload:var+tag(16)]
//!
//! First encrypted payload contains:
//!   [addr_type:1][addr:var][port:2][payload...]
//! ```
//!
//! ## Wire Format (AEAD UDP)
//!
//! ```text
//! UDP packet:
//!   [salt:key_len][encrypted_payload+tag(16)]
//!   Nonce = all zeros
//! ```
//!
//! ## Key Derivation
//!
//! - Master key: EVP_BytesToKey (MD5-based) from password
//! - Per-session subkey: HKDF-SHA1(master_key, salt, "ss-subkey", key_len)
//! - Nonce: 12 bytes, little-endian increment per operation (2 per chunk: length + payload)

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes128Gcm, Aes256Gcm, Nonce as AesNonce};
use chacha20poly1305::{ChaCha20Poly1305, Nonce as ChaChaNonce};
use hmac::Mac as HmacMacTrait;

use super::{parse_address, CompatCommand, CompatProtocol, CompatRequest};
use crate::error::{CryptoError, ProtocolError};

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
    /// Derived PSK from password (via EVP_BytesToKey).
    pub psk: Vec<u8>,
    /// Whether UDP relay is enabled.
    pub udp_enabled: bool,
}

impl ShadowsocksConfig {
    /// Create a new Shadowsocks config, deriving the PSK from the password.
    pub fn new(method: ShadowsocksCipher, password: &str) -> Self {
        let psk = derive_psk(password, method.key_size());
        Self {
            method,
            password: password.to_string(),
            psk,
            udp_enabled: true,
        }
    }

    /// Create with explicit UDP setting.
    pub fn with_udp(method: ShadowsocksCipher, password: &str, udp: bool) -> Self {
        let psk = derive_psk(password, method.key_size());
        Self {
            method,
            password: password.to_string(),
            psk,
            udp_enabled: udp,
        }
    }
}

/// Derive PSK from password using the EVP_BytesToKey method (MD5).
///
/// This is the standard key derivation used by Shadowsocks (OpenSSL-compatible):
/// ```text
/// D_i = MD5(D_{i-1} || password)
/// key = D_1 || D_2 || ... (truncated to key_size)
/// ```
pub fn derive_psk(password: &str, key_size: usize) -> Vec<u8> {
    use md5::Digest;

    let mut result = Vec::with_capacity(key_size);
    let mut prev_hash = Vec::new();

    while result.len() < key_size {
        let mut hasher = md5::Md5::new();
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
///
/// Per the Shadowsocks AEAD spec, this uses HMAC-SHA1 for both the extract
/// and expand phases of HKDF (RFC 5869).
pub fn derive_subkey(psk: &[u8], salt: &[u8], key_len: usize) -> Vec<u8> {
    use hmac::Hmac;
    use sha1::Sha1;

    type HmacSha1 = Hmac<Sha1>;

    // HKDF Extract: PRK = HMAC-SHA1(salt, IKM)
    let mut extract_mac =
        <HmacSha1 as HmacMacTrait>::new_from_slice(salt).expect("HMAC key length valid");
    extract_mac.update(psk);
    let prk = extract_mac.finalize().into_bytes();

    // HKDF Expand: OKM = T(1) || T(2) || ...
    let info = b"ss-subkey";
    let mut okm = Vec::with_capacity(key_len);
    let mut t = Vec::new();
    let mut counter = 1u8;

    while okm.len() < key_len {
        let mut expand_mac =
            <HmacSha1 as HmacMacTrait>::new_from_slice(&prk).expect("HMAC key length valid");
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

/// Maximum Shadowsocks payload size per chunk (16KB - 1 = 0x3FFF).
pub const SS_MAX_PAYLOAD_SIZE: usize = 0x3FFF;

// ---------------------------------------------------------------------------
// AEAD encryption/decryption helpers
// ---------------------------------------------------------------------------

/// Encrypt data with the given cipher, key, and nonce.
fn ss_encrypt(
    cipher: ShadowsocksCipher,
    key: &[u8],
    nonce: &[u8; 12],
    plaintext: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    match cipher {
        ShadowsocksCipher::Aes128Gcm => {
            let c = Aes128Gcm::new_from_slice(key)
                .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;
            c.encrypt(
                AesNonce::from_slice(nonce),
                Payload {
                    msg: plaintext,
                    aad: &[],
                },
            )
            .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))
        }
        ShadowsocksCipher::Aes256Gcm => {
            let c = Aes256Gcm::new_from_slice(key)
                .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;
            c.encrypt(
                AesNonce::from_slice(nonce),
                Payload {
                    msg: plaintext,
                    aad: &[],
                },
            )
            .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))
        }
        ShadowsocksCipher::ChaCha20IetfPoly1305 => {
            let c = ChaCha20Poly1305::new_from_slice(key)
                .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;
            c.encrypt(
                ChaChaNonce::from_slice(nonce),
                Payload {
                    msg: plaintext,
                    aad: &[],
                },
            )
            .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))
        }
    }
}

/// Decrypt data with the given cipher, key, and nonce.
fn ss_decrypt(
    cipher: ShadowsocksCipher,
    key: &[u8],
    nonce: &[u8; 12],
    ciphertext: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    match cipher {
        ShadowsocksCipher::Aes128Gcm => {
            let c = Aes128Gcm::new_from_slice(key)
                .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))?;
            c.decrypt(
                AesNonce::from_slice(nonce),
                Payload {
                    msg: ciphertext,
                    aad: &[],
                },
            )
            .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))
        }
        ShadowsocksCipher::Aes256Gcm => {
            let c = Aes256Gcm::new_from_slice(key)
                .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))?;
            c.decrypt(
                AesNonce::from_slice(nonce),
                Payload {
                    msg: ciphertext,
                    aad: &[],
                },
            )
            .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))
        }
        ShadowsocksCipher::ChaCha20IetfPoly1305 => {
            let c = ChaCha20Poly1305::new_from_slice(key)
                .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))?;
            c.decrypt(
                ChaChaNonce::from_slice(nonce),
                Payload {
                    msg: ciphertext,
                    aad: &[],
                },
            )
            .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))
        }
    }
}

// ---------------------------------------------------------------------------
// TCP Stream Cipher
// ---------------------------------------------------------------------------

/// Shadowsocks TCP AEAD stream cipher state.
///
/// Manages the per-session subkey and incrementing nonce for TCP relay.
/// Each chunk operation uses two nonce increments: one for length, one for payload.
pub struct SsTcpCipher {
    cipher: ShadowsocksCipher,
    subkey: Vec<u8>,
    nonce: [u8; 12],
}

impl SsTcpCipher {
    /// Create from a PSK and salt. Derives the per-session subkey via HKDF-SHA1.
    pub fn new(cipher: ShadowsocksCipher, psk: &[u8], salt: &[u8]) -> Self {
        let subkey = derive_subkey(psk, salt, cipher.key_size());
        Self {
            cipher,
            subkey,
            nonce: [0u8; 12],
        }
    }

    /// Encrypt a single TCP chunk: [enc_length:2+tag][enc_payload:var+tag].
    ///
    /// The nonce is incremented twice: once for the length, once for the payload.
    pub fn encrypt_chunk(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
        let payload_len = plaintext.len();
        if payload_len > SS_MAX_PAYLOAD_SIZE {
            return Err(CryptoError::EncryptionFailed(format!(
                "Shadowsocks payload too large: {} > {}",
                payload_len, SS_MAX_PAYLOAD_SIZE
            )));
        }

        // Encrypt length (2 bytes, big-endian)
        let len_bytes = (payload_len as u16).to_be_bytes();
        let enc_len = ss_encrypt(self.cipher, &self.subkey, &self.nonce, &len_bytes)?;
        increment_nonce(&mut self.nonce);

        // Encrypt payload
        let enc_payload = ss_encrypt(self.cipher, &self.subkey, &self.nonce, plaintext)?;
        increment_nonce(&mut self.nonce);

        let mut result = Vec::with_capacity(enc_len.len() + enc_payload.len());
        result.extend_from_slice(&enc_len);
        result.extend_from_slice(&enc_payload);
        Ok(result)
    }

    /// Decrypt the length portion of a TCP chunk.
    /// Returns the plaintext payload length.
    pub fn decrypt_length(&mut self, encrypted_length: &[u8]) -> Result<u16, CryptoError> {
        let plaintext = ss_decrypt(self.cipher, &self.subkey, &self.nonce, encrypted_length)?;
        increment_nonce(&mut self.nonce);

        if plaintext.len() < 2 {
            return Err(CryptoError::DecryptionFailed(
                "Shadowsocks length plaintext too short".into(),
            ));
        }
        let len = u16::from_be_bytes([plaintext[0], plaintext[1]]);
        if len as usize > SS_MAX_PAYLOAD_SIZE {
            return Err(CryptoError::DecryptionFailed(format!(
                "Shadowsocks chunk too large: {} > {}",
                len, SS_MAX_PAYLOAD_SIZE
            )));
        }
        Ok(len)
    }

    /// Decrypt the payload portion of a TCP chunk.
    pub fn decrypt_payload(&mut self, encrypted_payload: &[u8]) -> Result<Vec<u8>, CryptoError> {
        let plaintext = ss_decrypt(self.cipher, &self.subkey, &self.nonce, encrypted_payload)?;
        increment_nonce(&mut self.nonce);
        Ok(plaintext)
    }

    /// Size of the encrypted length field: 2 + tag_size.
    pub fn length_overhead(&self) -> usize {
        2 + self.cipher.tag_size()
    }

    /// Size of the tag on each payload: tag_size.
    pub fn payload_overhead(&self) -> usize {
        self.cipher.tag_size()
    }
}

// ---------------------------------------------------------------------------
// UDP relay
// ---------------------------------------------------------------------------

/// Encrypt a UDP packet using Shadowsocks AEAD format.
///
/// Format: [salt][encrypted_payload + tag]
/// Nonce is all zeros for UDP.
pub fn encrypt_udp_packet(
    cipher: ShadowsocksCipher,
    psk: &[u8],
    plaintext: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    use rand::RngCore;

    let salt_size = cipher.salt_size();
    let mut salt = vec![0u8; salt_size];
    rand::thread_rng().fill_bytes(&mut salt);

    let subkey = derive_subkey(psk, &salt, cipher.key_size());
    let nonce = [0u8; 12]; // Zero nonce for UDP

    let encrypted = ss_encrypt(cipher, &subkey, &nonce, plaintext)?;

    let mut result = Vec::with_capacity(salt_size + encrypted.len());
    result.extend_from_slice(&salt);
    result.extend_from_slice(&encrypted);
    Ok(result)
}

/// Decrypt a UDP packet using Shadowsocks AEAD format.
///
/// Format: [salt][encrypted_payload + tag]
pub fn decrypt_udp_packet(
    cipher: ShadowsocksCipher,
    psk: &[u8],
    packet: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let salt_size = cipher.salt_size();
    if packet.len() < salt_size + cipher.tag_size() {
        return Err(CryptoError::DecryptionFailed(
            "Shadowsocks UDP packet too short".into(),
        ));
    }

    let salt = &packet[..salt_size];
    let encrypted = &packet[salt_size..];

    let subkey = derive_subkey(psk, salt, cipher.key_size());
    let nonce = [0u8; 12]; // Zero nonce for UDP

    ss_decrypt(cipher, &subkey, &nonce, encrypted)
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

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

/// Parse a Shadowsocks UDP request payload.
///
/// The decrypted UDP payload contains:
/// ```text
/// [addr_type:1][addr:var][port:2][payload...]
/// ```
pub fn parse_ss_udp_request(data: &[u8]) -> Result<CompatRequest, ProtocolError> {
    if data.is_empty() {
        return Err(ProtocolError::InvalidFrame(
            "Shadowsocks UDP request is empty".into(),
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
        command: CompatCommand::UdpAssociate,
        destination,
        initial_payload,
    })
}

/// Perform a full Shadowsocks AEAD TCP server-side decode of the first chunk.
///
/// Input: raw bytes from the client starting with the salt.
/// Returns: parsed request, SsTcpCipher for subsequent chunks, and bytes consumed.
pub fn decode_ss_tcp_request(
    data: &[u8],
    config: &ShadowsocksConfig,
) -> Result<(CompatRequest, SsTcpCipher, usize), ProtocolError> {
    let cipher = config.method;
    let salt_size = cipher.salt_size();
    let tag_size = cipher.tag_size();
    let len_overhead = 2 + tag_size;

    // Minimum: salt + length_chunk + at least 1 byte payload + tag
    let min_size = salt_size + len_overhead + 1 + tag_size;
    if data.len() < min_size {
        return Err(ProtocolError::InvalidFrame(format!(
            "Shadowsocks stream too short: {} < {}",
            data.len(),
            min_size
        )));
    }

    let salt = &data[..salt_size];

    // Create cipher for decryption
    let mut tcp_cipher = SsTcpCipher::new(cipher, &config.psk, salt);

    // Decrypt length
    let length_end = salt_size + len_overhead;
    let payload_len = tcp_cipher
        .decrypt_length(&data[salt_size..length_end])
        .map_err(|e| ProtocolError::HandshakeFailed(format!("SS length decrypt: {}", e)))?
        as usize;

    // Decrypt payload
    let payload_enc_end = length_end + payload_len + tag_size;
    if data.len() < payload_enc_end {
        return Err(ProtocolError::InvalidFrame(format!(
            "Shadowsocks first chunk truncated: {} < {}",
            data.len(),
            payload_enc_end
        )));
    }

    let payload = tcp_cipher
        .decrypt_payload(&data[length_end..payload_enc_end])
        .map_err(|e| ProtocolError::HandshakeFailed(format!("SS payload decrypt: {}", e)))?;

    // Parse the request from the decrypted payload
    let request = parse_ss_request(&payload)?;

    Ok((request, tcp_cipher, payload_enc_end))
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

/// Build a Shadowsocks AEAD stream header for outbound connections.
///
/// Generates a random salt and returns it.
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
        assert_eq!(psk, derive_psk("test-password", 32));
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
        assert_eq!(subkey, derive_subkey(&psk, &salt, 32));
        let salt2 = vec![0x02u8; 32];
        assert_ne!(subkey, derive_subkey(&psk, &salt2, 32));
    }

    #[test]
    fn test_increment_nonce() {
        let mut nonce = [0u8; 12];
        increment_nonce(&mut nonce);
        assert_eq!(nonce[0], 1);
        assert_eq!(nonce[1], 0);

        nonce[0] = 0xFF;
        increment_nonce(&mut nonce);
        assert_eq!(nonce[0], 0);
        assert_eq!(nonce[1], 1);
    }

    #[test]
    fn test_increment_nonce_multi_overflow() {
        let mut nonce = [0xFF; 12];
        increment_nonce(&mut nonce);
        assert_eq!(nonce, [0u8; 12]);
    }

    #[test]
    fn test_tcp_chunk_roundtrip_aes128() {
        let psk = derive_psk("test-password", 16);
        let salt = vec![0xAA; 16];
        let plaintext = b"Hello, Shadowsocks!";

        let mut enc = SsTcpCipher::new(ShadowsocksCipher::Aes128Gcm, &psk, &salt);
        let chunk = enc.encrypt_chunk(plaintext).unwrap();

        let mut dec = SsTcpCipher::new(ShadowsocksCipher::Aes128Gcm, &psk, &salt);
        let len_overhead = dec.length_overhead();
        let payload_len = dec.decrypt_length(&chunk[..len_overhead]).unwrap() as usize;
        let payload_tag_size = dec.cipher.tag_size();
        let decrypted = dec
            .decrypt_payload(&chunk[len_overhead..len_overhead + payload_len + payload_tag_size])
            .unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_tcp_chunk_roundtrip_aes256() {
        let psk = derive_psk("test-password", 32);
        let salt = vec![0xBB; 32];
        let plaintext = b"AES-256 test data";

        let mut enc = SsTcpCipher::new(ShadowsocksCipher::Aes256Gcm, &psk, &salt);
        let chunk = enc.encrypt_chunk(plaintext).unwrap();

        let mut dec = SsTcpCipher::new(ShadowsocksCipher::Aes256Gcm, &psk, &salt);
        let len_overhead = dec.length_overhead();
        let payload_len = dec.decrypt_length(&chunk[..len_overhead]).unwrap() as usize;
        let payload_tag_size = dec.cipher.tag_size();
        let decrypted = dec
            .decrypt_payload(&chunk[len_overhead..len_overhead + payload_len + payload_tag_size])
            .unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_tcp_chunk_roundtrip_chacha20() {
        let psk = derive_psk("test-password", 32);
        let salt = vec![0xCC; 32];
        let plaintext = b"ChaCha20 test";

        let mut enc = SsTcpCipher::new(ShadowsocksCipher::ChaCha20IetfPoly1305, &psk, &salt);
        let chunk = enc.encrypt_chunk(plaintext).unwrap();

        let mut dec = SsTcpCipher::new(ShadowsocksCipher::ChaCha20IetfPoly1305, &psk, &salt);
        let len_overhead = dec.length_overhead();
        let payload_len = dec.decrypt_length(&chunk[..len_overhead]).unwrap() as usize;
        let payload_tag_size = dec.cipher.tag_size();
        let decrypted = dec
            .decrypt_payload(&chunk[len_overhead..len_overhead + payload_len + payload_tag_size])
            .unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_tcp_multiple_chunks() {
        let psk = derive_psk("multi-chunk-test", 32);
        let salt = vec![0xDD; 32];

        let chunks_data = [b"first chunk".to_vec(), b"second chunk".to_vec()];

        let mut enc = SsTcpCipher::new(ShadowsocksCipher::Aes256Gcm, &psk, &salt);
        let encrypted: Vec<Vec<u8>> = chunks_data
            .iter()
            .map(|d| enc.encrypt_chunk(d).unwrap())
            .collect();

        let mut dec = SsTcpCipher::new(ShadowsocksCipher::Aes256Gcm, &psk, &salt);
        for (i, enc_chunk) in encrypted.iter().enumerate() {
            let len_overhead = dec.length_overhead();
            let payload_len = dec.decrypt_length(&enc_chunk[..len_overhead]).unwrap() as usize;
            let tag = dec.cipher.tag_size();
            let decrypted = dec
                .decrypt_payload(&enc_chunk[len_overhead..len_overhead + payload_len + tag])
                .unwrap();
            assert_eq!(decrypted, chunks_data[i]);
        }
    }

    #[test]
    fn test_tcp_max_payload_enforcement() {
        let psk = derive_psk("test", 32);
        let salt = vec![0xEE; 32];
        let too_large = vec![0u8; SS_MAX_PAYLOAD_SIZE + 1];

        let mut enc = SsTcpCipher::new(ShadowsocksCipher::Aes256Gcm, &psk, &salt);
        assert!(enc.encrypt_chunk(&too_large).is_err());
    }

    #[test]
    fn test_udp_packet_roundtrip_aes256() {
        let psk = derive_psk("udp-test", 32);
        let plaintext = b"UDP payload data";

        let packet = encrypt_udp_packet(ShadowsocksCipher::Aes256Gcm, &psk, plaintext).unwrap();
        let decrypted = decrypt_udp_packet(ShadowsocksCipher::Aes256Gcm, &psk, &packet).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_udp_packet_roundtrip_aes128() {
        let psk = derive_psk("udp-128", 16);
        let plaintext = b"AES-128 UDP";

        let packet = encrypt_udp_packet(ShadowsocksCipher::Aes128Gcm, &psk, plaintext).unwrap();
        let decrypted = decrypt_udp_packet(ShadowsocksCipher::Aes128Gcm, &psk, &packet).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_udp_packet_roundtrip_chacha20() {
        let psk = derive_psk("udp-chacha", 32);
        let plaintext = b"ChaCha20 UDP";

        let packet =
            encrypt_udp_packet(ShadowsocksCipher::ChaCha20IetfPoly1305, &psk, plaintext).unwrap();
        let decrypted =
            decrypt_udp_packet(ShadowsocksCipher::ChaCha20IetfPoly1305, &psk, &packet).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_udp_wrong_psk_fails() {
        let psk1 = derive_psk("correct", 32);
        let psk2 = derive_psk("wrong", 32);
        let plaintext = b"secret";

        let packet = encrypt_udp_packet(ShadowsocksCipher::Aes256Gcm, &psk1, plaintext).unwrap();
        assert!(decrypt_udp_packet(ShadowsocksCipher::Aes256Gcm, &psk2, &packet).is_err());
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
    fn test_decode_ss_tcp_request_full() {
        let config = ShadowsocksConfig::new(ShadowsocksCipher::Aes256Gcm, "test-password");

        // Build a valid SS TCP stream: salt + encrypted(address+payload)
        let salt = build_stream_header(ShadowsocksCipher::Aes256Gcm);
        let mut enc = SsTcpCipher::new(ShadowsocksCipher::Aes256Gcm, &config.psk, &salt);

        // Build address payload: domain + port
        let mut addr_payload = vec![0x03, 11];
        addr_payload.extend_from_slice(b"example.com");
        addr_payload.extend_from_slice(&443u16.to_be_bytes());
        addr_payload.extend_from_slice(b"initial data");

        let chunk = enc.encrypt_chunk(&addr_payload).unwrap();

        let mut wire = Vec::new();
        wire.extend_from_slice(&salt);
        wire.extend_from_slice(&chunk);

        let (request, _cipher, consumed) = decode_ss_tcp_request(&wire, &config).unwrap();
        assert_eq!(request.protocol, CompatProtocol::Shadowsocks);
        assert_eq!(request.destination.port, 443);
        assert_eq!(request.initial_payload, b"initial data");
        assert_eq!(consumed, wire.len());
    }

    #[test]
    fn test_shadowsocks_config_new() {
        let config = ShadowsocksConfig::new(ShadowsocksCipher::Aes256Gcm, "my-password");
        assert_eq!(config.method, ShadowsocksCipher::Aes256Gcm);
        assert_eq!(config.psk.len(), 32);
        assert!(config.udp_enabled);
    }

    #[test]
    fn test_shadowsocks_config_with_udp() {
        let config = ShadowsocksConfig::with_udp(ShadowsocksCipher::Aes128Gcm, "pw", false);
        assert!(!config.udp_enabled);
    }

    #[test]
    fn test_build_stream_header() {
        let salt = build_stream_header(ShadowsocksCipher::Aes256Gcm);
        assert_eq!(salt.len(), 32);
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
