---
sidebar_position: 2
---

# Getting Started

This guide walks you through setting up Prisma v2.26.0 and running your first proxy session — from pre-built binaries or from source.

## Prerequisites

- A server with a public IP (VPS, cloud instance, etc.)
- A client machine (laptop, desktop, or mobile device)
- For building from source: [Rust](https://rustup.rs/) stable toolchain and Git

## Option A: Pre-Built Binaries (Recommended)

Download the latest v2.26.0 release for your platform:

```bash
# Linux x86_64
curl -fsSL https://github.com/prisma-proxy/prisma/releases/download/v2.26.0/prisma-linux-amd64 -o prisma && chmod +x prisma

# macOS (Apple Silicon)
curl -fsSL https://github.com/prisma-proxy/prisma/releases/download/v2.26.0/prisma-darwin-arm64 -o prisma && chmod +x prisma

# macOS (Intel)
curl -fsSL https://github.com/prisma-proxy/prisma/releases/download/v2.26.0/prisma-darwin-amd64 -o prisma && chmod +x prisma
```

Or use the one-line installer:

```bash
curl -fsSL https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.sh | bash
```

Verify the installation:

```bash
prisma version
```

Expected output:

```
Prisma v2.26.0
Protocol: PrismaVeil v5
Ciphers:  ChaCha20-Poly1305, AES-256-GCM, Transport-Only
Transports: QUIC, TCP, WebSocket, gRPC, XHTTP, XPorta, SSH, WireGuard
```

## Option B: Build from Source

```bash
git clone https://github.com/prisma-proxy/prisma.git && cd prisma
cargo build --release
sudo cp target/release/prisma /usr/local/bin/
```

## Quick Start

### 1. Generate credentials

```bash
prisma gen-key
```

Output:

```
Client ID:   a1b2c3d4-e5f6-7890-abcd-ef1234567890
Auth Secret: 4f8a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a

# Add to server.toml:
[[authorized_clients]]
id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
auth_secret = "4f8a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a"
name = "my-client"

# Add to client.toml:
[identity]
client_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
auth_secret = "4f8a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a"
```

### 2. Generate TLS certificate (required for QUIC)

```bash
prisma gen-cert --output . --cn prisma-server
```

This creates `prisma-cert.pem` and `prisma-key.pem` in the current directory.

### 3. Generate config files

The fastest way to get started is to use `prisma init`, which generates annotated config files with fresh credentials:

```bash
prisma init
```

This creates both `server.toml` and `client.toml` with auto-generated UUIDs, auth secrets, and comments explaining every option. You can also use `prisma init --cdn` to include a fully annotated CDN transport section.

Alternatively, create the configs manually:

#### server.toml

```toml title="server.toml"
listen_addr = "0.0.0.0:8443"
quic_listen_addr = "0.0.0.0:8443"

# Enable hot-reload on config file changes
config_watch = true

[tls]
cert_path = "prisma-cert.pem"
key_path = "prisma-key.pem"

[[authorized_clients]]
id = "<client-id from gen-key>"
auth_secret = "<auth-secret from gen-key>"
name = "my-laptop"

[logging]
level = "info"
format = "pretty"

[performance]
max_connections = 1024
connection_timeout_secs = 300

[management]
enabled = true
listen_addr = "127.0.0.1:9090"
token = "your-secure-management-token"
```

#### client.toml

```toml title="client.toml"
socks5_listen_addr = "127.0.0.1:1080"
http_listen_addr = "127.0.0.1:8080"
server_addr = "<server-ip>:8443"
cipher_suite = "chacha20-poly1305"
transport = "quic"
skip_cert_verify = true  # for self-signed certs in development

[identity]
client_id = "<same client-id>"
auth_secret = "<same auth-secret>"

[logging]
level = "info"
format = "pretty"
```

### 4. Run

**Foreground mode** (useful for development and debugging):

```bash
# Terminal 1 — start server
prisma server -c server.toml

# Terminal 2 — start client
prisma client -c client.toml
```

**Daemon mode** (background process with PID file management):

```bash
# Start server as a daemon
prisma server -d -c server.toml

# Start client as a daemon
prisma client -d -c client.toml

# Check status
prisma server status
prisma client status

# Stop daemons
prisma server stop
prisma client stop
```

### 5. Launch the web console (optional)

```bash
prisma console --token your-secure-management-token
```

This downloads (and caches) the web console, starts a local server on port 9091, and opens your browser automatically.

### 6. Test the connection

**SOCKS5 proxy:**

```bash
curl --socks5 127.0.0.1:1080 https://httpbin.org/ip
```

**HTTP CONNECT proxy:**

```bash
curl --proxy http://127.0.0.1:8080 https://httpbin.org/ip
```

**Browser configuration:**

Configure your browser's proxy settings to use SOCKS5 at `127.0.0.1:1080` or HTTP proxy at `127.0.0.1:8080`.

## Next Steps

- [Installation](./installation.md) — detailed platform-specific installation instructions
- [CLI Reference](./cli-reference.md) — complete command documentation
- [Server Configuration](./configuration/server.md) — all server config options
- [Client Configuration](./configuration/client.md) — all client config options
- [Routing Rules](./features/routing-rules.md) — domain/IP/GeoIP-based routing
- [Web Console](./features/console.md) — real-time monitoring dashboard
- [Troubleshooting](./troubleshooting.md) — common issues and solutions
