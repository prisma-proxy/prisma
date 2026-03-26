---
sidebar_position: 3
---

# Port Forwarding

Prisma supports frp-style port forwarding (reverse proxy), allowing you to expose local services behind NAT or firewalls through the Prisma server. All traffic flows through the encrypted PrismaVeil tunnel. As of v1.5.0, port forwarding supports granular per-forward configuration, UDP forwarding, runtime management via the Management API, and dynamic add/remove via FFI.

## How it works

```
Internet ──TCP/UDP──▶ prisma-server:port ──PrismaVeil──▶ prisma-client ──TCP/UDP──▶ Local Service
```

### Protocol flow

1. The client establishes an encrypted PrismaVeil tunnel to the server
2. The client sends `RegisterForward` commands for each configured port forward
3. The server validates the requested port is within the allowed range and enforces per-client limits
4. The server responds with `ForwardReady` (success or failure) for each registration
5. When an external connection arrives at the server's forwarded port, the server sends a `ForwardConnect` message through the tunnel
6. The client opens a local connection to the mapped `local_addr` and relays data bidirectionally through the encrypted tunnel using multiplexed `stream_id`s

## Client configuration

Map local services to remote ports using `[[port_forwards]]` entries. Each forward supports granular control over protocol, timeouts, bandwidth, and access control.

### Minimal example

```toml
[[port_forwards]]
name = "web"
local_addr = "127.0.0.1:3000"
remote_port = 10080
```

### Full example with all options

```toml
[[port_forwards]]
name = "web-frontend"
local_addr = "127.0.0.1:3000"
remote_port = 10080
protocol = "tcp"                # "tcp" (default) or "udp"
bind_addr = "0.0.0.0"          # Server-side bind address override
max_connections = 50            # Max concurrent connections (0 = unlimited)
idle_timeout_secs = 600         # Close idle connections after N seconds (default: 300)
connect_timeout_secs = 5        # Timeout connecting to local service (default: 10)
bandwidth_up = "10mbps"         # Per-forward upload limit
bandwidth_down = "50mbps"       # Per-forward download limit
allowed_ips = ["10.0.0.0/8"]   # IP whitelist for server-side listener (empty = allow all)
enabled = true                  # Enable/disable this forward (default: true)
retry_on_failure = true         # Auto-retry if local connection fails (default: false)
buffer_size = 16384             # Custom relay buffer size in bytes (default: 8192)

[[port_forwards]]
name = "game-server"
local_addr = "127.0.0.1:27015"
remote_port = 10027
protocol = "udp"
bandwidth_up = "5mbps"
bandwidth_down = "20mbps"

[[port_forwards]]
name = "api-server"
local_addr = "127.0.0.1:8000"
remote_port = 10081
enabled = false                 # Disabled — will not register on connect
```

### Client configuration reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | — | Human-readable label for this forward (required) |
| `local_addr` | string | — | Address of the local service to expose (required) |
| `remote_port` | u16 | — | Port the server will listen on (required) |
| `protocol` | string | `"tcp"` | Transport protocol: `"tcp"` or `"udp"` |
| `bind_addr` | string? | `"0.0.0.0"` | Server-side bind address override |
| `max_connections` | u32? | unlimited | Max concurrent connections for this forward |
| `idle_timeout_secs` | u64? | `300` | Close idle connections after N seconds |
| `connect_timeout_secs` | u64? | `10` | Timeout for connecting to local service |
| `bandwidth_up` | string? | unlimited | Per-forward upload bandwidth limit (e.g., `"10mbps"`) |
| `bandwidth_down` | string? | unlimited | Per-forward download bandwidth limit (e.g., `"50mbps"`) |
| `allowed_ips` | string[] | `[]` | IP CIDR whitelist for incoming connections (empty = allow all) |
| `enabled` | bool | `true` | Enable/disable this forward without removing it |
| `retry_on_failure` | bool | `false` | Auto-retry when local connection fails |
| `buffer_size` | usize? | `8192` | Custom relay buffer size in bytes |

## Server configuration

Enable port forwarding and configure server-side policies:

### Minimal example

```toml
[port_forwarding]
enabled = true
port_range_start = 10000
port_range_end = 20000
```

### Full example with all options

```toml
[port_forwarding]
enabled = true
port_range_start = 10000
port_range_end = 20000

# Per-client limits
max_forwards_per_client = 5               # Max forwards any single client can register (default: 10)
max_connections_per_forward = 100          # Default max connections per forward (default: 100)
default_idle_timeout_secs = 300            # Default idle timeout for forwards (default: 300)

# Port access control
allowed_ports = [80, 443, 8080]            # Additional specific allowed ports (outside range)
denied_ports = [22, 3306, 5432]            # Specific denied ports (overrides range)

# Bandwidth limits (global for all forwards)
global_bandwidth_up = "100mbps"            # Total upload bandwidth for all forwards
global_bandwidth_down = "500mbps"          # Total download bandwidth for all forwards

# Access control
allowed_ips = ["0.0.0.0/0"]               # IP CIDRs allowed to connect (empty = allow all)
allowed_bind_addrs = ["0.0.0.0"]           # Bind addresses clients may request

# Operational
require_name = true                        # Require clients to name their forwards
log_connections = true                     # Log each forwarded connection (default: true)
```

### Server configuration reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Must be `true` to allow any port forwards |
| `port_range_start` | u16 | `1024` | Minimum allowed forwarded port |
| `port_range_end` | u16 | `65535` | Maximum allowed forwarded port |
| `max_forwards_per_client` | u32? | `10` | Maximum port forwards per client |
| `max_connections_per_forward` | u32? | `100` | Default max connections per individual forward |
| `default_idle_timeout_secs` | u64? | `300` | Default idle timeout for forwards |
| `allowed_ports` | u16[] | `[]` | Additional specific ports to allow (outside range) |
| `denied_ports` | u16[] | `[]` | Specific ports to deny (overrides range) |
| `global_bandwidth_up` | string? | unlimited | Total upload bandwidth for all forwards |
| `global_bandwidth_down` | string? | unlimited | Total download bandwidth for all forwards |
| `allowed_ips` | string[] | `[]` | IP CIDRs allowed to connect to forwarded ports (empty = allow all) |
| `allowed_bind_addrs` | string[] | `[]` | Bind addresses clients may request (empty = only wildcard) |
| `require_name` | bool | `false` | Require clients to name their forwards |
| `log_connections` | bool | `true` | Log each forwarded connection |

The server rejects any `RegisterForward` request for a port outside the configured range or in the `denied_ports` list, and enforces the `max_forwards_per_client` limit per authenticated client.

## Management API

Port forwards can be monitored and managed at runtime via the [Management API](/docs/features/management-api).

### List all active forwards

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/forwards
```

Response:

```json
{
  "forwards": [
    {
      "remote_port": 10080,
      "name": "web-frontend",
      "client_id": "uuid",
      "bind_addr": "0.0.0.0:10080",
      "active_connections": 3,
      "total_connections": 142,
      "bytes_up": 1048576,
      "bytes_down": 5242880,
      "registered_at": "2026-03-20T00:00:00Z",
      "protocol": "tcp",
      "allowed_ips": ["10.0.0.0/8"]
    }
  ]
}
```

### Close a forward

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:9090/api/forwards/10080
```

### List connections for a specific forward

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:9090/api/forwards/10080/connections
```

Response:

```json
{
  "remote_port": 10080,
  "connections": [
    {
      "stream_id": 42,
      "peer_addr": "203.0.113.5:54321",
      "connected_at": "2026-03-20T12:00:00Z",
      "bytes_up": 2048,
      "bytes_down": 8192
    }
  ]
}
```

## Dynamic FFI (Runtime Add/Remove)

GUI and mobile clients can add or remove port forwards at runtime via `prisma-ffi` without restarting the connection:

```c
// Add a forward dynamically (JSON matches PortForwardConfig)
int prisma_add_forward(PrismaHandle* h, const char* json);

// Remove a forward by remote port
int prisma_remove_forward(PrismaHandle* h, uint16_t remote_port);
```

Example JSON for `prisma_add_forward`:

```json
{
  "name": "new-service",
  "local_addr": "127.0.0.1:9000",
  "remote_port": 10090,
  "protocol": "tcp",
  "max_connections": 20,
  "bandwidth_down": "10mbps"
}
```

## Use cases

- **Expose a local web server to the internet** — develop locally and share with others
- **Access services behind NAT** without opening firewall ports
- **Secure tunneling for development and staging** — all traffic encrypted end-to-end
- **Remote access to internal tools** — expose dashboards, admin panels, or APIs
- **Game server hosting** — expose UDP game servers behind NAT using `protocol = "udp"`
- **Per-forward bandwidth control** — limit individual forward throughput to prevent abuse

## Security considerations

- Only enable port forwarding on the server if you need it (`enabled = false` by default)
- Restrict the port range to the minimum necessary (avoid using `1024-65535`)
- Use `denied_ports` to block sensitive services (SSH, databases) even within the allowed range
- Set `max_forwards_per_client` to prevent resource exhaustion
- Use `allowed_ips` on both client and server to restrict who can connect to forwarded ports
- Each forwarded port is bound on the server's public interface — ensure firewall rules are appropriate
- The server validates that requested ports fall within the configured range before accepting
- All forwarded traffic is encrypted through the PrismaVeil tunnel
- Enable `log_connections = true` (default) for audit trails
