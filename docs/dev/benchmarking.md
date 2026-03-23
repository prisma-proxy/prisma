---
title: Performance Benchmarking
sidebar_position: 9
---

# Performance Benchmarking

Prisma includes two layers of benchmarking: **micro-benchmarks** (Criterion, in-process) for crypto/codec/relay hot paths, and **macro-benchmarks** (shell script, end-to-end) for comparative throughput against xray-core and sing-box.

## Micro-Benchmarks (Criterion)

### Running Benchmarks

```bash
# Run all prisma-core benchmarks
cargo bench -p prisma-core

# Run a specific benchmark file
cargo bench -p prisma-core -- relay
cargo bench -p prisma-core -- codec
cargo bench -p prisma-core -- handshake
cargo bench -p prisma-core -- crypto
```

### Benchmark Files

| File | What It Measures |
|------|-----------------|
| `crates/prisma-core/benches/crypto_bench.rs` | AEAD encrypt/decrypt (ChaCha20-Poly1305, AES-256-GCM), frame encoder/decoder (seal/unseal), codec encode/decode, KDF (BLAKE3), anti-replay window, padding generation, handshake message encode/decode |
| `crates/prisma-core/benches/relay_bench.rs` | Simulated relay loop: seal+unseal round-trip at 1KB/8KB/32KB, encrypt-only, decrypt-only, and padded relay paths for both cipher suites |
| `crates/prisma-core/benches/codec_bench.rs` | Encode/decode round-trip for all 16 Command types: Connect, Data, Close, Ping, Pong, RegisterForward, ForwardReady, ForwardConnect, UdpData, SpeedTest, DnsQuery, DnsResponse, ChallengeResponse, Migration, FallbackAdvertisement |
| `crates/prisma-core/benches/handshake_bench.rs` | Full handshake timing: client init generation, server decode + auth verify, ECDH (X25519), KDF chain (preliminary + session), server init encrypt/decrypt, and end-to-end handshake round-trip |

### Comparing Against Previous Runs

Criterion stores baselines automatically in `target/criterion/`. To compare:

```bash
# Save a baseline before making changes
cargo bench -p prisma-core -- --save-baseline before

# Make your changes...

# Compare against the baseline
cargo bench -p prisma-core -- --baseline before
```

Criterion generates HTML reports in `target/criterion/report/index.html` with comparison charts.

### Key Metrics to Watch

| Metric | Benchmark Group | Target |
|--------|----------------|--------|
| Relay throughput | `relay_roundtrip` | > 5 Gbps (32KB frames) |
| AEAD encrypt latency | `aead_encrypt` | < 1 us (1KB) |
| Frame seal latency | `frame_encoder/seal` | < 2 us (16KB) |
| Codec round-trip | `codec/data` | < 200 ns (1KB) |
| Handshake total | `handshake/full_roundtrip` | < 500 us |
| ECDH (X25519) | `handshake/ecdh_x25519` | < 100 us |

### Adding New Benchmarks

1. Create or edit a file in `crates/prisma-core/benches/`
2. Use the Criterion framework:
   ```rust
   use criterion::{black_box, criterion_group, criterion_main, Criterion};

   fn bench_my_thing(c: &mut Criterion) {
       c.bench_function("my_thing", |b| {
           b.iter(|| black_box(do_something()));
       });
   }

   criterion_group!(benches, bench_my_thing);
   criterion_main!(benches);
   ```
3. Add a `[[bench]]` entry to `crates/prisma-core/Cargo.toml`:
   ```toml
   [[bench]]
   name = "my_bench"
   harness = false
   ```
4. Run `cargo bench -p prisma-core -- my_thing` to verify

## Profiling

### CPU Profiling (Flamegraph)

```bash
cargo install flamegraph

# Profile the server under load
cargo flamegraph -p prisma-cli -- server -c server.toml

# Profile a specific benchmark
cargo flamegraph --bench crypto_bench -- --bench
```

### Memory Profiling (DHAT)

```bash
# Build release binary
cargo build --release -p prisma-cli

# Run with DHAT (Linux only, requires valgrind)
valgrind --tool=dhat ./target/release/prisma server -c server.toml
```

### Async Profiling (tokio-console)

```bash
# Build with tokio_unstable cfg
RUSTFLAGS="--cfg tokio_unstable" cargo build -p prisma-cli

# In another terminal
tokio-console
```

## Macro-Benchmarks (Comparative)

The `scripts/benchmark.sh` script runs end-to-end throughput comparisons:

```bash
# Quick mode: 5 scenarios, 64MB payload, 3 runs
./scripts/benchmark.sh quick

# Full mode: 25 scenarios, 3 payloads (1MB/32MB/256MB), 7 runs
./scripts/benchmark.sh full
```

Results are written to `benchmark-results/` and automatically published by CI to the [benchmarks page](/benchmarks).

### CI Integration

- **Weekly runs**: `.github/workflows/benchmark.yml` runs every Monday at 04:00 UTC
- **PR checks**: `.github/workflows/ci.yml` includes a benchmark regression check on PRs
- **History**: Last 12 weeks of results are preserved in `docs/static/data/benchmark-results.json`

## Performance Regression Detection

Any change to hot-path files should be checked for regressions:

```bash
# Quick check: run the built-in speed test
prisma speed-test --server localhost:8443 --duration 10 --direction both

# Thorough check: run micro-benchmarks with comparison
cargo bench -p prisma-core -- --save-baseline before
# ... make changes ...
cargo bench -p prisma-core -- --baseline before

# Flag any regression > 5%
```
