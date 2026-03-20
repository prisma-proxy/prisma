//! Criterion benchmarks for simulated relay encrypt/decrypt loops.
//!
//! Measures the core hot path: frame encryption and decryption at
//! various payload sizes, simulating the bidirectional relay loop.
//!
//! Run: `cargo bench -p prisma-core -- relay`

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};

use prisma_core::crypto::aead::create_cipher;
use prisma_core::protocol::frame_encoder::{FrameDecoder, FrameEncoder};
use prisma_core::types::{CipherSuite, PaddingRange, NONCE_SIZE};

/// Simulate a relay encrypt/decrypt loop: seal a data frame, then unseal it.
/// This is the exact hot path in the relay loop (minus I/O).
fn bench_relay_roundtrip(c: &mut Criterion) {
    let mut group = c.benchmark_group("relay_roundtrip");
    let key = [0x42u8; 32];
    let padding_zero = PaddingRange::new(0, 0);

    for size in [1024, 8192, 32768] {
        let label = match size {
            1024 => "1KB",
            8192 => "8KB",
            32768 => "32KB",
            _ => unreachable!(),
        };

        // ChaCha20-Poly1305 relay roundtrip
        let cipher = create_cipher(CipherSuite::ChaCha20Poly1305, &key);
        group.throughput(Throughput::Bytes(size as u64));
        group.bench_with_input(
            BenchmarkId::new("chacha20_seal_unseal", label),
            &size,
            |b, &payload_size| {
                let mut encoder = FrameEncoder::new();
                let nonce = [0u8; NONCE_SIZE];
                b.iter(|| {
                    // --- Encrypt (client/server send path) ---
                    encoder.payload_mut()[..payload_size].fill(0xAB);
                    let wire = encoder
                        .seal_data_frame(cipher.as_ref(), &nonce, payload_size, 1, &padding_zero)
                        .unwrap();

                    // --- Decrypt (server/client receive path) ---
                    let outer_len = u16::from_be_bytes([wire[0], wire[1]]) as usize;
                    let mut frame_data = wire[2..].to_vec();
                    let _frame = FrameDecoder::unseal_data_frame(
                        &mut frame_data,
                        outer_len,
                        cipher.as_ref(),
                    )
                    .unwrap();
                    black_box(());
                });
            },
        );

        // AES-256-GCM relay roundtrip
        let cipher = create_cipher(CipherSuite::Aes256Gcm, &key);
        group.bench_with_input(
            BenchmarkId::new("aes256gcm_seal_unseal", label),
            &size,
            |b, &payload_size| {
                let mut encoder = FrameEncoder::new();
                let nonce = [0u8; NONCE_SIZE];
                b.iter(|| {
                    encoder.payload_mut()[..payload_size].fill(0xAB);
                    let wire = encoder
                        .seal_data_frame(cipher.as_ref(), &nonce, payload_size, 1, &padding_zero)
                        .unwrap();

                    let outer_len = u16::from_be_bytes([wire[0], wire[1]]) as usize;
                    let mut frame_data = wire[2..].to_vec();
                    let _frame = FrameDecoder::unseal_data_frame(
                        &mut frame_data,
                        outer_len,
                        cipher.as_ref(),
                    )
                    .unwrap();
                    black_box(());
                });
            },
        );
    }
    group.finish();
}

/// Benchmark seal-only (encrypt direction) at various sizes.
fn bench_relay_encrypt(c: &mut Criterion) {
    let mut group = c.benchmark_group("relay_encrypt");
    let key = [0x42u8; 32];
    let padding_zero = PaddingRange::new(0, 0);

    for size in [1024, 8192, 32768] {
        let label = match size {
            1024 => "1KB",
            8192 => "8KB",
            32768 => "32KB",
            _ => unreachable!(),
        };

        let cipher = create_cipher(CipherSuite::ChaCha20Poly1305, &key);
        group.throughput(Throughput::Bytes(size as u64));
        group.bench_with_input(
            BenchmarkId::new("chacha20_seal", label),
            &size,
            |b, &payload_size| {
                let mut encoder = FrameEncoder::new();
                let nonce = [0u8; NONCE_SIZE];
                b.iter(|| {
                    encoder.payload_mut()[..payload_size].fill(0xAB);
                    black_box(
                        encoder
                            .seal_data_frame(
                                cipher.as_ref(),
                                &nonce,
                                payload_size,
                                1,
                                &padding_zero,
                            )
                            .unwrap(),
                    );
                });
            },
        );
    }
    group.finish();
}

/// Benchmark unseal-only (decrypt direction) at various sizes.
fn bench_relay_decrypt(c: &mut Criterion) {
    let mut group = c.benchmark_group("relay_decrypt");
    let key = [0x42u8; 32];
    let padding_zero = PaddingRange::new(0, 0);

    for size in [1024, 8192, 32768] {
        let label = match size {
            1024 => "1KB",
            8192 => "8KB",
            32768 => "32KB",
            _ => unreachable!(),
        };

        let cipher = create_cipher(CipherSuite::ChaCha20Poly1305, &key);
        let nonce = [0u8; NONCE_SIZE];

        // Pre-seal the frame
        let mut encoder = FrameEncoder::new();
        encoder.payload_mut()[..size].fill(0xAB);
        let wire = encoder
            .seal_data_frame(cipher.as_ref(), &nonce, size, 1, &padding_zero)
            .unwrap()
            .to_vec();
        let outer_len = u16::from_be_bytes([wire[0], wire[1]]) as usize;
        let sealed_data = wire[2..].to_vec();

        group.throughput(Throughput::Bytes(size as u64));
        group.bench_with_input(
            BenchmarkId::new("chacha20_unseal", label),
            &size,
            |b, _| {
                b.iter(|| {
                    let mut buf = sealed_data.clone();
                    black_box(
                        FrameDecoder::unseal_data_frame(&mut buf, outer_len, cipher.as_ref())
                            .unwrap(),
                    );
                });
            },
        );
    }
    group.finish();
}

/// Benchmark relay roundtrip with padding enabled (simulates production traffic).
fn bench_relay_padded(c: &mut Criterion) {
    let mut group = c.benchmark_group("relay_padded");
    let key = [0x42u8; 32];
    let padding = PaddingRange::new(10, 64);

    for size in [1024, 8192] {
        let label = match size {
            1024 => "1KB",
            8192 => "8KB",
            _ => unreachable!(),
        };

        let cipher = create_cipher(CipherSuite::ChaCha20Poly1305, &key);
        group.throughput(Throughput::Bytes(size as u64));
        group.bench_with_input(
            BenchmarkId::new("chacha20_padded", label),
            &size,
            |b, &payload_size| {
                let mut encoder = FrameEncoder::new();
                let nonce = [0u8; NONCE_SIZE];
                b.iter(|| {
                    encoder.payload_mut()[..payload_size].fill(0xAB);
                    let wire = encoder
                        .seal_data_frame(cipher.as_ref(), &nonce, payload_size, 1, &padding)
                        .unwrap();

                    let outer_len = u16::from_be_bytes([wire[0], wire[1]]) as usize;
                    let mut frame_data = wire[2..].to_vec();
                    let _frame = FrameDecoder::unseal_data_frame(
                        &mut frame_data,
                        outer_len,
                        cipher.as_ref(),
                    )
                    .unwrap();
                    black_box(());
                });
            },
        );
    }
    group.finish();
}

criterion_group!(
    benches,
    bench_relay_roundtrip,
    bench_relay_encrypt,
    bench_relay_decrypt,
    bench_relay_padded,
);
criterion_main!(benches);
