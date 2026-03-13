---
sidebar_position: 2
---

# Client Configuration

The client is configured via a TOML file (default: `client.toml`). Configuration is resolved in three layers — compiled defaults, then TOML file, then environment variables. See [Environment Variables](./environment-variables.md) for override details.

## Configuration reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `socks5_listen_addr` | string | `"127.0.0.1:1080"` | Local SOCKS5 proxy bind address |
| `http_listen_addr` | string? | — | Local HTTP CONNECT proxy bind address (optional) |
| `server_addr` | string | — | Remote Prisma server address (e.g. `1.2.3.4:8443`) |
| `identity.client_id` | string | — | Client UUID (must match server config) |
| `identity.auth_secret` | string | — | 64 hex character shared secret (must match server config) |
| `cipher_suite` | string | `"chacha20-poly1305"` | `chacha20-poly1305` / `aes-256-gcm` |
| `transport` | string | `"quic"` | `quic` / `tcp` / `ws` / `grpc` / `xhttp` |
| `skip_cert_verify` | bool | `false` | Skip TLS certificate verification |
| `port_forwards[].name` | string | — | Human-readable label for this port forward |
| `port_forwards[].local_addr` | string | — | Local service address (e.g. `127.0.0.1:3000`) |
| `port_forwards[].remote_port` | u16 | — | Port to listen on at the server |
| `logging.level` | string | `"info"` | `trace` / `debug` / `info` / `warn` / `error` |
| `logging.format` | string | `"pretty"` | `pretty` / `json` |
| `xhttp_mode` | string? | — | XHTTP mode: `"packet-up"` / `"stream-up"` / `"stream-one"` |
| `xhttp_upload_url` | string? | — | XHTTP upload URL for packet-up/stream-up |
| `xhttp_download_url` | string? | — | XHTTP download URL for packet-up |
| `xhttp_stream_url` | string? | — | XHTTP stream URL for stream-one |
| `xhttp_extra_headers` | \[\[k,v\]\] | `[]` | Extra XHTTP request headers |
| `xmux.max_connections_min` | u16 | `1` | Min connections in pool |
| `xmux.max_connections_max` | u16 | `4` | Max connections in pool |
| `xmux.max_concurrency_min` | u16 | `8` | Min concurrency per connection |
| `xmux.max_concurrency_max` | u16 | `16` | Max concurrency per connection |
| `xmux.max_lifetime_secs_min` | u64 | `300` | Min connection lifetime (seconds) |
| `xmux.max_lifetime_secs_max` | u64 | `600` | Max connection lifetime (seconds) |
| `xmux.max_requests_min` | u32 | `100` | Min requests before rotation |
| `xmux.max_requests_max` | u32 | `200` | Max requests before rotation |
| `user_agent` | string? | — | Override User-Agent header |
| `referer` | string? | — | Override Referer header |
| `congestion.mode` | string | `"bbr"` | Congestion control: `"brutal"` / `"bbr"` / `"adaptive"` |
| `congestion.target_bandwidth` | string? | — | Target bandwidth for brutal/adaptive (e.g., `"100mbps"`) |
| `port_hopping.enabled` | bool | `false` | Enable QUIC port hopping |
| `port_hopping.base_port` | u16 | `10000` | Start of port range |
| `port_hopping.port_range` | u16 | `50000` | Number of ports in range |
| `port_hopping.interval_secs` | u64 | `60` | Seconds between port hops |
| `port_hopping.grace_period_secs` | u64 | `10` | Dual-port acceptance window |
| `salamander_password` | string? | — | Salamander UDP obfuscation password (QUIC only) |
| `udp_fec.enabled` | bool | `false` | Enable Forward Error Correction for UDP relay |
| `udp_fec.data_shards` | usize | `10` | Original packets per FEC group |
| `udp_fec.parity_shards` | usize | `3` | Parity packets per FEC group |
| `dns.mode` | string | `"direct"` | DNS mode: `"smart"` / `"fake"` / `"tunnel"` / `"direct"` |
| `dns.fake_ip_range` | string | `"198.18.0.0/15"` | CIDR range for fake DNS IPs |
| `dns.upstream` | string | `"8.8.8.8:53"` | Upstream DNS server |
| `routing.rules[].type` | string | — | Rule type: `domain` / `domain-suffix` / `domain-keyword` / `ip-cidr` / `port` / `all` |
| `routing.rules[].value` | string | — | Match value |
| `routing.rules[].action` | string | `"proxy"` | Action: `"proxy"` / `"direct"` / `"block"` |
| `tun.enabled` | bool | `false` | Enable TUN mode (system-wide proxy) |
| `tun.device_name` | string | `"prisma-tun0"` | TUN device name |
| `tun.mtu` | u16 | `1500` | TUN device MTU |
| `tun.dns` | string | `"fake"` | TUN DNS mode: `"fake"` / `"tunnel"` |

## Full example

```toml
socks5_listen_addr = "127.0.0.1:1080"
http_listen_addr = "127.0.0.1:8080"  # optional, remove to disable HTTP proxy
server_addr = "127.0.0.1:8443"
cipher_suite = "chacha20-poly1305"   # or "aes-256-gcm"
transport = "quic"                   # or "tcp"
skip_cert_verify = true              # set true for self-signed certs in dev

# Must match a key generated with: prisma gen-key
[identity]
client_id = "00000000-0000-0000-0000-000000000001"
auth_secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

# Port forwarding (reverse proxy) — expose local services through the server
[[port_forwards]]
name = "my-web-app"
local_addr = "127.0.0.1:3000"
remote_port = 10080

[[port_forwards]]
name = "my-api"
local_addr = "127.0.0.1:8000"
remote_port = 10081

[logging]
level = "info"
format = "pretty"
```

## Validation rules

The client config is validated at startup. The following rules are enforced:

- `socks5_listen_addr` must not be empty
- `server_addr` must not be empty
- `identity.client_id` must not be empty
- `identity.auth_secret` must be valid hex
- `cipher_suite` must be one of: `chacha20-poly1305`, `aes-256-gcm`
- `transport` must be one of: `quic`, `tcp`, `ws`, `grpc`, `xhttp`
- `xhttp_mode` (when transport is `xhttp`) must be one of: `packet-up`, `stream-up`, `stream-one`
- `xhttp_mode = "stream-one"` requires `xhttp_stream_url`
- `xhttp_mode = "packet-up"` or `"stream-up"` requires `xhttp_upload_url` and `xhttp_download_url`
- XMUX ranges must have min ≤ max
- `logging.level` must be one of: `trace`, `debug`, `info`, `warn`, `error`
- `logging.format` must be one of: `pretty`, `json`

## Transport selection

### QUIC (default)

QUIC provides multiplexed streams over UDP with built-in TLS 1.3. This is the recommended transport for most deployments.

```toml
transport = "quic"
```

### TCP fallback

If your network blocks UDP traffic, use the TCP transport:

```toml
transport = "tcp"
```

## Disabling HTTP proxy

The HTTP CONNECT proxy is optional. To disable it, simply omit the `http_listen_addr` field from your config:

```toml
socks5_listen_addr = "127.0.0.1:1080"
# http_listen_addr is not set — HTTP proxy disabled
server_addr = "1.2.3.4:8443"
```

## Certificate verification

For production deployments with a valid TLS certificate, keep `skip_cert_verify` set to `false` (the default). Only set it to `true` during development with self-signed certificates.
