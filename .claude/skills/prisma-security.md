---
description: "Security & protocol engineering: PrismaVeil protocol, crypto, anti-detection, camouflage, traffic analysis resistance, fingerprint evasion"
globs:
  - "prisma-core/src/protocol/**/*.rs"
  - "prisma-core/src/crypto/**/*.rs"
  - "prisma-core/src/traffic_shaping.rs"
  - "prisma-core/src/salamander.rs"
  - "prisma-core/src/port_hop.rs"
  - "prisma-core/src/fec.rs"
  - "prisma-core/src/utls/**/*.rs"
  - "prisma-core/src/prisma_auth/**/*.rs"
  - "prisma-core/src/prisma_fp/**/*.rs"
  - "prisma-core/src/prisma_mask/**/*.rs"
  - "prisma-core/src/prisma_flow/**/*.rs"
  - "prisma-server/src/camouflage.rs"
  - "prisma-server/src/auth.rs"
  - "prisma-server/src/handler.rs"
---

# Prisma Security & Protocol Skill

You are the security engineering agent for Prisma. You handle protocol evolution, cryptographic correctness, anti-detection, camouflage, and traffic analysis resistance. Every change you make must prioritize security over performance — a fast but detectable proxy is useless.

## Security Threat Model

```
                    Adversary capabilities
                    ┌─────────────────────────────────┐
                    │ Passive: DPI, flow analysis      │
                    │ Active:  probe, replay, MITM     │
                    │ Context: GFW, ISP, enterprise FW │
                    └─────────────────────────────────┘
                              │
    ┌─────────────────────────┼─────────────────────────┐
    ▼                         ▼                         ▼
Protocol Detection     Traffic Analysis         Active Probing
(byte patterns,        (timing, volume,         (replay, connect-back,
 TLS fingerprint,       packet sizes,            protocol probe,
 ALPN, SNI)             flow duration)           behavior analysis)
```

---

## 0. Security Audit Checklist

Before any security-sensitive change, verify:

1. **Crypto primitives** — using well-audited crates (chacha20poly1305, aes-gcm, x25519-dalek, blake3)
2. **No custom crypto** — never roll your own cipher, MAC, or KDF
3. **Constant-time comparison** — all auth token checks use `ct_eq` from `prisma-core/src/util.rs`
4. **Nonce uniqueness** — `AtomicNonceCounter` never repeats (directional prefix prevents collision)
5. **Anti-replay** — sliding window bitmap rejects replayed nonces
6. **Key separation** — preliminary, session, and ticket keys derived from different contexts
7. **Forward secrecy** — ephemeral X25519 per connection, no static DH
8. **No plaintext leakage** — all payload encrypted, padding prevents length analysis
9. **Camouflage fallback** — server looks like a normal HTTPS site to probes
10. **Certificate handling** — proper TLS certificate validation, no `danger_accept_invalid_certs` in production

---

## 1. PrismaVeil Protocol (v4)

### Current Protocol Summary
```
Handshake: X25519 ECDH → BLAKE3 KDF → Session Keys
Framing:   [nonce:12][len:2][ciphertext][tag:16]
Payload:   [cmd:1][flags:2][stream_id:4][data]
Padding:   PADDED flag → [payload_len:2][payload][padding]
Bucketing: BUCKETED flag → fixed-size frames (anti-traffic-analysis)
```

### Protocol Evolution Principles
- **Never break the handshake format without version bump** — increment `PRISMA_PROTOCOL_VERSION`
- **New features via flag bits** — use unused bits in `flags:u16` or `server_features:u32`
- **New commands via unused command bytes** — currently 0x01-0x0E used, 0x0F-0xFF available
- **Backward compatibility** — old clients must gracefully handle unknown flags/commands

### When Modifying Protocol
1. Update `prisma-core/src/protocol/types.rs` (constants, Command enum)
2. Update `prisma-core/src/protocol/codec.rs` (encode/decode)
3. Update `prisma-core/src/protocol/handshake.rs` (if handshake changes)
4. Update both server handler and client relay
5. Update `prisma-docs/docs/security/prismaveil-protocol.md` (EN + CN)
6. Add tests for new wire format in codec tests
7. Consider migration path for existing deployments

---

## 2. Anti-Detection Strategies

### 2A. TLS Fingerprint Resistance — PrismaFP

**Location:** `prisma-core/src/prisma_fp/`

TLS fingerprinting (JA3/JA4) is the primary detection vector. PrismaFP constructs byte-level ClientHello matching real browsers:

**Components:**
- `ja3.rs` — JA3-SHA256 hash computation (same format as JA3, SHA-256 instead of MD5)
- `ja4.rs` — JA4 fingerprint computation
- `grease.rs` — GREASE value handling (prevents fingerprinting via reserved values)
- `builder.rs` — Byte-level ClientHello construction
- `extensions.rs` — TLS extension generation

**Fingerprint Profiles:**
- Chrome 120+ on Windows 10/11
- Firefox 121+ on Windows 10/11
- Safari 17+ on macOS Sonoma
- Random (selects per-connection)
- None (default rustls behavior)

**ALPN**: `["h2", "h3", "http/1.1"]` depending on profile

**When adding a new browser fingerprint:**
1. Capture real browser ClientHello (Wireshark/tshark)
2. Add profile to `prisma-core/src/prisma_fp/builder.rs`
3. Verify with `ja3.zone` or `tls.peet.ws`
4. Test all cipher suites and extensions match exactly

### 2B. Hidden Authentication — PrismaAuth

**Location:** `prisma-core/src/prisma_auth/`

Replaces REALITY's visible Session ID with auth hidden in TLS padding extension:

**Client Flow:**
1. Compute epoch: `floor(unix_time / rotation_interval)` (default 1 hour)
2. Generate auth_tag: `BLAKE3("prisma-auth", master_secret | ephemeral_pub | epoch)[0..16]`
3. Compute tag position: `BLAKE3("prisma-auth-pos", master_secret | epoch) % (padding_len - 16)`
4. Fill padding with random bytes, embed auth_tag at computed position

**Server Flow:**
1. Extract padding extension from TLS ClientHello
2. For each registered client's master_secret, check epochs {epoch-1, epoch, epoch+1}
3. Compute expected position, extract 16 bytes, constant-time compare
4. No match → probe/browser → relay to mask server

**Key files:** `beacon.rs` (tag generation/verification), `rotation.rs` (epoch calculation)

### 2C. Dynamic Mask Server Pool — PrismaMask

**Location:** `prisma-core/src/prisma_mask/mod.rs`

Pool of real-world mask servers (Microsoft, Apple, Google, etc.):
- Health checks every 60 seconds via TCP+TLS handshake
- Round-robin selection among healthy servers
- RTT measurement for timing normalization
- Unauthenticated connections transparently relayed to mask server
- Server indistinguishable from legitimate website to probers

### 2D. Protocol Camouflage

**Location:** `prisma-server/src/camouflage.rs`

Detection logic peeks at initial bytes:
- PrismaVeil: `[frame_len:2 BE (≥41)][version:0x04]`
- Rejects TLS ClientHello (0x16 0x03 pattern) and HTTP (0x47='G')
- Non-Prisma traffic relayed to fallback/decoy server

### 2E. Post-Handshake Defense — PrismaFlow

**Location:** `prisma-core/src/prisma_flow/`

- **HTTP/2 SETTINGS Mimicry** (`h2_mimicry.rs`): Chrome/Firefox/Safari H2 profiles to prevent fingerprinting via SETTINGS frame
- **RTT Normalization** (`timing.rs`): Uses mask server RTT to delay responses, preventing distinguishing direct vs proxied connections

### 2F. Traffic Pattern Masking

**Location:** `prisma-core/src/prisma_mask/`, `prisma-core/src/traffic_shaping.rs`

- **Padding** — random padding on every frame to obscure payload sizes
- **Bucket padding** — fixed-size frames to eliminate size-based fingerprinting
- **Timing jitter** — add random delays to break timing patterns
- **Chaff frames** — send dummy encrypted frames during idle periods (CHAFF flag)
- **Traffic shaping** — match traffic patterns of normal HTTPS browsing

---

## 3. Cryptographic Guidelines

### Cipher Selection
| Use case | Cipher | Why |
|----------|--------|-----|
| Data encryption | ChaCha20-Poly1305 (default) | Fast on all platforms, constant-time |
| Data encryption | AES-256-GCM (alternative) | Faster on x86 with AES-NI |
| Transport-only | TransportOnly (0x03) | TLS handles encryption, no double crypto |
| Key exchange | X25519 | Standard, fast, safe |
| Key derivation | BLAKE3 | Fast, secure, keyed mode |
| Auth tokens | HMAC-SHA256 | Standard, constant-time verify |

### Crypto Implementation Rules
1. **Never reuse nonces** — atomic counter + directional prefix guarantees uniqueness
2. **Always authenticate** — AEAD provides both confidentiality and integrity
3. **Zeroize secrets** — use `zeroize` crate for key material on drop
4. **Side-channel resistance** — constant-time comparison for all security-critical comparisons
5. **Entropy** — use `rand::rngs::OsRng` for all randomness (not `thread_rng` for crypto)
6. **Key rotation** — session tickets expire after `SESSION_TICKET_MAX_AGE_SECS` (24h)

### When Adding Crypto
```rust
// 1. Use existing AeadCipher trait
use prisma_core::crypto::aead::AeadCipher;

// 2. Implement trait for new cipher
impl AeadCipher for MyCipher {
    fn encrypt_in_place(&self, nonce: &[u8; 12], aad: &[u8], buffer: &mut Vec<u8>) -> Result<()> { .. }
    fn decrypt_in_place(&self, nonce: &[u8; 12], aad: &[u8], buffer: &mut Vec<u8>) -> Result<()> { .. }
}

// 3. Add to CipherSuite enum in types.rs
// 4. Add to cipher negotiation in handshake
// 5. Test with known test vectors
```

---

## 4. Anti-Replay Protection

### Current: Sliding Window Bitmap

**Location:** `prisma-core/src/protocol/anti_replay.rs`

```
Window: [1024-bit bitmap] with base counter
- Accept: nonce > base OR nonce in window AND bit not set
- Reject: nonce < (base - 1024) OR bit already set
- Advance: slide window when nonce > base
```

### Improvement Opportunities
- [ ] Increase window size for high-latency connections (2048 or 4096 bits)
- [ ] Per-stream anti-replay (currently per-session)
- [ ] Timestamp-based rejection for very old nonces (complement to sliding window)
- [ ] Bloom filter for memory-efficient replay detection at scale

---

## 5. Salamander (UDP Obfuscation)

**Location:** `prisma-core/src/salamander.rs`

Salamander wraps QUIC packets in an obfuscation layer:
- **Purpose:** make QUIC traffic not look like QUIC to DPI
- **Method:** header obfuscation + payload padding
- **Detection risk:** if QUIC is blocked, Salamander makes it look like random UDP

### Improvement Opportunities
- [ ] Adaptive obfuscation — detect and respond to active probing
- [ ] Protocol mimicry — make UDP traffic look like DNS, DTLS, or WireGuard
- [ ] Port hopping integration — combine with `prisma-core/src/port_hop.rs`

---

## 6. Forward Error Correction (FEC)

**Location:** `prisma-core/src/fec.rs`

Reed-Solomon FEC for lossy networks (cellular, satellite):
- Adds redundancy packets so receiver can reconstruct lost data
- Trade-off: bandwidth overhead vs packet loss tolerance
- **Configuration:** `fec_ratio` in config (e.g., 20% overhead = tolerate 20% loss)

---

## 7. Security Testing

### Test Patterns
```rust
#[cfg(test)]
mod tests {
    // 1. Known-answer tests for crypto
    #[test]
    fn test_aead_known_vector() {
        let cipher = ChaCha20Poly1305Cipher::new(&key);
        let result = cipher.encrypt(&nonce, &aad, &plaintext);
        assert_eq!(result, expected_ciphertext);
    }

    // 2. Anti-replay window tests
    #[test]
    fn test_replay_rejected() {
        let mut window = AntiReplayWindow::new();
        assert!(window.check_and_mark(42));
        assert!(!window.check_and_mark(42)); // replay!
    }

    // 3. Property-based tests with proptest
    proptest! {
        #[test]
        fn encrypt_decrypt_roundtrip(data: Vec<u8>) {
            let encrypted = cipher.encrypt(&nonce, &[], &data)?;
            let decrypted = cipher.decrypt(&nonce, &[], &encrypted)?;
            prop_assert_eq!(data, decrypted);
        }
    }

    // 4. Nonce uniqueness
    #[test]
    fn test_nonce_never_repeats() {
        let counter = AtomicNonceCounter::new(0x00);
        let mut seen = HashSet::new();
        for _ in 0..100_000 {
            let nonce = counter.next_nonce();
            assert!(seen.insert(nonce));
        }
    }
}
```

### External Security Validation
- [ ] Run `cargo audit` for known vulnerabilities in dependencies
- [ ] Run `cargo geiger` to count unsafe code blocks
- [ ] TLS validation with `testssl.sh` against the server
- [ ] Fingerprint check with `ja3.zone` or `tls.peet.ws`
- [ ] Active probe resistance testing (send non-Prisma data, verify camouflage response)
