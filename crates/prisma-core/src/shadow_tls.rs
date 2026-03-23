//! ShadowTLS v3 protocol primitives.
//!
//! ShadowTLS v3 uses a real TLS handshake with a legitimate server as
//! camouflage. After the handshake completes, proxy data is wrapped in
//! TLS application data records. An HMAC tag in the record header
//! distinguishes proxy frames from legitimate traffic relayed from the
//! cover server.
//!
//! ## Wire format (after TLS handshake)
//!
//! Each proxy frame is a TLS Application Data record (content type 0x17):
//!
//! ```text
//! [0x17][0x03][0x03][length:2][hmac:8][payload:...]
//! ```
//!
//! - The first 3 bytes are the standard TLS 1.2 Application Data header.
//! - `length` covers `hmac + payload`.
//! - `hmac` is the first 8 bytes of HMAC-SHA256(key, payload).
//! - `payload` is the actual proxy data.
//!
//! The server distinguishes proxy frames from cover-server traffic by
//! verifying the HMAC tag. If verification fails, the frame is treated
//! as legitimate cover traffic and can be silently discarded or relayed.

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// TLS record content type: Application Data.
pub const TLS_APPLICATION_DATA: u8 = 0x17;
/// TLS record content type: Handshake.
pub const TLS_HANDSHAKE: u8 = 0x16;
/// TLS record content type: Change Cipher Spec.
pub const TLS_CHANGE_CIPHER_SPEC: u8 = 0x14;
/// TLS 1.2 major version.
pub const TLS_VERSION_MAJOR: u8 = 0x03;
/// TLS 1.2 minor version.
pub const TLS_VERSION_MINOR: u8 = 0x03;
/// Size of the TLS record header.
pub const TLS_RECORD_HEADER_SIZE: usize = 5;
/// Size of the HMAC tag prepended to proxy payloads inside TLS records.
pub const HMAC_TAG_SIZE: usize = 8;
/// Maximum TLS record payload size (2^14 = 16384).
pub const MAX_TLS_RECORD_PAYLOAD: usize = 16384;
/// Maximum proxy payload per frame (record payload minus HMAC tag).
pub const MAX_PROXY_PAYLOAD: usize = MAX_TLS_RECORD_PAYLOAD - HMAC_TAG_SIZE;

/// Derive the HMAC key from the pre-shared password.
///
/// Uses HMAC-SHA256 with a fixed context string so the password itself
/// is never used directly as a key.
pub fn derive_hmac_key(password: &str) -> [u8; 32] {
    let h = blake3::derive_key("prisma-shadow-tls-v3-hmac-key", password.as_bytes());
    h
}

/// Compute the 8-byte HMAC tag for a proxy payload.
pub fn compute_hmac(key: &[u8; 32], payload: &[u8]) -> [u8; HMAC_TAG_SIZE] {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC-SHA256 accepts any key size");
    mac.update(payload);
    let result = mac.finalize().into_bytes();
    let mut tag = [0u8; HMAC_TAG_SIZE];
    tag.copy_from_slice(&result[..HMAC_TAG_SIZE]);
    tag
}

/// Verify an HMAC tag against a payload.
pub fn verify_hmac(key: &[u8; 32], tag: &[u8; HMAC_TAG_SIZE], payload: &[u8]) -> bool {
    let expected = compute_hmac(key, payload);
    // Constant-time comparison to prevent timing attacks.
    subtle::ConstantTimeEq::ct_eq(&expected[..], &tag[..]).into()
}

/// Encode a proxy payload into a TLS Application Data record.
///
/// Returns the complete TLS record bytes including header, HMAC tag,
/// and payload.
pub fn encode_proxy_frame(key: &[u8; 32], payload: &[u8]) -> Vec<u8> {
    assert!(
        payload.len() <= MAX_PROXY_PAYLOAD,
        "payload exceeds maximum TLS record size"
    );

    let tag = compute_hmac(key, payload);
    let record_len = HMAC_TAG_SIZE + payload.len();

    let mut buf = Vec::with_capacity(TLS_RECORD_HEADER_SIZE + record_len);
    // TLS record header
    buf.push(TLS_APPLICATION_DATA);
    buf.push(TLS_VERSION_MAJOR);
    buf.push(TLS_VERSION_MINOR);
    buf.push((record_len >> 8) as u8);
    buf.push((record_len & 0xFF) as u8);
    // HMAC tag
    buf.extend_from_slice(&tag);
    // Payload
    buf.extend_from_slice(payload);

    buf
}

/// Result of attempting to decode a TLS record as a proxy frame.
#[derive(Debug)]
pub enum FrameDecodeResult {
    /// Valid proxy frame. Contains the decrypted proxy payload.
    ProxyData(Vec<u8>),
    /// TLS record that is NOT a proxy frame (cover traffic from the
    /// legitimate server). Contains the raw record payload.
    CoverTraffic(Vec<u8>),
    /// TLS handshake record (should be relayed during handshake phase).
    Handshake(Vec<u8>),
}

/// Decode a TLS record payload and check if it is a proxy frame.
///
/// `content_type` is the TLS record content type (first byte of header).
/// `record_payload` is the record payload (after the 5-byte header).
///
/// Returns `ProxyData` if the HMAC verifies, `CoverTraffic` if it does not,
/// or `Handshake` if the content type indicates a handshake record.
pub fn decode_frame(key: &[u8; 32], content_type: u8, record_payload: &[u8]) -> FrameDecodeResult {
    if content_type != TLS_APPLICATION_DATA {
        return FrameDecodeResult::Handshake(record_payload.to_vec());
    }

    if record_payload.len() < HMAC_TAG_SIZE {
        return FrameDecodeResult::CoverTraffic(record_payload.to_vec());
    }

    let (tag_bytes, payload) = record_payload.split_at(HMAC_TAG_SIZE);
    let mut tag = [0u8; HMAC_TAG_SIZE];
    tag.copy_from_slice(tag_bytes);

    if verify_hmac(key, &tag, payload) {
        FrameDecodeResult::ProxyData(payload.to_vec())
    } else {
        FrameDecodeResult::CoverTraffic(record_payload.to_vec())
    }
}

/// Read exactly one TLS record from a reader.
///
/// Returns `(content_type, payload)`.
pub async fn read_tls_record<R: tokio::io::AsyncReadExt + Unpin>(
    reader: &mut R,
) -> std::io::Result<(u8, Vec<u8>)> {
    let mut header = [0u8; TLS_RECORD_HEADER_SIZE];
    reader.read_exact(&mut header).await?;

    let content_type = header[0];
    let length = u16::from_be_bytes([header[3], header[4]]) as usize;

    if length > MAX_TLS_RECORD_PAYLOAD + 256 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("TLS record too large: {} bytes", length),
        ));
    }

    let mut payload = vec![0u8; length];
    reader.read_exact(&mut payload).await?;

    Ok((content_type, payload))
}

/// Write a raw TLS record (header + payload) to a writer.
pub async fn write_tls_record<W: tokio::io::AsyncWriteExt + Unpin>(
    writer: &mut W,
    content_type: u8,
    payload: &[u8],
) -> std::io::Result<()> {
    let length = payload.len();
    let mut header = [0u8; TLS_RECORD_HEADER_SIZE];
    header[0] = content_type;
    header[1] = TLS_VERSION_MAJOR;
    header[2] = TLS_VERSION_MINOR;
    header[3] = (length >> 8) as u8;
    header[4] = (length & 0xFF) as u8;

    writer.write_all(&header).await?;
    writer.write_all(payload).await?;
    writer.flush().await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_hmac_key_deterministic() {
        let key1 = derive_hmac_key("test-password");
        let key2 = derive_hmac_key("test-password");
        assert_eq!(key1, key2);
    }

    #[test]
    fn test_derive_hmac_key_different_passwords() {
        let key1 = derive_hmac_key("password-a");
        let key2 = derive_hmac_key("password-b");
        assert_ne!(key1, key2);
    }

    #[test]
    fn test_hmac_roundtrip() {
        let key = derive_hmac_key("test");
        let payload = b"hello world";
        let tag = compute_hmac(&key, payload);
        assert!(verify_hmac(&key, &tag, payload));
    }

    #[test]
    fn test_hmac_wrong_key() {
        let key1 = derive_hmac_key("key1");
        let key2 = derive_hmac_key("key2");
        let payload = b"hello world";
        let tag = compute_hmac(&key1, payload);
        assert!(!verify_hmac(&key2, &tag, payload));
    }

    #[test]
    fn test_hmac_wrong_payload() {
        let key = derive_hmac_key("test");
        let tag = compute_hmac(&key, b"hello");
        assert!(!verify_hmac(&key, &tag, b"world"));
    }

    #[test]
    fn test_encode_proxy_frame() {
        let key = derive_hmac_key("test-password");
        let payload = b"proxy data here";
        let frame = encode_proxy_frame(&key, payload);

        // Check TLS record header
        assert_eq!(frame[0], TLS_APPLICATION_DATA);
        assert_eq!(frame[1], TLS_VERSION_MAJOR);
        assert_eq!(frame[2], TLS_VERSION_MINOR);

        let record_len = u16::from_be_bytes([frame[3], frame[4]]) as usize;
        assert_eq!(record_len, HMAC_TAG_SIZE + payload.len());

        // Verify HMAC
        let tag_start = TLS_RECORD_HEADER_SIZE;
        let tag_end = tag_start + HMAC_TAG_SIZE;
        let mut tag = [0u8; HMAC_TAG_SIZE];
        tag.copy_from_slice(&frame[tag_start..tag_end]);
        assert!(verify_hmac(&key, &tag, payload));

        // Check payload
        assert_eq!(&frame[tag_end..], payload);
    }

    #[test]
    fn test_decode_proxy_frame() {
        let key = derive_hmac_key("test-password");
        let payload = b"proxy data";
        let frame = encode_proxy_frame(&key, payload);

        let record_payload = &frame[TLS_RECORD_HEADER_SIZE..];
        match decode_frame(&key, TLS_APPLICATION_DATA, record_payload) {
            FrameDecodeResult::ProxyData(data) => {
                assert_eq!(data, payload);
            }
            _ => panic!("Expected ProxyData"),
        }
    }

    #[test]
    fn test_decode_cover_traffic() {
        let key = derive_hmac_key("test-password");
        // Random data that won't pass HMAC verification
        let cover_data = vec![0xAB; 100];
        match decode_frame(&key, TLS_APPLICATION_DATA, &cover_data) {
            FrameDecodeResult::CoverTraffic(_) => {}
            _ => panic!("Expected CoverTraffic"),
        }
    }

    #[test]
    fn test_decode_handshake_record() {
        let key = derive_hmac_key("test-password");
        let data = vec![0x01; 50];
        match decode_frame(&key, TLS_HANDSHAKE, &data) {
            FrameDecodeResult::Handshake(_) => {}
            _ => panic!("Expected Handshake"),
        }
    }

    #[tokio::test]
    async fn test_read_write_tls_record() {
        let payload = b"test payload data";
        let mut buf = Vec::new();
        write_tls_record(&mut buf, TLS_APPLICATION_DATA, payload)
            .await
            .unwrap();

        let mut cursor = std::io::Cursor::new(buf);
        let (ct, data) = read_tls_record(&mut cursor).await.unwrap();
        assert_eq!(ct, TLS_APPLICATION_DATA);
        assert_eq!(data, payload);
    }
}
