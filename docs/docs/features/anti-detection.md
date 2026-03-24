---
sidebar_position: 8
---

# Anti-Detection Features

PrismaVeil includes multiple layers of anti-detection to resist deep packet inspection (DPI), active probing, and traffic analysis by censorship systems like the GFW.

## Salamander UDP Obfuscation

Salamander strips QUIC protocol headers and XOR-obfuscates all UDP packets, making traffic appear as random noise.

### How It Works

1. Derive a keystream from the shared password using BLAKE3
2. Generate a per-packet nonce (non-deterministic) to prevent correlation attacks
3. XOR every outgoing UDP packet with the nonce-keyed keystream before sending
4. On receive, extract the nonce and XOR to recover the original QUIC packet
5. Result: no recognizable QUIC or TLS headers on the wire

### Entropy Camouflage

Salamander v2 prepends a short ASCII prefix to each obfuscated packet. This lowers the measured entropy of the packet to pass GFW Ex2 (entropy analysis) checks, which flag purely random traffic. The ASCII prefix is derived deterministically from the packet nonce so the receiver can strip it without ambiguity.

### Configuration

```toml
# Server
[camouflage]
salamander_password = "your-shared-obfuscation-password"

# Client
salamander_password = "your-shared-obfuscation-password"
```

### When to Use

- Networks that block all identifiable QUIC traffic
- Environments that whitelist only known protocols (random UDP may still pass)

## Port Hopping

Periodically changes the UDP port used for QUIC connections, preventing IP:port-based blocking.

### How It Works

Both client and server compute the same port using HMAC-SHA256:

```
current_port = base_port + HMAC-SHA256(auth_secret, epoch)[0..2] % port_range
epoch = floor(current_time / interval_secs)
```

A grace period allows connections on both old and new ports during transitions.

### Configuration

```toml
# Server
[port_hopping]
enabled = true
base_port = 10000
port_range = 50000       # Ports 10000-60000
interval_secs = 60       # Hop every 60 seconds
grace_period_secs = 10   # Dual-port window

# Client
[port_hopping]
enabled = true
# Client uses same parameters automatically
```

## Congestion Control

Three modes to handle different network conditions:

### Brutal (Hysteria2-style)

Ignores packet loss signals and sends at a fixed target rate. Overcomes ISP throttling.

```toml
[congestion]
mode = "brutal"
target_bandwidth = "100mbps"
```

### BBR (Default)

Google BBRv2 — probes bandwidth and RTT. Fair with other traffic flows.

```toml
[congestion]
mode = "bbr"
```

### Adaptive

Starts with BBR behavior. Detects intentional throttling (consistent loss + stable RTT) and gradually increases aggressiveness. Returns to BBR when throttling stops.

```toml
[congestion]
mode = "adaptive"
target_bandwidth = "100mbps"
```

## PrismaTLS

PrismaTLS replaces the REALITY protocol for active probing resistance. Instead of embedding auth in the TLS Session ID (which is deprecated in TLS 1.3), PrismaTLS hides a 16-byte HMAC auth tag inside the TLS padding extension.

- **PrismaAuth**: Authentication via padding extension beacon (epoch-rotated, position-randomized)
- **PrismaMask**: Dynamic pool of mask servers with health checking and auto-failover
- **PrismaFP**: Byte-level ClientHello construction matching Chrome/Firefox/Safari fingerprints
- **PrismaFlow**: HTTP/2 SETTINGS mimicry + RTT normalization

## Traffic Shaping

Defenses against encapsulated TLS fingerprinting (USENIX 2024):

- **Bucket padding**: Pad frames to fixed sizes from a configurable bucket set
- **Chaff injection**: Dummy frames during idle periods for background noise
- **Timing jitter**: Random delays on handshake-phase frames
- **Frame coalescing**: Buffer small frames and merge them to hide packet boundaries

### Configuration

```toml
[traffic_shaping]
padding_mode = "bucket"
bucket_sizes = [128, 256, 512, 1024, 2048, 4096, 8192, 16384]
timing_jitter_ms = 30
chaff_interval_ms = 500
coalesce_window_ms = 5
```

## Camouflage & Fallback

Non-PrismaVeil connections are transparently proxied to a decoy website, making the server indistinguishable from a normal web server to active probers.

```toml
[camouflage]
enabled = true
fallback_addr = "127.0.0.1:8080"   # Real web server to proxy to
tls_on_tcp = true
```

## Per-Frame Padding

Random padding added to every encrypted data frame within a negotiated range, preventing traffic analysis based on packet size distribution.

```toml
[padding]
min = 0
max = 256
```

## DNS Leak Prevention

Four DNS modes prevent DNS queries from leaking outside the tunnel:

### Direct (Default)

No DNS processing — domains are passed to the server for resolution. Safe when the SOCKS5/HTTP proxy handles all traffic.

### Smart DNS

Blocked domains (Google, YouTube, Twitter, etc.) are always routed through the tunnel. Other domains resolve directly for speed. Smart DNS also overrides Direct routing rules — blocked domains are always proxied.

```toml
[dns]
mode = "smart"
```

### Fake DNS (TUN Mode)

Assigns fake IPs from a reserved pool (198.18.0.0/15) to all domains. Zero DNS leaks — no real DNS queries leave the device. When traffic arrives for a fake IP, the real domain is looked up and proxied.

```toml
[dns]
mode = "fake"
fake_ip_range = "198.18.0.0/15"
```

### Tunnel All DNS

Every DNS query is encrypted and sent through the tunnel via CMD_DNS_QUERY. The server resolves and returns the response. Maximum privacy with slightly higher latency.

```toml
[dns]
mode = "tunnel"
upstream = "8.8.8.8:53"   # Server-side upstream DNS
```

## TUN Mode (System-Wide Proxy)

Captures all system traffic via a virtual network interface — no per-app proxy configuration needed. Games, system services, and all applications are automatically proxied.

```toml
[tun]
enabled = true
device_name = "prisma-tun0"
mtu = 1500
dns = "fake"   # Use Fake DNS in TUN mode
```

Supported on all major platforms:
- **Linux**: requires `CAP_NET_ADMIN` (uses `/dev/net/tun`)
- **Windows**: uses Wintun driver (no admin install needed on Windows 10+)
- **macOS**: uses utun kernel interface (requires root)

## Multi-Transport

As of v1.5.0, Prisma supports **9 distinct transport families** (12 configurations including variants). Different transports have different detectability profiles:

| Transport | DPI Resistance | CDN Compatible | UDP Support |
|-----------|---------------|----------------|-------------|
| QUIC + Salamander | Highest | No | Yes (native) |
| QUIC (standard) | High | No | Yes (native) |
| PrismaTLS | Highest | No | TCP fallback |
| XPorta | Highest | Yes | TCP fallback |
| XHTTP (stream-one) | High | Yes | TCP fallback |
| WebSocket | Medium | Yes | TCP fallback |
| gRPC | Medium | Yes | TCP fallback |
| SSH | Medium | No | TCP fallback |
| WireGuard | Medium | No | Yes (native) |
| TCP + TLS | Medium | No | TCP fallback |
| TCP (raw) | Low | No | TCP fallback |

> **Note**: QUIC transports support QUIC v2 (RFC 9369) for improved ossification resistance.
