# Prisma

A next-generation encrypted proxy infrastructure suite built in Rust. Prisma implements the **PrismaVeil v3** wire protocol — combining the best of XHTTP, Hysteria2, and original innovations into the most powerful anti-censorship tunnel available.

## Features

### Core Protocol
- **PrismaVeil v3** — 2-step handshake (1 RTT), 0-RTT session resumption with ticket system
- **Modern cryptography** — X25519 ECDH, BLAKE3 KDF, ChaCha20-Poly1305 / AES-256-GCM AEAD
- **HMAC-SHA256 authentication** with constant-time verification
- **Anti-replay protection** via 1024-bit sliding window + bloom filter for 0-RTT tickets
- **Per-frame padding** with negotiated ranges to resist traffic analysis

### Transport
- **6 transports** — QUIC, TCP, WebSocket, gRPC, XHTTP (3 modes), CDN-compatible
- **XHTTP modes** — packet-up, stream-up, stream-one with XMUX connection pooling
- **Double encryption** — PrismaVeil encryption inside QUIC/TLS for defense-in-depth

### Anti-Censorship
- **Salamander UDP obfuscation** — BLAKE3-derived XOR keystream makes QUIC look like random UDP
- **HTTP/3 masquerade** — QUIC server serves real websites to browsers; PrismaVeil clients distinguished by ALPN
- **Port hopping** — deterministic HMAC-based UDP port rotation with grace period
- **Camouflage** — TLS-on-TCP wrapping, decoy fallback for probes, configurable ALPN

### Performance
- **3 congestion control modes** — Brutal (Hysteria2-style), BBR, Adaptive (auto-detects throttling)
- **PrismaUDP** — dedicated UDP relay for games/VoIP via QUIC DATAGRAM extension
- **FEC (Forward Error Correction)** — Reed-Solomon erasure coding for UDP flows
- **Connection multiplexing** — XMUX pooling with configurable concurrency

### System-Wide Proxy
- **TUN mode** — capture all system traffic via virtual network interface
  - Windows (Wintun driver), Linux (`/dev/net/tun`), macOS (utun)
  - Userspace TCP/IP stack (smoltcp) for TCP stream extraction
- **Smart DNS** — 4 modes: direct, smart (GeoSite-based), fake IP (zero DNS leaks), tunnel
- **Rule-based routing** — domain/domain-suffix/domain-keyword/IP-CIDR/port rules with proxy/direct/block actions

### Operations
- **SOCKS5 proxy** (RFC 1928) + **HTTP CONNECT proxy** for application compatibility
- **Port forwarding / reverse proxy** — expose local services through the server (frp-style)
- **Management API** — REST + WebSocket API for live monitoring and control
- **Web dashboard** — real-time Next.js dashboard with metrics, client management, and log streaming
- **Per-client bandwidth limits** and **traffic quotas** (daily/weekly/monthly)
- **Speed test** — built-in bandwidth measurement
- **DNS caching** with async resolution
- **Structured logging** (pretty or JSON) via `tracing` with broadcast support

## Architecture

```
prisma/
├── prisma-core/       # Shared library: crypto, protocol, config, DNS, routing, congestion, FEC
├── prisma-server/     # Proxy server (TCP, QUIC, CDN, WS, gRPC, XHTTP inbound)
├── prisma-client/     # Proxy client (SOCKS5, HTTP CONNECT, TUN inbound)
├── prisma-mgmt/       # Management API (REST + WebSocket via axum)
├── prisma-cli/        # CLI wrapper with key/cert generation, init, validate, status
├── prisma-dashboard/  # Web dashboard (Next.js + shadcn/ui)
└── prisma-docs/       # Documentation site (Docusaurus)
```

**Data flow — outbound proxy (SOCKS5/HTTP):**

```
Application ──SOCKS5/HTTP──▶ prisma-client ──PrismaVeil/QUIC──▶ prisma-server ──TCP──▶ Destination
```

**Data flow — TUN mode (system-wide):**

```
All Apps ──IP packets──▶ TUN device ──smoltcp──▶ prisma-client ──PrismaVeil──▶ prisma-server ──▶ Destination
```

**Data flow — UDP relay (games/VoIP):**

```
Game ──UDP──▶ SOCKS5 UDP ASSOCIATE / TUN ──CMD_UDP_DATA──▶ prisma-server ──UDP──▶ Game Server
```

**Data flow — port forwarding (reverse proxy):**

```
Internet ──TCP──▶ prisma-server:port ──PrismaVeil──▶ prisma-client ──TCP──▶ Local Service
```

**Data flow — management & dashboard:**

```
Browser ──HTTP──▶ prisma-server (axum serves static dashboard + REST/WS API) ──▶ ServerState
```

## Quick Start

### One-Line Install

Automatically detects your OS and architecture:

**Linux / macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/Yamimega/prisma/master/install.ps1 | iex
```

**Install + Setup** (also generates credentials, TLS certs, and example configs):

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/install.sh | bash -s -- --setup

# Windows (PowerShell)
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Yamimega/prisma/master/install.ps1))) -Setup
```

<details>
<summary>Manual platform-specific downloads</summary>

| Platform | Command |
|----------|---------|
| Linux x86_64 | `curl -fsSL https://github.com/Yamimega/prisma/releases/latest/download/prisma-linux-amd64 -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma` |
| Linux aarch64 | `curl -fsSL https://github.com/Yamimega/prisma/releases/latest/download/prisma-linux-arm64 -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma` |
| Linux ARMv7 | `curl -fsSL https://github.com/Yamimega/prisma/releases/latest/download/prisma-linux-armv7 -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma` |
| macOS | `curl -fsSL https://github.com/Yamimega/prisma/releases/latest/download/prisma-darwin-$(uname -m | sed s/x86_64/amd64/) -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma` |
| Windows x64 | `Invoke-WebRequest -Uri "https://github.com/Yamimega/prisma/releases/latest/download/prisma-windows-amd64.exe" -OutFile "$env:LOCALAPPDATA\prisma\prisma.exe"` |
| Windows ARM64 | `Invoke-WebRequest -Uri "https://github.com/Yamimega/prisma/releases/latest/download/prisma-windows-arm64.exe" -OutFile "$env:LOCALAPPDATA\prisma\prisma.exe"` |
| FreeBSD x86_64 | `fetch -o /usr/local/bin/prisma https://github.com/Yamimega/prisma/releases/latest/download/prisma-freebsd-amd64 && chmod +x /usr/local/bin/prisma` |
| Cargo (any) | `cargo install --git https://github.com/Yamimega/prisma.git prisma-cli` |
| Docker | `docker run --rm -v $(pwd):/config ghcr.io/yamimega/prisma server -c /config/server.toml` |

</details>

### Prerequisites

- [Rust](https://rustup.rs/) stable toolchain
- [Node.js](https://nodejs.org/) 18+ (for building the dashboard)
- Git

### Build

```bash
git clone https://github.com/Yamimega/prisma.git && cd prisma

# Build the dashboard (static files)
cd prisma-dashboard && npm ci && npm run build && cd ..

# Build the server + client
cargo build --release
```

Binaries are placed in `target/release/`. Dashboard static files are in `prisma-dashboard/out/`.

Or install the CLI directly:

```bash
cargo install --path prisma-cli
```

### 1. Generate credentials

```bash
# Generate a client UUID + auth secret pair
cargo run -p prisma-cli -- gen-key
```

Output:

```
Client ID:   a1b2c3d4-e5f6-...
Auth Secret: 4f8a...  (64 hex characters)
```

### 2. Generate TLS certificate (required for QUIC)

```bash
cargo run -p prisma-cli -- gen-cert --output . --cn prisma-server
```

This creates `prisma-cert.pem` and `prisma-key.pem` in the current directory.

### 3. Configure the server

Create `server.toml`:

```toml
listen_addr = "0.0.0.0:8443"
quic_listen_addr = "0.0.0.0:8443"

[tls]
cert_path = "prisma-cert.pem"
key_path = "prisma-key.pem"

[[authorized_clients]]
id = "<client-id from gen-key>"
auth_secret = "<auth-secret from gen-key>"
name = "my-laptop"

[logging]
level = "info"       # trace | debug | info | warn | error
format = "pretty"    # pretty | json

[performance]
max_connections = 1024
connection_timeout_secs = 300

# Enable port forwarding (reverse proxy)
[port_forwarding]
enabled = true
port_range_start = 10000
port_range_end = 20000

# Enable management API + dashboard
[management_api]
enabled = true
listen_addr = "127.0.0.1:9090"
auth_token = "your-secure-token-here"
dashboard_dir = "./prisma-dashboard/out"  # Path to built dashboard static files
```

### 4. Configure the client

Create `client.toml`:

```toml
socks5_listen_addr = "127.0.0.1:1080"
http_listen_addr = "127.0.0.1:8080"  # optional, remove to disable HTTP proxy
server_addr = "<server-ip>:8443"
cipher_suite = "chacha20-poly1305"   # or "aes-256-gcm"
transport = "quic"                   # or "tcp"
skip_cert_verify = false             # set true for self-signed certs in dev

[identity]
client_id = "<same client-id>"
auth_secret = "<same auth-secret>"

# Port forwarding: expose local services through the server
[[port_forwards]]
name = "my-web-app"
local_addr = "127.0.0.1:3000"
remote_port = 10080

[logging]
level = "info"
format = "pretty"
```

### 5. Run

```bash
# Terminal 1 — start server
cargo run -p prisma-cli -- server -c server.toml

# Terminal 2 — start client
cargo run -p prisma-cli -- client -c client.toml

# Terminal 3 — use it (SOCKS5)
curl --socks5 127.0.0.1:1080 https://httpbin.org/ip

# Or via HTTP proxy
curl --proxy http://127.0.0.1:8080 https://httpbin.org/ip

# Port forwarding: access local_addr:3000 from the server at port 10080
curl http://<server-ip>:10080
```

### 6. Access the dashboard (optional)

If you configured `dashboard_dir` in the server config, the dashboard is served automatically at the management API address:

```
http://127.0.0.1:9090
```

Log in with your `management_api.auth_token` as the API token.

To build the dashboard from source:

```bash
cd prisma-dashboard && npm ci && npm run build
```

Static files are output to `prisma-dashboard/out/`.

## Dashboard

The Prisma dashboard provides a real-time web interface for monitoring and managing the proxy server.

**Pages:**

| Page | Description |
|------|-------------|
| **Overview** | Live metrics cards, traffic chart (bytes/sec), active connections table |
| **Server** | Server health, version, config details, TLS info |
| **Clients** | Client list with enable/disable, add/remove clients at runtime |
| **Routing** | Visual routing rules editor (domain/IP/port allow/block) |
| **Logs** | Real-time log stream with level and target filtering |
| **Settings** | Edit server config, view TLS info, camouflage status |

**Tech stack:** Next.js 16 (static export), shadcn/ui, Recharts, TanStack Query

The dashboard is built as static HTML/JS/CSS and served directly by the Prisma server via the `dashboard_dir` config option. No separate Node.js process is needed in production.

**Data sources:**
- REST API for CRUD operations (clients, routes, config)
- WebSocket for real-time push (metrics every 1s, log entries)

## Management API

When `management_api.enabled = true` in the server config, an axum HTTP server starts on the configured address.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Server status, uptime, version |
| `GET` | `/api/metrics` | Current metrics snapshot |
| `GET` | `/api/metrics/history` | Time-series metrics |
| `GET` | `/api/connections` | Active connections with byte counters |
| `DELETE` | `/api/connections/:id` | Force-disconnect a session |
| `GET` | `/api/clients` | Client list |
| `POST` | `/api/clients` | Generate new client credentials |
| `PUT` | `/api/clients/:id` | Update client (name, enabled) |
| `DELETE` | `/api/clients/:id` | Remove client |
| `GET` | `/api/config` | Sanitized server config |
| `PATCH` | `/api/config` | Hot-reload supported fields |
| `GET` | `/api/config/tls` | TLS certificate info |
| `GET` | `/api/forwards` | Active port forwards |
| `GET` | `/api/routes` | Routing rules |
| `POST` | `/api/routes` | Add routing rule |
| `PUT` | `/api/routes/:id` | Update routing rule |
| `DELETE` | `/api/routes/:id` | Remove routing rule |
| WS | `/api/ws/metrics` | Push metrics every 1s |
| WS | `/api/ws/logs` | Push log entries with client-side filtering |

All endpoints require `Authorization: Bearer <auth_token>`.

## CLI Reference

| Command | Flags | Description |
|---------|-------|-------------|
| `prisma server` | `-c, --config <PATH>` (default: `server.toml`) | Start the proxy server |
| `prisma client` | `-c, --config <PATH>` (default: `client.toml`) | Start the proxy client |
| `prisma gen-key` | — | Generate a new client UUID + auth secret |
| `prisma gen-cert` | `-o, --output <DIR>`, `--cn <NAME>` | Generate self-signed TLS certificate |
| `prisma init` | `--cdn`, `--server-only`, `--client-only`, `--force` | Generate annotated config files |
| `prisma validate` | `-c, --config <PATH>`, `-t, --type <server\|client>` | Validate config without starting |
| `prisma status` | `-u, --url <URL>`, `-t, --token <TOKEN>` | Query management API for server status |
| `prisma speed-test` | `-s, --server`, `-d, --duration`, `--direction`, `-C, --config` | Bandwidth measurement |
| `prisma version` | — | Show version, protocol, supported ciphers and transports |

## Configuration

### Config layering

Configuration is resolved in this order (later overrides earlier):

1. Compiled defaults
2. TOML config file
3. Environment variables with `PRISMA_` prefix (underscore-separated)

Example: `PRISMA_LOGGING_LEVEL=debug` overrides `logging.level`.

### Server config reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `listen_addr` | string | `"0.0.0.0:8443"` | TCP listen address |
| `quic_listen_addr` | string | `"0.0.0.0:8443"` | QUIC listen address |
| `tls.cert_path` | string | — | Path to TLS certificate PEM |
| `tls.key_path` | string | — | Path to TLS private key PEM |
| `authorized_clients[].id` | string | — | Client UUID |
| `authorized_clients[].auth_secret` | string | — | 64 hex char (32 byte) shared secret |
| `authorized_clients[].name` | string? | — | Optional client label |
| `authorized_clients[].bandwidth_up` | string? | — | Upload rate limit (e.g., `"100mbps"`) |
| `authorized_clients[].bandwidth_down` | string? | — | Download rate limit |
| `authorized_clients[].quota` | string? | — | Transfer quota (e.g., `"100GB"`) |
| `authorized_clients[].quota_period` | string? | — | `daily` / `weekly` / `monthly` |
| `logging.level` | string | `"info"` | `trace` / `debug` / `info` / `warn` / `error` |
| `logging.format` | string | `"pretty"` | `pretty` / `json` |
| `performance.max_connections` | u32 | `1024` | Max concurrent connections |
| `performance.connection_timeout_secs` | u64 | `300` | Idle connection timeout (seconds) |
| `port_forwarding.enabled` | bool | `false` | Enable port forwarding / reverse proxy |
| `port_forwarding.port_range_start` | u16 | `1024` | Minimum allowed forwarded port |
| `port_forwarding.port_range_end` | u16 | `65535` | Maximum allowed forwarded port |
| `management_api.enabled` | bool | `false` | Enable the management REST/WS API |
| `management_api.listen_addr` | string | `"127.0.0.1:9090"` | Management API bind address |
| `management_api.auth_token` | string | — | Bearer token for API authentication |
| `management_api.cors_origins` | string[] | `[]` | Allowed CORS origins |
| `management_api.dashboard_dir` | string? | — | Path to built dashboard static files |
| `camouflage.enabled` | bool | `false` | Enable camouflage (anti-active-detection) |
| `camouflage.tls_on_tcp` | bool | `false` | Wrap TCP transport in TLS |
| `camouflage.fallback_addr` | string? | — | Decoy server address for non-Prisma connections |
| `camouflage.alpn_protocols` | string[] | `["h2", "http/1.1"]` | TLS/QUIC ALPN protocols |
| `camouflage.h3_cover_site` | string? | — | Upstream URL for HTTP/3 masquerade cover site |
| `camouflage.h3_static_dir` | string? | — | Local static files for H3 masquerade |
| `camouflage.salamander_password` | string? | — | Salamander UDP obfuscation password (QUIC) |
| `congestion.mode` | string | `"bbr"` | `brutal` / `bbr` / `adaptive` |
| `congestion.target_bandwidth` | string? | — | Target for brutal/adaptive (e.g., `"100mbps"`) |
| `port_hopping.enabled` | bool | `false` | Enable QUIC port hopping |
| `port_hopping.base_port` | u16 | `10000` | Start of port range |
| `port_hopping.port_range` | u16 | `50000` | Number of ports in range |
| `port_hopping.interval_secs` | u64 | `60` | Seconds between hops |
| `port_hopping.grace_period_secs` | u64 | `10` | Dual-port acceptance window |
| `dns_upstream` | string | `"8.8.8.8:53"` | Upstream DNS for CMD_DNS_QUERY |
| `cdn.xhttp_mode` | string? | — | XHTTP mode: `packet-up` / `stream-up` / `stream-one` |
| `cdn.xhttp_upload_path` | string | `"/api/v1/upload"` | XHTTP upload endpoint path |
| `cdn.xhttp_download_path` | string | `"/api/v1/events"` | XHTTP download endpoint path |
| `cdn.xhttp_stream_path` | string | `"/api/v1/stream"` | XHTTP stream endpoint path |

### Client config reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `socks5_listen_addr` | string | `"127.0.0.1:1080"` | Local SOCKS5 bind address |
| `http_listen_addr` | string? | — | Local HTTP CONNECT proxy bind address (optional) |
| `server_addr` | string | — | Remote Prisma server address |
| `identity.client_id` | string | — | Client UUID (must match server config) |
| `identity.auth_secret` | string | — | Shared secret (must match server config) |
| `cipher_suite` | string | `"chacha20-poly1305"` | `chacha20-poly1305` / `aes-256-gcm` |
| `transport` | string | `"quic"` | `quic` / `tcp` / `ws` / `grpc` / `xhttp` |
| `skip_cert_verify` | bool | `false` | Skip TLS certificate verification |
| `tls_on_tcp` | bool | `false` | Connect via TLS-wrapped TCP |
| `tls_server_name` | string? | — | TLS SNI server name |
| `alpn_protocols` | string[] | `["h2", "http/1.1"]` | TLS/QUIC ALPN protocols |
| `salamander_password` | string? | — | Salamander UDP obfuscation password (QUIC) |
| `congestion.mode` | string | `"bbr"` | `brutal` / `bbr` / `adaptive` |
| `congestion.target_bandwidth` | string? | — | Target for brutal/adaptive (e.g., `"100mbps"`) |
| `port_hopping.enabled` | bool | `false` | Enable QUIC port hopping |
| `dns.mode` | string | `"direct"` | `smart` / `fake` / `tunnel` / `direct` |
| `dns.fake_ip_range` | string | `"198.18.0.0/15"` | CIDR range for fake DNS IPs |
| `tun.enabled` | bool | `false` | Enable TUN mode (system-wide proxy) |
| `tun.device_name` | string | `"prisma-tun0"` | TUN device name |
| `tun.mtu` | u16 | `1500` | TUN device MTU |
| `tun.dns` | string | `"fake"` | TUN DNS mode: `fake` / `tunnel` |
| `udp_fec.enabled` | bool | `false` | Enable FEC for UDP relay |
| `udp_fec.data_shards` | usize | `10` | Original packets per FEC group |
| `udp_fec.parity_shards` | usize | `3` | Parity packets per FEC group |
| `xhttp_mode` | string? | — | `packet-up` / `stream-up` / `stream-one` |
| `xmux.max_connections_min/max` | u16 | `1`/`4` | Connection pool size range |
| `xmux.max_concurrency_min/max` | u16 | `8`/`16` | Per-connection concurrency range |
| `routing.rules[].type` | string | — | `domain` / `domain-suffix` / `ip-cidr` / `port` / `all` |
| `routing.rules[].action` | string | `"proxy"` | `proxy` / `direct` / `block` |
| `port_forwards[].name` | string | — | Label for this port forward |
| `port_forwards[].local_addr` | string | — | Local service address |
| `port_forwards[].remote_port` | u16 | — | Port to listen on at the server |
| `logging.level` | string | `"info"` | Log level |
| `logging.format` | string | `"pretty"` | Log format |

## Anti-Censorship Features

Prisma provides multiple layers of anti-detection and anti-blocking:

### Salamander UDP Obfuscation

Strips QUIC headers and XOR-obfuscates all UDP packets with a BLAKE3-derived keystream. Traffic appears as random bytes on the wire. Cached key derivation avoids per-packet overhead.

```toml
# Server
[camouflage]
salamander_password = "shared-obfuscation-password"

# Client
salamander_password = "shared-obfuscation-password"
```

### HTTP/3 Masquerade

The QUIC server serves a real website over HTTP/3 to browsers and active probes. PrismaVeil clients are distinguished by ALPN negotiation (`prisma-v3` vs `h3`).

```toml
[camouflage]
h3_cover_site = "https://example.com"    # Reverse-proxy a real site
# OR
h3_static_dir = "/var/www/html"          # Serve local static files
```

### Port Hopping

Server binds a range of UDP ports. Client rotates ports on a deterministic HMAC-based schedule, making it difficult for censors to block a single port.

```toml
[port_hopping]
enabled = true
base_port = 10000
port_range = 50000
interval_secs = 60
grace_period_secs = 10
```

### Camouflage (TCP)

1. **TLS-on-TCP** — Wraps the TCP transport in TLS, making PrismaVeil traffic look like HTTPS
2. **Decoy fallback** — Non-Prisma connections are reverse-proxied to a decoy website
3. **ALPN customization** — Configurable ALPN protocols (default `["h2", "http/1.1"]`)

```toml
[camouflage]
enabled = true
tls_on_tcp = true
fallback_addr = "example.com:443"
alpn_protocols = ["h2", "http/1.1"]
```

### Congestion Control

Three modes to overcome network throttling:

| Mode | Best For |
|------|----------|
| **Brutal** | Throttled networks — sends at target rate regardless of loss |
| **BBR** | Normal networks — probes bandwidth, fair sharing |
| **Adaptive** | Auto-detects throttling and increases aggressiveness |

```toml
[congestion]
mode = "adaptive"
target_bandwidth = "100mbps"
```

See [Camouflage documentation](./prisma-docs/docs/features/camouflage.md) for detailed setup instructions.

## Port Forwarding (Reverse Proxy)

Prisma supports frp-style port forwarding, allowing you to expose local services behind NAT/firewalls through the Prisma server.

**How it works:**

1. The client establishes an encrypted PrismaVeil tunnel to the server
2. The client sends `RegisterForward` commands for each configured port
3. The server validates the port is within the allowed range and starts listening
4. When an external connection arrives at the server's forwarded port, the server sends a `ForwardConnect` message through the tunnel
5. The client opens a local TCP connection to the mapped `local_addr`
6. Data is relayed bidirectionally through the encrypted tunnel using multiplexed `stream_id`s

**Server configuration** — enable forwarding and restrict the port range:

```toml
[port_forwarding]
enabled = true
port_range_start = 10000
port_range_end = 20000
```

**Client configuration** — map local services to remote ports:

```toml
[[port_forwards]]
name = "web"
local_addr = "127.0.0.1:3000"
remote_port = 10080

[[port_forwards]]
name = "api"
local_addr = "127.0.0.1:8000"
remote_port = 10081
```

Once both are running, `http://<server-ip>:10080` routes through the encrypted tunnel to `127.0.0.1:3000` on the client machine.

## Routing Rules

The routing rules engine allows you to control which destinations clients can connect to. Rules are managed at runtime via the management API or dashboard.

**Rule conditions:**
- `DomainMatch` — glob pattern (e.g. `*.google.com`)
- `DomainExact` — exact domain match
- `IpCidr` — IP range (e.g. `192.168.0.0/16`)
- `PortRange` — port range (e.g. 80–443)
- `All` — matches everything

**Rule actions:** `Allow` or `Block`

Rules are evaluated in priority order (lowest number first). The first matching rule determines the action. If no rule matches, traffic is allowed by default.

## Protocol Overview

### PrismaVeil v3 Handshake (1 RTT)

```
Client                                    Server
  │                                         │
  │──── ClientInit ─────────────────────▶│  (version=0x03, X25519 pubkey, client_id,
  │                                         │   timestamp, cipher_suite, auth_token, padding)
  │                                         │
  │  Server: ECDH → preliminary key        │
  │                                         │
  │◀──── ServerInit (encrypted) ─────────│  (status, session_id, X25519 pubkey, challenge,
  │                                         │   padding_range, features, session_ticket)
  │                                         │
  │  Client: Derive final session key      │
  │                                         │
  │──── ChallengeResp (encrypted) ──────▶│  (BLAKE3(challenge)) — first data frame
  │                                         │
  │════ Encrypted data frames ════════════│
```

0-RTT resumption: Subsequent connections use session tickets to skip the full handshake.

### Encrypted frame wire format

```
[nonce:12 bytes][ciphertext length:2 bytes BE][ciphertext + AEAD tag]
```

### Data frame plaintext format (v3)

```
[command:1][flags:2 LE][stream_id:4][payload:variable]
```

**14 commands:** `CONNECT (0x01)`, `DATA (0x02)`, `CLOSE (0x03)`, `PING (0x04)`, `PONG (0x05)`, `REGISTER_FORWARD (0x06)`, `FORWARD_READY (0x07)`, `FORWARD_CONNECT (0x08)`, `UDP_ASSOCIATE (0x09)`, `UDP_DATA (0x0A)`, `SPEED_TEST (0x0B)`, `DNS_QUERY (0x0C)`, `DNS_RESPONSE (0x0D)`, `CHALLENGE_RESP (0x0E)`

**6 flag bits:** PADDED, FEC, PRIORITY, DATAGRAM, COMPRESSED, 0RTT

### Cryptographic details

| Component | Algorithm | Purpose |
|-----------|-----------|---------|
| Key exchange | X25519 ECDH | Ephemeral shared secret per session |
| Key derivation | BLAKE3 `derive_key` (2-phase) | Preliminary key + final session key |
| Data encryption | ChaCha20-Poly1305 or AES-256-GCM | Authenticated encryption of data frames |
| Authentication | HMAC-SHA256 | Client identity verification |
| Challenge-response | BLAKE3 hash | Proves client derived the correct session key |
| UDP obfuscation | BLAKE3-derived XOR keystream | Salamander packet obfuscation |
| FEC | Reed-Solomon erasure coding | UDP packet loss recovery |
| Nonce | `[direction:1][reserved:3][counter:8]` | Per-direction monotonic counter |
| Anti-replay | 1024-bit sliding bitmap + bloom filter | Detects replayed frames and 0-RTT tickets |

## Development

### Running tests

```bash
# All tests
cargo test --workspace

# With nextest (faster, used in CI)
cargo nextest run --workspace

# Property-based tests only
cargo test -p prisma-core --test protocol_proptest

# Snapshot tests only
cargo test -p prisma-core --test protocol_snapshots

# Integration / E2E test
cargo test -p prisma-core --test integration
```

### Test suite

| Category | Count | Description |
|----------|-------|-------------|
| Unit tests | 115 | Crypto, codec, anti-replay, handshake, DNS, FEC, Salamander, congestion, port hopping, routing, TUN |
| Config tests | 7 | Loading, validation, defaults, rejection of invalid configs |
| Property tests | 6 | Randomized round-trip testing via proptest |
| Snapshot tests | 9 | Wire format stability via insta (v1/v2/v3 frames) |
| Client tests | 27 | Connection pool, relay, proxy, XHTTP stream, UDP relay |
| Server tests | 16 | Handler, listeners, bandwidth, H3 masquerade |
| Integration | 1 | Full E2E: handshake + encrypted echo through tunnel |
| **Total** | **181** | |

### Dashboard development

```bash
cd prisma-dashboard
npm install
npm run dev     # Start dev server on http://localhost:3000 (for development only)
npm run build   # Build static files to out/ (served by prisma-server in production)
```

### Linting

```bash
cargo fmt --all -- --check
cargo clippy --workspace -- -D warnings
```

### Updating snapshots

If you change the wire format:

```bash
cargo insta test --accept
```

### Project structure

```
prisma-core/src/
├── cache.rs              # DNS cache (moka)
├── config/
│   ├── mod.rs            # Config loading (config-rs)
│   ├── server.rs         # ServerConfig + ManagementApiConfig + RoutingRule
│   ├── client.rs         # ClientConfig struct
│   └── validation.rs     # Config validation rules
├── congestion/           # Congestion control (Brutal, BBR, Adaptive)
│   ├── mod.rs            # CongestionMode enum
│   ├── brutal.rs         # Fixed-rate CC (Hysteria2-style)
│   ├── bbr.rs            # Google BBRv2
│   └── adaptive.rs       # Auto-switching with throttle detection
├── crypto/
│   ├── aead.rs           # AeadCipher trait + ChaCha20/AES-256-GCM impls
│   ├── ecdh.rs           # X25519 key exchange
│   ├── kdf.rs            # BLAKE3 key derivation (2-phase for v3)
│   └── padding.rs        # Random padding generation
├── dns/                  # DNS handling
│   ├── mod.rs            # DnsMode enum, DnsResolver
│   ├── smart.rs          # GeoSite-based blocklist matching
│   └── fake_ip.rs        # FakeIP pool (198.18.0.0/15, LRU eviction)
├── error.rs              # Error types (thiserror)
├── fec.rs                # Forward Error Correction (Reed-Solomon)
├── logging.rs            # Tracing initialization + broadcast layer
├── port_hop.rs           # HMAC-based port hopping algorithm
├── protocol/
│   ├── anti_replay.rs    # Sliding window replay detection
│   ├── codec.rs          # v1/v2/v3 encode/decode for all wire messages
│   ├── handshake.rs      # Client + server handshake (2-step v3 + legacy 4-step)
│   └── types.rs          # Protocol message types, 14 commands, v3 flags
├── router/               # Rule-based routing engine
│   ├── mod.rs            # Rule matching
│   └── rules.rs          # Domain/IP-CIDR/port/keyword rules
├── salamander.rs         # Salamander UDP obfuscation (BLAKE3 XOR keystream)
├── state.rs              # ServerState, ServerMetrics, ConnectionInfo
├── types.rs              # ClientId, ProxyAddress, CipherSuite, v3 constants
└── util.rs               # Shared helpers (hex, HMAC, framed I/O)

prisma-server/src/
├── auth.rs               # AuthStore (verifies client credentials, runtime CRUD)
├── bandwidth/            # Per-client rate limiting + traffic quotas
├── forward.rs            # Port forwarding session (multiplexed reverse proxy)
├── handler.rs            # Connection handler (v3 handshake → routing → proxy/forward)
├── listener/
│   ├── tcp.rs            # TCP accept loop with connection backpressure
│   ├── quic.rs           # QUIC endpoint with TLS + semaphore + Salamander
│   ├── cdn.rs            # CDN/reverse-proxy transport listener
│   ├── ws_tunnel.rs      # WebSocket tunnel listener
│   ├── grpc_tunnel.rs    # gRPC tunnel listener
│   ├── xhttp.rs          # XHTTP transport (packet-up, stream-up, stream-one)
│   ├── reverse_proxy.rs  # Decoy reverse proxy for camouflage
│   └── h3_masquerade.rs  # HTTP/3 masquerade (real website + PrismaVeil ALPN split)
├── grpc_stream.rs        # gRPC stream adapter
├── ws_stream.rs          # WebSocket stream adapter
├── xhttp_stream.rs       # XHTTP stream adapter (AsyncRead + AsyncWrite)
├── udp_relay.rs          # Server-side PrismaUDP relay
├── outbound.rs           # TCP connect to destination
├── relay.rs              # Bidirectional encrypted relay with anti-replay
└── state.rs              # Re-exports from prisma-core::state

prisma-client/src/
├── connection_pool.rs    # XMUX connection pooling
├── connector.rs          # TCP/QUIC/WS/gRPC/XHTTP transport to server
├── forward.rs            # Port forwarding client
├── grpc_stream.rs        # gRPC stream adapter
├── ws_stream.rs          # WebSocket stream adapter
├── xhttp_stream.rs       # XHTTP stream adapter
├── proxy.rs              # Shared ProxyContext for all inbound protocols
├── relay.rs              # Bidirectional relay (local ↔ tunnel, TUN ↔ tunnel)
├── socks5/
│   └── server.rs         # RFC 1928 SOCKS5 implementation
├── http/
│   └── server.rs         # HTTP CONNECT proxy implementation
├── tun/                  # TUN mode (system-wide proxy)
│   ├── mod.rs            # TUN module entry
│   ├── device.rs         # Platform TUN devices (Windows/Linux/macOS)
│   ├── handler.rs        # TUN packet handler (TCP/UDP routing)
│   ├── packet.rs         # IPv4/TCP/UDP packet parsing
│   └── tcp_stack.rs      # smoltcp userspace TCP/IP stack
├── udp_relay.rs          # Client-side PrismaUDP relay
└── tunnel.rs             # PrismaVeil tunnel establishment

prisma-cli/src/
├── main.rs               # CLI entry (server, client, gen-key, gen-cert, init, validate, status)
├── init.rs               # Interactive config setup
├── validate.rs           # Config validation command
└── status.rs             # Server connectivity check

prisma-mgmt/src/
├── auth.rs               # Bearer token middleware
├── handlers/             # REST endpoint handlers
├── ws/                   # WebSocket streams (metrics, logs)
├── router.rs             # Axum router with all routes
└── lib.rs                # pub async fn serve()

prisma-dashboard/src/
├── app/                  # Next.js App Router pages (static export)
│   ├── dashboard/        # Overview, Clients, Routing, Logs, Settings pages
│   └── login/            # Token-based authentication page
├── components/           # React components (shadcn/ui + custom)
├── hooks/                # WebSocket + TanStack Query hooks
└── lib/                  # API client, types, auth helpers, utilities
```

## Documentation

Full documentation is available at the [Prisma Docs site](./prisma-docs/). To build and view locally:

```bash
cd prisma-docs && npm install && npm start
```

## License

GPLv3.0
