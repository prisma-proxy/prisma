---
description: "Quality assurance: unit/integration/property-based tests, benchmarks, snapshot tests, coverage analysis, CI/CD, regression detection"
globs:
  - "prisma-core/tests/**/*.rs"
  - "prisma-server/tests/**/*.rs"
  - "prisma-client/tests/**/*.rs"
  - "prisma-cli/tests/**/*.rs"
  - "prisma-mgmt/tests/**/*.rs"
  - "prisma-ffi/tests/**/*.rs"
  - "**/*_test.rs"
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
  - ".github/workflows/**/*.yml"
  - "Dockerfile"
  - "docker-compose*.yml"
---

# Prisma Quality Assurance Skill

You are the QA agent for Prisma. You ensure code correctness through testing, benchmarking, and CI/CD. After any implementation, you add appropriate tests and verify existing tests still pass.

## Testing Stack

| Tool | Purpose | Crates |
|------|---------|--------|
| `cargo test` / `cargo nextest` | Unit + integration tests | All Rust crates |
| `proptest` | Property-based testing | `prisma-core` (crypto, codec, protocol) |
| `insta` | Snapshot testing (YAML) | Config serialization, protocol wire format |
| `tokio-test` | Async test utilities | Server, client, mgmt |
| `rcgen` | Test TLS certificates | Integration tests |
| `criterion` (add) | Micro-benchmarks | Hot path performance |

### Current Test Inventory
- **299 inline test functions** across 36 modules in `prisma-core`
- **4 dedicated test files** in `prisma-core/tests/`:
  - `protocol_proptest.rs` — property-based protocol tests
  - `protocol_snapshots.rs` — snapshot tests for wire format
  - `config_tests.rs` — config parsing with fixture files
  - `integration.rs` — end-to-end echo-through-tunnel test (~280 lines)
- **5 test fixtures** in `prisma-core/tests/fixtures/` (valid/invalid TOML configs)
- **Snapshot files** in `prisma-core/tests/snapshots/` (insta YAML)
- **Proptest regressions** tracked in `.proptest-regressions` files

### CI Uses `cargo nextest` for Better Parallelization
```bash
cargo nextest run --workspace --target <target>
cargo test --workspace --doc  # doctests separately
```

---

## 0. Test Execution

### Run All Tests
```bash
cargo test --workspace
```

### Run Specific Crate Tests
```bash
cargo test -p prisma-core
cargo test -p prisma-server
cargo test -p prisma-client
cargo test -p prisma-cli
cargo test -p prisma-mgmt
cargo test -p prisma-ffi
```

### Run with Output
```bash
cargo test --workspace -- --nocapture    # Show println output
cargo test --workspace -- --show-output  # Show output for passing tests too
```

### Run Specific Test
```bash
cargo test -p prisma-core test_name
cargo test -p prisma-core -- protocol::codec::tests::  # Module prefix
```

---

## 1. Unit Test Patterns

### Crypto Tests (prisma-core)
```rust
#[cfg(test)]
mod tests {
    use super::*;

    // Known-answer test — verify against published test vectors
    #[test]
    fn test_chacha20_poly1305_known_vector() {
        let key = hex::decode("...").unwrap();
        let nonce = hex::decode("...").unwrap();
        let plaintext = b"test data";
        let cipher = ChaCha20Poly1305Cipher::new(&key);
        let mut buf = plaintext.to_vec();
        cipher.encrypt_in_place(&nonce.try_into().unwrap(), &[], &mut buf).unwrap();
        assert_eq!(hex::encode(&buf), "expected_ciphertext_hex");
    }

    // Round-trip test
    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = [0x42u8; 32];
        let nonce = [0u8; 12];
        let cipher = ChaCha20Poly1305Cipher::new(&key);
        let original = b"hello world";
        let mut buf = original.to_vec();
        cipher.encrypt_in_place(&nonce, &[], &mut buf).unwrap();
        assert_ne!(&buf, original); // encrypted is different
        cipher.decrypt_in_place(&nonce, &[], &mut buf).unwrap();
        assert_eq!(&buf, original); // decrypted matches
    }
}
```

### Codec Tests (prisma-core)
```rust
#[cfg(test)]
mod tests {
    use super::*;

    // Encode-decode round-trip for every command type
    #[test]
    fn test_connect_command_roundtrip() {
        let cmd = Command::Connect {
            destination: ProxyDestination::Domain("example.com".into(), 443),
        };
        let encoded = encode_command_payload(&cmd);
        let decoded = decode_command_payload(CMD_CONNECT, &encoded).unwrap();
        assert_eq!(cmd, decoded);
    }

    // Malformed input handling
    #[test]
    fn test_decode_truncated_data() {
        let result = decode_command_payload(CMD_CONNECT, &[0x01]); // too short
        assert!(result.is_err());
    }
}
```

### Config Tests (prisma-core)
```rust
#[cfg(test)]
mod tests {
    // Snapshot test for default config serialization
    #[test]
    fn test_default_server_config_snapshot() {
        let config = ServerConfig::default();
        let toml = toml::to_string_pretty(&config).unwrap();
        insta::assert_snapshot!(toml);
    }

    // Deserialization from minimal config
    #[test]
    fn test_minimal_server_config() {
        let toml = r#"
            listen_addr = "0.0.0.0:8443"
            auth_secret = "abc123"
        "#;
        let config: ServerConfig = toml::from_str(toml).unwrap();
        assert_eq!(config.listen_addr, "0.0.0.0:8443");
    }
}
```

### Handler Tests (prisma-server, prisma-mgmt)
```rust
#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_health_endpoint() {
        let app = build_router(test_state());
        let response = app
            .oneshot(Request::get("/api/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
}
```

---

## 2. Property-Based Tests (proptest)

Use for security-critical code where exhaustive testing is impossible:

```rust
use proptest::prelude::*;

proptest! {
    // Encrypt-decrypt is always reversible
    #[test]
    fn encrypt_decrypt_any_data(data: Vec<u8>) {
        let key = [0x42u8; 32];
        let nonce = [0u8; 12];
        let cipher = ChaCha20Poly1305Cipher::new(&key);
        let mut buf = data.clone();
        cipher.encrypt_in_place(&nonce, &[], &mut buf).unwrap();
        cipher.decrypt_in_place(&nonce, &[], &mut buf).unwrap();
        prop_assert_eq!(data, buf);
    }

    // Codec round-trip for arbitrary destinations
    #[test]
    fn codec_roundtrip_connect(
        host in "[a-z]{1,63}\\.[a-z]{2,6}",
        port in 1u16..=65535,
    ) {
        let cmd = Command::Connect {
            destination: ProxyDestination::Domain(host.clone(), port),
        };
        let encoded = encode_command_payload(&cmd);
        let decoded = decode_command_payload(CMD_CONNECT, &encoded).unwrap();
        prop_assert_eq!(cmd, decoded);
    }

    // Anti-replay window never accepts replayed nonce
    #[test]
    fn anti_replay_rejects_duplicates(nonces in prop::collection::vec(0u64..10000, 1..100)) {
        let mut window = AntiReplayWindow::new();
        let mut seen = std::collections::HashSet::new();
        for nonce in nonces {
            let is_new = seen.insert(nonce);
            let accepted = window.check_and_mark(nonce);
            if is_new {
                // First time should be accepted (unless too old for window)
                // Window may reject if nonce is too far behind
            } else {
                prop_assert!(!accepted, "Replay accepted for nonce {}", nonce);
            }
        }
    }

    // Padding never leaks plaintext length
    #[test]
    fn padded_frames_obscure_length(
        data_len in 0usize..1000,
        pad_min in 0u16..128,
        pad_max in 128u16..256,
    ) {
        let data = vec![0u8; data_len];
        let padded = add_padding(&data, pad_min, pad_max);
        // Multiple runs with same data should produce different lengths
        let padded2 = add_padding(&data, pad_min, pad_max);
        // At minimum, padded length >= data_len + pad_min
        prop_assert!(padded.len() >= data_len + pad_min as usize);
    }
}
```

---

## 3. Integration Tests

### End-to-End Proxy Test
```rust
// tests/integration/proxy_e2e.rs
#[tokio::test]
async fn test_tcp_proxy_roundtrip() {
    // 1. Start a mock target server
    let target = start_echo_server().await;

    // 2. Start prisma server with test config
    let server = start_test_server(target.addr()).await;

    // 3. Start prisma client
    let client = start_test_client(server.addr()).await;

    // 4. Connect through SOCKS5
    let mut stream = TcpStream::connect(client.socks5_addr()).await.unwrap();
    // Send SOCKS5 connect to target
    socks5_connect(&mut stream, target.addr()).await.unwrap();

    // 5. Send data and verify echo
    stream.write_all(b"hello").await.unwrap();
    let mut buf = [0u8; 5];
    stream.read_exact(&mut buf).await.unwrap();
    assert_eq!(&buf, b"hello");
}
```

### Transport Integration Tests
```rust
// Test each transport type
#[tokio::test]
async fn test_quic_transport() { transport_test(TransportType::QuicV2).await; }

#[tokio::test]
async fn test_tcp_tls_transport() { transport_test(TransportType::PrismaTls).await; }

#[tokio::test]
async fn test_ws_transport() { transport_test(TransportType::WebSocket).await; }
```

### Management API Integration Tests
```rust
#[tokio::test]
async fn test_full_client_lifecycle() {
    let app = build_test_app().await;

    // Create client
    let res = app.post("/api/clients").json(&new_client).send().await;
    assert_eq!(res.status(), 201);

    // List clients
    let res = app.get("/api/clients").send().await;
    let clients: Vec<Client> = res.json().await;
    assert_eq!(clients.len(), 1);

    // Delete client
    let res = app.delete(&format!("/api/clients/{}", client_id)).send().await;
    assert_eq!(res.status(), 200);
}
```

---

## 4. Snapshot Tests (insta)

```rust
use insta::assert_snapshot;
use insta::assert_yaml_snapshot;

// Config serialization snapshots
#[test]
fn test_server_config_snapshot() {
    let config = ServerConfig::default();
    assert_yaml_snapshot!(config);
}

// API response snapshots
#[test]
fn test_health_response_snapshot() {
    let response = HealthResponse { status: "ok", version: "0.6.3", uptime: 3600 };
    assert_yaml_snapshot!(response);
}

// Update snapshots: cargo insta review
```

---

## 5. Benchmark Tests

### Adding Criterion Benchmarks
```toml
# In prisma-core/Cargo.toml:
[dev-dependencies]
criterion = { version = "0.5", features = ["html_reports"] }

[[bench]]
name = "crypto_bench"
harness = false
```

```rust
// prisma-core/benches/crypto_bench.rs
use criterion::{black_box, criterion_group, criterion_main, Criterion, Throughput};

fn bench_chacha20_encrypt(c: &mut Criterion) {
    let key = [0x42u8; 32];
    let nonce = [0u8; 12];
    let cipher = ChaCha20Poly1305Cipher::new(&key);
    let data = vec![0u8; 32768]; // MAX_FRAME_SIZE

    let mut group = c.benchmark_group("chacha20-poly1305");
    group.throughput(Throughput::Bytes(32768));
    group.bench_function("encrypt-32kb", |b| {
        b.iter(|| {
            let mut buf = data.clone();
            cipher.encrypt_in_place(black_box(&nonce), &[], &mut buf).unwrap();
        });
    });
    group.finish();
}

fn bench_codec_roundtrip(c: &mut Criterion) {
    let cmd = Command::Data { data: vec![0u8; 1024] };
    c.bench_function("codec-roundtrip-1kb", |b| {
        b.iter(|| {
            let encoded = encode_command_payload(black_box(&cmd));
            decode_command_payload(CMD_DATA, &encoded).unwrap();
        });
    });
}

criterion_group!(benches, bench_chacha20_encrypt, bench_codec_roundtrip);
criterion_main!(benches);
```

```bash
# Run benchmarks
cargo bench -p prisma-core

# Compare against baseline
cargo bench -p prisma-core -- --save-baseline before
# ... make changes ...
cargo bench -p prisma-core -- --baseline before
```

---

## 6. Test Coverage

```bash
# Install cargo-tarpaulin
cargo install cargo-tarpaulin

# Generate coverage report
cargo tarpaulin --workspace --out html --output-dir coverage/

# Target: >80% line coverage for prisma-core (crypto, protocol)
# Target: >60% for other crates
```

### Coverage Priorities
| Crate | Target | Critical Modules |
|-------|--------|-----------------|
| prisma-core | 80%+ | crypto/*, protocol/*, config/* |
| prisma-server | 60%+ | handler, auth, relay |
| prisma-client | 60%+ | connector, socks5, relay |
| prisma-mgmt | 70%+ | handlers/*, auth |
| prisma-cli | 40%+ | Commands dispatch |
| prisma-ffi | 50%+ | FFI boundary, error codes |

---

## 7. CI/CD Pipeline

### Existing CI/CD Pipeline (`.github/workflows/`)

**`ci.yml`** — Main CI (already configured):
- **Lint job**: `cargo fmt --all -- --check` + `cargo clippy` (ubuntu, sccache + rust-cache)
- **Test job** (matrix across 5 targets):
  - `x86_64-unknown-linux-gnu` (ubuntu-latest)
  - `aarch64-unknown-linux-gnu` (ubuntu-24.04-arm)
  - `aarch64-apple-darwin` (macos-latest)
  - `x86_64-apple-darwin` (macos-latest)
  - `x86_64-pc-windows-msvc` (windows-latest)
  - Uses `cargo nextest` for parallel test execution
- **GUI check job**: Node 22, `npx tsc --noEmit`

**`benchmark.yml`** — Weekly benchmark (Monday 4am UTC):
- Compares Prisma vs xray-core vs sing-box
- 25 scenarios, multiple payload sizes
- Historical tracking (12-week history)

**`docker.yml`** — Multi-platform container builds:
- `linux/amd64` + `linux/arm64`
- Published to GitHub Container Registry on version tags

---

## 8. Test Writing Rules

1. **Every new feature gets tests** — no exceptions
2. **Every bug fix gets a regression test** — prove the bug existed, prove it's fixed
3. **Crypto code gets property-based tests** — proptest for encode/decode, encrypt/decrypt
4. **Config changes get snapshot tests** — catch unintended serialization changes
5. **API endpoints get integration tests** — verify status codes, response shapes
6. **FFI functions get boundary tests** — null pointers, invalid states, error codes
7. **Tests must be deterministic** — no flaky tests, no time-dependent assertions
8. **Tests must be fast** — unit tests < 1s each, integration tests < 10s each

### When Adding Tests After Implementation
```bash
# 1. Add tests
# 2. Run and verify
cargo test -p <crate> -- <test_name> --nocapture

# 3. Run full suite to check for regressions
cargo test --workspace

# 4. Check for clippy warnings in tests
cargo clippy --workspace --all-targets -- -D warnings
```
