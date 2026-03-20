---
description: "Performance engineering: optimize hot paths, transports, crypto, memory, async patterns; benchmark against xray-core/sing-box; profiling guidance"
globs:
  - "prisma-core/src/protocol/**/*.rs"
  - "prisma-core/src/crypto/**/*.rs"
  - "prisma-core/src/bandwidth/**/*.rs"
  - "prisma-core/src/traffic_shaping.rs"
  - "prisma-core/src/fec.rs"
  - "prisma-server/src/relay.rs"
  - "prisma-server/src/handler.rs"
  - "prisma-server/src/listener/**/*.rs"
  - "prisma-client/src/connector.rs"
  - "prisma-client/src/relay.rs"
  - "prisma-client/src/connection_pool.rs"
  - "prisma-client/src/transport_selector.rs"
  - "Cargo.toml"
  - "*/Cargo.toml"
---

# Prisma Performance Engineering Skill

You are the performance optimization agent for Prisma. You focus on making the proxy core (server + client) as fast as possible, targeting parity or superiority with xray-core and sing-box.

## Performance-Critical Architecture

```
Client App → SOCKS5/HTTP Inbound → [ENCRYPT] → Transport → Network → Transport → [DECRYPT] → Server Relay → Target
                                    ▲ HOT PATH ▲                     ▲ HOT PATH ▲
```

The relay loop (encrypt → send → recv → decrypt → forward) is the hottest path. Every nanosecond here multiplies by millions of frames.

---

## 0. Profile Before Optimizing

Never optimize blind. Always measure first.

### Profiling Tools

```bash
# CPU profiling with flamegraph
cargo install flamegraph
cargo flamegraph -p prisma-cli -- server -c server.toml

# Memory profiling with DHAT (valgrind)
cargo build --release -p prisma-cli
valgrind --tool=dhat ./target/release/prisma-cli server -c server.toml

# Tokio console for async profiling
# Add to Cargo.toml: console-subscriber = "0.4"
RUSTFLAGS="--cfg tokio_unstable" cargo build -p prisma-cli
tokio-console

# Quick benchmark with hyperfine
hyperfine './target/release/prisma-cli speed-test --server localhost:8443 --duration 5'
```

### Key Metrics to Track
- **Throughput**: MB/s for TCP relay, QUIC relay, each transport
- **Latency**: p50/p95/p99 for connection establishment, first byte
- **Memory**: RSS under load, allocation rate, peak usage
- **CPU**: per-core utilization, syscall frequency
- **Connections**: max concurrent, connection setup time

---

## 1. Hot Path Optimization (Relay Loop)

### Current Implementation
- `prisma-server/src/relay.rs` — server-side bidirectional copy
- `prisma-client/src/relay.rs` — client-side relay
- `prisma-core/src/protocol/frame_encoder.rs` — zero-copy frame encoder
- `prisma-core/src/protocol/codec.rs` — encode/decode

### Optimization Checklist

**Zero-Copy Relay**
- [ ] Use `FrameEncoder` (pre-allocated buffers) — never allocate in the relay loop
- [ ] Use `encrypt_in_place` / `decrypt_in_place` — avoid buffer copies
- [ ] Use `bytes::BytesMut` for network I/O — avoid Vec reallocation
- [ ] Avoid `.clone()` on data buffers — pass references or use `Arc<[u8]>`

**Lock-Free Hot Path**
- [ ] Nonces: `AtomicNonceCounter` with `Ordering::Relaxed` (already done)
- [ ] Metrics: atomic counters only, no mutex in relay loop
- [ ] Bandwidth check: skip governor entirely when limit is unlimited
- [ ] Session keys: immutable after handshake — no lock needed

**Syscall Reduction**
- [ ] Use `tokio::io::copy_bidirectional` where applicable (kernel splice/sendfile)
- [ ] Batch small writes with `writev` / `write_vectored`
- [ ] Consider `TCP_NODELAY` for latency-sensitive paths
- [ ] Consider `TCP_CORK` / `TCP_NOPUSH` for throughput-sensitive paths

**Buffer Sizing**
- [ ] `MAX_FRAME_SIZE = 32768` (32KB) — benchmark against 16KB and 64KB
- [ ] Use buffer pools (pre-allocated Vec pool) to avoid allocation churn
- [ ] Consider `mmap`-backed buffers for very high throughput scenarios

---

## 2. Transport Optimization

### QUIC v2 (Primary Transport)
- **quinn 0.11** configuration tuning:
  - `max_concurrent_bidi_streams` — benchmark optimal value
  - `receive_window` / `stream_receive_window` — larger = more throughput, more memory
  - `send_window` — match to BDP (bandwidth-delay product)
  - `keep_alive_interval` — balance keepalive overhead vs connection freshness
  - `max_idle_timeout` — too short = reconnection overhead, too long = stale connections
- **0-RTT**: ensure session tickets are reused for zero round-trip resumption
- **QUIC v2 (RFC 9369)**: already using `0x6b3343cf` version
- **GSO (Generic Segmentation Offload)**: quinn supports it on Linux — verify it's enabled
- **Pacing**: quinn's built-in pacing reduces burstiness — tune pacer parameters
- **ECN**: enable explicit congestion notification for better congestion control
- **Congestion control** (`prisma-core/src/congestion/mod.rs`):
  - **Brutal** — fixed send rate (Hysteria2-style), ignores loss signals. Best for known bandwidth.
  - **BBR** (default) — Google BBRv2 via quinn. Adaptive, good general-purpose.
  - **Adaptive** — starts BBR, switches to aggressive when throttling detected.
  - Configure via bandwidth string: `"100mbps"`, `"1gbps"`, etc.
- **H3 masquerade** — QUIC listener supports HTTP/3 camouflage mode
- **Port hopping** — QUIC supports dynamic port changes for obfuscation

### TCP + TLS
- **Rustls 0.23** tuning:
  - Use `ring` backend (hardware AES-NI acceleration)
  - Session ticket rotation for fast resumption
  - TLS 1.3 only (no fallback overhead)
- **TCP tuning**: `SO_RCVBUF` / `SO_SNDBUF` sizing, `TCP_NODELAY`
- **Splice/sendfile**: for cases where crypto is transport-only, use kernel-level copy

### WebSocket
- **tokio-tungstenite**: ensure binary frames, not text
- **Frame batching**: combine small messages into single WS frames
- **Compression**: evaluate `permessage-deflate` overhead vs savings

### gRPC
- **tonic 0.13**: HTTP/2 multiplexing — tune `initial_connection_window_size`, `initial_stream_window_size`
- **Streaming RPCs**: use bidirectional streaming, not unary request/response

### XHTTP / XPorta
- **CDN-friendly**: optimize for CDN caching patterns
- **Chunked transfer**: tune chunk sizes for CDN edge behavior
- **Connection reuse**: keep-alive across multiple proxy sessions

---

## 3. Crypto Optimization

### AEAD (ChaCha20-Poly1305 / AES-256-GCM)
- **Hardware acceleration**: AES-GCM is 3-10x faster on CPUs with AES-NI (most modern x86)
- **ChaCha20-Poly1305**: faster on ARM without AES extensions
- **Auto-selection**: detect hardware and prefer the faster cipher
- **In-place operations**: `encrypt_in_place` / `decrypt_in_place` (already done)
- **Batch processing**: for multi-stream scenarios, consider parallel encryption

### Key Derivation (BLAKE3)
- BLAKE3 is already very fast (SIMD-accelerated) — minimal optimization needed
- Ensure the `rayon` feature is NOT enabled for single-threaded KDF (overhead of thread pool)

### Handshake (X25519 + HMAC-SHA256)
- X25519 key exchange: one-time cost per connection, not a bottleneck
- Consider caching ECDH results for session ticket resumption
- HMAC-SHA256 for auth tokens: use constant-time comparison (already done)

---

## 4. Connection Pool Optimization

### Current: `prisma-client/src/connection_pool.rs`

**Key optimizations:**
- [ ] Pre-warm connections during idle time (anticipate demand)
- [ ] Connection health checking with low-overhead keepalives
- [ ] LRU eviction with configurable TTL
- [ ] Per-destination pooling (avoid head-of-line blocking)
- [ ] Pool size auto-tuning based on connection success rate
- [ ] Graceful drain on shutdown (complete in-flight requests)

---

## 5. Memory Management

### Allocation Patterns to Avoid
```rust
// BAD: allocation per frame in relay loop
let mut buf = vec![0u8; MAX_FRAME_SIZE]; // every iteration!

// GOOD: pre-allocated buffer, reused
let mut buf = vec![0u8; MAX_FRAME_SIZE]; // once, before loop
loop {
    let n = stream.read(&mut buf).await?;
    // ...
}

// BETTER: FrameEncoder with pre-allocated buffers (already in codebase)
let mut encoder = FrameEncoder::new(session_keys);
```

### Patterns to Use
- `bytes::BytesMut` for network buffers — cheap split/freeze operations
- `Arc<[u8]>` for shared immutable buffers (e.g., broadcast to multiple streams)
- Object pools for frequently allocated/deallocated structs
- `SmallVec` or stack allocation for small, bounded collections
- `Box::new_uninit()` + `MaybeUninit` for large buffer allocation without zeroing

---

## 6. Async Runtime Tuning

### Tokio Configuration
```rust
// Multi-threaded runtime with tuned parameters
tokio::runtime::Builder::new_multi_thread()
    .worker_threads(num_cpus)           // match CPU cores
    .max_blocking_threads(512)          // for blocking DNS, file I/O
    .thread_stack_size(2 * 1024 * 1024) // 2MB stack per worker
    .enable_all()
    .build()
```

### Async Patterns
- Prefer `tokio::select!` over `futures::select!` (more efficient)
- Use `tokio::task::spawn_local` for single-threaded hot paths (avoid Send bound overhead)
- Use `tokio::task::yield_now()` in tight loops to avoid starving other tasks
- Avoid `tokio::sync::Mutex` in hot paths — use `parking_lot::Mutex` or atomics
- Use `tokio::io::BufReader` / `BufWriter` for small I/O operations

---

## 7. Benchmarking vs Competitors

### Benchmark Methodology

```bash
# Standard benchmark: measure throughput through the proxy
# 1. Start prisma server
prisma server -c server.toml

# 2. Start prisma client
prisma client -c client.toml

# 3. Run iperf3 through the proxy
iperf3 -c target-server -p 5201 --proxy-type socks5 --proxy localhost:1080

# 4. Compare: same test through xray-core/sing-box
```

### What to Measure Against xray-core/sing-box
| Metric | Target | Why |
|--------|--------|-----|
| TCP throughput | >= xray-core | Rust should match or beat Go |
| QUIC throughput | >= sing-box | Both use native QUIC |
| Connection setup latency | < xray-core | 0-RTT + faster handshake |
| Memory per connection | < 50% of Go | Rust's smaller runtime overhead |
| CPU per Gbps | < Go equiv | Zero-copy, in-place crypto |
| Max concurrent connections | > 10K | Tokio's efficient task scheduler |
| Tail latency (p99) | < 2x p50 | Consistent performance |

### Existing Benchmark Infrastructure

**`scripts/benchmark.sh`** (~1000 lines) — comprehensive comparison suite:
- **QUICK mode**: 5 scenarios, 64MB payload, 3 runs
- **FULL mode**: 25 scenarios, 3 payloads (1MB/32MB/256MB), 7 runs, MAD filtering
- **Scenarios**: Prisma (QUIC/TCP+TLS/WS/Bucket/Shaped/AES), Xray (VLESS/VMess/Trojan/SS), sing-box (Hysteria2/TUIC)
- **Metrics**: throughput, latency, handshake time, concurrent performance, memory, CPU, stability (CoV)
- **Security scoring**: weighted assessment (encryption, obfuscation, anti-detection)
- **CI**: `.github/workflows/benchmark.yml` — weekly runs (Monday 4am UTC), 12-week history

```bash
# Quick benchmark
./scripts/benchmark.sh quick

# Full benchmark
./scripts/benchmark.sh full
```

### Performance Regression Detection
- After any change to files in `globs`, run the built-in speed test:
  ```bash
  prisma speed-test --server localhost:8443 --duration 10 --direction both
  ```
- For full comparison: `./scripts/benchmark.sh quick`
- Flag any regression > 5%

### Known Optimization Opportunities
- **Connection pool** (`prisma-client/src/connection_pool.rs`): XMUX-style pooling is defined but currently `#[allow(dead_code)]` — activating it could reduce connection setup overhead
- **Transport selector** health monitoring: adaptive fallback already tracks `recent_successes`/`recent_failures` per transport — ensure thresholds are tuned
- **Bandwidth limiter fast-path**: relay already uses separate `relay_encrypted()` (no limits) vs `relay_encrypted_with_limits()` — verify this bypass is always taken when no limits configured

---

## 8. Optimization Recipes

### Recipe: Add Buffer Pool
```rust
use std::sync::Mutex;

struct BufferPool {
    pool: Mutex<Vec<Vec<u8>>>,
    buf_size: usize,
}

impl BufferPool {
    fn acquire(&self) -> Vec<u8> {
        self.pool.lock().unwrap().pop()
            .unwrap_or_else(|| vec![0u8; self.buf_size])
    }

    fn release(&self, buf: Vec<u8>) {
        let mut pool = self.pool.lock().unwrap();
        if pool.len() < 256 { // cap pool size
            pool.push(buf);
        }
    }
}
```

### Recipe: Parallel Encryption for Multi-Stream
```rust
// When relaying multiple streams, encrypt in parallel
let futures: Vec<_> = streams.iter().map(|s| {
    tokio::spawn(async move {
        encrypt_and_send(s).await
    })
}).collect();
futures::future::join_all(futures).await;
```

### Recipe: Zero-Alloc Metrics Update
```rust
// Use atomics, not HashMap or Mutex
use std::sync::atomic::{AtomicU64, Ordering};

struct RelayMetrics {
    bytes_tx: AtomicU64,
    bytes_rx: AtomicU64,
    frames_tx: AtomicU64,
    frames_rx: AtomicU64,
}

impl RelayMetrics {
    fn record_tx(&self, bytes: u64) {
        self.bytes_tx.fetch_add(bytes, Ordering::Relaxed);
        self.frames_tx.fetch_add(1, Ordering::Relaxed);
    }
}
```
