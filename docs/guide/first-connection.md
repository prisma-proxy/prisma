---
sidebar_position: 9
---

# Your First Connection

This is the moment everything comes together.

## Pre-flight checklist

- [ ] Server: Prisma installed and `server.toml` configured
- [ ] Server: Firewall port 8443 open (TCP + UDP)
- [ ] Client: Prisma installed and configured
- [ ] Client: Credentials match server config exactly

## What happens when you connect

```mermaid
sequenceDiagram
    participant You as You
    participant CL as Prisma Client
    participant SV as Prisma Server
    participant Web as Internet

    You->>CL: Start client
    Note over CL: Open SOCKS5 on 127.0.0.1:1080
    CL->>SV: TCP/QUIC connection to server:8443
    Note over CL,SV: PrismaVeil v5 handshake (1-RTT)
    CL->>SV: ClientInit (public key + auth proof)
    SV-->>CL: ServerInit (server key + session ticket)
    Note over CL,SV: Encrypted channel established!
    CL-->>You: "Connected! Handshake completed in 45ms"

    You->>CL: curl --socks5 127.0.0.1:1080 httpbin.org/ip
    CL->>SV: Encrypted request
    SV->>Web: GET httpbin.org/ip
    Web-->>SV: {"origin": "203.0.113.45"}
    SV-->>CL: Encrypted response
    CL-->>You: {"origin": "203.0.113.45"}
    Note over You: Server IP shown = working!
```

## Step 1: Start the server

```bash
prisma server -c /etc/prisma/server.toml
```

Look for: `Server ready!`

## Step 2: Start the client

**CLI:**
```bash
prisma client -c ~/client.toml
```

Look for: `Connected! Handshake completed`

**GUI:** Select profile, click Connect, wait for green status.

## Step 3: Verify

```bash
curl --socks5 127.0.0.1:1080 https://httpbin.org/ip
```

The IP should be your **server's IP**. Visit https://www.dnsleaktest.com for a DNS leak test.

## Troubleshooting

```mermaid
graph TD
    A["Connection refused"] --> B{"Server running?"}
    B -->|"Check"| B1["ps aux | grep prisma"]
    B -->|"Yes"| C{"Firewall open?"}
    C -->|"Check"| C1["sudo ufw status"]
    C -->|"Yes"| D{"Credentials match?"}
    D -->|"Check"| D1["Compare client_id\nand auth_secret"]
    D -->|"Yes"| E["Check TLS:\nskip_cert_verify = true"]
```

| Problem | Solution |
|---------|---------|
| Connection refused | Check server is running, firewall ports open |
| Authentication failed | Credentials must match exactly |
| TLS handshake failed | Set `skip_cert_verify = true` for self-signed certs |
| Address already in use | Change port or stop conflicting program |
| Very slow | Try different transport (QUIC vs TCP) |

## Success!

```mermaid
graph LR
    A["Your Computer"] -->|"Encrypted"| B["Prisma Server"]
    B -->|"Normal traffic"| C["Internet"]

    style A fill:#22c55e,color:#000
    style B fill:#22c55e,color:#000
```

## Next step

Your setup works! Head to [Going Further](./advanced-setup.md) for system services, routing, CDN, and performance tuning.
