---
sidebar_position: 9
---

# PrismaTLS

PrismaTLS is PrismaVeil's active probing resistance system (v1.5.0), replacing the REALITY protocol. It makes the server indistinguishable from a real website to active probers while authenticating legitimate PrismaVeil clients through a hidden beacon in the TLS handshake.

## Why PrismaTLS replaces REALITY

REALITY embeds authentication data in the TLS `legacy_session_id` field (32 bytes). This approach has critical issues:

1. **TLS 1.3 deprecation**: Browsers are dropping non-empty Session IDs in TLS 1.3, making any connection with a 32-byte Session ID instantly suspicious
2. **Fixed pattern**: Auth data is always at the same offset, making it detectable with the right heuristic
3. **Single mask server**: No failover if the mask server goes down

## Architecture

```
Application Data
    ↓
PrismaVeil v5 (framing, AEAD encryption with AAD, stream mux, traffic shaping, connection migration)
    ↓
PrismaTLS (auth embedding, ClientHello construction, mask relay)
    ↓
TLS 1.3 (actual cryptographic transport)
    ↓
TCP / QUIC v2
```

## Components

### PrismaAuth — Padding Extension Beacon

Authentication tag hidden inside the TLS `padding` extension at a position derived from the shared secret.

- **Epoch-rotated**: Tag position changes every hour (configurable)
- **Position-randomized**: Tag offset varies per epoch, no fixed pattern
- **Forward-secret**: Past connections are unlinkable
- **Constant-time verification**: Resistant to timing attacks

### PrismaMask — Dynamic Mask Server Pool

Multiple mask servers with automatic health checking and failover.

- Health checks every 60 seconds via TCP connect
- Round-robin load balancing among healthy servers
- RTT measurement for timing normalization
- Auto-failover when a mask server goes down

### PrismaFP — Browser Fingerprint Mimicry

Constructs TLS ClientHello at the byte level to match real browsers.

- Chrome, Firefox, Safari profiles
- Correct cipher suite order, extension order, GREASE values
- JA3/JA4 fingerprint verification
- Padding to target size (512 bytes for Chrome)

### PrismaFlow — Traffic Normalization

Post-handshake fingerprint defense.

- HTTP/2 SETTINGS frame mimicry (matches Chrome/Firefox/Safari)
- RTT normalization (delays responses to mask proxy hop)

## Configuration

### Server

```toml
[prisma_tls]
enabled = true
auth_secret = "hex-encoded-32-bytes"
auth_rotation_hours = 1

[[prisma_tls.mask_servers]]
addr = "www.microsoft.com:443"
names = ["www.microsoft.com"]

[[prisma_tls.mask_servers]]
addr = "www.apple.com:443"
names = ["www.apple.com"]
```

### Client

```toml
transport = "prisma-tls"
tls_server_name = "www.microsoft.com"
fingerprint = "chrome"
prisma_auth_secret = "hex-encoded-32-bytes"
```

## How it works

1. Client builds a Chrome-fingerprinted TLS ClientHello (PrismaFP)
2. Client embeds auth tag in padding extension at epoch-derived position (PrismaAuth)
3. Server receives ClientHello, checks padding for auth tag
4. **Authenticated**: Proceed with PrismaVeil handshake inside TLS channel
5. **Not authenticated**: Transparently relay to mask server (PrismaMask)
6. Active probers see exactly the real mask website — indistinguishable

## CDN compatibility

PrismaTLS and CDN transports serve different threat models:

| Mode | When to use | Server IP hidden? |
|------|-------------|-------------------|
| **QUIC v2 + Salamander** | Direct access, low latency | No |
| **TCP + PrismaTLS** | Direct access, max active probing resistance | No |
| **WebSocket over CDN** | Server IP must be hidden | Yes |
| **XPorta over CDN** | Max stealth, server IP hidden | Yes |

CDN modes don't use PrismaTLS because Cloudflare terminates TLS at the edge — the padding extension is invisible to the server.

## Monitoring

PrismaTLS status and mask server health are visible in the [Console](/docs/features/console) under Settings > TLS & Security, and via the Management API:

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/config/tls
# {"prisma_tls_enabled":true,"mask_servers":[{"addr":"www.microsoft.com:443","healthy":true,"rtt_ms":12}],"auth_rotation_hours":1}
