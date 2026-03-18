//! Hybrid post-quantum key exchange: X25519 + ML-KEM-768.
//!
//! Combines classical X25519 ECDH with the FIPS 203 ML-KEM-768 lattice-based
//! KEM for quantum-resistant key agreement. The hybrid approach ensures that
//! even if ML-KEM is broken, X25519 still provides classical security.
//!
//! Wire sizes:
//! - ML-KEM-768 encapsulation key: 1184 bytes
//! - ML-KEM-768 ciphertext: 1088 bytes
//! - ML-KEM-768 shared secret: 32 bytes

use ml_kem::{Encoded, EncodedSizeUser, KemCore, MlKem768};
use rand::rngs::OsRng;
use x25519_dalek::PublicKey;

use super::ecdh::EphemeralKeyPair;

/// ML-KEM-768 encapsulation key size in bytes.
pub const MLKEM_ENCAP_KEY_SIZE: usize = 1184;

/// ML-KEM-768 ciphertext size in bytes.
pub const MLKEM_CIPHERTEXT_SIZE: usize = 1088;

/// Client-side state for the hybrid key exchange, holding secrets until
/// the server responds.
pub struct HybridClientState {
    /// X25519 ephemeral keypair (consumed on `client_finish`).
    x25519_keypair: EphemeralKeyPair,
    /// ML-KEM-768 decapsulation (private) key.
    mlkem_dk: <MlKem768 as KemCore>::DecapsulationKey,
}

/// Data sent from client to server: X25519 public key + ML-KEM encapsulation key.
pub struct HybridClientInit {
    /// X25519 ephemeral public key (32 bytes).
    pub x25519_public: [u8; 32],
    /// ML-KEM-768 encapsulation key (1184 bytes).
    pub mlkem_encap_key: Vec<u8>,
}

/// Data sent from server to client: X25519 public key + ML-KEM ciphertext.
pub struct HybridServerInit {
    /// X25519 ephemeral public key (32 bytes).
    pub x25519_public: [u8; 32],
    /// ML-KEM-768 ciphertext (1088 bytes).
    pub mlkem_ciphertext: Vec<u8>,
}

/// Derive a hybrid shared secret by combining X25519 and ML-KEM shared secrets
/// using BLAKE3 KDF with a dedicated domain separation string.
fn combine_shared_secrets(x25519_shared: &[u8; 32], mlkem_shared: &[u8]) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new_derive_key("prisma-v5-hybrid-pq-kem");
    hasher.update(x25519_shared);
    hasher.update(mlkem_shared);
    let mut output = [0u8; 32];
    let mut reader = hasher.finalize_xof();
    reader.fill(&mut output);
    output
}

/// ML-KEM-768 keypair for use in the handshake (ML-KEM part only).
pub struct MlKemKeyPair {
    /// Decapsulation key (private), used by the client to decapsulate.
    pub dk: <MlKem768 as KemCore>::DecapsulationKey,
    /// Encoded encapsulation key (public), sent to the server.
    pub ek_bytes: Vec<u8>,
}

/// Generate an ML-KEM-768 keypair. The encapsulation key bytes are sent to the
/// server; the decapsulation key is held by the client until the server responds.
pub fn generate_mlkem_keypair() -> MlKemKeyPair {
    let (dk, ek) = MlKem768::generate(&mut OsRng);
    let ek_encoded: Encoded<<MlKem768 as KemCore>::EncapsulationKey> = ek.as_bytes();
    MlKemKeyPair {
        dk,
        ek_bytes: ek_encoded.to_vec(),
    }
}

/// Server-side: encapsulate a shared secret using the client's ML-KEM encapsulation key.
///
/// Returns `(ciphertext, mlkem_shared_secret)` or `None` if the encap key is invalid.
pub fn mlkem_encapsulate(ek_bytes: &[u8]) -> Option<(Vec<u8>, [u8; 32])> {
    use kem::Encapsulate;

    if ek_bytes.len() != MLKEM_ENCAP_KEY_SIZE {
        return None;
    }
    let ek_encoded =
        Encoded::<<MlKem768 as KemCore>::EncapsulationKey>::try_from(ek_bytes).ok()?;
    let ek = <MlKem768 as KemCore>::EncapsulationKey::from_bytes(&ek_encoded);
    let (ct, shared) = ek.encapsulate(&mut OsRng).ok()?;
    let mut shared_arr = [0u8; 32];
    shared_arr.copy_from_slice(&shared);
    Some((ct.to_vec(), shared_arr))
}

/// Client-side: decapsulate a shared secret from the server's ciphertext.
///
/// Returns the ML-KEM shared secret or `None` if the ciphertext is invalid.
pub fn mlkem_decapsulate(
    dk: &<MlKem768 as KemCore>::DecapsulationKey,
    ct_bytes: &[u8],
) -> Option<[u8; 32]> {
    use kem::Decapsulate;

    if ct_bytes.len() != MLKEM_CIPHERTEXT_SIZE {
        return None;
    }
    let ct = ml_kem::Ciphertext::<MlKem768>::try_from(ct_bytes).ok()?;
    let shared = dk.decapsulate(&ct).ok()?;
    let mut shared_arr = [0u8; 32];
    shared_arr.copy_from_slice(&shared);
    Some(shared_arr)
}

/// Combine an X25519 shared secret with an ML-KEM shared secret into a single
/// hybrid shared secret using BLAKE3 KDF.
pub fn hybrid_combine(x25519_shared: &[u8; 32], mlkem_shared: &[u8; 32]) -> [u8; 32] {
    combine_shared_secrets(x25519_shared, mlkem_shared)
}

/// Generate client-side hybrid key material.
///
/// Returns the client state (secrets) and the public init data to send to the server.
pub fn client_init() -> (HybridClientState, HybridClientInit) {
    let x25519_keypair = EphemeralKeyPair::generate();
    let x25519_public = x25519_keypair.public_key_bytes();

    let (mlkem_dk, mlkem_ek) = MlKem768::generate(&mut OsRng);
    let ek_encoded: Encoded<<MlKem768 as KemCore>::EncapsulationKey> = mlkem_ek.as_bytes();
    let mlkem_encap_key = ek_encoded.to_vec();

    let state = HybridClientState {
        x25519_keypair,
        mlkem_dk,
    };
    let init = HybridClientInit {
        x25519_public,
        mlkem_encap_key,
    };
    (state, init)
}

/// Server-side hybrid key exchange: process client init data and produce the
/// shared secret + server response.
///
/// Returns `None` if the ML-KEM encapsulation key is malformed.
pub fn server_respond(client_init: &HybridClientInit) -> Option<([u8; 32], HybridServerInit)> {
    use kem::Encapsulate;

    // X25519 exchange
    let server_x25519 = EphemeralKeyPair::generate();
    let server_x25519_public = server_x25519.public_key_bytes();
    let client_x25519_pub = PublicKey::from(client_init.x25519_public);
    let x25519_shared = server_x25519.diffie_hellman(&client_x25519_pub);

    // ML-KEM-768 encapsulation
    let ek_bytes = client_init.mlkem_encap_key.as_slice();
    if ek_bytes.len() != MLKEM_ENCAP_KEY_SIZE {
        return None;
    }
    let ek_encoded =
        Encoded::<<MlKem768 as KemCore>::EncapsulationKey>::try_from(ek_bytes).ok()?;
    let ek = <MlKem768 as KemCore>::EncapsulationKey::from_bytes(&ek_encoded);
    let (ct, mlkem_shared) = ek.encapsulate(&mut OsRng).ok()?;

    let mlkem_ciphertext = ct.to_vec();

    // Combine shared secrets
    let combined = combine_shared_secrets(&x25519_shared, &mlkem_shared);

    let server_init = HybridServerInit {
        x25519_public: server_x25519_public,
        mlkem_ciphertext,
    };
    Some((combined, server_init))
}

/// Client-side hybrid key exchange completion: process server response and
/// derive the shared secret.
///
/// Returns `None` if the ML-KEM ciphertext is malformed.
pub fn client_finish(
    client_state: HybridClientState,
    server_init: &HybridServerInit,
) -> Option<[u8; 32]> {
    // X25519 exchange
    let server_x25519_pub = PublicKey::from(server_init.x25519_public);
    let x25519_shared = client_state.x25519_keypair.diffie_hellman(&server_x25519_pub);

    // ML-KEM-768 decapsulation
    use ml_kem::kem::Decapsulate;

    let ct_bytes = server_init.mlkem_ciphertext.as_slice();
    if ct_bytes.len() != MLKEM_CIPHERTEXT_SIZE {
        return None;
    }
    let ct = ml_kem::Ciphertext::<MlKem768>::try_from(ct_bytes).ok()?;
    let mlkem_shared = client_state.mlkem_dk.decapsulate(&ct).ok()?;

    // Combine shared secrets
    let combined = combine_shared_secrets(&x25519_shared, &mlkem_shared);
    Some(combined)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hybrid_key_exchange_round_trip() {
        let (client_state, client_init_data) = client_init();
        let (server_shared, server_init_data) =
            server_respond(&client_init_data).expect("server_respond should succeed");
        let client_shared =
            client_finish(client_state, &server_init_data).expect("client_finish should succeed");
        assert_eq!(client_shared, server_shared);
        assert_ne!(client_shared, [0u8; 32]);
    }

    #[test]
    fn test_hybrid_key_exchange_different_sessions_differ() {
        let (state1, init1) = client_init();
        let (shared1, resp1) = server_respond(&init1).unwrap();
        let client1 = client_finish(state1, &resp1).unwrap();
        assert_eq!(client1, shared1);

        let (state2, init2) = client_init();
        let (shared2, resp2) = server_respond(&init2).unwrap();
        let client2 = client_finish(state2, &resp2).unwrap();
        assert_eq!(client2, shared2);

        assert_ne!(shared1, shared2);
    }

    #[test]
    fn test_hybrid_encap_key_size() {
        let (_state, init) = client_init();
        assert_eq!(init.mlkem_encap_key.len(), MLKEM_ENCAP_KEY_SIZE);
        assert_eq!(init.x25519_public.len(), 32);
    }

    #[test]
    fn test_hybrid_ciphertext_size() {
        let (_state, init) = client_init();
        let (_shared, resp) = server_respond(&init).unwrap();
        assert_eq!(resp.mlkem_ciphertext.len(), MLKEM_CIPHERTEXT_SIZE);
        assert_eq!(resp.x25519_public.len(), 32);
    }

    #[test]
    fn test_server_respond_rejects_bad_encap_key() {
        let init = HybridClientInit {
            x25519_public: [0xAA; 32],
            mlkem_encap_key: vec![0u8; 100],
        };
        assert!(server_respond(&init).is_none());
    }

    #[test]
    fn test_client_finish_rejects_bad_ciphertext() {
        let (state, _init) = client_init();
        let bad_server = HybridServerInit {
            x25519_public: [0xBB; 32],
            mlkem_ciphertext: vec![0u8; 100],
        };
        assert!(client_finish(state, &bad_server).is_none());
    }

    #[test]
    fn test_combine_shared_secrets_determinism() {
        let x25519 = [0xAAu8; 32];
        let mlkem = [0xBBu8; 32];
        let result1 = combine_shared_secrets(&x25519, &mlkem);
        let result2 = combine_shared_secrets(&x25519, &mlkem);
        assert_eq!(result1, result2);
        assert_ne!(result1, [0u8; 32]);
    }

    #[test]
    fn test_combine_shared_secrets_different_inputs() {
        let x25519 = [0xAAu8; 32];
        let mlkem1 = [0xBBu8; 32];
        let mlkem2 = [0xCCu8; 32];
        let result1 = combine_shared_secrets(&x25519, &mlkem1);
        let result2 = combine_shared_secrets(&x25519, &mlkem2);
        assert_ne!(result1, result2);
    }
}
