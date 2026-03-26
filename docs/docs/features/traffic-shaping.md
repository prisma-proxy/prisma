---
sidebar_position: 10
---

# Traffic Shaping

PrismaVeil v5 includes traffic shaping defenses against encapsulated TLS fingerprinting, as described in USENIX Security 2024 research. These defenses prevent censors from identifying proxy traffic by analyzing packet size distributions and timing patterns.

## Bucket Padding

Pads every frame to the nearest size from a fixed bucket set. This eliminates size-based classification of inner TLS handshakes.

```toml
[traffic_shaping]
padding_mode = "bucket"
bucket_sizes = [128, 256, 512, 1024, 2048, 4096, 8192, 16384]
```

Without bucket padding, the size of the inner TLS ClientHello (~512 bytes) is visible even through the outer encryption, allowing censors to detect TLS-inside-TLS patterns.

## Chaff Injection

Sends dummy frames during idle periods to maintain background traffic noise. Chaff frames use `FLAG_CHAFF` and are discarded by the receiver.

```toml
[traffic_shaping]
chaff_interval_ms = 500   # Send chaff every 500ms when idle
```

## Timing Jitter

Adds random delays to handshake-phase frames to break timing patterns that could identify the inner protocol.

```toml
[traffic_shaping]
timing_jitter_ms = 30   # Up to 30ms random delay
```

## Frame Coalescing

Buffers small frames within a time window and merges them into larger frames. This hides the packet-size signature of inner TLS handshake messages.

```toml
[traffic_shaping]
coalesce_window_ms = 5   # Buffer for up to 5ms
```

## Recommended Configuration

For maximum anti-fingerprinting protection:

```toml
[traffic_shaping]
padding_mode = "bucket"
bucket_sizes = [128, 256, 512, 1024, 2048, 4096, 8192, 16384]
timing_jitter_ms = 30
chaff_interval_ms = 500
coalesce_window_ms = 5
```

For performance-sensitive deployments (minimal overhead):

```toml
[traffic_shaping]
padding_mode = "bucket"
bucket_sizes = [512, 1024, 4096, 16384]
```

## Runtime Configuration (v1.5.0)

All traffic shaping parameters are hot-reloadable via the [Management API](/docs/features/management-api). Changes take effect immediately without restarting the server or disconnecting clients.

```bash
curl -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"traffic_shaping": {"timing_jitter_ms": 50, "chaff_interval_ms": 250}}' \
  http://127.0.0.1:9090/api/config
```

The [Console](/docs/features/console) provides a visual traffic shaping dashboard (Settings > Traffic & Performance) showing the current bucket size distribution chart and configuration cards.

## Performance Impact

- Bucket padding: under 5% bandwidth overhead
- Chaff: ~1 small frame per 500ms (negligible)
- Jitter: under 50ms added latency on handshake only
- Coalescing: under 5ms latency on small frames
