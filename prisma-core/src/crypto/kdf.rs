use zeroize::Zeroizing;

/// Derive a 32-byte key from context material using BLAKE3's key derivation mode.
///
/// The `domain` string provides cryptographic domain separation so that
/// different callers sharing the same inputs produce independent keys.
fn blake3_derive(domain: &str, context: &[u8]) -> [u8; 32] {
    let mut output = [0u8; 32];
    let mut hasher = blake3::Hasher::new_derive_key(domain);
    hasher.update(context);
    let mut reader = hasher.finalize_xof();
    reader.fill(&mut output);
    output
}

/// Build the standard KDF context: shared secret, both public keys, and timestamp.
///
/// Returns a `Zeroizing<Vec<u8>>` so the context (which contains the shared secret)
/// is zeroized when dropped.
fn build_kdf_context(
    shared_secret: &[u8; 32],
    client_pub: &[u8; 32],
    server_pub: &[u8; 32],
    timestamp: u64,
) -> Zeroizing<Vec<u8>> {
    let mut context = Vec::with_capacity(32 + 32 + 32 + 8);
    context.extend_from_slice(shared_secret);
    context.extend_from_slice(client_pub);
    context.extend_from_slice(server_pub);
    context.extend_from_slice(&timestamp.to_be_bytes());
    Zeroizing::new(context)
}

/// Derive a key for encrypting/decrypting session tickets.
///
/// The ticket key is derived from a server-side secret using BLAKE3 KDF.
#[allow(dead_code)]
pub fn derive_ticket_key(server_secret: &[u8; 32]) -> [u8; 32] {
    blake3_derive("prisma-v3-session-ticket", server_secret)
}

// ===== v5 Key Derivation Functions =====

/// v5: Derive preliminary key for encrypting PrismaServerInit.
///
/// Uses the v5 domain separation string for forward-incompatible key derivation.
pub fn derive_v5_preliminary_key(
    shared_secret: &[u8; 32],
    client_pub: &[u8; 32],
    server_pub: &[u8; 32],
    timestamp: u64,
) -> [u8; 32] {
    let context = build_kdf_context(shared_secret, client_pub, server_pub, timestamp);
    blake3_derive("prisma-v5-preliminary", &context)
}

/// v5: Derive final session key with challenge binding.
///
/// Includes protocol version byte in the KDF context
/// to prevent cross-version key confusion.
pub fn derive_v5_session_key(
    shared_secret: &[u8; 32],
    client_pub: &[u8; 32],
    server_pub: &[u8; 32],
    challenge: &[u8; 32],
    timestamp: u64,
) -> [u8; 32] {
    let mut context = build_kdf_context(shared_secret, client_pub, server_pub, timestamp);
    context.extend_from_slice(challenge);
    // v5: bind protocol version into KDF context
    context.push(0x05);
    blake3_derive("prisma-v5-session", &context)
}

/// v5: Derive a separate key for header authentication (AAD binding).
///
/// This key is used to compute the AAD for header-authenticated frames,
/// providing an additional layer of integrity over the frame header fields
/// (cmd, flags, stream_id) that are visible in the plaintext structure.
pub fn derive_v5_header_key(session_key: &[u8; 32]) -> [u8; 32] {
    blake3_derive("prisma-v5-header-auth", session_key)
}

/// v5: Derive a connection migration token.
///
/// This token allows a client to resume a session on a new transport
/// connection without repeating the full handshake, provided the session
/// is still valid.
pub fn derive_v5_migration_token(session_key: &[u8; 32], session_id: &[u8; 16]) -> [u8; 32] {
    let mut context = Vec::with_capacity(48);
    context.extend_from_slice(session_key);
    context.extend_from_slice(session_id);
    blake3_derive("prisma-v5-migration", &context)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ticket_key_derivation() {
        let secret = [0x42u8; 32];
        let key1 = derive_ticket_key(&secret);
        let key2 = derive_ticket_key(&secret);
        assert_eq!(key1, key2);
        assert_ne!(key1, [0u8; 32]);
    }

    #[test]
    fn test_v5_preliminary_key_determinism() {
        let secret = [0xCDu8; 32];
        let client_pub = [0x01u8; 32];
        let server_pub = [0x02u8; 32];

        let key1 = derive_v5_preliminary_key(&secret, &client_pub, &server_pub, 1000);
        let key2 = derive_v5_preliminary_key(&secret, &client_pub, &server_pub, 1000);
        assert_eq!(key1, key2);
    }

    #[test]
    fn test_v5_preliminary_key_not_zero() {
        let secret = [0xCDu8; 32];
        let client_pub = [0x01u8; 32];
        let server_pub = [0x02u8; 32];

        let key = derive_v5_preliminary_key(&secret, &client_pub, &server_pub, 1000);
        assert_ne!(key, [0u8; 32]);
    }

    #[test]
    fn test_v5_session_key_determinism() {
        let secret = [0xEFu8; 32];
        let client_pub = [0x01u8; 32];
        let server_pub = [0x02u8; 32];
        let challenge = [0x03u8; 32];

        let key1 = derive_v5_session_key(&secret, &client_pub, &server_pub, &challenge, 1000);
        let key2 = derive_v5_session_key(&secret, &client_pub, &server_pub, &challenge, 1000);
        assert_eq!(key1, key2);
    }

    #[test]
    fn test_v5_session_key_differs_with_challenge() {
        let secret = [0xEFu8; 32];
        let client_pub = [0x01u8; 32];
        let server_pub = [0x02u8; 32];
        let challenge1 = [0x03u8; 32];
        let challenge2 = [0x04u8; 32];

        let key1 = derive_v5_session_key(&secret, &client_pub, &server_pub, &challenge1, 1000);
        let key2 = derive_v5_session_key(&secret, &client_pub, &server_pub, &challenge2, 1000);
        assert_ne!(key1, key2);
    }

    #[test]
    fn test_v5_header_key_derivation() {
        let session_key = [0xAAu8; 32];
        let header_key = derive_v5_header_key(&session_key);
        assert_ne!(
            header_key, session_key,
            "header key must differ from session key"
        );
        assert_ne!(header_key, [0u8; 32]);

        // Deterministic
        let header_key2 = derive_v5_header_key(&session_key);
        assert_eq!(header_key, header_key2);
    }

    #[test]
    fn test_v5_migration_token_derivation() {
        let session_key = [0xBBu8; 32];
        let session_id = [0x01u8; 16];

        let token1 = derive_v5_migration_token(&session_key, &session_id);
        let token2 = derive_v5_migration_token(&session_key, &session_id);
        assert_eq!(token1, token2);
        assert_ne!(token1, [0u8; 32]);

        // Different session_id produces different token
        let other_id = [0x02u8; 16];
        let token3 = derive_v5_migration_token(&session_key, &other_id);
        assert_ne!(token1, token3);
    }
}
