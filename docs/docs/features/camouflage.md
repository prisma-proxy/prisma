---
sidebar_position: 7
---

# Camouflage (Anti-Active-Detection)

Prisma's camouflage system resists active probing by censorship systems (such as the GFW) that fingerprint proxy protocols by connecting and observing the response. Without camouflage, the PrismaVeil handshake is trivially identifiable.

## Why camouflage matters

Active probing works by:
1. Detecting a suspicious connection (e.g. via traffic analysis)
2. Replaying or initiating a connection to the server
3. Sending HTTP, TLS, or random bytes
4. Observing whether the server responds differently from a real web server

If the server silently closes the connection or sends an unexpected response, it is flagged and blocked. Camouflage makes the server indistinguishable from a real HTTPS website.

## TLS-on-TCP

Wraps the TCP transport in a TLS layer using the same certificate and key used for QUIC. The PrismaVeil handshake runs inside the TLS tunnel, so outer traffic looks like standard HTTPS.

**Server config:**

```toml
[tls]
cert_path = "cert.pem"
key_path = "key.pem"

[camouflage]
enabled = true
tls_on_tcp = true
```

**Client config:**

```toml
transport = "tcp"
tls_on_tcp = true
tls_server_name = "yourdomain.com"
skip_cert_verify = false
```

The client connects via TLS to the server. Inside the TLS tunnel, the normal PrismaVeil handshake proceeds.

## Decoy fallback

When a non-Prisma connection arrives (HTTP probe, browser visit, GFW active probe), the server reverse-proxies it to a configurable decoy website instead of dropping the connection. This makes the server behave identically to a real HTTPS reverse proxy.

```toml
[camouflage]
enabled = true
fallback_addr = "example.com:443"
```

When a probe connects:
1. Server peeks at the first 3 bytes
2. If the bytes don't match a PrismaVeil ClientHello, the entire connection (including the peeked bytes) is forwarded to `fallback_addr`
3. The probe sees a real website response

## ALPN customization

PrismaVeil v5 uses standard ALPN `"h3"` for QUIC, avoiding protocol identification by DPI. For TCP-based transports with camouflage enabled, ALPN defaults to `["h2", "http/1.1"]` -- matching what real HTTPS sites use.

```toml
[camouflage]
enabled = true
alpn_protocols = ["h2", "http/1.1"]
```

The client must use matching ALPN:

```toml
alpn_protocols = ["h2", "http/1.1"]
```

## Full config example

### Server

```toml
listen_addr = "0.0.0.0:8443"
quic_listen_addr = "0.0.0.0:8443"

[tls]
cert_path = "/etc/prisma/cert.pem"
key_path = "/etc/prisma/key.pem"

[[authorized_clients]]
id = "your-client-uuid"
auth_secret = "your-hex-secret"
name = "laptop"

[camouflage]
enabled = true
tls_on_tcp = true
fallback_addr = "example.com:443"
alpn_protocols = ["h2", "http/1.1"]
```

### Client

```toml
socks5_listen_addr = "127.0.0.1:1080"
server_addr = "yourserver.com:8443"
transport = "tcp"
tls_on_tcp = true
tls_server_name = "yourserver.com"
alpn_protocols = ["h2", "http/1.1"]
skip_cert_verify = false

[identity]
client_id = "your-client-uuid"
auth_secret = "your-hex-secret"
```

## Best practices

- **Use a real domain certificate** — Get a certificate from Let's Encrypt for your domain. Self-signed certificates are detectable.
- **Pick a popular decoy site** — Use a site that is commonly accessed in your region (e.g. a CDN endpoint, cloud provider landing page).
- **Match ALPN to the decoy** — If your decoy serves HTTP/2, use `["h2", "http/1.1"]`. This is the default.
- **Use QUIC sparingly** — In heavily censored networks, QUIC/UDP may be blocked entirely. TLS-on-TCP is often more reliable.
- **Set `tls_server_name`** — Ensure the SNI matches your certificate's CN or SAN for a clean TLS handshake.

## Configuration reference

### Server (`[camouflage]`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable camouflage (activates decoy fallback and ALPN override) |
| `tls_on_tcp` | bool | `false` | Wrap TCP transport in TLS |
| `fallback_addr` | string? | — | Address of decoy server to proxy non-Prisma traffic to |
| `alpn_protocols` | string[] | `["h2", "http/1.1"]` | TLS/QUIC ALPN protocols |

### Client

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tls_on_tcp` | bool | `false` | Connect to server via TLS-wrapped TCP |
| `tls_server_name` | string? | — | TLS SNI server name (defaults to hostname in `server_addr`) |
| `alpn_protocols` | string[] | `["h2", "http/1.1"]` | TLS ALPN protocols (must match server) |

## TLS Probe Guard

In addition to decoy fallback, Prisma includes a **TLS probe guard** that automatically detects and blocks IPs exhibiting repeated TLS handshake failures. This is a strong indicator of active probing -- censorship systems often attempt rapid connection sequences to fingerprint the server.

When enabled (the default when camouflage is active), the probe guard tracks per-IP handshake failure counts within a configurable sliding window. Once an IP exceeds the threshold, it is temporarily blocked.

```toml
[camouflage.tls_probe_guard]
enabled = true
max_failures = 20           # failures per IP before blocking
failure_window_secs = 120   # sliding window (seconds)
block_duration_secs = 120   # block duration (seconds)
```

### Tuning guidance

| Scenario | Recommended settings |
|----------|---------------------|
| Standard deployment | Defaults (20 failures / 120s window / 120s block) |
| Heavily probed server | `max_failures = 5`, `block_duration_secs = 3600` |
| Shared hosting (many clients) | `max_failures = 50`, `failure_window_secs = 300` |
| Debugging connectivity | `enabled = false` (temporarily disable) |

The probe guard works alongside the decoy fallback -- probers that pass the TLS handshake but fail the PrismaVeil authentication are handled by the decoy fallback, while probers that cannot even complete TLS (e.g., sending random bytes) are caught by the probe guard.

## PrismaTLS (Recommended for Advanced Deployments)

For environments with active probing, PrismaTLS is the recommended approach for active probing resistance, replacing basic camouflage. PrismaTLS hides authentication inside the TLS padding extension and uses byte-level ClientHello fingerprint construction to match real browsers, providing stronger protection than decoy fallback alone. See the [Anti-Detection](../features/anti-detection.md#prismatls) documentation for full details.
