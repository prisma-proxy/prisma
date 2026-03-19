//! Criterion micro-benchmarks for prisma-core crypto and protocol hot paths.
//!
//! Run: `cargo bench -p prisma-core`

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};

use prisma_core::crypto::aead::create_cipher;
use prisma_core::crypto::kdf::{
    derive_preliminary_key, derive_v3_session_key, derive_v5_header_key, derive_v5_migration_token,
    derive_v5_preliminary_key, derive_v5_session_key,
};
use prisma_core::crypto::padding::{generate_frame_padding, generate_padding};
use prisma_core::protocol::anti_replay::AntiReplayWindow;
use prisma_core::protocol::codec::{decode_data_frame, encode_client_init, encode_data_frame};
use prisma_core::protocol::frame_encoder::{FrameDecoder, FrameEncoder};
use prisma_core::protocol::types::*;
use prisma_core::types::{
    CipherSuite, ClientId, PaddingRange, NONCE_SIZE, PRISMA_PROTOCOL_VERSION,
};

// -- AEAD encrypt/decrypt --

fn bench_aead_encrypt(c: &mut Criterion) {
    let mut group = c.benchmark_group("aead_encrypt");
    for size in [64, 1024, 4096, 16384] {
        let plaintext = vec![0xABu8; size];
        let nonce = [0u8; NONCE_SIZE];
        let key = [0x42u8; 32];

        let cipher = create_cipher(CipherSuite::ChaCha20Poly1305, &key);
        group.throughput(Throughput::Bytes(size as u64));
        group.bench_with_input(BenchmarkId::new("chacha20poly1305", size), &size, |b, _| {
            b.iter(|| black_box(cipher.encrypt(&nonce, &plaintext, &[]).unwrap()));
        });

        let cipher = create_cipher(CipherSuite::Aes256Gcm, &key);
        group.bench_with_input(BenchmarkId::new("aes256gcm", size), &size, |b, _| {
            b.iter(|| black_box(cipher.encrypt(&nonce, &plaintext, &[]).unwrap()));
        });
    }
    group.finish();
}

fn bench_aead_decrypt(c: &mut Criterion) {
    let mut group = c.benchmark_group("aead_decrypt");
    for size in [64, 1024, 4096, 16384] {
        let plaintext = vec![0xABu8; size];
        let nonce = [0u8; NONCE_SIZE];
        let key = [0x42u8; 32];

        let cipher = create_cipher(CipherSuite::ChaCha20Poly1305, &key);
        let ciphertext = cipher.encrypt(&nonce, &plaintext, &[]).unwrap();
        group.throughput(Throughput::Bytes(size as u64));
        group.bench_with_input(BenchmarkId::new("chacha20poly1305", size), &size, |b, _| {
            b.iter(|| black_box(cipher.decrypt(&nonce, &ciphertext, &[]).unwrap()));
        });

        let cipher = create_cipher(CipherSuite::Aes256Gcm, &key);
        let ciphertext = cipher.encrypt(&nonce, &plaintext, &[]).unwrap();
        group.bench_with_input(BenchmarkId::new("aes256gcm", size), &size, |b, _| {
            b.iter(|| black_box(cipher.decrypt(&nonce, &ciphertext, &[]).unwrap()));
        });
    }
    group.finish();
}

// -- Frame encoder/decoder (zero-copy) --

fn bench_frame_encoder(c: &mut Criterion) {
    let mut group = c.benchmark_group("frame_encoder");
    let key = [0x42u8; 32];
    let padding_zero = PaddingRange::new(0, 0);

    for size in [64, 1024, 4096, 16384] {
        let cipher = create_cipher(CipherSuite::ChaCha20Poly1305, &key);
        let nonce = [0u8; NONCE_SIZE];
        group.throughput(Throughput::Bytes(size as u64));
        group.bench_with_input(BenchmarkId::new("seal", size), &size, |b, &size| {
            let mut encoder = FrameEncoder::new();
            b.iter(|| {
                encoder.payload_mut()[..size].fill(0xAB);
                black_box(
                    encoder
                        .seal_data_frame(cipher.as_ref(), &nonce, size, 0, &padding_zero)
                        .unwrap(),
                );
            });
        });
    }
    group.finish();
}

fn bench_frame_decoder(c: &mut Criterion) {
    let mut group = c.benchmark_group("frame_decoder");
    let key = [0x42u8; 32];
    let padding = PaddingRange::new(0, 0);

    for size in [64, 1024, 4096, 16384] {
        let cipher = create_cipher(CipherSuite::ChaCha20Poly1305, &key);
        let nonce = [0u8; NONCE_SIZE];
        let mut encoder = FrameEncoder::new();
        encoder.payload_mut()[..size].fill(0xAB);
        let wire = encoder
            .seal_data_frame(cipher.as_ref(), &nonce, size, 0, &padding)
            .unwrap()
            .to_vec();
        let outer_len = u16::from_be_bytes([wire[0], wire[1]]) as usize;
        let frame_data = wire[2..].to_vec();

        group.throughput(Throughput::Bytes(size as u64));
        group.bench_with_input(BenchmarkId::new("unseal", size), &size, |b, _| {
            b.iter(|| {
                let mut buf = frame_data.clone();
                black_box(
                    FrameDecoder::unseal_data_frame(&mut buf, outer_len, cipher.as_ref()).unwrap(),
                );
            });
        });
    }
    group.finish();
}

// -- Codec encode/decode --

fn bench_codec(c: &mut Criterion) {
    let mut group = c.benchmark_group("codec");
    let frame = DataFrame {
        command: Command::Data(bytes::Bytes::from(vec![0xABu8; 1024])),
        flags: 0,
        stream_id: 42,
    };
    let encoded = encode_data_frame(&frame);
    group.throughput(Throughput::Bytes(1024));

    group.bench_function("encode_data_frame_1KB", |b| {
        b.iter(|| black_box(encode_data_frame(&frame)));
    });
    group.bench_function("decode_data_frame_1KB", |b| {
        b.iter(|| black_box(decode_data_frame(&encoded).unwrap()));
    });
    group.finish();
}

// -- KDF --

fn bench_kdf(c: &mut Criterion) {
    let mut group = c.benchmark_group("kdf");
    let secret = [0xABu8; 32];
    let client_pub = [0x01u8; 32];
    let server_pub = [0x02u8; 32];
    let challenge = [0x03u8; 32];
    let session_key = [0xAAu8; 32];
    let session_id = [0x01u8; 16];

    group.bench_function("derive_preliminary_key", |b| {
        b.iter(|| {
            black_box(derive_preliminary_key(
                &secret,
                &client_pub,
                &server_pub,
                1000,
            ))
        });
    });
    group.bench_function("derive_v3_session_key", |b| {
        b.iter(|| {
            black_box(derive_v3_session_key(
                &secret,
                &client_pub,
                &server_pub,
                &challenge,
                1000,
            ))
        });
    });
    group.bench_function("derive_v5_preliminary_key", |b| {
        b.iter(|| {
            black_box(derive_v5_preliminary_key(
                &secret,
                &client_pub,
                &server_pub,
                1000,
            ))
        });
    });
    group.bench_function("derive_v5_session_key", |b| {
        b.iter(|| {
            black_box(derive_v5_session_key(
                &secret,
                &client_pub,
                &server_pub,
                &challenge,
                1000,
            ))
        });
    });
    group.bench_function("derive_v5_header_key", |b| {
        b.iter(|| black_box(derive_v5_header_key(&session_key)));
    });
    group.bench_function("derive_v5_migration_token", |b| {
        b.iter(|| black_box(derive_v5_migration_token(&session_key, &session_id)));
    });
    group.finish();
}

// -- Anti-replay --

fn bench_anti_replay(c: &mut Criterion) {
    let mut group = c.benchmark_group("anti_replay");

    group.bench_function("sequential_v4", |b| {
        let mut window = AntiReplayWindow::new();
        let mut counter = 0u64;
        b.iter(|| {
            window.check_and_update(counter).unwrap();
            black_box(());
            counter += 1;
        });
    });
    group.bench_function("sequential_v5", |b| {
        let mut window = AntiReplayWindow::new_v5();
        let mut counter = 0u64;
        b.iter(|| {
            window.check_and_update(counter).unwrap();
            black_box(());
            counter += 1;
        });
    });
    group.bench_function("window_advance", |b| {
        let mut window = AntiReplayWindow::new();
        let mut counter = 0u64;
        b.iter(|| {
            counter += 500;
            window.check_and_update(counter).unwrap();
            black_box(());
        });
    });
    group.finish();
}

// -- Padding --

fn bench_padding(c: &mut Criterion) {
    let mut group = c.benchmark_group("padding");

    group.bench_function("generate_padding_64", |b| {
        b.iter(|| black_box(generate_padding(64)));
    });
    group.bench_function("generate_padding_256", |b| {
        b.iter(|| black_box(generate_padding(256)));
    });

    let range = PaddingRange::new(10, 50);
    group.bench_function("generate_frame_padding", |b| {
        b.iter(|| black_box(generate_frame_padding(&range)));
    });

    let range_zero = PaddingRange::new(0, 0);
    group.bench_function("generate_frame_padding_zero", |b| {
        b.iter(|| black_box(generate_frame_padding(&range_zero)));
    });
    group.finish();
}

// -- Handshake messages --

fn bench_handshake(c: &mut Criterion) {
    let mut group = c.benchmark_group("handshake");

    let client_init = PrismaClientInit {
        version: PRISMA_PROTOCOL_VERSION,
        flags: CLIENT_INIT_FLAG_HEADER_AUTH | CLIENT_INIT_FLAG_MIGRATION,
        client_ephemeral_pub: [0xAAu8; 32],
        client_id: ClientId(uuid::Uuid::nil()),
        timestamp: 1700000000,
        cipher_suite: CipherSuite::ChaCha20Poly1305,
        auth_token: [0xBBu8; 32],
        pq_kem_encap_key: None,
        padding: vec![0u8; 128],
    };

    group.bench_function("encode_client_init", |b| {
        b.iter(|| black_box(encode_client_init(&client_init)));
    });

    let encoded = encode_client_init(&client_init);
    group.bench_function("decode_client_init", |b| {
        b.iter(|| black_box(prisma_core::protocol::codec::decode_client_init(&encoded).unwrap()));
    });

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

    group.bench_function("encode_server_init", |b| {
        b.iter(|| {
            black_box(prisma_core::protocol::codec::encode_server_init(
                &server_init,
            ))
        });
    });

    let encoded_server = prisma_core::protocol::codec::encode_server_init(&server_init);
    group.bench_function("decode_server_init", |b| {
        b.iter(|| {
            black_box(prisma_core::protocol::codec::decode_server_init(&encoded_server).unwrap())
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_aead_encrypt,
    bench_aead_decrypt,
    bench_frame_encoder,
    bench_frame_decoder,
    bench_codec,
    bench_kdf,
    bench_anti_replay,
    bench_padding,
    bench_handshake,
);
criterion_main!(benches);
