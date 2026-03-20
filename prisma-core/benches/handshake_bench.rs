//! Criterion benchmarks for the full PrismaVeil v5 handshake.
//!
//! Measures end-to-end handshake timing: client init generation, server init
//! processing, key derivation, and the complete client+server round-trip.
//!
//! Run: `cargo bench -p prisma-core -- handshake`

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use x25519_dalek::PublicKey;

use prisma_core::crypto::aead::create_cipher;
use prisma_core::crypto::ecdh::EphemeralKeyPair;
use prisma_core::crypto::kdf::{derive_v5_preliminary_key, derive_v5_session_key};
use prisma_core::protocol::codec::{
    decode_client_init, decode_server_init, encode_client_init, encode_server_init,
};
use prisma_core::protocol::types::*;
use prisma_core::types::{CipherSuite, ClientId, NONCE_SIZE, PRISMA_PROTOCOL_VERSION};

/// Benchmark client-side handshake init generation (keypair + auth token + encode).
fn bench_client_init_generation(c: &mut Criterion) {
    let client_id = ClientId(uuid::Uuid::nil());
    let auth_secret = [0xABu8; 32];

    c.bench_function("handshake/client_init_generate", |b| {
        b.iter(|| {
            let keypair = EphemeralKeyPair::generate();
            let client_pub = keypair.public_key_bytes();
            let timestamp = 1700000000u64;
            let auth_token =
                prisma_core::util::compute_auth_token(&auth_secret, &client_id, timestamp);

            let init = PrismaClientInit {
                version: PRISMA_PROTOCOL_VERSION,
                flags: CLIENT_INIT_FLAG_HEADER_AUTH | CLIENT_INIT_FLAG_MIGRATION,
                client_ephemeral_pub: client_pub,
                client_id,
                timestamp,
                cipher_suite: CipherSuite::ChaCha20Poly1305,
                auth_token,
                pq_kem_encap_key: None,
                padding: vec![0u8; 64],
            };
            black_box(encode_client_init(&init));
        });
    });
}

/// Benchmark server-side client init decoding + auth verification.
fn bench_server_decode_client_init(c: &mut Criterion) {
    let client_id = ClientId(uuid::Uuid::nil());
    let auth_secret = [0xABu8; 32];
    let timestamp = 1700000000u64;
    let auth_token = prisma_core::util::compute_auth_token(&auth_secret, &client_id, timestamp);

    let init = PrismaClientInit {
        version: PRISMA_PROTOCOL_VERSION,
        flags: CLIENT_INIT_FLAG_HEADER_AUTH | CLIENT_INIT_FLAG_MIGRATION,
        client_ephemeral_pub: [0xAAu8; 32],
        client_id,
        timestamp,
        cipher_suite: CipherSuite::ChaCha20Poly1305,
        auth_token,
        pq_kem_encap_key: None,
        padding: vec![0u8; 64],
    };
    let encoded = encode_client_init(&init);

    c.bench_function("handshake/server_decode_client_init", |b| {
        b.iter(|| {
            let decoded = decode_client_init(&encoded).unwrap();
            let expected = prisma_core::util::compute_auth_token(
                &auth_secret,
                &decoded.client_id,
                decoded.timestamp,
            );
            black_box(prisma_core::util::ct_eq(&decoded.auth_token, &expected));
        });
    });
}

/// Benchmark server init encode + decode (used over the wire encrypted).
fn bench_server_init_roundtrip(c: &mut Criterion) {
    let server_init = PrismaServerInit {
        status: AcceptStatus::Ok,
        session_id: uuid::Uuid::nil(),
        server_ephemeral_pub: [0xCCu8; 32],
        challenge: [0xDDu8; 32],
        padding_min: 10,
        padding_max: 200,
        server_features: FEATURE_UDP_RELAY | FEATURE_SPEED_TEST | FEATURE_V5_KDF,
        session_ticket: vec![0u8; 61],
        bucket_sizes: vec![128, 256, 512, 1024],
        pq_kem_ciphertext: None,
        padding: vec![0u8; 64],
    };

    c.bench_function("handshake/server_init_roundtrip", |b| {
        b.iter(|| {
            let encoded = encode_server_init(&server_init);
            black_box(decode_server_init(&encoded).unwrap());
        });
    });
}

/// Benchmark ECDH key exchange (X25519) which happens during handshake.
fn bench_ecdh_key_exchange(c: &mut Criterion) {
    c.bench_function("handshake/ecdh_x25519", |b| {
        let server_keypair = EphemeralKeyPair::generate();
        let server_pub = PublicKey::from(server_keypair.public_key_bytes());

        b.iter(|| {
            let client_keypair = EphemeralKeyPair::generate();
            let shared_secret = client_keypair.diffie_hellman(&server_pub);
            black_box(shared_secret);
        });
    });
}

/// Benchmark the full key derivation chain (preliminary + session keys).
fn bench_full_kdf_chain(c: &mut Criterion) {
    let shared_secret = [0xABu8; 32];
    let client_pub = [0x01u8; 32];
    let server_pub = [0x02u8; 32];
    let challenge = [0x03u8; 32];
    let timestamp = 1700000000u64;

    c.bench_function("handshake/full_kdf_chain", |b| {
        b.iter(|| {
            let preliminary = derive_v5_preliminary_key(
                &shared_secret,
                &client_pub,
                &server_pub,
                timestamp,
            );
            let session = derive_v5_session_key(
                &shared_secret,
                &client_pub,
                &server_pub,
                &challenge,
                timestamp,
            );
            black_box((preliminary, session));
        });
    });
}

/// Benchmark the full handshake round-trip (both sides, excluding network I/O).
///
/// Steps measured:
/// 1. Client generates keypair + ClientInit
/// 2. Server decodes ClientInit + verifies auth
/// 3. Server generates keypair + ECDH + KDF + ServerInit
/// 4. Server encrypts ServerInit with preliminary key
/// 5. Client decrypts ServerInit + ECDH + KDF to derive session key
fn bench_full_handshake_roundtrip(c: &mut Criterion) {
    let client_id = ClientId(uuid::Uuid::nil());
    let auth_secret = [0xABu8; 32];

    c.bench_function("handshake/full_roundtrip", |b| {
        b.iter(|| {
            // === Client side: generate init ===
            let client_keypair = EphemeralKeyPair::generate();
            let client_pub = client_keypair.public_key_bytes();
            let timestamp = 1700000000u64;
            let auth_token =
                prisma_core::util::compute_auth_token(&auth_secret, &client_id, timestamp);

            let client_init = PrismaClientInit {
                version: PRISMA_PROTOCOL_VERSION,
                flags: CLIENT_INIT_FLAG_HEADER_AUTH | CLIENT_INIT_FLAG_MIGRATION,
                client_ephemeral_pub: client_pub,
                client_id,
                timestamp,
                cipher_suite: CipherSuite::ChaCha20Poly1305,
                auth_token,
                pq_kem_encap_key: None,
                padding: vec![0u8; 64],
            };
            let client_init_bytes = encode_client_init(&client_init);

            // === Server side: decode + verify + generate response ===
            let decoded_init = decode_client_init(&client_init_bytes).unwrap();
            let expected_token = prisma_core::util::compute_auth_token(
                &auth_secret,
                &decoded_init.client_id,
                decoded_init.timestamp,
            );
            let _auth_ok = prisma_core::util::ct_eq(&decoded_init.auth_token, &expected_token);

            let server_keypair = EphemeralKeyPair::generate();
            let server_pub = server_keypair.public_key_bytes();
            let client_pub_key = PublicKey::from(decoded_init.client_ephemeral_pub);
            let shared_secret = server_keypair.diffie_hellman(&client_pub_key);
            let preliminary_key = derive_v5_preliminary_key(
                &shared_secret,
                &decoded_init.client_ephemeral_pub,
                &server_pub,
                decoded_init.timestamp,
            );

            let challenge = [0xDDu8; 32];
            let server_init = PrismaServerInit {
                status: AcceptStatus::Ok,
                session_id: uuid::Uuid::new_v4(),
                server_ephemeral_pub: server_pub,
                challenge,
                padding_min: 10,
                padding_max: 200,
                server_features: FEATURE_UDP_RELAY | FEATURE_V5_KDF,
                session_ticket: vec![0u8; 61],
                bucket_sizes: vec![128, 256, 512, 1024],
                pq_kem_ciphertext: None,
                padding: vec![0u8; 64],
            };
            let server_init_plain = encode_server_init(&server_init);

            // Encrypt server init with preliminary key
            let cipher = create_cipher(CipherSuite::ChaCha20Poly1305, &preliminary_key);
            let nonce = [0u8; NONCE_SIZE];
            let server_init_encrypted = cipher.encrypt(&nonce, &server_init_plain, &[]).unwrap();

            // === Client side: decrypt + derive session key ===
            let server_init_decrypted =
                cipher.decrypt(&nonce, &server_init_encrypted, &[]).unwrap();
            let decoded_server_init = decode_server_init(&server_init_decrypted).unwrap();

            let server_pub_key = PublicKey::from(decoded_server_init.server_ephemeral_pub);
            let client_shared_secret = client_keypair.diffie_hellman(&server_pub_key);
            let session_key = derive_v5_session_key(
                &client_shared_secret,
                &client_pub,
                &decoded_server_init.server_ephemeral_pub,
                &decoded_server_init.challenge,
                timestamp,
            );

            black_box(session_key);
        });
    });
}

/// Benchmark server init encryption with preliminary key (a sub-step of handshake).
fn bench_server_init_encrypt(c: &mut Criterion) {
    let key = [0x42u8; 32];
    let cipher = create_cipher(CipherSuite::ChaCha20Poly1305, &key);
    let nonce = [0u8; NONCE_SIZE];

    let server_init = PrismaServerInit {
        status: AcceptStatus::Ok,
        session_id: uuid::Uuid::nil(),
        server_ephemeral_pub: [0xCCu8; 32],
        challenge: [0xDDu8; 32],
        padding_min: 10,
        padding_max: 200,
        server_features: FEATURE_UDP_RELAY | FEATURE_V5_KDF,
        session_ticket: vec![0u8; 61],
        bucket_sizes: vec![128, 256, 512, 1024],
        pq_kem_ciphertext: None,
        padding: vec![0u8; 64],
    };
    let plaintext = encode_server_init(&server_init);

    c.bench_function("handshake/server_init_encrypt", |b| {
        b.iter(|| {
            black_box(cipher.encrypt(&nonce, &plaintext, &[]).unwrap());
        });
    });

    let ciphertext = cipher.encrypt(&nonce, &plaintext, &[]).unwrap();
    c.bench_function("handshake/server_init_decrypt", |b| {
        b.iter(|| {
            black_box(cipher.decrypt(&nonce, &ciphertext, &[]).unwrap());
        });
    });
}

criterion_group!(
    benches,
    bench_client_init_generation,
    bench_server_decode_client_init,
    bench_server_init_roundtrip,
    bench_ecdh_key_exchange,
    bench_full_kdf_chain,
    bench_full_handshake_roundtrip,
    bench_server_init_encrypt,
);
criterion_main!(benches);
