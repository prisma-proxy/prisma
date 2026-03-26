---
sidebar_position: 3
---

# How Prisma Works

Now that you understand the fundamentals, let's dive into Prisma's architecture. This chapter explains what happens behind the scenes when you browse through Prisma, how the PrismaVeil v5 protocol keeps your data safe, and how to choose among the eight available transports.

## The big picture: Client and Server

Prisma has two main components:

1. **Prisma Client** -- runs on your device (computer, phone, tablet). It accepts your internet traffic and encrypts it.
2. **Prisma Server** -- runs on a remote VPS you control. It decrypts the traffic and forwards it to the destination.

```mermaid
graph LR
    subgraph "Your Device"
        BR["Browser / Apps"]
        CL["Prisma Client"]
    end

    subgraph "Your VPS"
        SV["Prisma Server"]
    end

    subgraph "Internet"
        W1["google.com"]
        W2["github.com"]
        W3["any website"]
    end

    BR -->|"SOCKS5 / HTTP"| CL
    CL <-->|"Encrypted Tunnel\n(PrismaVeil v5)"| SV
    SV --> W1
    SV --> W2
    SV --> W3
```

> **Analogy:** Imagine you are in a building where a security guard inspects every package. Prisma builds a **secret underground tunnel** from your desk to a trusted friend's office outside the building. You pass your packages through the tunnel, your friend sends them onward normally, and the guard never sees a thing.

## Complete connection flow

Here is exactly what happens when you open `https://example.com` in your browser while using Prisma:

```mermaid
sequenceDiagram
    participant Browser
    participant Client as Prisma Client
    participant Tunnel as Encrypted Tunnel
    participant Server as Prisma Server
    participant DNS as DNS Resolver
    participant Website as example.com

    Browser->>Client: CONNECT example.com:443 (via SOCKS5)
    Note over Client: Encrypt with PrismaVeil v5
    Client->>Tunnel: Encrypted frame (random-looking bytes)
    Note over Tunnel: ISP sees only encrypted traffic to a single IP
    Tunnel->>Server: Encrypted frame arrives
    Note over Server: Decrypt and parse destination
    Server->>DNS: Resolve example.com
    DNS-->>Server: 93.184.216.34
    Server->>Website: HTTPS request to 93.184.216.34
    Website-->>Server: HTTPS response (web page)
    Note over Server: Encrypt response with PrismaVeil
    Server->>Tunnel: Encrypted response frame
    Tunnel->>Client: Encrypted response arrives
    Note over Client: Decrypt response
    Client->>Browser: Here is the web page!
```

**What your ISP sees:**

| Without Prisma | With Prisma |
|---------------|------------|
| DNS query for `example.com` | None (DNS goes through tunnel) |
| TLS connection to `93.184.216.34` | Encrypted data to your VPS IP |
| SNI header showing `example.com` | No SNI visible |
| ~2.3 MB transferred from example.com | ~2.3 MB of opaque data |

## The PrismaVeil v5 protocol

PrismaVeil is Prisma's custom encryption protocol, currently at version 5. It is designed to be simultaneously **secure**, **fast**, and **undetectable**.

### Handshake process

The handshake establishes a shared encryption key between client and server in a single round trip (1-RTT):

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server

    Note over C: Generate ephemeral keypair
    C->>S: ClientInit (public key + client ID + auth proof + timestamp)
    Note over S: Verify auth proof against authorized_clients
    Note over S: Derive shared secret via X25519
    S->>C: ServerInit (server public key + session ticket + encrypted OK)
    Note over C: Derive shared secret
    Note over C,S: Symmetric encryption active (ChaCha20 or AES-256-GCM)
    C->>S: Encrypted application data
    S->>C: Encrypted application data
```

On subsequent connections, Prisma can use **0-RTT resumption** with the session ticket, skipping the handshake entirely and sending data immediately.

### Encryption layers

Prisma applies encryption at multiple layers:

```mermaid
graph TD
    subgraph "Application Data"
        D["HTTP request to example.com"]
    end

    subgraph "PrismaVeil Encryption"
        E["ChaCha20-Poly1305 / AES-256-GCM\n+ random padding\n+ anti-replay nonce"]
    end

    subgraph "Transport Encryption"
        T["TLS 1.3 (QUIC/TCP/WS)\nor WireGuard\nor SSH"]
    end

    subgraph "Network"
        N["TCP/UDP packets"]
    end

    D --> E --> T --> N
```

This means your data is encrypted **twice** -- once by PrismaVeil and once by the transport layer. Even if one layer were somehow compromised, the other still protects you.

### Anti-replay protection

Every encrypted frame carries a unique nonce. The server maintains a **1024-bit sliding window** bitmap that tracks which nonces have been seen. If an attacker records your traffic and replays it, the server detects the duplicate nonce and drops the frame.

### Anti-detection features

| Technique | What it does | Why it matters |
|-----------|-------------|---------------|
| **Random padding** | Adds 0--256 random bytes per frame | Packet sizes become unpredictable |
| **Timing jitter** | Adds tiny random delays between frames | Prevents timing-based traffic correlation |
| **Chaff injection** | Sends fake decoy packets | Confuses volumetric traffic analysis |
| **Entropy camouflage** | Shapes byte distribution to match normal TLS | Defeats entropy-based DPI classifiers |
| **Camouflage mode** | Server shows a real website to non-Prisma visitors | Active probers see a legitimate website |
| **PrismaTLS** | Custom TLS fingerprint randomization | Prevents JA3/JA4 fingerprinting |

## Transport types

A **transport** is how encrypted data travels between client and server. Prisma supports eight transports, each with different trade-offs:

### Transport comparison table

| Transport | Protocol | CDN-compatible | Stealth level | Speed | Best for |
|-----------|----------|---------------|---------------|-------|----------|
| **QUIC** | UDP | No | Medium | Fastest | Default choice |
| **TCP** | TCP | No | Medium | Fast | When UDP is blocked |
| **WebSocket** | TCP (HTTP upgrade) | Yes | Medium-High | Good | Simple CDN setups |
| **gRPC** | TCP (HTTP/2) | Yes | High | Good | Enterprise networks |
| **XHTTP** | TCP (HTTP/2 POST) | Yes | High | Good | No upgrade headers |
| **XPorta** | TCP (REST API) | Yes | Highest | Moderate | Maximum stealth |
| **SSH** | TCP | No | Medium | Good | Almost never blocked |
| **WireGuard** | UDP | No | Low | Fastest | Kernel-level performance |

### Transport decision tree

Use this flowchart to pick the right transport for your situation:

```mermaid
graph TD
    START["Start here"] --> Q1{"Is UDP blocked\non your network?"}
    Q1 -->|"No"| Q2{"Do you need to\nhide server IP\nbehind CDN?"}
    Q1 -->|"Yes"| Q3{"Do you have\na domain + CDN?"}

    Q2 -->|"No"| QUIC["Use <b>QUIC</b>\nFastest, multiplexed"]
    Q2 -->|"Yes"| Q3

    Q3 -->|"No"| Q4{"Is DPI very\naggressive?"}
    Q3 -->|"Yes"| Q5{"Is censorship\nheavy?"}

    Q4 -->|"No"| TCP["Use <b>TCP</b>\nWorks everywhere"]
    Q4 -->|"Yes"| PTLS["Use <b>PrismaTLS</b>\nActive probe resistance"]

    Q5 -->|"Moderate"| WS["Use <b>WebSocket</b>\nSimple CDN setup"]
    Q5 -->|"Heavy"| XPORTA["Use <b>XPorta</b>\nMaximum stealth"]

    style QUIC fill:#22c55e,color:#000
    style TCP fill:#3b82f6,color:#fff
    style WS fill:#f59e0b,color:#000
    style XPORTA fill:#ef4444,color:#fff
    style PTLS fill:#8b5cf6,color:#fff
```

:::tip Start simple
Begin with **QUIC**. If it does not work, try **TCP**. If you need CDN protection, use **WebSocket**. Only upgrade to **XPorta** or **PrismaTLS** when other transports are being actively blocked.
:::

## XMUX multiplexing

For CDN-based transports (WebSocket, gRPC, XHTTP, XPorta), establishing a new TLS connection for every request is expensive. **XMUX** multiplexes many proxy streams over a small pool of transport connections:

```mermaid
graph LR
    subgraph "Prisma Client"
        S1["Stream 1 (google.com)"]
        S2["Stream 2 (github.com)"]
        S3["Stream 3 (youtube.com)"]
        S4["Stream 4 (reddit.com)"]
    end

    subgraph "XMUX Pool"
        C1["Connection 1"]
        C2["Connection 2"]
    end

    subgraph "CDN / Server"
        SV["Prisma Server"]
    end

    S1 --> C1
    S2 --> C1
    S3 --> C2
    S4 --> C2
    C1 --> SV
    C2 --> SV
```

This dramatically reduces handshake overhead and connection count, which also makes your traffic look more like a normal browser (which reuses connections).

## Why Prisma is hard to detect

```mermaid
graph TD
    T1["ISP reads traffic"] -->|"Defense"| D1["All data encrypted\nChaCha20 / AES-256"]
    T2["Firewall blocks proxy ports"] -->|"Defense"| D2["Runs on port 443\n(same as HTTPS)"]
    T3["DPI detects proxy protocols"] -->|"Defense"| D3["PrismaVeil has no\nrecognizable signatures"]
    T4["Traffic pattern analysis"] -->|"Defense"| D4["Padding + jitter +\nchaff injection"]
    T5["Active probing"] -->|"Defense"| D5["Camouflage mode shows\na real website"]
    T6["Replay attacks"] -->|"Defense"| D6["1024-bit sliding\nanti-replay window"]
    T7["Server IP blocked"] -->|"Defense"| D7["CDN transports hide\nserver behind Cloudflare"]

    style D1 fill:#22c55e,color:#000
    style D2 fill:#22c55e,color:#000
    style D3 fill:#22c55e,color:#000
    style D4 fill:#22c55e,color:#000
    style D5 fill:#22c55e,color:#000
    style D6 fill:#22c55e,color:#000
    style D7 fill:#22c55e,color:#000
```

## Prisma vs. other tools

| Feature | Traditional VPN | Simple Proxy | Prisma |
|---------|---------------|-------------|--------|
| Encryption | Yes | Sometimes | Always (double layer) |
| Hard to detect | No (easily identified) | Somewhat | Yes (multi-layer anti-detection) |
| Multiple transports | 1--2 | 1--2 | 8 with auto-fallback |
| CDN support | Rare | Some | Full (WS, gRPC, XHTTP, XPorta) |
| Traffic shaping | No | No | Padding, jitter, chaff |
| Active probe resistance | No | Some | Camouflage + PrismaTLS |
| System-wide (TUN) | Yes | Rare | Yes |
| Post-quantum ready | Rare | No | Hybrid key exchange |
| Performance | Moderate | Fast | Fast (Rust, io_uring, zero-copy) |

## Next step

Now that you understand how Prisma works, let's get ready to set it up. Head to [Preparation](./prepare.md) to learn what you need and how to prepare your server.
