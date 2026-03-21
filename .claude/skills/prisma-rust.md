---
description: "Deep context for working on Prisma Rust crates: architecture, protocol, conventions, and extension recipes"
globs:
  - "prisma-core/**/*.rs"
  - "prisma-server/**/*.rs"
  - "prisma-client/**/*.rs"
  - "prisma-cli/**/*.rs"
  - "prisma-mgmt/**/*.rs"
  - "prisma-ffi/**/*.rs"
  - "Cargo.toml"
  - "*/Cargo.toml"
---

# Prisma Rust Crate Skill

## Architecture Overview

Prisma is a high-performance encrypted proxy built in Rust. The workspace (v1.7.0, edition 2021) contains 6 crates:

```
prisma-cli ──► prisma-server ──► prisma-core
    │              │                  ▲
    │              ├──► prisma-mgmt ──┘
    │              │
    └──► prisma-client ──► prisma-core
              ▲
         prisma-ffi
```

**Binary outputs:** `prisma-cli` (main CLI), `prisma-ffi` (C FFI shared library for GUI/mobile).

## Crate Map

### prisma-core — Shared protocol, crypto, config, types

| Module | Path | Purpose |
|--------|------|---------|
| types | `prisma-core/src/types.rs` | `CipherSuite`, `ClientId`, `ProxyAddress`, `ProxyDestination`, `PaddingRange` |
| error | `prisma-core/src/error.rs` | `PrismaError`, `ProtocolError`, `CryptoError`, `ConfigError`, `Result<T>` |
| state | `prisma-core/src/state.rs` | `ServerState`, `ServerMetrics`, `ConnectionInfo`, `MetricsSnapshot`, `metrics_ticker()` |
| logging | `prisma-core/src/logging.rs` | `init_logging()`, `init_logging_with_broadcast()`, `BroadcastLayer` |
| crypto/aead | `prisma-core/src/crypto/aead.rs` | `AeadCipher` trait, `ChaCha20Poly1305Cipher`, `Aes256GcmCipher`, `TransportOnlyCipher` |
| crypto/ecdh | `prisma-core/src/crypto/ecdh.rs` | X25519 key exchange |
| crypto/kdf | `prisma-core/src/crypto/kdf.rs` | BLAKE3 key derivation (preliminary, session, ticket keys) |
| crypto/padding | `prisma-core/src/crypto/padding.rs` | Random padding generation |
| protocol/handshake | `prisma-core/src/protocol/handshake.rs` | `AuthVerifier` trait, `PrismaHandshakeClient`, `PrismaHandshakeServer` |
| protocol/codec | `prisma-core/src/protocol/codec.rs` | Wire format encode/decode, `encode_command_payload()`, `decode_command_payload()` |
| protocol/types | `prisma-core/src/protocol/types.rs` | `Command` enum, `DataFrame`, `SessionKeys`, `AtomicNonceCounter`, command/flag/feature constants |
| protocol/frame_encoder | `prisma-core/src/protocol/frame_encoder.rs` | Zero-copy `FrameEncoder` for hot relay path |
| protocol/anti_replay | `prisma-core/src/protocol/anti_replay.rs` | Sliding-window (1024-bit) nonce replay protection |
| config/server | `prisma-core/src/config/server.rs` | `ServerConfig`, `AuthorizedClient`, `TlsConfig`, `PerformanceConfig` |
| config/client | `prisma-core/src/config/client.rs` | `ClientConfig`, `ClientIdentity`, `TunConfig`, `TrafficShapingConfig` |
| config/validation | `prisma-core/src/config/validation.rs` | Config validation via `garde` |
| bandwidth | `prisma-core/src/bandwidth/` | `BandwidthLimiterStore`, `QuotaStore` (governor-based token bucket) |
| fec | `prisma-core/src/fec.rs` | Reed-Solomon forward error correction |
| port_hop | `prisma-core/src/port_hop.rs` | QUIC port hopping |
| salamander | `prisma-core/src/salamander.rs` | UDP obfuscation layer |
| traffic_shaping | `prisma-core/src/traffic_shaping.rs` | Anti-fingerprinting traffic shaping |
| dns | `prisma-core/src/dns/` | DNS resolution and tunneling |
| router | `prisma-core/src/router/` | GeoIP-based routing rules |
| xporta | `prisma-core/src/xporta/` | CDN-compatible REST API transport |
| utls | `prisma-core/src/utls/` | ClientHello fingerprinting (uTLS) |
| prisma_auth | `prisma-core/src/prisma_auth/` | Auth subsystem |
| prisma_flow | `prisma-core/src/prisma_flow/` | Flow control |
| prisma_fp | `prisma-core/src/prisma_fp/` | Fingerprint resistance |
| prisma_mask | `prisma-core/src/prisma_mask/` | Traffic masking |

### prisma-server — Server-side proxy logic

| Module | Path | Purpose |
|--------|------|---------|
| lib | `prisma-server/src/lib.rs` | `run()` entry point |
| handler | `prisma-server/src/handler.rs` | `handle_tcp_connection()`, `handle_tcp_connection_camouflaged()` |
| auth | `prisma-server/src/auth.rs` | `AuthStore`, `AuthVerifier` impl |
| state | `prisma-server/src/state.rs` | `ServerContext` (wraps `ServerState`) |
| forward | `prisma-server/src/forward.rs` | Port forwarding logic |
| relay | `prisma-server/src/relay.rs` | TCP relay (bidirectional copy) |
| udp_relay | `prisma-server/src/udp_relay.rs` | UDP relay |
| outbound | `prisma-server/src/outbound.rs` | Outbound connection management |
| camouflage | `prisma-server/src/camouflage.rs` | Protocol camouflage (fallback site) |
| listener | `prisma-server/src/listener/` | TCP, QUIC, WS, gRPC, XHTTP, XPorta listeners |
| stream types | `prisma-server/src/ws_stream.rs`, `grpc_stream.rs`, `xhttp_stream.rs`, `xporta_stream.rs`, `channel_stream.rs` | Transport stream wrappers |

### prisma-client — Client-side proxy logic

| Module | Path | Purpose |
|--------|------|---------|
| lib | `prisma-client/src/lib.rs` | `run()`, `run_embedded()` entry points |
| proxy | `prisma-client/src/proxy.rs` | `ProxyContext` (client config struct with all transport options) |
| connector | `prisma-client/src/connector.rs` | `TransportStream` enum (Tcp/Quic/TcpTls/WebSocket/Grpc/Xhttp/XPorta) |
| transport_selector | `prisma-client/src/transport_selector.rs` | `TransportType` enum, `DEFAULT_FALLBACK_ORDER`, transport selection |
| socks5 | `prisma-client/src/socks5.rs` | SOCKS5 inbound handler |
| http | `prisma-client/src/http.rs` | HTTP CONNECT inbound handler |
| forward | `prisma-client/src/forward.rs` | Client-side relay |
| relay | `prisma-client/src/relay.rs` | Bidirectional relay |
| udp_relay | `prisma-client/src/udp_relay.rs` | UDP relay |
| tunnel | `prisma-client/src/tunnel.rs` | Tunnel establishment |
| connection_pool | `prisma-client/src/connection_pool.rs` | Connection pooling |
| tun | `prisma-client/src/tun/` | TUN device (platform-specific: wintun/libc/utun) |
| dns_resolver | `prisma-client/src/dns_resolver.rs` | DNS resolution |
| dns_server | `prisma-client/src/dns_server.rs` | Local DNS server for TUN mode |
| metrics | `prisma-client/src/metrics.rs` | Client-side metrics |

### prisma-cli — Command-line interface

| Module | Path | Purpose |
|--------|------|---------|
| main | `prisma-cli/src/main.rs` | Clap 4 (derive) CLI entry, `Commands` enum |
| api_client | `prisma-cli/src/api_client.rs` | HTTP client for management API |
| init | `prisma-cli/src/init.rs` | `prisma init` — generate config files |
| config_ops | `prisma-cli/src/config_ops.rs` | Config get/set/backup operations |
| clients | `prisma-cli/src/clients.rs` | Client CRUD commands |
| connections | `prisma-cli/src/connections.rs` | Connection list/disconnect/watch |
| routes | `prisma-cli/src/routes.rs` | Routing rule CRUD |
| dashboard | `prisma-cli/src/dashboard.rs` | TUI dashboard |
| bandwidth | `prisma-cli/src/bandwidth.rs` | Bandwidth summary/get/set |
| metrics | `prisma-cli/src/metrics.rs` | Metrics display |
| status | `prisma-cli/src/status.rs` | Server status |
| logs | `prisma-cli/src/logs.rs` | Log streaming |
| validate | `prisma-cli/src/validate.rs` | Config validation |
| diagnostics | `prisma-cli/src/diagnostics.rs` | Network diagnostics |
| completions | `prisma-cli/src/completions.rs` | Shell completions |

### prisma-mgmt — Management REST/WebSocket API

| Module | Path | Purpose |
|--------|------|---------|
| lib | `prisma-mgmt/src/lib.rs` | Exports |
| router | `prisma-mgmt/src/router.rs` | Axum router, `build_router()`, all route definitions |
| auth | `prisma-mgmt/src/auth.rs` | Token-based auth middleware |
| handlers/ | `prisma-mgmt/src/handlers/` | alerts, backup, bandwidth, clients, config, connections, forwards, health, routes, system |

**API endpoints:** `GET/POST/PUT/DELETE /api/{health,metrics,connections,clients,bandwidth,config,backups,routes,forwards,alerts,system}` + WebSocket `/api/ws/{metrics,logs}`.

### prisma-ffi — C FFI for GUI/mobile

| Module | Path | Purpose |
|--------|------|---------|
| lib | `prisma-ffi/src/lib.rs` | C-ABI exports: `prisma_create/connect/disconnect/destroy`, callbacks |
| connection | `prisma-ffi/src/connection.rs` | `ConnectionManager` |
| profiles | `prisma-ffi/src/profiles.rs` | Profile persistence (TOML) |
| qr | `prisma-ffi/src/qr.rs` | QR code/URI import-export |
| geo | `prisma-ffi/src/geo.rs` | GeoIP lookups |
| runtime | `prisma-ffi/src/runtime.rs` | Tokio runtime wrapper |
| system_proxy | `prisma-ffi/src/system_proxy.rs` | OS proxy settings (Windows/macOS) |
| auto_update | `prisma-ffi/src/auto_update.rs` | Auto-update mechanism |
| stats_poller | `prisma-ffi/src/stats_poller.rs` | Background stats collection |

**FFI error codes:** `PRISMA_OK=0`, `ERR_INVALID_CONFIG=1`, `ERR_ALREADY_CONNECTED=2`, `ERR_NOT_CONNECTED=3`, `ERR_PERMISSION_DENIED=4`, `ERR_INTERNAL=5`.
**FFI status:** `DISCONNECTED=0`, `CONNECTING=1`, `CONNECTED=2`, `ERROR=3`.
**Proxy modes (bitfield):** `SOCKS5=0x01`, `SYSTEM_PROXY=0x02`, `TUN=0x04`, `PER_APP=0x08`.

## Key Traits & Types

| Type | Location | Role |
|------|----------|------|
| `AeadCipher` | `prisma-core/src/crypto/aead.rs` | Trait: `encrypt/decrypt` + `_in_place` variants with 12-byte nonce + AAD |
| `AuthVerifier` | `prisma-core/src/protocol/handshake.rs` | Trait: `verify(client_id, auth_token, timestamp) -> bool` |
| `TransportStream` | `prisma-client/src/connector.rs` | Enum wrapping all transports, implements `AsyncRead + AsyncWrite` |
| `Command` | `prisma-core/src/protocol/types.rs` | Enum: 14 protocol commands (Connect, Data, Close, Ping/Pong, Forward*, Udp*, SpeedTest, Dns*, ChallengeResponse) |
| `DataFrame` | `prisma-core/src/protocol/types.rs` | Struct: `{ command, flags: u16, stream_id: u32 }` |
| `SessionKeys` | `prisma-core/src/protocol/types.rs` | Struct: session_key, cipher_suite, session_id, nonce counters, challenge, ticket |
| `AtomicNonceCounter` | `prisma-core/src/protocol/types.rs` | Lock-free atomic nonce generation |
| `ServerState` | `prisma-core/src/state.rs` | Shared server state: metrics, connections, auth_store, config, routing_rules, broadcast channels |
| `ProxyContext` | `prisma-client/src/proxy.rs` | Client config struct: server addr, identity, transport options, DNS, routing, metrics |
| `PrismaError` | `prisma-core/src/error.rs` | Top-level error: Protocol/Crypto/Config/Io/Connection/Auth/Other(anyhow) |
| `CipherSuite` | `prisma-core/src/types.rs` | Enum: `ChaCha20Poly1305=0x01`, `Aes256Gcm=0x02`, `TransportOnly=0x03` |
| `TransportType` | `prisma-client/src/transport_selector.rs` | Enum: QuicV2Salamander, QuicV2, PrismaTls, WebSocket, XPorta (+ legacy Quic, TcpTls, Tcp) |
| `FrameEncoder` | `prisma-core/src/protocol/frame_encoder.rs` | Zero-copy pre-allocated encoder for hot relay path |

## Protocol Quick Reference (PrismaVeil v5)

**Version:** `PRISMA_PROTOCOL_VERSION = 0x05`

### Handshake (2-step)

```
Client → Server: PrismaClientInit
  [version:1][flags:1][client_ephemeral_pub:32][client_id:16][timestamp:8]
  [cipher_suite:1][auth_token:32][padding:var]     (min 91 bytes)

  auth_token = HMAC-SHA256(auth_secret, client_id || timestamp)

Server → Client: PrismaServerInit (encrypted with preliminary key)
  [status:1][session_id:16][server_ephemeral_pub:32][challenge:32]
  [padding_min:2][padding_max:2][server_features:4]
  [ticket_len:2][ticket:var][bucket_count:2][bucket_sizes:2*N][padding:var]

Key derivation (BLAKE3):
  preliminary = blake3_derive("prisma-v3-preliminary", shared_secret || client_pub || server_pub)
  session     = blake3_derive("prisma-v3-session", preliminary || challenge)
  ticket      = blake3_derive("prisma-v3-session-ticket", server_secret)
```

**AcceptStatus:** `Ok=0x00`, `AuthFailed=0x01`, `ServerBusy=0x02`, `VersionMismatch=0x03`, `QuotaExceeded=0x04`

### Encrypted Frame Wire Format

```
[nonce:12][len:2 LE][ciphertext...][tag:16]
```

### DataFrame Format (inside ciphertext)

```
Normal:  [cmd:1][flags:2 LE][stream_id:4][payload:var]
Padded:  [cmd:1][flags:2 LE][stream_id:4][payload_len:2][payload:var][padding:var]
Bucketed:[cmd:1][flags:2 LE][stream_id:4][bucket_pad_len:2][payload:var][bucket_padding:var]
```

### Command Bytes

| Byte | Command | Payload |
|------|---------|---------|
| 0x01 | Connect | ProxyDestination (addr_type + addr + port) |
| 0x02 | Data | raw bytes |
| 0x03 | Close | (empty) |
| 0x04 | Ping | u32 sequence |
| 0x05 | Pong | u32 sequence |
| 0x06 | RegisterForward | u16 port + string name |
| 0x07 | ForwardReady | u16 port + bool success |
| 0x08 | ForwardConnect | u16 port |
| 0x09 | UdpAssociate | addr_type + addr + port |
| 0x0A | UdpData | assoc_id + frag + dest + payload |
| 0x0B | SpeedTest | direction + duration + data |
| 0x0C | DnsQuery | query_id + data |
| 0x0D | DnsResponse | query_id + data |
| 0x0E | ChallengeResponse | 32-byte hash |

### Flag Bits (u16 LE)

`PADDED=0x0001`, `FEC=0x0002`, `PRIORITY=0x0004`, `DATAGRAM=0x0008`, `COMPRESSED=0x0010`, `0RTT=0x0020`, `BUCKETED=0x0040`, `CHAFF=0x0080`

### Server Feature Flags (u32)

`UDP_RELAY=0x0001`, `FEC=0x0002`, `PORT_HOPPING=0x0004`, `SPEED_TEST=0x0008`, `DNS_TUNNEL=0x0010`, `BANDWIDTH_LIMIT=0x0020`, `TRANSPORT_ONLY_CIPHER=0x0040`

### Nonce Scheme

```
[direction:1][0x00:3][counter:8 BE]
  direction: 0x00 = client→server, 0x01 = server→client
  counter: AtomicU64, incremented per frame (Ordering::Relaxed)
```

Anti-replay: sliding-window bitmap (1024-bit), rejects replayed/too-old nonce counters.

### Constants

- `MAX_FRAME_SIZE = 32768`, `NONCE_SIZE = 12`, `TAG_SIZE = 16`, `MAX_PADDING_SIZE = 256`
- `SESSION_TICKET_MAX_AGE_SECS = 86400` (24h)
- QUIC v2: `0x6b3343cf` (RFC 9369), ALPN: `"h3"`
- Address types: IPv4=`0x01`, Domain=`0x03`, IPv6=`0x04`
- Default ports: server `8443`, mgmt `9090`, SOCKS5 `1080`

## Coding Conventions

### Error Handling
- **`thiserror` v2** for structured error enums (`PrismaError`, `ProtocolError`, `CryptoError`, `ConfigError`)
- **`anyhow` v1** at boundaries and for ad-hoc context (`.context("msg")`)
- `prisma_core::error::Result<T>` is the standard result alias
- `#[from]` conversions between error layers

### Logging
- **`tracing`** with structured fields: `tracing::{info, warn, debug, error, trace}`
- `init_logging(level, format)` — `"json"` or pretty
- `init_logging_with_broadcast()` — adds `BroadcastLayer` for management API log streaming
- Filter: `EnvFilter` from `RUST_LOG` env var, fallback to config level

### Async Patterns
- **Tokio 1** (full features) — `tokio::spawn`, `tokio::select!`, `tokio::time::interval`
- **`Arc<RwLock<T>>`** for shared mutable state (connections, config, auth_store, routing_rules)
- **`broadcast::Sender`** for real-time event streaming (logs, metrics)
- **`AtomicU64`** for lock-free counters on hot paths (nonces, metrics)
- **`Arc<T>`** for shared immutable state (metrics, router, bandwidth store)

### Config Patterns
- **TOML** serialization via `serde` + `toml` crate
- `#[serde(default)]` and `#[serde(default = "func")]` for optional fields with defaults
- Config validation via `garde` crate
- Hex-encoded secrets in config files (auth_secret)

### Security Patterns
- Constant-time comparison for auth tokens (HMAC-SHA256)
- In-place encryption/decryption to minimize plaintext exposure
- Anti-replay window for nonce counters
- Zero-fill padding (not RNG — already encrypted)

### Workspace Dependencies
- All deps declared in root `Cargo.toml` `[workspace.dependencies]` — crates reference via `dep.workspace = true`
- `resolver = "2"` for proper feature unification

## Extension Recipes

### Add a New Transport

1. **Define transport type** — add variant to `TransportType` in `prisma-client/src/transport_selector.rs`
2. **Add parse/display** — add `parse()` and `as_str()` match arms in `TransportType`
3. **Create stream wrapper** — new file `prisma-client/src/my_stream.rs` implementing a struct with `AsyncRead + AsyncWrite`
4. **Add to TransportStream enum** — add variant in `prisma-client/src/connector.rs`, add match arms to `poll_read`, `poll_write`, `poll_flush`, `poll_shutdown`
5. **Create connect function** — add `connect_my_transport()` in `prisma-client/src/connector.rs`
6. **Wire into transport selector** — add case in `prisma-client/src/transport_selector.rs` connect logic
7. **Server listener** — create `prisma-server/src/listener/my_transport.rs`, add to listener setup in `prisma-server/src/lib.rs`
8. **Server stream wrapper** — create `prisma-server/src/my_stream.rs` if needed
9. **Config fields** — add `use_my_transport`, options to `ClientConfig` and `ServerConfig`
10. **Update ProxyContext** — add fields to `prisma-client/src/proxy.rs`

### Add a New CLI Command

1. **Add variant** to `Commands` enum in `prisma-cli/src/main.rs` with clap attributes
2. **Create handler** — new file `prisma-cli/src/my_command.rs`
3. **Implement handler** — async fn taking args, using `ApiClient` for mgmt API calls
4. **Wire match arm** — add `Commands::MyCommand { .. } => my_command::run(..).await` in main
5. For nested subcommands: create a sub-enum with `#[command(subcommand)]`

### Add a Management API Endpoint

1. **Create handler** — new file or add function in `prisma-mgmt/src/handlers/`
2. **Handler signature** — `async fn my_handler(State(state): State<MgmtState>, ...) -> impl IntoResponse`
3. **Add route** — in `prisma-mgmt/src/router.rs` `build_router()`: `.route("/api/my-thing", get(handlers::my_handler))`
4. **Apply auth** — wrap with auth middleware if needed
5. **Return JSON** — `Ok(Json(response))` or error with `StatusCode`

### Add a New Protocol Command

1. **Assign byte** — add `CMD_MY_THING = 0x0F` constant in `prisma-core/src/protocol/types.rs`
2. **Add variant** — to `Command` enum with fields
3. **Add cmd_byte()** — match arm in `Command::cmd_byte()`
4. **Encode** — add case in `encode_command_payload()` in `prisma-core/src/protocol/codec.rs`
5. **Decode** — add case in `decode_command_payload()` in `prisma-core/src/protocol/codec.rs`
6. **Handle server-side** — dispatch in relay/handler module (`prisma-server/src/relay.rs` or `handler.rs`)
7. **Handle client-side** — if bidirectional, add handling in `prisma-client/src/relay.rs`

## Performance Notes

- **Hot path:** relay loop (encrypt→send→recv→decrypt) — avoid allocations, use `FrameEncoder` (zero-copy, pre-allocated buffers)
- **Nonce generation:** `AtomicNonceCounter` with `Ordering::Relaxed` — eliminates ~30K+ lock ops/sec
- **In-place crypto:** `encrypt_in_place` / `decrypt_in_place` to avoid buffer copies
- **Buffer size:** `MAX_FRAME_SIZE = 32768` (32KB)
- **Bandwidth checks:** skip entirely when limit is unlimited (no governor overhead)
- **Metrics:** atomics for counters, broadcast channel for snapshots (1-second ticker)
- **Connection pool:** reuses transport connections across SOCKS5 requests

## Platform Notes

- **TUN:** `wintun` (Windows), `/dev/net/tun` ioctl (Linux, needs `CAP_NET_ADMIN`), `utun` (macOS, needs root)
- **System proxy:** WinReg + `InternetSetOptionW` (Windows), `networksetup` (macOS), Linux not yet implemented
- **Config paths:** `/etc/prisma/` → `$XDG_CONFIG_HOME/prisma/` → `~/.config/prisma/` (Linux/macOS), `%PROGRAMDATA%\prisma\` (Windows)
- **Release profile:** `strip = true`, `lto = "thin"`, `codegen-units = 1`

## Verification Commands

```bash
cargo build --workspace                    # Build all crates
cargo build --release -p prisma-cli        # Release build of CLI
cargo test --workspace                     # Run all tests
cargo test -p prisma-core                  # Test specific crate
cargo clippy --workspace --all-targets     # Lint
cargo fmt --all -- --check                 # Format check
RUST_LOG=debug cargo run -p prisma-cli     # Run with debug logging
```
