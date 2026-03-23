---
sidebar_position: 3
---

# Anti-Replay & Padding

Prisma includes two defenses against network-level attacks: a sliding-window anti-replay mechanism and random padding on handshake messages.

## Anti-replay protection

### Sliding window

Prisma uses a 1024-bit sliding window to detect replayed or reordered nonce counter values. The window is implemented as a bitmap of 16 x `u64` words (1024 bits total).

### How it works

- The window tracks a `base` counter and a 1024-bit bitmap of seen counters relative to that base
- Each incoming frame's nonce counter is checked against the window:
  - **Below `base`**: rejected as too old (more than 1024 frames behind the highest seen)
  - **Within the window and already marked**: rejected as a replay
  - **Within the window and not seen**: accepted and marked in the bitmap
  - **Above the window**: the window advances, old entries are discarded, and the new counter is accepted

### Properties

- Allows up to 1024 frames of out-of-order delivery
- Detects exact replays within the window
- Automatically evicts stale entries as the counter advances
- Zero heap allocation — fixed-size `[u64; 16]` array

### Error handling

When a replay is detected, the frame is rejected with a `ReplayDetected` error containing the offending counter value. The connection can continue processing subsequent valid frames.

## Random padding

### Handshake padding

Both `ClientInit` (v3) / `ClientHello` (v1/v2) and `ServerInit` / `ServerHello` messages include random padding to resist traffic fingerprinting. The padding format is:

```
[padding_len:2 bytes BE][random_bytes:padding_len]
```

- Padding length is randomly chosen from 0 to `max_size` bytes (up to 256)
- Padding bytes are filled with cryptographically random data
- The receiver strips padding by reading the 2-byte length prefix

### Per-frame padding (v2/v3)

In protocol v2 and v3, every data frame includes random padding when `FLAG_PADDED` is set. The padded frame format is:

```
v3: [command:1][flags:2 LE][stream_id:4][payload_len:2][payload:var][padding:var]
v2: [command:1][flags:1][stream_id:4][payload_len:2][payload:var][padding:var]
```

- The padding range (min/max bytes) is negotiated during the handshake via the `ServerInit` (v3) or `ServerAccept` (v2) message
- Default range: 0–256 bytes
- Configurable via `[padding]` section in server config:

```toml
[padding]
min = 0     # minimum padding bytes per frame
max = 256   # maximum padding bytes per frame
```

- Each frame independently chooses a random padding length within the negotiated range
- The `payload_len` field allows the receiver to distinguish payload from padding
- This prevents traffic analysis that correlates frame sizes with application data sizes

### Why padding matters

Without padding, handshake messages have predictable sizes based on the fixed-size fields (public keys, timestamps). An observer could fingerprint PrismaVeil traffic by matching these sizes. Random padding makes each handshake a different total size.

Per-frame padding (v2) goes further: without it, data frame sizes correlate directly with application data sizes, enabling statistical traffic analysis. With randomized per-frame padding, the relationship between frame size and data size is obscured.

## Protocol constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_PADDING_SIZE` | 256 | Maximum handshake padding size |
| `DEFAULT_PADDING_RANGE` | 0–256 | Default per-frame padding range |
| Window size | 1024 bits | Anti-replay window capacity |
| Bitmap words | 16 | Number of `u64` words in the bitmap |
