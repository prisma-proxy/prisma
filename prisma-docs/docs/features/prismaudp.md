---
sidebar_position: 7
---

# PrismaUDP (Game Proxy)

PrismaUDP is a sub-protocol within PrismaVeil designed specifically for proxying UDP traffic — games, VoIP, video calls, and DNS.

## Overview

Unlike TCP proxy traffic which uses CMD_CONNECT, UDP traffic uses a dedicated pair of commands:

- **CMD_UDP_ASSOCIATE (0x09)**: Client requests a UDP relay session
- **CMD_UDP_DATA (0x0A)**: Bidirectional UDP datagram relay

## How It Works

### SOCKS5 UDP ASSOCIATE

1. Application sends SOCKS5 UDP ASSOCIATE request to the Prisma client
2. Client binds a local UDP socket and replies with the bound address/port
3. Client establishes a PrismaVeil tunnel to the server and sends CMD_UDP_ASSOCIATE
4. Server allocates a server-side UDP socket and acknowledges
5. Application sends UDP datagrams (with SOCKS5 UDP header) to the local socket
6. Client strips the SOCKS5 header, wraps in CMD_UDP_DATA, encrypts, and sends through tunnel
7. Server decrypts, extracts the destination, and forwards the raw UDP datagram
8. Responses follow the reverse path

### Wire Format

**CMD_UDP_DATA payload:**

```
[assoc_id:4][frag:1][addr_type:1][dest_addr:var][dest_port:2][udp_payload:var]
```

| Field | Description |
|-------|-------------|
| `assoc_id` | UDP association identifier |
| `frag` | Fragment info (0 = unfragmented) |
| `addr_type` | 0x01=IPv4, 0x03=Domain, 0x04=IPv6 |
| `dest_addr` | Destination address bytes |
| `dest_port` | Destination port (big-endian) |
| `udp_payload` | Raw UDP payload |

## Forward Error Correction (FEC)

PrismaUDP supports optional Reed-Solomon FEC to recover lost packets without retransmission:

- **Reed-Solomon erasure coding**: Every `data_shards` packets, `parity_shards` redundancy packets are generated
- **No retransmission latency**: Lost data packets are reconstructed from parity, not retransmitted
- **Configurable overhead**: Default 10 data + 3 parity = ~30% bandwidth overhead

### FEC Configuration

```toml
[udp_fec]
enabled = true
data_shards = 10      # Original packets per FEC group
parity_shards = 3     # Parity packets per group
```

### FEC Wire Format

FEC-enabled datagrams have FLAG_FEC (0x0002) set and prepend a 4-byte FEC header to the payload:

```
[fec_group:2 LE][fec_index:1][fec_total:1][payload:var]
```

## Performance Considerations

| Scenario | Recommendation |
|----------|---------------|
| Competitive gaming | QUIC transport + Brutal CC + FEC (3 parity) |
| Casual gaming | QUIC transport + BBR CC + no FEC |
| VoIP | QUIC transport + BBR CC + FEC (2 parity) |
| DNS relay | Any transport, FEC not needed |

## Example Configuration

### Client (client.toml)

```toml
transport = "quic"

[congestion]
mode = "brutal"
target_bandwidth = "50mbps"

[udp_fec]
enabled = true
data_shards = 10
parity_shards = 3
```

### Server (server.toml)

```toml
# PrismaUDP is automatically available on all transports
# No additional server configuration required
```
