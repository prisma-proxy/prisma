---
title: Developer Documentation
slug: /
---

# Developer Documentation

Comprehensive internal reference for the Prisma proxy system -- architecture, module APIs, wire protocol, configuration fields, CLI commands, management endpoints, FFI functions, and extension recipes.

**Workspace version:** v2.1.4 | **Protocol:** PrismaVeil v5 | **Rust edition:** 2021

---

## Workspace Architecture

The Prisma workspace consists of six crates with well-defined dependency boundaries:

```mermaid
graph TD
    CLI["prisma-cli<br/><small>CLI binary (clap 4)</small>"]
    SERVER["prisma-server<br/><small>Server binary</small>"]
    CLIENT["prisma-client<br/><small>Client library</small>"]
    MGMT["prisma-mgmt<br/><small>Management API (axum)</small>"]
    FFI["prisma-ffi<br/><small>C FFI shared library</small>"]
    CORE["prisma-core<br/><small>Shared library</small>"]

    CLI --> SERVER
    CLI --> CLIENT
    CLI --> MGMT
    CLI --> CORE
    SERVER --> CORE
    SERVER --> MGMT
    CLIENT --> CORE
    MGMT --> CORE
    FFI --> CLIENT
    FFI --> CORE

    style CORE fill:#2d6a4f,color:#fff,stroke:#1b4332
    style SERVER fill:#264653,color:#fff
    style CLIENT fill:#264653,color:#fff
    style CLI fill:#e76f51,color:#fff
    style MGMT fill:#457b9d,color:#fff
    style FFI fill:#6d6875,color:#fff
```

| Crate | Role |
|-------|------|
| **prisma-core** | Shared library: crypto, protocol (PrismaVeil v5), config, types, bandwidth, DNS, routing, mux, ACL, proxy groups, subscriptions, import |
| **prisma-server** | Server binary: listeners (TCP/QUIC/WS/gRPC/XHTTP/XPorta/SSH/WireGuard/CDN), relay, auth, camouflage, hot-reload |
| **prisma-client** | Client library: SOCKS5/HTTP inbound, transport selection, TUN, connection pool, DNS resolver/server, PAC, port forwarding |
| **prisma-cli** | CLI binary (clap 4): server/client runners, management commands, daemon mode, web console, diagnostics |
| **prisma-mgmt** | Management API (axum): REST + WebSocket endpoints, auth middleware, Prometheus export |
| **prisma-ffi** | C FFI shared library for GUI/mobile: lifecycle, profiles, QR, system proxy, auto-update, per-app proxy, proxy groups |

---

## Data Flow

End-to-end data flow from an application through the client to the server and out to the internet:

```mermaid
sequenceDiagram
    participant App as Application
    participant SOCKS as SOCKS5/HTTP/TUN
    participant Router as Rule Router
    participant Transport as Transport Layer
    participant Tunnel as PrismaVeil Tunnel
    participant Server as Prisma Server
    participant Handler as Server Handler
    participant Internet as Internet

    App->>SOCKS: TCP/UDP request
    SOCKS->>Router: Evaluate routing rules
    alt Direct
        Router->>Internet: Connect directly
    else Proxy
        Router->>Transport: Select transport (QUIC/TCP/WS/gRPC/...)
        Transport->>Tunnel: Encrypt (PrismaVeil v5)
        Tunnel->>Server: Encrypted frames
        Server->>Handler: Decrypt + authenticate
        Handler->>Internet: Forward to destination
        Internet-->>Handler: Response
        Handler-->>Tunnel: Encrypt response
        Tunnel-->>Transport: Encrypted frames
        Transport-->>SOCKS: Plaintext data
        SOCKS-->>App: Response
    end
```

---

## Build Instructions

```bash
# Build all crates
cargo build --workspace

# Build in release mode
cargo build --workspace --release

# Test all crates
cargo test --workspace

# Lint with clippy
cargo clippy --workspace --all-targets

# Format check
cargo fmt --all -- --check

# Run the server
cargo run -p prisma-cli -- server -c server.toml

# Run the client
cargo run -p prisma-cli -- client -c client.toml

# Generate config files
cargo run -p prisma-cli -- init
```

All workspace dependencies are declared in the root `Cargo.toml` under `[workspace.dependencies]`. Crates reference them with `dep.workspace = true`.

---

## Sub-Pages

| Page | Contents |
|------|----------|
| [prisma-core](./prisma-core) | Shared library reference: every public module, type, and function |
| [prisma-server](./prisma-server) | Server binary reference: listeners, handler pipeline, relay, reload |
| [prisma-client](./prisma-client) | Client library reference: proxy flow, transports, TUN, DNS, connection pool |
| [prisma-mgmt](./prisma-mgmt) | Management API reference: every REST endpoint, WebSocket, auth |
| [prisma-ffi](./prisma-ffi) | FFI reference: every exported C function, error codes, mobile lifecycle |
| [prisma-cli](./prisma-cli) | CLI reference: every command, flag, default, and example |
| [protocol](./protocol) | Wire protocol reference: PrismaVeil v5 handshake, frame format, commands |
| [contributing](./contributing) | Contributing guide: adding transports, commands, endpoints, testing, fuzzing |
