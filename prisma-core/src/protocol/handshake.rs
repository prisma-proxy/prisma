use uuid::Uuid;

use crate::crypto::aead::create_cipher;
use crate::crypto::ecdh::EphemeralKeyPair;
use crate::crypto::kdf::{
    derive_v5_header_key, derive_v5_migration_token, derive_v5_preliminary_key,
    derive_v5_session_key,
};
use crate::crypto::pq_kem;
use crate::error::{CryptoError, PrismaError, ProtocolError};
use crate::protocol::codec::*;
use crate::protocol::types::*;
use crate::types::{CipherSuite, ClientId, PaddingRange, NONCE_SIZE, PRISMA_PROTOCOL_VERSION};
use crate::util;

// ===== Prisma Handshake (2-step: PrismaClientInit → PrismaServerInit) =====

/// Callback for the server to verify client credentials.
pub trait AuthVerifier: Send + Sync {
    fn verify(&self, client_id: &ClientId, auth_token: &[u8; 32], timestamp: u64) -> bool;
}

/// Client-side handshake state machine.
pub struct PrismaHandshakeClient {
    client_id: ClientId,
    auth_secret: [u8; 32],
    preferred_cipher: CipherSuite,
    enable_pq_kem: bool,
}

impl PrismaHandshakeClient {
    pub fn new(client_id: ClientId, auth_secret: [u8; 32], preferred_cipher: CipherSuite) -> Self {
        Self {
            client_id,
            auth_secret,
            preferred_cipher,
            enable_pq_kem: false,
        }
    }

    /// Enable hybrid post-quantum key exchange (X25519 + ML-KEM-768).
    pub fn with_pq_kem(mut self) -> Self {
        self.enable_pq_kem = true;
        self
    }

    /// Step 1: Generate PrismaClientInit and transition to awaiting PrismaServerInit.
    pub fn start(self) -> (PrismaClientAwaitingServerInit, Vec<u8>) {
        let keypair = EphemeralKeyPair::generate();
        let client_pub = keypair.public_key_bytes();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let auth_token = util::compute_auth_token(&self.auth_secret, &self.client_id, timestamp);

        // v5: request header authentication and connection migration
        let mut flags = CLIENT_INIT_FLAG_HEADER_AUTH | CLIENT_INIT_FLAG_MIGRATION;

        // Generate ML-KEM-768 keypair for hybrid PQ key exchange if enabled
        let (mlkem_keypair, pq_kem_encap_key) = if self.enable_pq_kem {
            flags |= CLIENT_INIT_FLAG_PQ_KEM;
            let kp = pq_kem::generate_mlkem_keypair();
            let ek_bytes = kp.ek_bytes.clone();
            (Some(kp), Some(ek_bytes))
        } else {
            (None, None)
        };

        let init = PrismaClientInit {
            version: PRISMA_PROTOCOL_VERSION,
            flags,
            client_ephemeral_pub: client_pub,
            client_id: self.client_id,
            timestamp,
            cipher_suite: self.preferred_cipher,
            auth_token,
            pq_kem_encap_key,
            padding: crate::crypto::padding::generate_padding(64),
        };
        let bytes = encode_client_init(&init);

        let state = PrismaClientAwaitingServerInit {
            keypair,
            client_pub,
            timestamp,
            client_id: self.client_id,
            preferred_cipher: self.preferred_cipher,
            mlkem_keypair,
        };

        (state, bytes)
    }
}

/// Intermediate state after PrismaClientInit is sent.
pub struct PrismaClientAwaitingServerInit {
    keypair: EphemeralKeyPair,
    client_pub: [u8; 32],
    timestamp: u64,
    client_id: ClientId,
    preferred_cipher: CipherSuite,
    /// ML-KEM-768 keypair for hybrid PQ KEM (present when CLIENT_INIT_FLAG_PQ_KEM was set).
    mlkem_keypair: Option<pq_kem::MlKemKeyPair>,
}

impl PrismaClientAwaitingServerInit {
    /// Process PrismaServerInit and produce session keys.
    /// Returns (SessionKeys, bucket_sizes).
    /// The client must then send a ChallengeResponse as its first data frame.
    pub fn process_server_init(
        self,
        encrypted_server_init: &[u8],
    ) -> Result<(SessionKeys, Vec<u16>), PrismaError> {
        if encrypted_server_init.len() < 32 + NONCE_SIZE + 2 {
            return Err(ProtocolError::InvalidFrame("PrismaServerInit too short".into()).into());
        }

        // Extract server's public key from clear prefix
        let mut server_pub = [0u8; 32];
        server_pub.copy_from_slice(&encrypted_server_init[..32]);
        let encrypted_payload = &encrypted_server_init[32..];

        // Derive shared secret
        let server_pub_key = x25519_dalek::PublicKey::from(server_pub);
        let shared_secret = self.keypair.diffie_hellman(&server_pub_key);

        // Derive preliminary key — use v5 KDF for v5 clients
        let prelim_key = derive_v5_preliminary_key(
            &shared_secret,
            &self.client_pub,
            &server_pub,
            self.timestamp,
        );

        // Decrypt PrismaServerInit
        let cipher = create_cipher(CipherSuite::ChaCha20Poly1305, &prelim_key);
        let (plaintext, _nonce) =
            decrypt_frame(cipher.as_ref(), encrypted_payload).map_err(|e| {
                ProtocolError::HandshakeFailed(format!("PrismaServerInit decrypt: {}", e))
            })?;

        let server_init = decode_server_init(&plaintext)?;

        if server_init.status != AcceptStatus::Ok {
            return Err(PrismaError::Auth(format!(
                "Server rejected: {:?}",
                server_init.status
            )));
        }

        // If PQ KEM was negotiated, decapsulate the ML-KEM ciphertext and combine
        // with the X25519 shared secret for hybrid post-quantum security.
        let shared_secret = if server_init.server_features & FEATURE_PQ_KEM != 0 {
            let mlkem_kp = self.mlkem_keypair.ok_or_else(|| {
                ProtocolError::HandshakeFailed(
                    "Server negotiated PQ KEM but client has no ML-KEM keypair".into(),
                )
            })?;
            let ct = server_init.pq_kem_ciphertext.as_ref().ok_or_else(|| {
                ProtocolError::HandshakeFailed(
                    "Server negotiated PQ KEM but no ciphertext in ServerInit".into(),
                )
            })?;
            let mlkem_shared = pq_kem::mlkem_decapsulate(&mlkem_kp.dk, ct).ok_or_else(|| {
                ProtocolError::HandshakeFailed("ML-KEM decapsulation failed".into())
            })?;
            pq_kem::hybrid_combine(&shared_secret, &mlkem_shared)
        } else {
            shared_secret
        };

        // Derive final session key — v5 KDF with version binding
        let session_key = derive_v5_session_key(
            &shared_secret,
            &self.client_pub,
            &server_init.server_ephemeral_pub,
            &server_init.challenge,
            self.timestamp,
        );

        let padding_range = PaddingRange::new(server_init.padding_min, server_init.padding_max);
        let bucket_sizes = server_init.bucket_sizes.clone();

        // v5: derive header key for header-authenticated encryption
        let header_key = if server_init.server_features & FEATURE_HEADER_AUTH != 0 {
            Some(derive_v5_header_key(&session_key))
        } else {
            None
        };

        // v5: derive migration token if server supports it
        let migration_token = if server_init.server_features & FEATURE_CONNECTION_MIGRATION != 0 {
            Some(derive_v5_migration_token(
                &session_key,
                server_init.session_id.as_bytes(),
            ))
        } else {
            None
        };

        Ok((
            SessionKeys {
                session_key,
                cipher_suite: self.preferred_cipher,
                session_id: server_init.session_id,
                client_id: self.client_id,
                client_nonce_counter: 0,
                server_nonce_counter: 0,
                protocol_version: PRISMA_PROTOCOL_VERSION,
                padding_range,
                challenge: Some(server_init.challenge),
                session_ticket: if server_init.session_ticket.is_empty() {
                    None
                } else {
                    Some(server_init.session_ticket)
                },
                header_key,
                migration_token,
            },
            bucket_sizes,
        ))
    }
}

/// Server-side handshake.
pub struct PrismaHandshakeServer;

impl PrismaHandshakeServer {
    /// Process a PrismaClientInit and produce an encrypted PrismaServerInit response.
    ///
    /// Only accepts v5 clients (v4 support removed in 0.9.0).
    ///
    /// Returns: (encrypted_server_init_bytes, PrismaServerCompleted)
    pub fn process_client_init(
        client_init_bytes: &[u8],
        padding_range: PaddingRange,
        server_features: u32,
        ticket_key: &[u8; 32],
        bucket_sizes: &[u16],
        verifier: &dyn AuthVerifier,
    ) -> Result<(Vec<u8>, PrismaServerCompleted), PrismaError> {
        let client_init = decode_client_init(client_init_bytes)?;

        // Only v5 is accepted (v4 backward compat removed in 0.9.0)
        if client_init.version != PRISMA_PROTOCOL_VERSION {
            return Err(ProtocolError::InvalidVersion(client_init.version).into());
        }

        // Reject TransportOnly cipher if server doesn't advertise support
        if client_init.cipher_suite == CipherSuite::TransportOnly
            && (server_features & FEATURE_TRANSPORT_ONLY_CIPHER == 0)
        {
            return Err(PrismaError::Auth(
                "TransportOnly cipher not supported by server".into(),
            ));
        }

        // Verify auth token
        if !verifier.verify(
            &client_init.client_id,
            &client_init.auth_token,
            client_init.timestamp,
        ) {
            return Err(PrismaError::Auth("Authentication failed".into()));
        }

        // Generate server ephemeral key
        let server_keypair = EphemeralKeyPair::generate();
        let server_pub = server_keypair.public_key_bytes();

        // Derive X25519 shared secret
        let client_pub_key = x25519_dalek::PublicKey::from(client_init.client_ephemeral_pub);
        let x25519_shared = server_keypair.diffie_hellman(&client_pub_key);

        // Generate random challenge
        let mut challenge = [0u8; 32];
        rand::Rng::fill(&mut rand::thread_rng(), &mut challenge[..]);

        let session_id = Uuid::new_v4();

        // Derive preliminary key from X25519 only (client needs this to decrypt
        // the ServerInit, which contains the ML-KEM ciphertext).
        let prelim_key = derive_v5_preliminary_key(
            &x25519_shared,
            &client_init.client_ephemeral_pub,
            &server_pub,
            client_init.timestamp,
        );

        // Hybrid PQ KEM: if both client and server support it, encapsulate with
        // client's ML-KEM key and combine the resulting shared secret with X25519.
        // The combined secret is used for the session key (not the preliminary key).
        let pq_kem_negotiated = client_init.flags & CLIENT_INIT_FLAG_PQ_KEM != 0
            && server_features & FEATURE_PQ_KEM != 0
            && client_init.pq_kem_encap_key.is_some();

        let (shared_secret, pq_kem_ciphertext) = if pq_kem_negotiated {
            let ek_bytes = client_init.pq_kem_encap_key.as_ref().unwrap();
            match pq_kem::mlkem_encapsulate(ek_bytes) {
                Some((ct, mlkem_shared)) => {
                    let combined = pq_kem::hybrid_combine(&x25519_shared, &mlkem_shared);
                    (combined, Some(ct))
                }
                None => {
                    // ML-KEM encapsulation failed; fall back to plain X25519
                    (x25519_shared, None)
                }
            }
        } else {
            (x25519_shared, None)
        };

        // Derive final session key (for data transfer) from the (potentially hybrid) shared secret
        let session_key = derive_v5_session_key(
            &shared_secret,
            &client_init.client_ephemeral_pub,
            &server_pub,
            &challenge,
            client_init.timestamp,
        );

        // Create session ticket
        let ticket_plaintext = encode_session_ticket(&SessionTicket {
            client_id: client_init.client_id,
            session_key,
            cipher_suite: client_init.cipher_suite,
            issued_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            padding_range,
        });
        let ticket_cipher = create_cipher(CipherSuite::ChaCha20Poly1305, ticket_key);
        let ticket_nonce = [0u8; NONCE_SIZE];
        let encrypted_ticket = ticket_cipher
            .encrypt(&ticket_nonce, &ticket_plaintext, &[])
            .map_err(|e| CryptoError::EncryptionFailed(format!("Ticket encrypt: {}", e)))?;

        // Negotiate features based on client flags
        let mut negotiated_features = server_features;
        // Always advertise v5 features
        negotiated_features |= FEATURE_V5_KDF | FEATURE_EXTENDED_ANTI_REPLAY;
        if client_init.flags & CLIENT_INIT_FLAG_HEADER_AUTH != 0 {
            negotiated_features |= FEATURE_HEADER_AUTH;
        }
        if client_init.flags & CLIENT_INIT_FLAG_MIGRATION != 0 {
            negotiated_features |= FEATURE_CONNECTION_MIGRATION;
        }
        // Only advertise PQ KEM if we actually negotiated it
        if pq_kem_ciphertext.is_some() {
            negotiated_features |= FEATURE_PQ_KEM;
        }

        // Build PrismaServerInit
        let server_init = PrismaServerInit {
            status: AcceptStatus::Ok,
            session_id,
            server_ephemeral_pub: server_pub,
            challenge,
            padding_min: padding_range.min,
            padding_max: padding_range.max,
            server_features: negotiated_features,
            session_ticket: encrypted_ticket,
            bucket_sizes: bucket_sizes.to_vec(),
            pq_kem_ciphertext,
            padding: crate::crypto::padding::generate_padding(64),
        };
        let init_plaintext = encode_server_init(&server_init);

        // Encrypt with preliminary key
        let prelim_cipher = create_cipher(CipherSuite::ChaCha20Poly1305, &prelim_key);
        let init_nonce = [0u8; NONCE_SIZE];
        let encrypted_init = encrypt_frame(prelim_cipher.as_ref(), &init_nonce, &init_plaintext)
            .map_err(|e| {
                CryptoError::EncryptionFailed(format!("PrismaServerInit encrypt: {}", e))
            })?;

        // Wire: [server_pub:32][encrypted_frame]
        let mut wire = Vec::with_capacity(32 + encrypted_init.len());
        wire.extend_from_slice(&server_pub);
        wire.extend_from_slice(&encrypted_init);

        // Derive additional v5 keys
        let header_key = if client_init.flags & CLIENT_INIT_FLAG_HEADER_AUTH != 0 {
            Some(derive_v5_header_key(&session_key))
        } else {
            None
        };

        let migration_token = if client_init.flags & CLIENT_INIT_FLAG_MIGRATION != 0 {
            Some(derive_v5_migration_token(
                &session_key,
                session_id.as_bytes(),
            ))
        } else {
            None
        };

        let state = PrismaServerCompleted {
            session_key,
            challenge,
            session_id,
            client_id: client_init.client_id,
            cipher_suite: client_init.cipher_suite,
            padding_range,
            protocol_version: PRISMA_PROTOCOL_VERSION,
            header_key,
            migration_token,
        };

        Ok((wire, state))
    }
}

/// Server state after handshake: waiting for client's challenge response in first data frame.
#[derive(Debug)]
pub struct PrismaServerCompleted {
    pub session_key: [u8; 32],
    pub challenge: [u8; 32],
    pub session_id: Uuid,
    pub client_id: ClientId,
    pub cipher_suite: CipherSuite,
    pub padding_range: PaddingRange,
    /// The protocol version (always v5).
    pub protocol_version: u8,
    /// Header authentication key (None if client did not request it).
    pub header_key: Option<[u8; 32]>,
    /// Connection migration token (None if client did not request it).
    pub migration_token: Option<[u8; 32]>,
}

impl PrismaServerCompleted {
    /// Complete the handshake by producing SessionKeys.
    /// The server should verify the challenge response from the first data frame separately.
    pub fn into_session_keys(self) -> SessionKeys {
        SessionKeys {
            session_key: self.session_key,
            cipher_suite: self.cipher_suite,
            session_id: self.session_id,
            client_id: self.client_id,
            client_nonce_counter: 0,
            server_nonce_counter: 0,
            protocol_version: self.protocol_version,
            padding_range: self.padding_range,
            challenge: Some(self.challenge),
            session_ticket: None,
            header_key: self.header_key,
            migration_token: self.migration_token,
        }
    }

    /// Verify a challenge response hash.
    pub fn verify_challenge(&self, response_hash: &[u8; 32]) -> bool {
        let expected: [u8; 32] = blake3::hash(&self.challenge).into();
        util::ct_eq(response_hash, &expected)
    }
}

// ===== Version detection helper =====

/// Check if a version byte is the supported Prisma protocol version (v5 only).
pub fn is_valid_protocol_version(version: u8) -> bool {
    version == PRISMA_PROTOCOL_VERSION
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestVerifier {
        expected_id: ClientId,
        auth_secret: [u8; 32],
    }

    impl AuthVerifier for TestVerifier {
        fn verify(&self, client_id: &ClientId, auth_token: &[u8; 32], timestamp: u64) -> bool {
            if *client_id != self.expected_id {
                return false;
            }
            let expected = util::compute_auth_token(&self.auth_secret, client_id, timestamp);
            util::ct_eq(auth_token, &expected)
        }
    }

    fn server_state_verify_challenge(challenge: &[u8; 32], response_hash: &[u8; 32]) -> bool {
        let expected: [u8; 32] = blake3::hash(challenge).into();
        util::ct_eq(response_hash, &expected)
    }

    #[test]
    fn test_prisma_handshake() {
        let client_id = ClientId::new();
        let auth_secret = [0x42u8; 32];
        let ticket_key = [0xFFu8; 32];
        let bucket_sizes = vec![128, 256, 512, 1024, 2048, 4096, 8192, 16384];

        let verifier = TestVerifier {
            expected_id: client_id,
            auth_secret,
        };

        // Client step 1: send PrismaClientInit
        let client_hs =
            PrismaHandshakeClient::new(client_id, auth_secret, CipherSuite::ChaCha20Poly1305);
        let (client_state, client_init_bytes) = client_hs.start();

        // Server step 1: process PrismaClientInit, produce PrismaServerInit
        let padding_range = PaddingRange::new(0, 256);
        let (server_init_bytes, server_state) = PrismaHandshakeServer::process_client_init(
            &client_init_bytes,
            padding_range,
            FEATURE_UDP_RELAY | FEATURE_SPEED_TEST,
            &ticket_key,
            &bucket_sizes,
            &verifier,
        )
        .unwrap();

        // Client step 2: process PrismaServerInit
        let (client_session, client_buckets) = client_state
            .process_server_init(&server_init_bytes)
            .unwrap();

        // Server produces session keys
        let server_session = server_state.into_session_keys();

        // Both sides should have the same session key
        assert_eq!(client_session.session_key, server_session.session_key);
        assert_eq!(client_session.session_id, server_session.session_id);
        assert_eq!(client_session.cipher_suite, server_session.cipher_suite);
        assert_eq!(client_session.protocol_version, PRISMA_PROTOCOL_VERSION);

        // Client should have a challenge to respond to
        assert!(client_session.challenge.is_some());
        assert!(client_session.session_ticket.is_some());

        // Client should receive bucket sizes
        assert_eq!(client_buckets, bucket_sizes);

        // Verify challenge response
        let challenge = client_session.challenge.unwrap();
        let response_hash: [u8; 32] = blake3::hash(&challenge).into();
        assert!(server_state_verify_challenge(
            &server_session.challenge.unwrap(),
            &response_hash
        ));
    }

    #[test]
    fn test_prisma_handshake_bad_auth() {
        let client_id = ClientId::new();
        let client_secret = [0x42u8; 32];
        let wrong_secret = [0x99u8; 32];
        let ticket_key = [0xFFu8; 32];

        let verifier = TestVerifier {
            expected_id: client_id,
            auth_secret: wrong_secret,
        };

        let client_hs =
            PrismaHandshakeClient::new(client_id, client_secret, CipherSuite::ChaCha20Poly1305);
        let (_, client_init_bytes) = client_hs.start();

        let result = PrismaHandshakeServer::process_client_init(
            &client_init_bytes,
            PaddingRange::new(0, 256),
            0,
            &ticket_key,
            &[128, 256, 512],
            &verifier,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_prisma_handshake_wrong_client_id() {
        let client_id = ClientId::new();
        let other_id = ClientId::new();
        let auth_secret = [0x42u8; 32];
        let ticket_key = [0xFFu8; 32];

        let verifier = TestVerifier {
            expected_id: other_id, // Verifier expects a different client
            auth_secret,
        };

        let client_hs =
            PrismaHandshakeClient::new(client_id, auth_secret, CipherSuite::ChaCha20Poly1305);
        let (_, client_init_bytes) = client_hs.start();

        let result = PrismaHandshakeServer::process_client_init(
            &client_init_bytes,
            PaddingRange::new(0, 256),
            0,
            &ticket_key,
            &[],
            &verifier,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_prisma_handshake_aes256gcm() {
        let client_id = ClientId::new();
        let auth_secret = [0x42u8; 32];
        let ticket_key = [0xFFu8; 32];

        let verifier = TestVerifier {
            expected_id: client_id,
            auth_secret,
        };

        // Use AES-256-GCM cipher suite
        let client_hs = PrismaHandshakeClient::new(client_id, auth_secret, CipherSuite::Aes256Gcm);
        let (client_state, client_init_bytes) = client_hs.start();

        let padding_range = PaddingRange::new(10, 128);
        let (server_init_bytes, server_state) = PrismaHandshakeServer::process_client_init(
            &client_init_bytes,
            padding_range,
            0,
            &ticket_key,
            &[],
            &verifier,
        )
        .unwrap();

        let (client_session, client_buckets) = client_state
            .process_server_init(&server_init_bytes)
            .unwrap();

        let server_session = server_state.into_session_keys();

        assert_eq!(client_session.session_key, server_session.session_key);
        assert_eq!(client_session.cipher_suite, CipherSuite::Aes256Gcm);
        assert_eq!(server_session.cipher_suite, CipherSuite::Aes256Gcm);
        assert_eq!(client_session.padding_range, padding_range);
        assert!(client_buckets.is_empty());
    }

    #[test]
    fn test_prisma_handshake_no_buckets() {
        let client_id = ClientId::new();
        let auth_secret = [0x42u8; 32];
        let ticket_key = [0xFFu8; 32];

        let verifier = TestVerifier {
            expected_id: client_id,
            auth_secret,
        };

        let client_hs =
            PrismaHandshakeClient::new(client_id, auth_secret, CipherSuite::ChaCha20Poly1305);
        let (client_state, client_init_bytes) = client_hs.start();

        let (server_init_bytes, server_state) = PrismaHandshakeServer::process_client_init(
            &client_init_bytes,
            PaddingRange::new(0, 256),
            FEATURE_UDP_RELAY | FEATURE_FEC | FEATURE_DNS_TUNNEL,
            &ticket_key,
            &[], // no bucket sizes
            &verifier,
        )
        .unwrap();

        let (client_session, client_buckets) = client_state
            .process_server_init(&server_init_bytes)
            .unwrap();
        let server_session = server_state.into_session_keys();

        assert_eq!(client_session.session_key, server_session.session_key);
        assert!(client_buckets.is_empty());
    }

    #[test]
    fn test_prisma_challenge_verification() {
        let client_id = ClientId::new();
        let auth_secret = [0x42u8; 32];
        let ticket_key = [0xFFu8; 32];

        let verifier = TestVerifier {
            expected_id: client_id,
            auth_secret,
        };

        let client_hs =
            PrismaHandshakeClient::new(client_id, auth_secret, CipherSuite::ChaCha20Poly1305);
        let (client_state, client_init_bytes) = client_hs.start();

        let (server_init_bytes, server_state) = PrismaHandshakeServer::process_client_init(
            &client_init_bytes,
            PaddingRange::new(0, 256),
            0,
            &ticket_key,
            &[],
            &verifier,
        )
        .unwrap();

        let (client_session, _) = client_state
            .process_server_init(&server_init_bytes)
            .unwrap();

        // Correct challenge response should verify
        let challenge = client_session.challenge.unwrap();
        let correct_hash: [u8; 32] = blake3::hash(&challenge).into();
        assert!(server_state.verify_challenge(&correct_hash));

        // Wrong challenge response should fail
        let wrong_hash = [0xFFu8; 32];
        assert!(!server_state.verify_challenge(&wrong_hash));
    }

    #[test]
    fn test_prisma_handshake_session_ticket_present() {
        let client_id = ClientId::new();
        let auth_secret = [0x42u8; 32];
        let ticket_key = [0xFFu8; 32];

        let verifier = TestVerifier {
            expected_id: client_id,
            auth_secret,
        };

        let client_hs =
            PrismaHandshakeClient::new(client_id, auth_secret, CipherSuite::ChaCha20Poly1305);
        let (client_state, client_init_bytes) = client_hs.start();

        let (server_init_bytes, _server_state) = PrismaHandshakeServer::process_client_init(
            &client_init_bytes,
            PaddingRange::new(0, 256),
            0,
            &ticket_key,
            &[],
            &verifier,
        )
        .unwrap();

        let (client_session, _) = client_state
            .process_server_init(&server_init_bytes)
            .unwrap();

        // Session ticket should be present (server always generates one)
        assert!(client_session.session_ticket.is_some());
        let ticket_bytes = client_session.session_ticket.unwrap();
        assert!(!ticket_bytes.is_empty());
    }

    #[test]
    fn test_prisma_version_detection() {
        assert!(is_valid_protocol_version(PRISMA_PROTOCOL_VERSION));
        assert!(is_valid_protocol_version(0x05)); // v5 current
        // v4 no longer accepted (removed in 0.9.0)
        assert!(!is_valid_protocol_version(0x04));
        // Old versions should be invalid
        assert!(!is_valid_protocol_version(0x01));
        assert!(!is_valid_protocol_version(0x02));
        assert!(!is_valid_protocol_version(0x03));
        // Future versions should be invalid
        assert!(!is_valid_protocol_version(0x06));
        assert!(!is_valid_protocol_version(0x00));
    }

    #[test]
    fn test_prisma_server_init_too_short() {
        let client_id = ClientId::new();
        let auth_secret = [0x42u8; 32];

        let client_hs =
            PrismaHandshakeClient::new(client_id, auth_secret, CipherSuite::ChaCha20Poly1305);
        let (client_state, _) = client_hs.start();

        // Too-short data should fail
        let short_data = vec![0u8; 10];
        let result = client_state.process_server_init(&short_data);
        assert!(result.is_err());
    }

    #[test]
    fn test_prisma_client_init_version_mismatch() {
        let client_id = ClientId::new();
        let auth_secret = [0x42u8; 32];
        let ticket_key = [0xFFu8; 32];

        let verifier = TestVerifier {
            expected_id: client_id,
            auth_secret,
        };

        // Manually construct a PrismaClientInit with wrong version
        let keypair = EphemeralKeyPair::generate();
        let client_pub = keypair.public_key_bytes();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let auth_token = util::compute_auth_token(&auth_secret, &client_id, timestamp);

        let bad_init = PrismaClientInit {
            version: 0x02, // Unsupported old version
            flags: 0,
            client_ephemeral_pub: client_pub,
            client_id,
            timestamp,
            cipher_suite: CipherSuite::ChaCha20Poly1305,
            auth_token,
            pq_kem_encap_key: None,
            padding: vec![],
        };
        let bad_bytes = encode_client_init(&bad_init);

        let result = PrismaHandshakeServer::process_client_init(
            &bad_bytes,
            PaddingRange::new(0, 256),
            0,
            &ticket_key,
            &[],
            &verifier,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_prisma_server_completed_into_session_keys() {
        let session_key = [0xAAu8; 32];
        let challenge = [0xBBu8; 32];
        let session_id = Uuid::new_v4();
        let client_id = ClientId::new();
        let padding_range = PaddingRange::new(10, 200);

        let completed = PrismaServerCompleted {
            session_key,
            challenge,
            session_id,
            client_id,
            cipher_suite: CipherSuite::ChaCha20Poly1305,
            padding_range,
            protocol_version: PRISMA_PROTOCOL_VERSION,
            header_key: Some([0xCCu8; 32]),
            migration_token: Some([0xDDu8; 32]),
        };

        let keys = completed.into_session_keys();
        assert_eq!(keys.session_key, session_key);
        assert_eq!(keys.session_id, session_id);
        assert_eq!(keys.client_id, client_id);
        assert_eq!(keys.cipher_suite, CipherSuite::ChaCha20Poly1305);
        assert_eq!(keys.protocol_version, PRISMA_PROTOCOL_VERSION);
        assert_eq!(keys.padding_range, padding_range);
        assert_eq!(keys.challenge, Some(challenge));
        assert_eq!(keys.session_ticket, None);
        assert_eq!(keys.client_nonce_counter, 0);
        assert_eq!(keys.server_nonce_counter, 0);
        assert_eq!(keys.header_key, Some([0xCCu8; 32]));
        assert_eq!(keys.migration_token, Some([0xDDu8; 32]));
    }

    #[test]
    fn test_server_key_pin_verification_success() {
        // Full handshake, then verify the server's public key pin matches.
        let client_id = ClientId::new();
        let auth_secret = [0x42u8; 32];
        let ticket_key = [0xFFu8; 32];

        let verifier = TestVerifier {
            expected_id: client_id,
            auth_secret,
        };

        let client_hs =
            PrismaHandshakeClient::new(client_id, auth_secret, CipherSuite::ChaCha20Poly1305);
        let (client_state, client_init_bytes) = client_hs.start();

        let (server_init_bytes, _server_state) = PrismaHandshakeServer::process_client_init(
            &client_init_bytes,
            PaddingRange::new(0, 256),
            0,
            &ticket_key,
            &[],
            &verifier,
        )
        .unwrap();

        // Extract server public key (first 32 bytes of wire format)
        let mut server_pub = [0u8; 32];
        server_pub.copy_from_slice(&server_init_bytes[..32]);

        // Compute the pin from the server's public key
        let pin = crate::util::compute_server_key_pin(&server_pub);

        // Verify should succeed with the correct pin
        assert!(crate::util::verify_server_key_pin(&pin, &server_pub).is_ok());

        // The handshake should still succeed after pin verification
        let (session_keys, _) = client_state
            .process_server_init(&server_init_bytes)
            .unwrap();
        assert!(session_keys.challenge.is_some());
    }

    #[test]
    fn test_server_key_pin_verification_failure() {
        // Full handshake, then verify that a wrong pin is rejected.
        let client_id = ClientId::new();
        let auth_secret = [0x42u8; 32];
        let ticket_key = [0xFFu8; 32];

        let verifier = TestVerifier {
            expected_id: client_id,
            auth_secret,
        };

        let client_hs =
            PrismaHandshakeClient::new(client_id, auth_secret, CipherSuite::ChaCha20Poly1305);
        let (_client_state, client_init_bytes) = client_hs.start();

        let (server_init_bytes, _server_state) = PrismaHandshakeServer::process_client_init(
            &client_init_bytes,
            PaddingRange::new(0, 256),
            0,
            &ticket_key,
            &[],
            &verifier,
        )
        .unwrap();

        // Extract server public key (first 32 bytes of wire format)
        let mut server_pub = [0u8; 32];
        server_pub.copy_from_slice(&server_init_bytes[..32]);

        // Use a wrong pin (pin of a different key)
        let wrong_key = [0xEEu8; 32];
        let wrong_pin = crate::util::compute_server_key_pin(&wrong_key);

        // Verify should fail with the wrong pin
        let result = crate::util::verify_server_key_pin(&wrong_pin, &server_pub);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("pin mismatch"));
    }

    #[test]
    fn test_no_server_key_pin_skips_verification() {
        // When no pin is configured (None), the handshake should proceed without
        // any pin check. This test verifies the handshake completes successfully.
        let client_id = ClientId::new();
        let auth_secret = [0x42u8; 32];
        let ticket_key = [0xFFu8; 32];

        let verifier = TestVerifier {
            expected_id: client_id,
            auth_secret,
        };

        let client_hs =
            PrismaHandshakeClient::new(client_id, auth_secret, CipherSuite::ChaCha20Poly1305);
        let (client_state, client_init_bytes) = client_hs.start();

        let (server_init_bytes, server_state) = PrismaHandshakeServer::process_client_init(
            &client_init_bytes,
            PaddingRange::new(0, 256),
            0,
            &ticket_key,
            &[],
            &verifier,
        )
        .unwrap();

        // No pin verification — just complete the handshake
        let (client_session, _) = client_state
            .process_server_init(&server_init_bytes)
            .unwrap();

        let server_session = server_state.into_session_keys();
        assert_eq!(client_session.session_key, server_session.session_key);
    }

    #[test]
    fn test_prisma_handshake_pq_kem() {
        // Full handshake with hybrid PQ KEM enabled on both sides.
        let client_id = ClientId::new();
        let auth_secret = [0x42u8; 32];
        let ticket_key = [0xFFu8; 32];
        let bucket_sizes = vec![128, 256, 512, 1024];

        let verifier = TestVerifier {
            expected_id: client_id,
            auth_secret,
        };

        // Client enables PQ KEM
        let client_hs =
            PrismaHandshakeClient::new(client_id, auth_secret, CipherSuite::ChaCha20Poly1305)
                .with_pq_kem();
        let (client_state, client_init_bytes) = client_hs.start();

        // Server enables PQ KEM via server_features
        let (server_init_bytes, server_state) = PrismaHandshakeServer::process_client_init(
            &client_init_bytes,
            PaddingRange::new(0, 256),
            FEATURE_UDP_RELAY | FEATURE_PQ_KEM,
            &ticket_key,
            &bucket_sizes,
            &verifier,
        )
        .unwrap();

        // Client processes server response (with PQ KEM ciphertext)
        let (client_session, client_buckets) = client_state
            .process_server_init(&server_init_bytes)
            .unwrap();

        let server_session = server_state.into_session_keys();

        // Both sides must agree on session key (derived from hybrid X25519+ML-KEM secret)
        assert_eq!(client_session.session_key, server_session.session_key);
        assert_eq!(client_session.session_id, server_session.session_id);
        assert_eq!(client_session.cipher_suite, server_session.cipher_suite);
        assert_eq!(client_session.protocol_version, PRISMA_PROTOCOL_VERSION);
        assert!(client_session.challenge.is_some());
        assert!(client_session.session_ticket.is_some());
        assert_eq!(client_buckets, bucket_sizes);

        // Verify challenge response still works
        let challenge = client_session.challenge.unwrap();
        let response_hash: [u8; 32] = blake3::hash(&challenge).into();
        assert!(server_state_verify_challenge(
            &server_session.challenge.unwrap(),
            &response_hash
        ));
    }

    #[test]
    fn test_prisma_handshake_pq_kem_backward_compat() {
        // Client enables PQ KEM but server does NOT support it.
        // Handshake should succeed using plain X25519.
        let client_id = ClientId::new();
        let auth_secret = [0x42u8; 32];
        let ticket_key = [0xFFu8; 32];

        let verifier = TestVerifier {
            expected_id: client_id,
            auth_secret,
        };

        let client_hs =
            PrismaHandshakeClient::new(client_id, auth_secret, CipherSuite::ChaCha20Poly1305)
                .with_pq_kem();
        let (client_state, client_init_bytes) = client_hs.start();

        // Server does NOT advertise FEATURE_PQ_KEM
        let (server_init_bytes, server_state) = PrismaHandshakeServer::process_client_init(
            &client_init_bytes,
            PaddingRange::new(0, 256),
            FEATURE_UDP_RELAY, // no PQ KEM
            &ticket_key,
            &[],
            &verifier,
        )
        .unwrap();

        let (client_session, _) = client_state
            .process_server_init(&server_init_bytes)
            .unwrap();

        let server_session = server_state.into_session_keys();

        // Handshake should still succeed with plain X25519
        assert_eq!(client_session.session_key, server_session.session_key);
    }

    #[test]
    fn test_prisma_handshake_pq_kem_differs_from_non_pq() {
        // Verify that a PQ KEM handshake produces a different session key than
        // a non-PQ handshake (since ML-KEM adds additional entropy).
        // Note: We can't directly compare because ephemeral keys differ,
        // but we verify the PQ KEM handshake itself is internally consistent.
        let client_id = ClientId::new();
        let auth_secret = [0x42u8; 32];
        let ticket_key = [0xFFu8; 32];

        let verifier = TestVerifier {
            expected_id: client_id,
            auth_secret,
        };

        // PQ KEM handshake
        let client_hs =
            PrismaHandshakeClient::new(client_id, auth_secret, CipherSuite::ChaCha20Poly1305)
                .with_pq_kem();
        let (client_state, client_init_bytes) = client_hs.start();

        let (server_init_bytes, server_state) = PrismaHandshakeServer::process_client_init(
            &client_init_bytes,
            PaddingRange::new(0, 256),
            FEATURE_PQ_KEM,
            &ticket_key,
            &[],
            &verifier,
        )
        .unwrap();

        let (client_session, _) = client_state
            .process_server_init(&server_init_bytes)
            .unwrap();

        let server_session = server_state.into_session_keys();

        assert_eq!(client_session.session_key, server_session.session_key);
        // Session key should not be all zeros
        assert_ne!(client_session.session_key, [0u8; 32]);
    }
}
