---
description: "Module reference for all 6 Prisma Rust crates with file paths, key types, and extension recipes"
globs:
  - "crates/prisma-core/**/*.rs"
  - "crates/prisma-server/**/*.rs"
  - "crates/prisma-client/**/*.rs"
  - "crates/prisma-cli/**/*.rs"
  - "crates/prisma-mgmt/**/*.rs"
  - "crates/prisma-ffi/**/*.rs"
  - "Cargo.toml"
  - "crates/*/Cargo.toml"
---

# Prisma Crate Map (v2.19.0)

## Dependency Graph

```
prisma-cli --> prisma-server --> prisma-core
    |              |                  ^
    |              +-> prisma-mgmt ---+
    |
    +---> prisma-client --> prisma-core
              ^
         prisma-ffi
```

## prisma-core — Shared protocol, crypto, config, types

| Module | Path | Purpose |
|--------|------|---------|
| types | `src/types.rs` | `CipherSuite`, `ClientId`, `ProxyAddress`, `ProxyDestination`, `PaddingRange` |
| error | `src/error.rs` | `PrismaError`, `ProtocolError`, `CryptoError`, `ConfigError`, `Result<T>` |
| state | `src/state.rs` | `ServerState`, `ServerMetrics`, `ConnectionInfo`, `MetricsSnapshot` |
| logging | `src/logging.rs` | `init_logging()`, `init_logging_with_broadcast()`, `BroadcastLayer` |
| crypto/aead | `src/crypto/aead.rs` | `AeadCipher` trait, ChaCha20Poly1305, Aes256Gcm, TransportOnly |
| crypto/ecdh | `src/crypto/ecdh.rs` | X25519 key exchange |
| crypto/kdf | `src/crypto/kdf.rs` | BLAKE3 key derivation |
| crypto/padding | `src/crypto/padding.rs` | Random padding generation |
| protocol/handshake | `src/protocol/handshake.rs` | `AuthVerifier` trait, handshake client/server |
| protocol/codec | `src/protocol/codec.rs` | Wire format encode/decode |
| protocol/types | `src/protocol/types.rs` | `Command` enum, `DataFrame`, `SessionKeys`, `AtomicNonceCounter` |
| protocol/frame_encoder | `src/protocol/frame_encoder.rs` | Zero-copy `FrameEncoder` for hot relay path |
| protocol/anti_replay | `src/protocol/anti_replay.rs` | Sliding-window (1024-bit) nonce replay protection |
| config/server | `src/config/server.rs` | `ServerConfig`, `AuthorizedClient`, `TlsConfig` |
| config/client | `src/config/client.rs` | `ClientConfig`, `ClientIdentity`, `TunConfig` |
| config/validation | `src/config/validation.rs` | Config validation via `garde` |
| bandwidth | `src/bandwidth/` | `BandwidthLimiterStore`, `QuotaStore` (governor-based) |
| fec | `src/fec.rs` | Reed-Solomon forward error correction |
| port_hop | `src/port_hop.rs` | QUIC port hopping |
| salamander | `src/salamander.rs` | UDP obfuscation layer |
| traffic_shaping | `src/traffic_shaping.rs` | Anti-fingerprinting traffic shaping |
| dns | `src/dns/` | DNS resolution and tunneling |
| router | `src/router/` | GeoIP-based routing rules |
| xporta | `src/xporta/` | CDN-compatible REST API transport |
| utls | `src/utls/` | ClientHello fingerprinting (uTLS) |

## prisma-server — Server-side proxy logic

| Module | Path | Purpose |
|--------|------|---------|
| lib | `src/lib.rs` | `run()` entry point |
| handler | `src/handler.rs` | `handle_tcp_connection()`, camouflage handler |
| auth | `src/auth.rs` | `AuthStore`, `AuthVerifier` impl |
| relay | `src/relay.rs` | TCP relay (bidirectional copy) |
| udp_relay | `src/udp_relay.rs` | UDP relay |
| outbound | `src/outbound.rs` | Outbound connection management |
| camouflage | `src/camouflage.rs` | Protocol camouflage (fallback site) |
| listener/ | `src/listener/` | TCP, QUIC, WS, gRPC, XHTTP, XPorta listeners |
| streams | `src/ws_stream.rs`, `grpc_stream.rs`, `xhttp_stream.rs`, `xporta_stream.rs` | Transport wrappers |

## prisma-client — Client-side proxy logic

| Module | Path | Purpose |
|--------|------|---------|
| lib | `src/lib.rs` | `run()`, `run_embedded()` entry points |
| proxy | `src/proxy.rs` | `ProxyContext` (client config struct) |
| connector | `src/connector.rs` | `TransportStream` enum (Tcp/Quic/TcpTls/WS/Grpc/Xhttp/XPorta) |
| transport_selector | `src/transport_selector.rs` | `TransportType` enum, selection logic |
| socks5 | `src/socks5.rs` | SOCKS5 inbound handler |
| http | `src/http.rs` | HTTP CONNECT inbound handler |
| relay | `src/relay.rs` | Bidirectional relay |
| connection_pool | `src/connection_pool.rs` | Connection pooling |
| tun/ | `src/tun/` | TUN device (wintun/libc/utun) |

## prisma-cli — Command-line interface

| Module | Path | Purpose |
|--------|------|---------|
| main | `src/main.rs` | Clap 4 entry, `Commands` enum |
| api_client | `src/api_client.rs` | HTTP client for management API |
| init | `src/init.rs` | `prisma init` config generation |
| dashboard | `src/dashboard.rs` | TUI dashboard |
| Various | `src/{clients,connections,routes,bandwidth,metrics,status,logs,validate,diagnostics}.rs` | CLI subcommands |

## prisma-mgmt — Management REST/WebSocket API

| Module | Path | Purpose |
|--------|------|---------|
| router | `src/router.rs` | Axum `build_router()`, all route definitions |
| auth | `src/auth.rs` | Token-based auth middleware |
| handlers/ | `src/handlers/` | alerts, backup, bandwidth, clients, config, connections, forwards, health, routes, system |

Endpoints: `GET/POST/PUT/DELETE /api/{health,metrics,connections,clients,bandwidth,config,backups,routes,forwards,alerts,system}` + WS `/api/ws/{metrics,logs}`

## prisma-ffi — C FFI for GUI/mobile

| Module | Path | Purpose |
|--------|------|---------|
| lib | `src/lib.rs` | C-ABI exports: `prisma_create/connect/disconnect/destroy` |
| connection | `src/connection.rs` | `ConnectionManager` |
| profiles | `src/profiles.rs` | Profile persistence (TOML) |
| qr | `src/qr.rs` | QR code/URI import-export |
| system_proxy | `src/system_proxy.rs` | OS proxy settings |
| auto_update | `src/auto_update.rs` | Auto-update mechanism |

## Extension Recipes

### Add a New Transport
1. Add variant to `TransportType` in `crates/prisma-client/src/transport_selector.rs`
2. Create stream wrapper in `crates/prisma-client/src/` implementing `AsyncRead + AsyncWrite`
3. Add to `TransportStream` enum in `crates/prisma-client/src/connector.rs`
4. Create connect function in `crates/prisma-client/src/connector.rs`
5. Add server listener in `crates/prisma-server/src/listener/`
6. Add config fields to `ClientConfig` and `ServerConfig`

### Add a New CLI Command
1. Add variant to `Commands` enum in `crates/prisma-cli/src/main.rs`
2. Create handler in `crates/prisma-cli/src/`
3. Wire match arm in main

### Add a Management API Endpoint
1. Create handler in `crates/prisma-mgmt/src/handlers/`
2. Add route in `crates/prisma-mgmt/src/router.rs` `build_router()`
3. Apply auth middleware if needed

### Add a New Protocol Command
1. Assign byte constant in `crates/prisma-core/src/protocol/types.rs`
2. Add variant to `Command` enum
3. Encode in `crates/prisma-core/src/protocol/codec.rs`
4. Decode in `crates/prisma-core/src/protocol/codec.rs`
5. Handle in `crates/prisma-server/src/relay.rs` and/or `crates/prisma-client/src/relay.rs`
