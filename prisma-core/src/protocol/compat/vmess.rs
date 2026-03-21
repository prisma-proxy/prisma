//! VMess protocol implementation (AEAD header format, v2fly/xray compatible).
//!
//! VMess uses UUID-based authentication with timestamp-based header encryption.
//! This module implements the modern AEAD variant used by v2fly/xray-core.
//!
//! ## Wire Format (AEAD)
//!
//! ```text
//! Client -> Server:
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
//!
//! ## KDF
//!
//! VMess AEAD uses HMAC-SHA256 chained KDF with base key "VMess AEAD KDF".
//! The KDF accepts multiple path components that are applied sequentially.
//!
//! ## Data Transfer
//!
//! Data is sent as length-prefixed encrypted chunks:
//! ```text
//! [encrypted_length:2+tag][encrypted_payload:var+tag][padding:var]
//! ```
//! Length masking with Shake128 when Opt(M) is set.

use std::time::{SystemTime, UNIX_EPOCH};

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes128Gcm, Nonce as AesNonce};
use chacha20poly1305::{ChaCha20Poly1305, Nonce as ChaChaNonce};
use hmac::{Hmac, Mac as HmacMac};
use sha2::{Digest as Sha2Digest, Sha256};
use uuid::Uuid;

use crate::error::{CryptoError, ProtocolError};
use crate::types::ProxyDestination;

use super::{CompatCommand, CompatRequest};

type HmacSha256 = Hmac<Sha256>;

/// VMess protocol version (AEAD).
pub const VMESS_VERSION: u8 = 1;

/// Maximum VMess data chunk payload size (2^14 = 16384 bytes).
pub const VMESS_MAX_CHUNK_SIZE: usize = 1 << 14;

/// VMess AEAD tag size (16 bytes for all ciphers).
pub const VMESS_TAG_SIZE: usize = 16;

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
    /// Zero encryption (no overhead)
    Zero = 0x06,
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
            0x06 => Some(VMessSecurity::Zero),
            _ => None,
        }
    }

    /// Whether this security type is considered insecure and should be rejected
    /// when `disable_insecure_encryption` is set.
    pub fn is_insecure(&self) -> bool {
        matches!(self, VMessSecurity::Aes128Cfb | VMessSecurity::None)
    }
}

/// VMess option flags.
pub const VMESS_OPT_CHUNK_STREAM: u8 = 0x01; // S: standard format
pub const VMESS_OPT_REUSE: u8 = 0x02; // R: connection reuse
pub const VMESS_OPT_CHUNK_MASKING: u8 = 0x04; // M: metadata obfuscation (Shake length masking)
pub const VMESS_OPT_GLOBAL_PADDING: u8 = 0x08; // P: global padding
pub const VMESS_OPT_AUTH_LENGTH: u8 = 0x10; // A: authenticated length

/// VMess AEAD KDF base key.
const VMESS_KDF_SALT_CONST: &[u8] = b"VMess AEAD KDF";

/// VMess AEAD KDF path components for different key derivations.
const KDF_SALT_VMESS_AEAD_RESP_HEADER_LEN_KEY: &[u8] = b"AEAD Resp Header Len Key";
const KDF_SALT_VMESS_AEAD_RESP_HEADER_LEN_IV: &[u8] = b"AEAD Resp Header Len IV";
const KDF_SALT_VMESS_AEAD_RESP_HEADER_PAYLOAD_KEY: &[u8] = b"AEAD Resp Header Key";
const KDF_SALT_VMESS_AEAD_RESP_HEADER_PAYLOAD_IV: &[u8] = b"AEAD Resp Header IV";
const KDF_SALT_VMESS_HEADER_PAYLOAD_AEAD_KEY: &[u8] = b"VMess Header AEAD Key";
const KDF_SALT_VMESS_HEADER_PAYLOAD_AEAD_IV: &[u8] = b"VMess Header AEAD Nonce";
const KDF_SALT_VMESS_HEADER_PAYLOAD_LENGTH_AEAD_KEY: &[u8] = b"VMess Header AEAD Key_Length";
const KDF_SALT_VMESS_HEADER_PAYLOAD_LENGTH_AEAD_IV: &[u8] = b"VMess Header AEAD Nonce_Length";

/// VMess client configuration.
#[derive(Debug, Clone)]
pub struct VMessClient {
    pub uuid: Uuid,
    pub alter_id: u16,
}

// ---------------------------------------------------------------------------
// KDF (HMAC-SHA256 chain)
// ---------------------------------------------------------------------------

/// VMess AEAD KDF: HMAC-SHA256 chain.
///
/// Starting from the base key "VMess AEAD KDF", each path component is applied
/// as: `key = HMAC-SHA256(path_component, previous_key)`.
/// The final key is `HMAC-SHA256(final_key, data)`.
pub fn vmess_kdf(data: &[u8], paths: &[&[u8]]) -> [u8; 32] {
    // Start with the base key
    let mut key = VMESS_KDF_SALT_CONST.to_vec();

    // Apply path components
    for path in paths {
        let mut mac =
            <HmacSha256 as HmacMac>::new_from_slice(path).expect("HMAC key length is valid");
        mac.update(&key);
        let result = mac.finalize().into_bytes();
        key = result.to_vec();
    }

    // Final HMAC with the accumulated key
    let mut mac = <HmacSha256 as HmacMac>::new_from_slice(&key).expect("HMAC key length is valid");
    mac.update(data);
    let result = mac.finalize().into_bytes();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

/// Derive the 16-byte key and 12-byte IV/nonce for a VMess AEAD operation.
fn vmess_kdf16(data: &[u8], paths: &[&[u8]]) -> [u8; 16] {
    let full = vmess_kdf(data, paths);
    let mut out = [0u8; 16];
    out.copy_from_slice(&full[..16]);
    out
}

// ---------------------------------------------------------------------------
// Command key derivation
// ---------------------------------------------------------------------------

/// Derive the VMess command key from a UUID.
///
/// Per the VMess/v2fly spec:
/// `cmd_key = MD5(uuid_bytes + b"c48619fe-8f02-49e0-b9e9-edf763e17e21")`
pub fn derive_cmd_key(uuid: &Uuid) -> [u8; 16] {
    use md5::Digest;

    let magic = b"c48619fe-8f02-49e0-b9e9-edf763e17e21";
    let mut hasher = md5::Md5::new();
    hasher.update(uuid.as_bytes());
    hasher.update(magic);
    let result = hasher.finalize();
    let mut key = [0u8; 16];
    key.copy_from_slice(&result);
    key
}

// ---------------------------------------------------------------------------
// EAuID (auth_id) generation and verification
// ---------------------------------------------------------------------------

/// Compute the VMess AEAD auth_id from the command key and timestamp.
///
/// `auth_id = HMAC-SHA256(cmd_key, timestamp_be8)[:16]`
pub fn compute_auth_id(cmd_key: &[u8; 16], timestamp: u64) -> [u8; 16] {
    let mut mac =
        <HmacSha256 as HmacMac>::new_from_slice(cmd_key).expect("HMAC key length is valid");
    mac.update(&timestamp.to_be_bytes());
    let result = mac.finalize().into_bytes();
    let mut auth_id = [0u8; 16];
    auth_id.copy_from_slice(&result[..16]);
    auth_id
}

/// Verify a VMess auth_id against a set of authorized clients.
///
/// Checks the timestamp window and matches against known UUIDs.
/// Always iterates all clients and all timestamps to prevent timing
/// side-channel leaks that could reveal which client matched or how
/// many clients are configured.
///
/// Returns `(matched_uuid, cmd_key, matched_timestamp)` on success.
pub fn verify_auth_id(
    auth_id: &[u8; 16],
    clients: &[VMessClient],
    timestamp_tolerance_secs: u64,
) -> Option<(Uuid, [u8; 16], u64)> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let mut matched: Option<(Uuid, [u8; 16], u64)> = None;

    for client in clients {
        let cmd_key = derive_cmd_key(&client.uuid);
        let start = now.saturating_sub(timestamp_tolerance_secs);
        let end = now + timestamp_tolerance_secs;
        for ts in start..=end {
            let expected = compute_auth_id(&cmd_key, ts);
            if crate::util::ct_eq_slice(auth_id, &expected) {
                matched = Some((client.uuid, cmd_key, ts));
            }
        }
    }
    matched
}

// ---------------------------------------------------------------------------
// AEAD header encryption/decryption
// ---------------------------------------------------------------------------

/// Decrypt the VMess AEAD header length (2 bytes encrypted with AES-128-GCM).
///
/// The length is encrypted as: AES-128-GCM(key, nonce, aad=auth_id, plaintext=length_be2)
pub fn decrypt_header_length(
    cmd_key: &[u8; 16],
    auth_id: &[u8; 16],
    encrypted_length_and_tag: &[u8], // 2 + 16 = 18 bytes
) -> Result<u16, CryptoError> {
    if encrypted_length_and_tag.len() < 2 + VMESS_TAG_SIZE {
        return Err(CryptoError::DecryptionFailed(
            "VMess header length too short".into(),
        ));
    }

    // Derive key and nonce
    let key = vmess_kdf16(
        cmd_key,
        &[KDF_SALT_VMESS_HEADER_PAYLOAD_LENGTH_AEAD_KEY, auth_id],
    );
    let nonce_full = vmess_kdf16(
        cmd_key,
        &[KDF_SALT_VMESS_HEADER_PAYLOAD_LENGTH_AEAD_IV, auth_id],
    );
    let mut nonce = [0u8; 12];
    nonce.copy_from_slice(&nonce_full[..12]);

    // Decrypt with AES-128-GCM
    let cipher = Aes128Gcm::new_from_slice(&key)
        .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))?;
    let aes_nonce = AesNonce::from_slice(&nonce);
    let plaintext = cipher
        .decrypt(
            aes_nonce,
            Payload {
                msg: encrypted_length_and_tag,
                aad: auth_id,
            },
        )
        .map_err(|e| {
            CryptoError::DecryptionFailed(format!("VMess header length decrypt: {}", e))
        })?;

    if plaintext.len() < 2 {
        return Err(CryptoError::DecryptionFailed(
            "VMess header length plaintext too short".into(),
        ));
    }

    Ok(u16::from_be_bytes([plaintext[0], plaintext[1]]))
}

/// Encrypt the VMess AEAD header length (2 bytes encrypted with AES-128-GCM).
pub fn encrypt_header_length(
    cmd_key: &[u8; 16],
    auth_id: &[u8; 16],
    header_length: u16,
) -> Result<Vec<u8>, CryptoError> {
    let key = vmess_kdf16(
        cmd_key,
        &[KDF_SALT_VMESS_HEADER_PAYLOAD_LENGTH_AEAD_KEY, auth_id],
    );
    let nonce_full = vmess_kdf16(
        cmd_key,
        &[KDF_SALT_VMESS_HEADER_PAYLOAD_LENGTH_AEAD_IV, auth_id],
    );
    let mut nonce = [0u8; 12];
    nonce.copy_from_slice(&nonce_full[..12]);

    let cipher = Aes128Gcm::new_from_slice(&key)
        .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;
    let aes_nonce = AesNonce::from_slice(&nonce);

    cipher
        .encrypt(
            aes_nonce,
            Payload {
                msg: &header_length.to_be_bytes(),
                aad: auth_id,
            },
        )
        .map_err(|e| CryptoError::EncryptionFailed(format!("VMess header length encrypt: {}", e)))
}

/// Decrypt the VMess AEAD header payload.
pub fn decrypt_header_payload(
    cmd_key: &[u8; 16],
    auth_id: &[u8; 16],
    encrypted_header: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let key = vmess_kdf16(cmd_key, &[KDF_SALT_VMESS_HEADER_PAYLOAD_AEAD_KEY, auth_id]);
    let nonce_full = vmess_kdf16(cmd_key, &[KDF_SALT_VMESS_HEADER_PAYLOAD_AEAD_IV, auth_id]);
    let mut nonce = [0u8; 12];
    nonce.copy_from_slice(&nonce_full[..12]);

    let cipher = Aes128Gcm::new_from_slice(&key)
        .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))?;
    let aes_nonce = AesNonce::from_slice(&nonce);

    cipher
        .decrypt(
            aes_nonce,
            Payload {
                msg: encrypted_header,
                aad: auth_id,
            },
        )
        .map_err(|e| CryptoError::DecryptionFailed(format!("VMess header decrypt: {}", e)))
}

/// Encrypt the VMess AEAD header payload.
pub fn encrypt_header_payload(
    cmd_key: &[u8; 16],
    auth_id: &[u8; 16],
    header: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let key = vmess_kdf16(cmd_key, &[KDF_SALT_VMESS_HEADER_PAYLOAD_AEAD_KEY, auth_id]);
    let nonce_full = vmess_kdf16(cmd_key, &[KDF_SALT_VMESS_HEADER_PAYLOAD_AEAD_IV, auth_id]);
    let mut nonce = [0u8; 12];
    nonce.copy_from_slice(&nonce_full[..12]);

    let cipher = Aes128Gcm::new_from_slice(&key)
        .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;
    let aes_nonce = AesNonce::from_slice(&nonce);

    cipher
        .encrypt(
            aes_nonce,
            Payload {
                msg: header,
                aad: auth_id,
            },
        )
        .map_err(|e| CryptoError::EncryptionFailed(format!("VMess header encrypt: {}", e)))
}

// ---------------------------------------------------------------------------
// Response key/IV derivation
// ---------------------------------------------------------------------------

/// Derive the VMess response key from the request data key.
///
/// `response_key = SHA256(request_key)[:16]`
pub fn derive_response_key(request_key: &[u8; 16]) -> [u8; 16] {
    let hash = Sha256::digest(request_key);
    let mut key = [0u8; 16];
    key.copy_from_slice(&hash[..16]);
    key
}

/// Derive the VMess response IV from the request data IV.
///
/// `response_iv = SHA256(request_iv)[:16]`
pub fn derive_response_iv(request_iv: &[u8; 16]) -> [u8; 16] {
    let hash = Sha256::digest(request_iv);
    let mut iv = [0u8; 16];
    iv.copy_from_slice(&hash[..16]);
    iv
}

// ---------------------------------------------------------------------------
// Response header encryption/decryption (AES-128-GCM)
// ---------------------------------------------------------------------------

/// Encrypt the VMess server response header using AES-128-GCM with derived key/IV.
pub fn encrypt_response_header(
    response_key: &[u8; 16],
    response_iv: &[u8; 16],
    header: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    // Derive AEAD key and nonce for response header length
    let len_key = vmess_kdf16(response_key, &[KDF_SALT_VMESS_AEAD_RESP_HEADER_LEN_KEY]);
    let len_iv_full = vmess_kdf16(response_iv, &[KDF_SALT_VMESS_AEAD_RESP_HEADER_LEN_IV]);
    let mut len_nonce = [0u8; 12];
    len_nonce.copy_from_slice(&len_iv_full[..12]);

    let len_cipher = Aes128Gcm::new_from_slice(&len_key)
        .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;

    let header_len = (header.len() as u16).to_be_bytes();
    let encrypted_len = len_cipher
        .encrypt(
            AesNonce::from_slice(&len_nonce),
            Payload {
                msg: &header_len,
                aad: &[],
            },
        )
        .map_err(|e| {
            CryptoError::EncryptionFailed(format!("VMess response header len encrypt: {}", e))
        })?;

    // Encrypt the header payload
    let payload_key = vmess_kdf16(response_key, &[KDF_SALT_VMESS_AEAD_RESP_HEADER_PAYLOAD_KEY]);
    let payload_iv_full = vmess_kdf16(response_iv, &[KDF_SALT_VMESS_AEAD_RESP_HEADER_PAYLOAD_IV]);
    let mut payload_nonce = [0u8; 12];
    payload_nonce.copy_from_slice(&payload_iv_full[..12]);

    let payload_cipher = Aes128Gcm::new_from_slice(&payload_key)
        .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;

    let encrypted_header = payload_cipher
        .encrypt(
            AesNonce::from_slice(&payload_nonce),
            Payload {
                msg: header,
                aad: &[],
            },
        )
        .map_err(|e| {
            CryptoError::EncryptionFailed(format!("VMess response header encrypt: {}", e))
        })?;

    let mut result = Vec::with_capacity(encrypted_len.len() + encrypted_header.len());
    result.extend_from_slice(&encrypted_len);
    result.extend_from_slice(&encrypted_header);
    Ok(result)
}

/// Decrypt the VMess server response header using AES-128-GCM.
pub fn decrypt_response_header(
    response_key: &[u8; 16],
    response_iv: &[u8; 16],
    data: &[u8],
) -> Result<(Vec<u8>, usize), CryptoError> {
    let len_encrypted_size = 2 + VMESS_TAG_SIZE; // 18 bytes
    if data.len() < len_encrypted_size {
        return Err(CryptoError::DecryptionFailed(
            "VMess response header too short for length".into(),
        ));
    }

    // Decrypt length
    let len_key = vmess_kdf16(response_key, &[KDF_SALT_VMESS_AEAD_RESP_HEADER_LEN_KEY]);
    let len_iv_full = vmess_kdf16(response_iv, &[KDF_SALT_VMESS_AEAD_RESP_HEADER_LEN_IV]);
    let mut len_nonce = [0u8; 12];
    len_nonce.copy_from_slice(&len_iv_full[..12]);

    let len_cipher = Aes128Gcm::new_from_slice(&len_key)
        .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))?;

    let len_plaintext = len_cipher
        .decrypt(
            AesNonce::from_slice(&len_nonce),
            Payload {
                msg: &data[..len_encrypted_size],
                aad: &[],
            },
        )
        .map_err(|e| {
            CryptoError::DecryptionFailed(format!("VMess response header len decrypt: {}", e))
        })?;

    let header_len = u16::from_be_bytes([len_plaintext[0], len_plaintext[1]]) as usize;
    let header_encrypted_size = header_len + VMESS_TAG_SIZE;
    let total = len_encrypted_size + header_encrypted_size;

    if data.len() < total {
        return Err(CryptoError::DecryptionFailed(
            "VMess response header truncated".into(),
        ));
    }

    // Decrypt header
    let payload_key = vmess_kdf16(response_key, &[KDF_SALT_VMESS_AEAD_RESP_HEADER_PAYLOAD_KEY]);
    let payload_iv_full = vmess_kdf16(response_iv, &[KDF_SALT_VMESS_AEAD_RESP_HEADER_PAYLOAD_IV]);
    let mut payload_nonce = [0u8; 12];
    payload_nonce.copy_from_slice(&payload_iv_full[..12]);

    let payload_cipher = Aes128Gcm::new_from_slice(&payload_key)
        .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))?;

    let header = payload_cipher
        .decrypt(
            AesNonce::from_slice(&payload_nonce),
            Payload {
                msg: &data[len_encrypted_size..total],
                aad: &[],
            },
        )
        .map_err(|e| {
            CryptoError::DecryptionFailed(format!("VMess response header decrypt: {}", e))
        })?;

    Ok((header, total))
}

// ---------------------------------------------------------------------------
// Data chunk encryption/decryption
// ---------------------------------------------------------------------------

/// VMess data stream cipher state.
///
/// Handles encryption/decryption of data chunks with incrementing nonces.
pub struct VMessDataCipher {
    security: VMessSecurity,
    key: [u8; 16],
    iv: [u8; 16],
    nonce_counter: u16,
    option: u8,
    /// Shake128 state for length masking when Opt(M) is set.
    shake_masker: Option<ShakeLengthMasker>,
}

/// Length masking using Shake128 (for Opt(M) metadata obfuscation).
///
/// VMess uses Shake128 as a CSPRNG seeded with the IV to produce a stream
/// of 2-byte masks, one per chunk length. The mask is XORed with the length
/// before encryption to prevent observers from inferring payload sizes.
struct ShakeLengthMasker {
    /// Accumulated XOF reader from Shake128.
    reader: sha3::digest::core_api::XofReaderCoreWrapper<sha3::Shake128ReaderCore>,
}

impl ShakeLengthMasker {
    fn new(nonce_iv: &[u8; 16]) -> Self {
        use sha3::digest::{ExtendableOutput, Update};
        let mut hasher = sha3::Shake128::default();
        hasher.update(nonce_iv);
        let reader = hasher.finalize_xof();
        Self { reader }
    }

    fn next_mask(&mut self) -> u16 {
        use sha3::digest::XofReader;
        let mut buf = [0u8; 2];
        self.reader.read(&mut buf);
        u16::from_be_bytes(buf)
    }
}

impl VMessDataCipher {
    /// Create a new VMess data cipher from the parsed header.
    pub fn new(key: [u8; 16], iv: [u8; 16], security: VMessSecurity, option: u8) -> Self {
        let shake_masker = if option & VMESS_OPT_CHUNK_MASKING != 0 {
            Some(ShakeLengthMasker::new(&iv))
        } else {
            None
        };

        Self {
            security,
            key,
            iv,
            nonce_counter: 0,
            option,
            shake_masker,
        }
    }

    /// Derive the 32-byte key needed by ChaCha20-Poly1305 from the 16-byte VMess key.
    ///
    /// Per the VMess spec: `chacha_key = MD5(key) || MD5(MD5(key))`
    fn chacha20_key(&self) -> [u8; 32] {
        use md5::Digest;
        let md5_1 = md5::Md5::digest(self.key);
        let md5_2 = md5::Md5::digest(md5_1);
        let mut key32 = [0u8; 32];
        key32[..16].copy_from_slice(&md5_1);
        key32[16..].copy_from_slice(&md5_2);
        key32
    }

    /// Get the current nonce (12 bytes) and advance the counter.
    fn next_nonce(&mut self) -> [u8; 12] {
        let mut nonce = [0u8; 12];
        nonce[..2].copy_from_slice(&self.nonce_counter.to_be_bytes());
        nonce[2..12].copy_from_slice(&self.iv[2..12]);
        self.nonce_counter = self.nonce_counter.wrapping_add(1);
        nonce
    }

    /// Encrypt a data chunk. Returns the wire bytes: [enc_length:2+tag][enc_payload:+tag][padding].
    pub fn encrypt_chunk(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
        let padding_len = if self.option & VMESS_OPT_GLOBAL_PADDING != 0 {
            // Random padding 0..=15
            use rand::Rng;
            rand::thread_rng().gen_range(0..=15u16)
        } else {
            0
        };

        let payload_len = plaintext.len() as u16;
        let mut wire_length = payload_len;

        if self.option & VMESS_OPT_AUTH_LENGTH != 0 {
            wire_length = payload_len + VMESS_TAG_SIZE as u16;
        }

        // Include padding in wire length
        wire_length += padding_len;

        // Apply Shake masking if enabled
        let masked_length = if let Some(ref mut masker) = self.shake_masker {
            wire_length ^ masker.next_mask()
        } else {
            wire_length
        };

        let mut result = Vec::new();

        match self.security {
            VMessSecurity::Aes128Gcm => {
                let nonce = self.next_nonce();
                let cipher = Aes128Gcm::new_from_slice(&self.key)
                    .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;

                // Encrypt length
                let len_bytes = masked_length.to_be_bytes();
                let enc_len = cipher
                    .encrypt(
                        AesNonce::from_slice(&nonce),
                        Payload {
                            msg: &len_bytes,
                            aad: &[],
                        },
                    )
                    .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;
                result.extend_from_slice(&enc_len);

                // Encrypt payload
                let nonce = self.next_nonce();
                let enc_payload = cipher
                    .encrypt(
                        AesNonce::from_slice(&nonce),
                        Payload {
                            msg: plaintext,
                            aad: &[],
                        },
                    )
                    .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;
                result.extend_from_slice(&enc_payload);
            }
            VMessSecurity::ChaCha20Poly1305 => {
                let nonce = self.next_nonce();
                let cipher = ChaCha20Poly1305::new_from_slice(&self.chacha20_key())
                    .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;

                // Encrypt length
                let len_bytes = masked_length.to_be_bytes();
                let enc_len = cipher
                    .encrypt(
                        ChaChaNonce::from_slice(&nonce),
                        Payload {
                            msg: &len_bytes,
                            aad: &[],
                        },
                    )
                    .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;
                result.extend_from_slice(&enc_len);

                // Encrypt payload
                let nonce = self.next_nonce();
                let enc_payload = cipher
                    .encrypt(
                        ChaChaNonce::from_slice(&nonce),
                        Payload {
                            msg: plaintext,
                            aad: &[],
                        },
                    )
                    .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;
                result.extend_from_slice(&enc_payload);
            }
            VMessSecurity::None | VMessSecurity::Zero => {
                // No encryption: length + payload in cleartext
                result.extend_from_slice(&masked_length.to_be_bytes());
                result.extend_from_slice(plaintext);
            }
            _ => {
                return Err(CryptoError::EncryptionFailed(format!(
                    "unsupported VMess security type: {:?}",
                    self.security
                )));
            }
        }

        // Add padding if needed
        if padding_len > 0 {
            result.extend(std::iter::repeat_n(0u8, padding_len as usize));
        }

        Ok(result)
    }

    /// Decrypt a data chunk length. Returns the payload length (after unmasking).
    pub fn decrypt_chunk_length(
        &mut self,
        encrypted_length_data: &[u8],
    ) -> Result<u16, CryptoError> {
        let raw_length = match self.security {
            VMessSecurity::Aes128Gcm => {
                if encrypted_length_data.len() < 2 + VMESS_TAG_SIZE {
                    return Err(CryptoError::DecryptionFailed(
                        "VMess chunk length too short".into(),
                    ));
                }
                let nonce = self.next_nonce();
                let cipher = Aes128Gcm::new_from_slice(&self.key)
                    .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))?;
                let plaintext = cipher
                    .decrypt(
                        AesNonce::from_slice(&nonce),
                        Payload {
                            msg: encrypted_length_data,
                            aad: &[],
                        },
                    )
                    .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))?;
                u16::from_be_bytes([plaintext[0], plaintext[1]])
            }
            VMessSecurity::ChaCha20Poly1305 => {
                if encrypted_length_data.len() < 2 + VMESS_TAG_SIZE {
                    return Err(CryptoError::DecryptionFailed(
                        "VMess chunk length too short".into(),
                    ));
                }
                let nonce = self.next_nonce();
                let cipher = ChaCha20Poly1305::new_from_slice(&self.chacha20_key())
                    .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))?;
                let plaintext = cipher
                    .decrypt(
                        ChaChaNonce::from_slice(&nonce),
                        Payload {
                            msg: encrypted_length_data,
                            aad: &[],
                        },
                    )
                    .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))?;
                u16::from_be_bytes([plaintext[0], plaintext[1]])
            }
            VMessSecurity::None | VMessSecurity::Zero => {
                if encrypted_length_data.len() < 2 {
                    return Err(CryptoError::DecryptionFailed(
                        "VMess chunk length too short".into(),
                    ));
                }
                u16::from_be_bytes([encrypted_length_data[0], encrypted_length_data[1]])
            }
            _ => {
                return Err(CryptoError::DecryptionFailed(format!(
                    "unsupported VMess security: {:?}",
                    self.security
                )));
            }
        };

        // Unmask the length
        let unmasked = if let Some(ref mut masker) = self.shake_masker {
            raw_length ^ masker.next_mask()
        } else {
            raw_length
        };

        Ok(unmasked)
    }

    /// Decrypt a data chunk payload. Returns the plaintext.
    pub fn decrypt_chunk_payload(
        &mut self,
        encrypted_payload: &[u8],
    ) -> Result<Vec<u8>, CryptoError> {
        match self.security {
            VMessSecurity::Aes128Gcm => {
                let nonce = self.next_nonce();
                let cipher = Aes128Gcm::new_from_slice(&self.key)
                    .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))?;
                cipher
                    .decrypt(
                        AesNonce::from_slice(&nonce),
                        Payload {
                            msg: encrypted_payload,
                            aad: &[],
                        },
                    )
                    .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))
            }
            VMessSecurity::ChaCha20Poly1305 => {
                let nonce = self.next_nonce();
                let cipher = ChaCha20Poly1305::new_from_slice(&self.chacha20_key())
                    .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))?;
                cipher
                    .decrypt(
                        ChaChaNonce::from_slice(&nonce),
                        Payload {
                            msg: encrypted_payload,
                            aad: &[],
                        },
                    )
                    .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))
            }
            VMessSecurity::None | VMessSecurity::Zero => Ok(encrypted_payload.to_vec()),
            _ => Err(CryptoError::DecryptionFailed(format!(
                "unsupported VMess security: {:?}",
                self.security
            ))),
        }
    }

    /// Size of the encrypted length field in bytes.
    pub fn length_overhead(&self) -> usize {
        match self.security {
            VMessSecurity::Aes128Gcm | VMessSecurity::ChaCha20Poly1305 => 2 + VMESS_TAG_SIZE,
            _ => 2,
        }
    }

    /// Size of the authentication tag on each payload chunk.
    pub fn payload_overhead(&self) -> usize {
        match self.security {
            VMessSecurity::Aes128Gcm | VMessSecurity::ChaCha20Poly1305 => VMESS_TAG_SIZE,
            _ => 0,
        }
    }
}

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

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

/// Build a raw VMess header (before encryption).
pub fn build_vmess_header(
    data_iv: &[u8; 16],
    data_key: &[u8; 16],
    response_header: u8,
    option: u8,
    security: VMessSecurity,
    command: CompatCommand,
    dest: &ProxyDestination,
) -> Vec<u8> {
    let addr = encode_vmess_address(dest);
    // No padding for simplicity
    let padding_len: u8 = 0;
    let padding_security = (padding_len << 4) | (security as u8 & 0x0F);

    let mut header = Vec::with_capacity(41 + addr.len() + 4);
    header.push(VMESS_VERSION);
    header.extend_from_slice(data_iv);
    header.extend_from_slice(data_key);
    header.push(response_header);
    header.push(option);
    header.push(padding_security);
    header.push(0x00); // reserved
    header.push(command.to_byte());
    header.extend_from_slice(&dest.port.to_be_bytes());
    header.extend_from_slice(&addr);

    // FNV1a checksum
    let checksum = fnv1a32(&header);
    header.extend_from_slice(&checksum.to_be_bytes());

    header
}

/// Encode VMess address (addr_type + addr, without port).
fn encode_vmess_address(dest: &ProxyDestination) -> Vec<u8> {
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

/// Perform a full VMess AEAD server-side decode of the request header.
///
/// Input: raw bytes from the client starting with the 16-byte auth_id.
/// Returns: parsed header, cmd_key (for response), and bytes consumed from input.
pub fn decode_vmess_request(
    data: &[u8],
    clients: &[VMessClient],
    timestamp_tolerance_secs: u64,
    disable_insecure_encryption: bool,
) -> Result<(VMessParsedHeader, [u8; 16], usize), ProtocolError> {
    if data.len() < 16 {
        return Err(ProtocolError::InvalidFrame(
            "VMess data too short for auth_id".into(),
        ));
    }

    // 1. Extract auth_id
    let mut auth_id = [0u8; 16];
    auth_id.copy_from_slice(&data[..16]);

    // 2. Verify auth
    let (uuid, cmd_key, _ts) = verify_auth_id(&auth_id, clients, timestamp_tolerance_secs)
        .ok_or_else(|| ProtocolError::HandshakeFailed("VMess authentication failed".into()))?;

    tracing::debug!(client = %uuid, "VMess client authenticated");

    let remaining = &data[16..];

    // 3. Decrypt header length (18 bytes: 2+16 tag)
    let len_size = 2 + VMESS_TAG_SIZE;
    if remaining.len() < len_size {
        return Err(ProtocolError::InvalidFrame(
            "VMess header too short for length".into(),
        ));
    }

    let header_len = decrypt_header_length(&cmd_key, &auth_id, &remaining[..len_size])
        .map_err(|e| ProtocolError::HandshakeFailed(format!("VMess header length: {}", e)))?
        as usize;

    // 4. Decrypt header payload
    let header_enc_size = header_len + VMESS_TAG_SIZE;
    if remaining.len() < len_size + header_enc_size {
        return Err(ProtocolError::InvalidFrame(
            "VMess header payload truncated".into(),
        ));
    }

    let header_plaintext = decrypt_header_payload(
        &cmd_key,
        &auth_id,
        &remaining[len_size..len_size + header_enc_size],
    )
    .map_err(|e| ProtocolError::HandshakeFailed(format!("VMess header payload: {}", e)))?;

    // 5. Parse the decrypted header
    let parsed = parse_vmess_header(&header_plaintext)?;

    // 6. Check insecure encryption
    if disable_insecure_encryption && parsed.security.is_insecure() {
        return Err(ProtocolError::HandshakeFailed(
            "VMess: insecure encryption rejected by server policy".into(),
        ));
    }

    let consumed = 16 + len_size + header_enc_size;
    Ok((parsed, cmd_key, consumed))
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
        let result = verify_auth_id(&auth_id, &clients, 120);
        assert!(result.is_some());
        let (matched_uuid, _, _) = result.unwrap();
        assert_eq!(matched_uuid, uuid);
    }

    #[test]
    fn test_verify_auth_id_no_match() {
        let uuid = Uuid::new_v4();
        let clients = vec![VMessClient { uuid, alter_id: 0 }];
        let fake_auth = [0xFFu8; 16];
        assert!(verify_auth_id(&fake_auth, &clients, 120).is_none());
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
        assert_eq!(VMessSecurity::from_byte(0x06), Some(VMessSecurity::Zero));
        assert_eq!(VMessSecurity::from_byte(0xFF), None);
    }

    #[test]
    fn test_vmess_security_is_insecure() {
        assert!(VMessSecurity::Aes128Cfb.is_insecure());
        assert!(VMessSecurity::None.is_insecure());
        assert!(!VMessSecurity::Aes128Gcm.is_insecure());
        assert!(!VMessSecurity::ChaCha20Poly1305.is_insecure());
        assert!(!VMessSecurity::Zero.is_insecure());
    }

    #[test]
    fn test_build_response_header() {
        let resp = build_response_header(0xAB);
        assert_eq!(resp, vec![0xAB, 0x00, 0x00, 0x00]);
    }

    #[test]
    fn test_vmess_kdf_deterministic() {
        let data = b"test-data";
        let paths: &[&[u8]] = &[b"path1", b"path2"];
        let result1 = vmess_kdf(data, paths);
        let result2 = vmess_kdf(data, paths);
        assert_eq!(result1, result2);
    }

    #[test]
    fn test_vmess_kdf_different_paths() {
        let data = b"test-data";
        let result1 = vmess_kdf(data, &[b"path1"]);
        let result2 = vmess_kdf(data, &[b"path2"]);
        assert_ne!(result1, result2);
    }

    #[test]
    fn test_header_length_encrypt_decrypt_roundtrip() {
        let cmd_key = [0x42u8; 16];
        let auth_id = [0x01u8; 16];
        let original_len: u16 = 256;

        let encrypted = encrypt_header_length(&cmd_key, &auth_id, original_len).unwrap();
        let decrypted = decrypt_header_length(&cmd_key, &auth_id, &encrypted).unwrap();
        assert_eq!(decrypted, original_len);
    }

    #[test]
    fn test_header_payload_encrypt_decrypt_roundtrip() {
        let cmd_key = [0x42u8; 16];
        let auth_id = [0x01u8; 16];
        let header = b"test-header-payload-data";

        let encrypted = encrypt_header_payload(&cmd_key, &auth_id, header).unwrap();
        let decrypted = decrypt_header_payload(&cmd_key, &auth_id, &encrypted).unwrap();
        assert_eq!(decrypted, header);
    }

    #[test]
    fn test_response_key_iv_derivation() {
        let key = [0x42u8; 16];
        let iv = [0x43u8; 16];
        let resp_key = derive_response_key(&key);
        let resp_iv = derive_response_iv(&iv);
        assert_ne!(resp_key, key);
        assert_ne!(resp_iv, iv);
        assert_eq!(resp_key, derive_response_key(&key));
        assert_eq!(resp_iv, derive_response_iv(&iv));
    }

    #[test]
    fn test_response_header_encrypt_decrypt_roundtrip() {
        let key = [0x42u8; 16];
        let iv = [0x43u8; 16];
        let resp_key = derive_response_key(&key);
        let resp_iv = derive_response_iv(&iv);
        let header = build_response_header(0xAB);

        let encrypted = encrypt_response_header(&resp_key, &resp_iv, &header).unwrap();
        let (decrypted, consumed) =
            decrypt_response_header(&resp_key, &resp_iv, &encrypted).unwrap();
        assert_eq!(decrypted, header);
        assert_eq!(consumed, encrypted.len());
    }

    #[test]
    fn test_data_cipher_aes128gcm_roundtrip() {
        let key = [0x42u8; 16];
        let iv = [0x01u8; 16];
        let option = VMESS_OPT_CHUNK_STREAM;
        let plaintext = b"Hello, VMess AEAD!";

        let mut enc_cipher = VMessDataCipher::new(key, iv, VMessSecurity::Aes128Gcm, option);
        let encrypted = enc_cipher.encrypt_chunk(plaintext).unwrap();

        // Decrypt: first get length, then payload
        let mut dec_cipher = VMessDataCipher::new(key, iv, VMessSecurity::Aes128Gcm, option);
        let len_overhead = dec_cipher.length_overhead();
        let _len = dec_cipher
            .decrypt_chunk_length(&encrypted[..len_overhead])
            .unwrap();
        let decrypted = dec_cipher
            .decrypt_chunk_payload(&encrypted[len_overhead..])
            .unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_data_cipher_chacha20_roundtrip() {
        let key = [0x42u8; 16];
        let iv = [0x01u8; 16];
        let option = VMESS_OPT_CHUNK_STREAM;
        let plaintext = b"Hello, ChaCha!";

        let mut enc_cipher = VMessDataCipher::new(key, iv, VMessSecurity::ChaCha20Poly1305, option);
        let encrypted = enc_cipher.encrypt_chunk(plaintext).unwrap();

        let mut dec_cipher = VMessDataCipher::new(key, iv, VMessSecurity::ChaCha20Poly1305, option);
        let len_overhead = dec_cipher.length_overhead();
        let _len = dec_cipher
            .decrypt_chunk_length(&encrypted[..len_overhead])
            .unwrap();
        let decrypted = dec_cipher
            .decrypt_chunk_payload(&encrypted[len_overhead..])
            .unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_data_cipher_none_roundtrip() {
        let key = [0x42u8; 16];
        let iv = [0x01u8; 16];
        let option = VMESS_OPT_CHUNK_STREAM;
        let plaintext = b"No encryption!";

        let mut enc_cipher = VMessDataCipher::new(key, iv, VMessSecurity::None, option);
        let encrypted = enc_cipher.encrypt_chunk(plaintext).unwrap();

        let mut dec_cipher = VMessDataCipher::new(key, iv, VMessSecurity::None, option);
        let len_overhead = dec_cipher.length_overhead();
        let _len = dec_cipher
            .decrypt_chunk_length(&encrypted[..len_overhead])
            .unwrap();
        let decrypted = dec_cipher
            .decrypt_chunk_payload(&encrypted[len_overhead..])
            .unwrap();
        assert_eq!(decrypted, plaintext);
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

    #[test]
    fn test_full_vmess_aead_request_roundtrip() {
        use crate::types::{ProxyAddress, ProxyDestination};

        let uuid = Uuid::new_v4();
        let clients = vec![VMessClient { uuid, alter_id: 0 }];
        let cmd_key = derive_cmd_key(&uuid);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        // 1. Build auth_id
        let auth_id = compute_auth_id(&cmd_key, now);

        // 2. Build header
        let data_iv = [0xAAu8; 16];
        let data_key = [0xBBu8; 16];
        let dest = ProxyDestination {
            address: ProxyAddress::Domain("example.com".into()),
            port: 443,
        };
        let header = build_vmess_header(
            &data_iv,
            &data_key,
            0xCD,
            VMESS_OPT_CHUNK_STREAM | VMESS_OPT_CHUNK_MASKING,
            VMessSecurity::Aes128Gcm,
            CompatCommand::TcpConnect,
            &dest,
        );

        // 3. Encrypt header
        let enc_len = encrypt_header_length(&cmd_key, &auth_id, header.len() as u16).unwrap();
        let enc_header = encrypt_header_payload(&cmd_key, &auth_id, &header).unwrap();

        // 4. Assemble wire data
        let mut wire = Vec::new();
        wire.extend_from_slice(&auth_id);
        wire.extend_from_slice(&enc_len);
        wire.extend_from_slice(&enc_header);

        // 5. Decode on server side
        let (parsed, _cmd_key, consumed) =
            decode_vmess_request(&wire, &clients, 120, false).unwrap();

        assert_eq!(parsed.response_header, 0xCD);
        assert_eq!(parsed.security, VMessSecurity::Aes128Gcm);
        assert_eq!(parsed.command, CompatCommand::TcpConnect);
        assert_eq!(parsed.destination.port, 443);
        assert_eq!(parsed.data_iv, data_iv);
        assert_eq!(parsed.data_key, data_key);
        assert_eq!(consumed, wire.len());
    }

    #[test]
    fn test_decode_vmess_rejects_insecure() {
        use crate::types::{ProxyAddress, ProxyDestination};

        let uuid = Uuid::new_v4();
        let clients = vec![VMessClient { uuid, alter_id: 0 }];
        let cmd_key = derive_cmd_key(&uuid);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let auth_id = compute_auth_id(&cmd_key, now);
        let dest = ProxyDestination {
            address: ProxyAddress::Ipv4(std::net::Ipv4Addr::LOCALHOST),
            port: 80,
        };
        // Use insecure None security
        let header = build_vmess_header(
            &[0u8; 16],
            &[0u8; 16],
            0x01,
            VMESS_OPT_CHUNK_STREAM,
            VMessSecurity::None,
            CompatCommand::TcpConnect,
            &dest,
        );

        let enc_len = encrypt_header_length(&cmd_key, &auth_id, header.len() as u16).unwrap();
        let enc_header = encrypt_header_payload(&cmd_key, &auth_id, &header).unwrap();

        let mut wire = Vec::new();
        wire.extend_from_slice(&auth_id);
        wire.extend_from_slice(&enc_len);
        wire.extend_from_slice(&enc_header);

        // Should fail with disable_insecure_encryption=true
        let result = decode_vmess_request(&wire, &clients, 120, true);
        assert!(result.is_err());
    }
}
