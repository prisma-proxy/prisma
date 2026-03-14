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
fn build_kdf_context(
    shared_secret: &[u8; 32],
    client_pub: &[u8; 32],
    server_pub: &[u8; 32],
    timestamp: u64,
) -> Vec<u8> {
    let mut context = Vec::with_capacity(32 + 32 + 32 + 8);
    context.extend_from_slice(shared_secret);
    context.extend_from_slice(client_pub);
    context.extend_from_slice(server_pub);
    context.extend_from_slice(&timestamp.to_be_bytes());
    context
}

/// Derive a session key from the shared secret and contextual binding data.
///
/// Uses BLAKE3's key derivation mode with a domain separation string.
/// The context includes both public keys and a timestamp to ensure
/// unique keys per session even if ephemeral keys are somehow reused.
///
/// Legacy KDF, retained for compatibility testing.
pub fn derive_session_key(
    shared_secret: &[u8; 32],
    client_pub: &[u8; 32],
    server_pub: &[u8; 32],
    timestamp: u64,
) -> [u8; 32] {
    let context = build_kdf_context(shared_secret, client_pub, server_pub, timestamp);
    blake3_derive("prisma-veil-v1-session-key", &context)
}

/// Derive preliminary key for encrypting PrismaServerInit.
///
/// This key is derived from the shared secret + client's public key + server's public key + timestamp.
/// Used in the v4 handshake to encrypt the ServerInit response.
pub fn derive_preliminary_key(
    shared_secret: &[u8; 32],
    client_pub: &[u8; 32],
    server_pub: &[u8; 32],
    timestamp: u64,
) -> [u8; 32] {
    let context = build_kdf_context(shared_secret, client_pub, server_pub, timestamp);
    blake3_derive("prisma-v3-preliminary", &context)
}

/// Derive final session key with challenge binding.
///
/// This key is derived after the server proves its identity via the challenge.
/// Context includes the shared secret, both public keys, challenge, and timestamp.
/// Used in the v4 handshake for data transfer encryption.
pub fn derive_v3_session_key(
    shared_secret: &[u8; 32],
    client_pub: &[u8; 32],
    server_pub: &[u8; 32],
    challenge: &[u8; 32],
    timestamp: u64,
) -> [u8; 32] {
    let mut context = build_kdf_context(shared_secret, client_pub, server_pub, timestamp);
    context.extend_from_slice(challenge);
    blake3_derive("prisma-v3-session", &context)
}

/// Derive a key for encrypting/decrypting session tickets.
///
/// The ticket key is derived from a server-side secret using BLAKE3 KDF.
pub fn derive_ticket_key(server_secret: &[u8; 32]) -> [u8; 32] {
    blake3_derive("prisma-v3-session-ticket", server_secret)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kdf_determinism() {
        let secret = [0xABu8; 32];
        let client_pub = [0x01u8; 32];
        let server_pub = [0x02u8; 32];
        let timestamp = 1234567890u64;

        let key1 = derive_session_key(&secret, &client_pub, &server_pub, timestamp);
        let key2 = derive_session_key(&secret, &client_pub, &server_pub, timestamp);

        assert_eq!(key1, key2);
    }

    #[test]
    fn test_kdf_different_inputs_different_keys() {
        let secret = [0xABu8; 32];
        let client_pub = [0x01u8; 32];
        let server_pub = [0x02u8; 32];

        let key1 = derive_session_key(&secret, &client_pub, &server_pub, 1000);
        let key2 = derive_session_key(&secret, &client_pub, &server_pub, 1001);

        assert_ne!(key1, key2);
    }

    #[test]
    fn test_kdf_key_length() {
        let secret = [0u8; 32];
        let client_pub = [0u8; 32];
        let server_pub = [0u8; 32];

        let key = derive_session_key(&secret, &client_pub, &server_pub, 0);
        assert_eq!(key.len(), 32);
        // Should not be all zeros (vanishingly unlikely)
        assert_ne!(key, [0u8; 32]);
    }

    #[test]
    fn test_v3_preliminary_key_determinism() {
        let secret = [0xCDu8; 32];
        let client_pub = [0x01u8; 32];
        let server_pub = [0x02u8; 32];

        let key1 = derive_preliminary_key(&secret, &client_pub, &server_pub, 1000);
        let key2 = derive_preliminary_key(&secret, &client_pub, &server_pub, 1000);
        assert_eq!(key1, key2);
    }

    #[test]
    fn test_v3_preliminary_differs_from_v1() {
        let secret = [0xCDu8; 32];
        let client_pub = [0x01u8; 32];
        let server_pub = [0x02u8; 32];

        let v1_key = derive_session_key(&secret, &client_pub, &server_pub, 1000);
        let v3_prelim = derive_preliminary_key(&secret, &client_pub, &server_pub, 1000);
        assert_ne!(v1_key, v3_prelim);
    }

    #[test]
    fn test_v3_session_key_determinism() {
        let secret = [0xEFu8; 32];
        let client_pub = [0x01u8; 32];
        let server_pub = [0x02u8; 32];
        let challenge = [0x03u8; 32];

        let key1 = derive_v3_session_key(&secret, &client_pub, &server_pub, &challenge, 1000);
        let key2 = derive_v3_session_key(&secret, &client_pub, &server_pub, &challenge, 1000);
        assert_eq!(key1, key2);
    }

    #[test]
    fn test_v3_session_key_differs_with_challenge() {
        let secret = [0xEFu8; 32];
        let client_pub = [0x01u8; 32];
        let server_pub = [0x02u8; 32];
        let challenge1 = [0x03u8; 32];
        let challenge2 = [0x04u8; 32];

        let key1 = derive_v3_session_key(&secret, &client_pub, &server_pub, &challenge1, 1000);
        let key2 = derive_v3_session_key(&secret, &client_pub, &server_pub, &challenge2, 1000);
        assert_ne!(key1, key2);
    }

    #[test]
    fn test_ticket_key_derivation() {
        let secret = [0x42u8; 32];
        let key1 = derive_ticket_key(&secret);
        let key2 = derive_ticket_key(&secret);
        assert_eq!(key1, key2);
        assert_ne!(key1, [0u8; 32]);
    }
}
