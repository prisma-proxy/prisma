use hmac::{Hmac, Mac};
use sha2::Sha256;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::error::{ConfigError, ProtocolError};
use crate::types::{ClientId, MAX_FRAME_SIZE};

type HmacSha256 = Hmac<Sha256>;

// --- Hex encoding/decoding ---

/// Encode bytes as a lowercase hex string.
pub fn hex_encode(bytes: &[u8]) -> String {
    const HEX_CHARS: &[u8; 16] = b"0123456789abcdef";
    let mut result = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        result.push(HEX_CHARS[(b >> 4) as usize] as char);
        result.push(HEX_CHARS[(b & 0x0f) as usize] as char);
    }
    result
}

/// Decode a hex string into bytes. Returns `None` if the string has odd length
/// or contains non-hex characters.
pub fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

/// Decode a hex string into a 32-byte array. Returns an error if the string
/// is not valid hex or not exactly 64 hex characters (32 bytes).
pub fn hex_decode_32(s: &str) -> Result<[u8; 32], ConfigError> {
    let bytes = hex_decode(s).ok_or_else(|| ConfigError::ValidationFailed("invalid hex".into()))?;
    if bytes.len() != 32 {
        return Err(ConfigError::ValidationFailed(format!(
            "expected 32 bytes (64 hex chars), got {} bytes",
            bytes.len()
        )));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

// --- Auth token computation ---

/// Compute the HMAC-SHA256 auth token: `HMAC(auth_secret, client_id || timestamp)`.
/// Used by both client (to produce) and server (to verify).
pub fn compute_auth_token(
    auth_secret: &[u8; 32],
    client_id: &ClientId,
    timestamp: u64,
) -> [u8; 32] {
    let mut mac = HmacSha256::new_from_slice(auth_secret).expect("HMAC key length is valid");
    mac.update(client_id.0.as_bytes());
    mac.update(&timestamp.to_be_bytes());
    mac.finalize().into_bytes().into()
}

// --- Length-prefixed framed I/O ---

/// Read a length-prefixed frame: `[len:2][payload:len]`.
/// Rejects frames larger than `MAX_FRAME_SIZE`.
pub async fn read_framed<R: AsyncReadExt + Unpin>(r: &mut R) -> Result<Vec<u8>, ProtocolError> {
    let mut len_buf = [0u8; 2];
    r.read_exact(&mut len_buf)
        .await
        .map_err(|e| ProtocolError::InvalidFrame(format!("read length: {}", e)))?;
    let len = u16::from_be_bytes(len_buf) as usize;
    if len > MAX_FRAME_SIZE {
        return Err(ProtocolError::FrameTooLarge {
            size: len,
            max: MAX_FRAME_SIZE,
        });
    }
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf)
        .await
        .map_err(|e| ProtocolError::InvalidFrame(format!("read payload: {}", e)))?;
    Ok(buf)
}

/// Write a length-prefixed frame: `[len:2][payload]`.
///
/// Coalesces the length prefix and payload into a single buffer to reduce
/// the number of syscalls from two `write_all` calls to one.
pub async fn write_framed<W: AsyncWriteExt + Unpin>(
    w: &mut W,
    payload: &[u8],
) -> Result<(), ProtocolError> {
    let len = (payload.len() as u16).to_be_bytes();
    // Coalesce length prefix + payload into a single write to reduce syscalls.
    // For typical frame sizes (<32KB) this is a net win over two separate writes.
    let mut buf = Vec::with_capacity(2 + payload.len());
    buf.extend_from_slice(&len);
    buf.extend_from_slice(payload);
    w.write_all(&buf)
        .await
        .map_err(|e| ProtocolError::InvalidFrame(format!("write frame: {}", e)))?;
    w.flush()
        .await
        .map_err(|e| ProtocolError::InvalidFrame(format!("flush: {}", e)))?;
    Ok(())
}

// --- Constant-time comparison ---

/// Constant-time comparison of two 32-byte arrays to prevent timing side-channels.
pub fn ct_eq(a: &[u8; 32], b: &[u8; 32]) -> bool {
    use subtle::ConstantTimeEq;
    a.ct_eq(b).into()
}

/// Constant-time comparison of two byte slices to prevent timing side-channels.
/// Returns false if the slices differ in length (length comparison is NOT constant-time,
/// but for password comparison the length is typically not a secret).
pub fn ct_eq_slice(a: &[u8], b: &[u8]) -> bool {
    use subtle::ConstantTimeEq;
    if a.len() != b.len() {
        return false;
    }
    a.ct_eq(b).into()
}

// --- Server key pinning ---

/// Compute the SHA-256 pin of a server's public key (32 bytes).
/// Returns the pin as a lowercase hex string (64 characters).
///
/// This pin can be set as `server_key_pin` in the client config to
/// authenticate the server during the PrismaVeil handshake, independent
/// of the TLS layer. This is critical when traffic goes through CDNs
/// that terminate TLS.
pub fn compute_server_key_pin(server_public_key: &[u8; 32]) -> String {
    use sha2::Digest;
    let hash = Sha256::digest(server_public_key);
    hex_encode(&hash)
}

/// Verify that a server's public key matches a pinned SHA-256 hash.
///
/// `pin_hex` is the expected hex-encoded SHA-256 hash.
/// `server_public_key` is the raw 32-byte X25519 public key from the server.
///
/// Returns `Ok(())` if the pin matches, or an error describing the mismatch.
pub fn verify_server_key_pin(
    pin_hex: &str,
    server_public_key: &[u8; 32],
) -> Result<(), crate::error::PrismaError> {
    use sha2::Digest;
    let actual_hash = Sha256::digest(server_public_key);
    let actual_hex = hex_encode(&actual_hash);

    let pin_normalized = pin_hex.to_lowercase();
    if pin_normalized.len() != 64 {
        return Err(crate::error::PrismaError::Config(ConfigError::Invalid(
            format!(
                "server_key_pin must be a 64-character hex string (SHA-256), got {} characters",
                pin_normalized.len()
            ),
        )));
    }

    if actual_hex != pin_normalized {
        return Err(crate::error::PrismaError::Auth(format!(
            "Server key pin mismatch: expected {}, got {}. \
             This may indicate a man-in-the-middle attack or a server key change.",
            pin_normalized, actual_hex
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_server_key_pin() {
        let key = [0x42u8; 32];
        let pin = compute_server_key_pin(&key);
        // Pin should be a 64-char hex string (SHA-256)
        assert_eq!(pin.len(), 64);
        // Should be deterministic
        assert_eq!(pin, compute_server_key_pin(&key));
        // Different key should produce different pin
        let other_key = [0x43u8; 32];
        assert_ne!(pin, compute_server_key_pin(&other_key));
    }

    #[test]
    fn test_verify_server_key_pin_match() {
        let key = [0xAAu8; 32];
        let pin = compute_server_key_pin(&key);
        assert!(verify_server_key_pin(&pin, &key).is_ok());
    }

    #[test]
    fn test_verify_server_key_pin_match_case_insensitive() {
        let key = [0xAAu8; 32];
        let pin = compute_server_key_pin(&key);
        // Uppercase pin should also match
        let upper_pin = pin.to_uppercase();
        assert!(verify_server_key_pin(&upper_pin, &key).is_ok());
    }

    #[test]
    fn test_verify_server_key_pin_mismatch() {
        let key = [0xAAu8; 32];
        let wrong_key = [0xBBu8; 32];
        let pin = compute_server_key_pin(&key);
        let result = verify_server_key_pin(&pin, &wrong_key);
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("pin mismatch"), "Error: {}", err_msg);
    }

    #[test]
    fn test_verify_server_key_pin_invalid_length() {
        let key = [0xAAu8; 32];
        let result = verify_server_key_pin("deadbeef", &key);
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("64-character hex string"),
            "Error: {}",
            err_msg
        );
    }

    #[test]
    fn test_verify_server_key_pin_no_pin_skipped() {
        // When no pin is set (None), the check should be skipped at the call site.
        // This test verifies the function works correctly when called with valid inputs.
        let key = [0xCCu8; 32];
        let pin = compute_server_key_pin(&key);
        assert!(verify_server_key_pin(&pin, &key).is_ok());
    }
}
