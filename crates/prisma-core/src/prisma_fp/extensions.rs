//! TLS extension serializers.
//!
//! Each function returns the raw bytes for a specific TLS extension,
//! including the extension type and length header.
//!
//! Extension wire format: `[type:2][length:2][data:variable]`

/// Build server_name extension (type 0x0000).
///
/// Wire format:
/// ```text
/// [0x00 0x00]                    -- extension type
/// [length:2]                     -- extension data length
///   [server_name_list_length:2]
///     [host_name_type:1 = 0x00]
///     [host_name_length:2]
///     [host_name:var]
/// ```
pub fn build_sni_extension(hostname: &str) -> Vec<u8> {
    let name_bytes = hostname.as_bytes();
    let name_len = name_bytes.len();

    // server_name entry: type(1) + length(2) + name(var)
    let entry_len = 1 + 2 + name_len;
    // server_name_list: list_length(2) + entry(var)
    let list_len = 2 + entry_len;

    let mut buf = Vec::with_capacity(4 + list_len);
    // Extension type
    buf.extend_from_slice(&0x0000u16.to_be_bytes());
    // Extension data length
    buf.extend_from_slice(&(list_len as u16).to_be_bytes());
    // Server name list length
    buf.extend_from_slice(&(entry_len as u16).to_be_bytes());
    // Host name type (0 = DNS hostname)
    buf.push(0x00);
    // Host name length
    buf.extend_from_slice(&(name_len as u16).to_be_bytes());
    // Host name
    buf.extend_from_slice(name_bytes);

    buf
}

/// Build supported_versions extension (type 0x002b) for TLS 1.3 + 1.2.
///
/// Wire format:
/// ```text
/// [0x00 0x2b]        -- extension type
/// [length:2]         -- extension data length
///   [versions_len:1]
///   [version:2]*     -- each supported version
/// ```
pub fn build_supported_versions_extension(include_grease: bool, grease_value: u16) -> Vec<u8> {
    let mut versions: Vec<u16> = Vec::new();
    if include_grease {
        versions.push(grease_value);
    }
    versions.push(0x0304); // TLS 1.3
    versions.push(0x0303); // TLS 1.2

    let versions_byte_len = versions.len() * 2;

    let mut buf = Vec::with_capacity(4 + 1 + versions_byte_len);
    // Extension type
    buf.extend_from_slice(&0x002bu16.to_be_bytes());
    // Extension data length: 1 (list length byte) + versions bytes
    buf.extend_from_slice(&((1 + versions_byte_len) as u16).to_be_bytes());
    // Versions list length in bytes
    buf.push(versions_byte_len as u8);
    // Each version
    for v in &versions {
        buf.extend_from_slice(&v.to_be_bytes());
    }

    buf
}

/// Build supported_groups extension (type 0x000a).
///
/// Wire format:
/// ```text
/// [0x00 0x0a]               -- extension type
/// [length:2]                -- extension data length
///   [named_group_list_len:2]
///   [named_group:2]*        -- each supported group
/// ```
pub fn build_supported_groups_extension(
    groups: &[u16],
    include_grease: bool,
    grease_value: u16,
) -> Vec<u8> {
    let mut group_list: Vec<u16> = Vec::new();
    if include_grease {
        group_list.push(grease_value);
    }
    group_list.extend_from_slice(groups);

    let list_byte_len = group_list.len() * 2;

    let mut buf = Vec::with_capacity(4 + 2 + list_byte_len);
    // Extension type
    buf.extend_from_slice(&0x000au16.to_be_bytes());
    // Extension data length: 2 (list length) + groups bytes
    buf.extend_from_slice(&((2 + list_byte_len) as u16).to_be_bytes());
    // Named group list length
    buf.extend_from_slice(&(list_byte_len as u16).to_be_bytes());
    // Each group
    for g in &group_list {
        buf.extend_from_slice(&g.to_be_bytes());
    }

    buf
}

/// Build signature_algorithms extension (type 0x000d).
///
/// Wire format:
/// ```text
/// [0x00 0x0d]                       -- extension type
/// [length:2]                        -- extension data length
///   [signature_algorithms_len:2]
///   [signature_algorithm:2]*        -- each algorithm
/// ```
pub fn build_signature_algorithms_extension(algorithms: &[u16]) -> Vec<u8> {
    let list_byte_len = algorithms.len() * 2;

    let mut buf = Vec::with_capacity(4 + 2 + list_byte_len);
    // Extension type
    buf.extend_from_slice(&0x000du16.to_be_bytes());
    // Extension data length
    buf.extend_from_slice(&((2 + list_byte_len) as u16).to_be_bytes());
    // Algorithm list length
    buf.extend_from_slice(&(list_byte_len as u16).to_be_bytes());
    // Each algorithm
    for a in algorithms {
        buf.extend_from_slice(&a.to_be_bytes());
    }

    buf
}

/// Build key_share extension (type 0x0033) with X25519 key.
///
/// Wire format:
/// ```text
/// [0x00 0x33]               -- extension type
/// [length:2]                -- extension data length
///   [client_shares_len:2]
///   [key_share_entry]*:
///     [named_group:2]
///     [key_exchange_len:2]
///     [key_exchange:var]
/// ```
///
/// The `groups` parameter specifies which groups to include key shares for.
/// Currently only X25519 (0x001d) is provided with actual key data;
/// other groups are skipped.
pub fn build_key_share_extension(x25519_pub: &[u8; 32], groups: &[u16]) -> Vec<u8> {
    // Build key share entries - only X25519 has actual key data
    let mut entries = Vec::new();
    for &group in groups {
        if group == 0x001d {
            // X25519: group(2) + key_len(2) + key(32) = 36 bytes
            entries.extend_from_slice(&group.to_be_bytes());
            entries.extend_from_slice(&32u16.to_be_bytes());
            entries.extend_from_slice(x25519_pub);
        }
        // Other groups (e.g., secp256r1, secp384r1) could be added here
        // with their respective key share data
    }

    let shares_len = entries.len();

    let mut buf = Vec::with_capacity(4 + 2 + shares_len);
    // Extension type
    buf.extend_from_slice(&0x0033u16.to_be_bytes());
    // Extension data length: 2 (shares list length) + entries
    buf.extend_from_slice(&((2 + shares_len) as u16).to_be_bytes());
    // Client shares length
    buf.extend_from_slice(&(shares_len as u16).to_be_bytes());
    // Key share entries
    buf.extend_from_slice(&entries);

    buf
}

/// Build psk_key_exchange_modes extension (type 0x002d).
///
/// Wire format:
/// ```text
/// [0x00 0x2d]     -- extension type
/// [length:2]      -- extension data length
///   [modes_len:1]
///   [mode:1]*     -- each PSK mode
/// ```
pub fn build_psk_modes_extension(modes: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(4 + 1 + modes.len());
    // Extension type
    buf.extend_from_slice(&0x002du16.to_be_bytes());
    // Extension data length: 1 (modes length byte) + modes
    buf.extend_from_slice(&((1 + modes.len()) as u16).to_be_bytes());
    // Modes length
    buf.push(modes.len() as u8);
    // Each mode
    buf.extend_from_slice(modes);

    buf
}

/// Build ALPN extension (type 0x0010).
///
/// Wire format:
/// ```text
/// [0x00 0x10]                -- extension type
/// [length:2]                 -- extension data length
///   [protocol_list_len:2]
///   [protocol_entry]*:
///     [protocol_len:1]
///     [protocol_name:var]
/// ```
pub fn build_alpn_extension(protocols: &[&str]) -> Vec<u8> {
    // Build protocol entries
    let mut entries = Vec::new();
    for proto in protocols {
        let bytes = proto.as_bytes();
        entries.push(bytes.len() as u8);
        entries.extend_from_slice(bytes);
    }

    let list_len = entries.len();

    let mut buf = Vec::with_capacity(4 + 2 + list_len);
    // Extension type
    buf.extend_from_slice(&0x0010u16.to_be_bytes());
    // Extension data length: 2 (list length) + entries
    buf.extend_from_slice(&((2 + list_len) as u16).to_be_bytes());
    // Protocol list length
    buf.extend_from_slice(&(list_len as u16).to_be_bytes());
    // Protocol entries
    buf.extend_from_slice(&entries);

    buf
}

/// Build padding extension (type 0x0015) to reach target length.
///
/// Content is filled with the provided bytes (for PrismaAuth beacon).
/// If content is shorter than the extension data area, the remainder is
/// zero-filled. If content is longer, it is truncated.
///
/// Wire format:
/// ```text
/// [0x00 0x15]    -- extension type
/// [length:2]     -- extension data length
/// [padding:var]  -- padding bytes
/// ```
pub fn build_padding_extension(content: &[u8]) -> Vec<u8> {
    let data_len = content.len();

    let mut buf = Vec::with_capacity(4 + data_len);
    // Extension type
    buf.extend_from_slice(&0x0015u16.to_be_bytes());
    // Extension data length
    buf.extend_from_slice(&(data_len as u16).to_be_bytes());
    // Padding content
    buf.extend_from_slice(content);

    buf
}

/// Build compress_certificate extension (type 0x001b).
///
/// Wire format:
/// ```text
/// [0x00 0x1b]              -- extension type
/// [length:2]               -- extension data length
///   [algorithms_len:1]
///   [algorithm:2]*         -- each compression algorithm ID
/// ```
pub fn build_compress_certificate_extension(algorithms: &[u16]) -> Vec<u8> {
    let algos_byte_len = algorithms.len() * 2;

    let mut buf = Vec::with_capacity(4 + 1 + algos_byte_len);
    // Extension type
    buf.extend_from_slice(&0x001bu16.to_be_bytes());
    // Extension data length: 1 (algos length byte) + algorithm bytes
    buf.extend_from_slice(&((1 + algos_byte_len) as u16).to_be_bytes());
    // Algorithms length in bytes
    buf.push(algos_byte_len as u8);
    // Each algorithm
    for a in algorithms {
        buf.extend_from_slice(&a.to_be_bytes());
    }

    buf
}

/// Build a GREASE extension (random type from GREASE range, random 1-byte content).
///
/// Wire format:
/// ```text
/// [grease_type:2]  -- GREASE extension type
/// [0x00 0x01]      -- length = 1
/// [0x00]           -- single zero byte content
/// ```
pub fn build_grease_extension(grease_type: u16) -> Vec<u8> {
    let mut buf = Vec::with_capacity(5);
    // Extension type (GREASE value)
    buf.extend_from_slice(&grease_type.to_be_bytes());
    // Extension data length: 1 byte
    buf.extend_from_slice(&1u16.to_be_bytes());
    // Content: single zero byte
    buf.push(0x00);

    buf
}

/// Build ec_point_formats extension (type 0x000b).
///
/// Wire format:
/// ```text
/// [0x00 0x0b]               -- extension type
/// [length:2]                -- extension data length
///   [formats_len:1]
///   [ec_point_format:1]*    -- each format
/// ```
///
/// Standard format: uncompressed (0x00).
pub fn build_ec_point_formats_extension() -> Vec<u8> {
    let mut buf = Vec::with_capacity(6);
    // Extension type
    buf.extend_from_slice(&0x000bu16.to_be_bytes());
    // Extension data length: 1 (formats length) + 1 (format)
    buf.extend_from_slice(&2u16.to_be_bytes());
    // Formats length
    buf.push(0x01);
    // Uncompressed (0x00)
    buf.push(0x00);

    buf
}

/// Build status_request extension (type 0x0005) for OCSP stapling.
///
/// Wire format:
/// ```text
/// [0x00 0x05]                  -- extension type
/// [length:2]                   -- extension data length
///   [status_type:1 = 0x01]     -- OCSP
///   [responder_id_list_len:2 = 0]
///   [request_extensions_len:2 = 0]
/// ```
pub fn build_status_request_extension() -> Vec<u8> {
    let mut buf = Vec::with_capacity(9);
    // Extension type
    buf.extend_from_slice(&0x0005u16.to_be_bytes());
    // Extension data length: 1 + 2 + 2 = 5
    buf.extend_from_slice(&5u16.to_be_bytes());
    // Status type: OCSP (1)
    buf.push(0x01);
    // Responder ID list length: 0
    buf.extend_from_slice(&0u16.to_be_bytes());
    // Request extensions length: 0
    buf.extend_from_slice(&0u16.to_be_bytes());

    buf
}

/// Build session_ticket extension (type 0x0023) -- empty for new connections.
///
/// Wire format:
/// ```text
/// [0x00 0x23]    -- extension type
/// [0x00 0x00]    -- length = 0 (empty, requesting new ticket)
/// ```
pub fn build_session_ticket_extension() -> Vec<u8> {
    let mut buf = Vec::with_capacity(4);
    // Extension type
    buf.extend_from_slice(&0x0023u16.to_be_bytes());
    // Extension data length: 0 (empty)
    buf.extend_from_slice(&0u16.to_be_bytes());

    buf
}

/// Build extended_master_secret extension (type 0x0017).
///
/// Wire format:
/// ```text
/// [0x00 0x17]    -- extension type
/// [0x00 0x00]    -- length = 0 (no data)
/// ```
pub fn build_extended_master_secret_extension() -> Vec<u8> {
    let mut buf = Vec::with_capacity(4);
    // Extension type
    buf.extend_from_slice(&0x0017u16.to_be_bytes());
    // Extension data length: 0
    buf.extend_from_slice(&0u16.to_be_bytes());

    buf
}

/// Build renegotiation_info extension (type 0xff01).
///
/// Wire format:
/// ```text
/// [0xff 0x01]                       -- extension type
/// [length:2]                        -- extension data length
///   [renegotiated_connection_len:1] -- 0 for initial handshake
/// ```
pub fn build_renegotiation_info_extension() -> Vec<u8> {
    let mut buf = Vec::with_capacity(5);
    // Extension type
    buf.extend_from_slice(&0xff01u16.to_be_bytes());
    // Extension data length: 1
    buf.extend_from_slice(&1u16.to_be_bytes());
    // Renegotiated connection length: 0 (initial handshake)
    buf.push(0x00);

    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sni_extension() {
        let ext = build_sni_extension("example.com");
        // Type = 0x0000
        assert_eq!(&ext[0..2], &[0x00, 0x00]);
        // Verify we can find the hostname in the bytes
        let hostname = b"example.com";
        let pos = ext
            .windows(hostname.len())
            .position(|w| w == hostname)
            .expect("hostname not found in extension bytes");
        assert!(pos > 4);
    }

    #[test]
    fn test_sni_extension_length() {
        let ext = build_sni_extension("test.org");
        // Total: type(2) + ext_len(2) + list_len(2) + type(1) + name_len(2) + name(8) = 17
        assert_eq!(ext.len(), 17);
        // Extension data length
        let ext_data_len = u16::from_be_bytes([ext[2], ext[3]]) as usize;
        assert_eq!(ext_data_len, ext.len() - 4);
    }

    #[test]
    fn test_supported_versions_no_grease() {
        let ext = build_supported_versions_extension(false, 0);
        assert_eq!(&ext[0..2], &[0x00, 0x2b]);
        // Data: 1 (list len) + 4 (two versions) = 5
        let ext_data_len = u16::from_be_bytes([ext[2], ext[3]]) as usize;
        assert_eq!(ext_data_len, 5);
        // Versions list length
        assert_eq!(ext[4], 4);
        // TLS 1.3
        assert_eq!(&ext[5..7], &[0x03, 0x04]);
        // TLS 1.2
        assert_eq!(&ext[7..9], &[0x03, 0x03]);
    }

    #[test]
    fn test_supported_versions_with_grease() {
        let ext = build_supported_versions_extension(true, 0x3a3a);
        assert_eq!(&ext[0..2], &[0x00, 0x2b]);
        // Versions list length: 6 bytes (3 versions * 2)
        assert_eq!(ext[4], 6);
        // First version is GREASE
        assert_eq!(&ext[5..7], &[0x3a, 0x3a]);
        // TLS 1.3
        assert_eq!(&ext[7..9], &[0x03, 0x04]);
    }

    #[test]
    fn test_supported_groups() {
        let groups = vec![0x001d, 0x0017, 0x0018]; // x25519, secp256r1, secp384r1
        let ext = build_supported_groups_extension(&groups, false, 0);
        assert_eq!(&ext[0..2], &[0x00, 0x0a]);
        let ext_data_len = u16::from_be_bytes([ext[2], ext[3]]) as usize;
        assert_eq!(ext_data_len, 2 + 6); // list_len(2) + 3 groups * 2
    }

    #[test]
    fn test_signature_algorithms() {
        let algos = vec![0x0403, 0x0503]; // ecdsa_secp256r1_sha256, ecdsa_secp384r1_sha384
        let ext = build_signature_algorithms_extension(&algos);
        assert_eq!(&ext[0..2], &[0x00, 0x0d]);
        let ext_data_len = u16::from_be_bytes([ext[2], ext[3]]) as usize;
        assert_eq!(ext_data_len, 2 + 4); // list_len(2) + 2 algos * 2
    }

    #[test]
    fn test_key_share_x25519() {
        let pub_key = [0xAB; 32];
        let ext = build_key_share_extension(&pub_key, &[0x001d]);
        assert_eq!(&ext[0..2], &[0x00, 0x33]);
        // Data: shares_len(2) + group(2) + key_len(2) + key(32) = 38
        let ext_data_len = u16::from_be_bytes([ext[2], ext[3]]) as usize;
        assert_eq!(ext_data_len, 38);
        // Verify the public key is in the extension
        assert_eq!(&ext[10..42], &[0xAB; 32]);
    }

    #[test]
    fn test_alpn_extension() {
        let ext = build_alpn_extension(&["h2", "http/1.1"]);
        assert_eq!(&ext[0..2], &[0x00, 0x10]);
        // Verify protocols appear in the bytes
        let h2_pos = ext.windows(2).position(|w| w == b"h2");
        assert!(h2_pos.is_some());
    }

    #[test]
    fn test_padding_extension() {
        let content = vec![0x42; 100];
        let ext = build_padding_extension(&content);
        assert_eq!(&ext[0..2], &[0x00, 0x15]);
        let ext_data_len = u16::from_be_bytes([ext[2], ext[3]]) as usize;
        assert_eq!(ext_data_len, 100);
        assert_eq!(&ext[4..], &content[..]);
    }

    #[test]
    fn test_compress_certificate() {
        let algos = vec![0x0002]; // brotli
        let ext = build_compress_certificate_extension(&algos);
        assert_eq!(&ext[0..2], &[0x00, 0x1b]);
        let ext_data_len = u16::from_be_bytes([ext[2], ext[3]]) as usize;
        assert_eq!(ext_data_len, 3); // 1 (len byte) + 2 (algo)
    }

    #[test]
    fn test_grease_extension() {
        let ext = build_grease_extension(0x1a1a);
        assert_eq!(&ext[0..2], &[0x1a, 0x1a]);
        assert_eq!(&ext[2..4], &[0x00, 0x01]);
        assert_eq!(ext[4], 0x00);
        assert_eq!(ext.len(), 5);
    }

    #[test]
    fn test_ec_point_formats() {
        let ext = build_ec_point_formats_extension();
        assert_eq!(&ext[0..2], &[0x00, 0x0b]);
        assert_eq!(ext.len(), 6);
        // Formats length = 1, format = uncompressed (0)
        assert_eq!(ext[4], 0x01);
        assert_eq!(ext[5], 0x00);
    }

    #[test]
    fn test_status_request() {
        let ext = build_status_request_extension();
        assert_eq!(&ext[0..2], &[0x00, 0x05]);
        let ext_data_len = u16::from_be_bytes([ext[2], ext[3]]) as usize;
        assert_eq!(ext_data_len, 5);
        // OCSP type
        assert_eq!(ext[4], 0x01);
    }

    #[test]
    fn test_session_ticket() {
        let ext = build_session_ticket_extension();
        assert_eq!(&ext[0..2], &[0x00, 0x23]);
        assert_eq!(&ext[2..4], &[0x00, 0x00]);
        assert_eq!(ext.len(), 4);
    }

    #[test]
    fn test_extended_master_secret() {
        let ext = build_extended_master_secret_extension();
        assert_eq!(&ext[0..2], &[0x00, 0x17]);
        assert_eq!(&ext[2..4], &[0x00, 0x00]);
        assert_eq!(ext.len(), 4);
    }

    #[test]
    fn test_renegotiation_info() {
        let ext = build_renegotiation_info_extension();
        assert_eq!(&ext[0..2], &[0xff, 0x01]);
        assert_eq!(ext.len(), 5);
        assert_eq!(ext[4], 0x00);
    }

    #[test]
    fn test_psk_modes() {
        let ext = build_psk_modes_extension(&[0x01]); // psk_dhe_ke
        assert_eq!(&ext[0..2], &[0x00, 0x2d]);
        let ext_data_len = u16::from_be_bytes([ext[2], ext[3]]) as usize;
        assert_eq!(ext_data_len, 2); // 1 (len byte) + 1 (mode)
        assert_eq!(ext[4], 0x01); // modes length
        assert_eq!(ext[5], 0x01); // psk_dhe_ke
    }
}
