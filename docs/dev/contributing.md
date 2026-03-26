---
title: Contributing Guide
---

# Contributing Guide

How to extend the Prisma proxy system: adding transports, CLI commands, API endpoints, config fields, testing, fuzzing, and benchmarking.

---

## Adding a New Transport

1. **Client stream adapter:** `crates/prisma-client/src/my_transport_stream.rs` -- implement `AsyncRead + AsyncWrite + Send + Unpin`
2. **Register in transport selector:** `crates/prisma-client/src/transport_selector.rs` -- add match arm
3. **Add module:** `crates/prisma-client/src/lib.rs`
4. **Server listener:** `crates/prisma-server/src/listener/my_transport.rs` -- implement `listen()` function
5. **Register listener:** `crates/prisma-server/src/listener/mod.rs` and `crates/prisma-server/src/lib.rs`
6. **Add config fields:** `crates/prisma-core/src/config/server.rs` and `client.rs`
7. **Update version command:** `crates/prisma-cli/src/main.rs`

---

## Adding a New CLI Command

1. Add command variant to `Commands` enum in `crates/prisma-cli/src/main.rs`
2. Create handler module in `crates/prisma-cli/src/`
3. Register module and add match arm in `main()`

---

## Adding a New Management API Endpoint

1. Create handler in `crates/prisma-mgmt/src/handlers/`
2. Register route in `crates/prisma-mgmt/src/router.rs`
3. Optionally add corresponding CLI command

---

## Adding a New Config Field

1. Add field with `#[serde(default)]` to config struct
2. Add default function
3. Add validation in `config/validation.rs`
4. Use in the appropriate crate
5. Add to reload handler if hot-reloadable

---

## Testing

```bash
cargo test --workspace              # All tests
cargo test -p prisma-core           # Specific crate
cargo test -- --nocapture           # With output
```

Conventions: `#[tokio::test]` for async, `proptest` for codec/protocol, mock `AuthVerifier` for handshake tests.

---

## Fuzzing

```bash
cargo install cargo-fuzz
cargo fuzz run fuzz_decode_client_init
```

Key targets: `fuzz_decode_client_init`, `fuzz_decode_server_init`, `fuzz_decode_data_frame`, `fuzz_mux_frame`.

---

## Benchmarks

```bash
cargo bench --workspace
cargo bench -p prisma-core -- handshake
```

Key benchmarks: `bench_aead_encrypt`, `bench_handshake`, `bench_handshake_pq`, `bench_relay_throughput`, `bench_router_evaluate`.

---

## Code Style

- `cargo fmt --all` before committing
- `cargo clippy --workspace --all-targets` -- fix all warnings
- Use `tracing` for logging (not `println!`)
- Use `anyhow::Result` for fallible functions
- FFI functions must use `ffi_catch!` macro
