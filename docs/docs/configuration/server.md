---
sidebar_position: 1
---

# Server Configuration

The server is configured via a TOML file (default: `server.toml`). Configuration is resolved in three layers -- compiled defaults, then TOML file, then environment variables. See [Environment Variables](./environment-variables.md) for override details.

:::info Version
This page reflects Prisma **v2.26.0**. Protocol v4 support has been removed; only PrismaVeil v5 (0x05) is accepted.
:::

## Top-level fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `listen_addr` | string | `"0.0.0.0:8443"` | TCP listen address for direct and TLS-wrapped connections |
| `quic_listen_addr` | string | `"0.0.0.0:8443"` | QUIC/UDP listen address |
| `dns_upstream` | string | `"8.8.8.8:53"` | Upstream DNS server for `CMD_DNS_QUERY` forwarding |
| `allow_transport_only_cipher` | bool | `false` | Allow clients to use transport-only cipher (BLAKE3 MAC, no app-layer encryption). Only safe when transport provides confidentiality (TLS/QUIC). |
| `config_watch` | bool | `false` | Watch the config file for changes and auto-reload at runtime |
| `shutdown_drain_timeout_secs` | u64 | `30` | Seconds to wait for in-flight connections during graceful shutdown |
| `ticket_rotation_hours` | u64 | `6` | Session ticket encryption key rotation interval in hours. Old keys are retained for 3 rotation periods to allow graceful resumption. |
| `public_address` | string? | -- | Public-facing server address for shared client configs (e.g., `"proxy.example.com:8443"`). Used instead of `listen_addr` in shared configs. Falls back to TLS SNI domain, then `listen_addr`. |

## `[tls]` -- TLS certificates

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cert_path` | string | -- | Path to TLS certificate PEM file |
| `key_path` | string | -- | Path to TLS private key PEM file |

TLS is **required** for QUIC transport and for `camouflage.tls_on_tcp = true`.

Generate a self-signed certificate for development:

```bash
prisma gen-cert --output /etc/prisma --cn prisma-server
```

For production, use a certificate from a trusted CA or Let's Encrypt.

## `[[authorized_clients]]` -- Client credentials

Each entry defines one authorized client. At least one is required.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | -- | Client UUID (generate with `prisma gen-key`) |
| `name` | string? | -- | Optional human-readable client label |
| `auth_secret` | string | -- | 64 hex character (32-byte) shared secret |
| `bandwidth_up` | string? | -- | Per-client upload rate limit (e.g., `"100mbps"`) |
| `bandwidth_down` | string? | -- | Per-client download rate limit (e.g., `"500mbps"`) |
| `quota` | string? | -- | Per-client transfer quota (e.g., `"100GB"`) |
| `quota_period` | string? | -- | Quota reset period: `"daily"` / `"weekly"` / `"monthly"` |
| `owner` | string? | -- | Owner username for data scoping. When set, client-role console users only see clients they own. |

Example with multiple clients:

```toml
[[authorized_clients]]
id = "client-uuid-1"
auth_secret = "hex-secret-1"
name = "laptop"
bandwidth_up = "100mbps"
bandwidth_down = "500mbps"
quota = "500GB"
quota_period = "monthly"

[[authorized_clients]]
id = "client-uuid-2"
auth_secret = "hex-secret-2"
name = "phone"
```

Clients can also be managed at runtime via the [Management API](/docs/features/management-api) or the [Console](/docs/features/console) without restarting the server.

### `[permissions]` -- Per-client permissions

Each `[[authorized_clients]]` entry may include an optional `[permissions]` table for granular access control. When omitted, all permissions default to unrestricted.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `allow_port_forwarding` | bool | `true` | Whether port forwarding is allowed for this client |
| `allow_udp` | bool | `true` | Whether UDP relay is allowed for this client |
| `allowed_destinations` | string[] | `[]` | Allowed destination patterns (CIDR or domain glob). Empty = allow all |
| `blocked_destinations` | string[] | `[]` | Blocked destination patterns. Blocked takes precedence over allowed |
| `max_connections` | u32 | `0` | Maximum concurrent connections for this client (0 = unlimited) |
| `bandwidth_limit` | u64? | -- | Per-client bandwidth limit in bytes/sec (null = unlimited) |
| `allowed_ports` | PortRange[] | `[]` | Allowed port ranges (each with `start` and `end`). Empty = allow all ports |
| `blocked_ports` | u16[] | `[]` | Blocked ports. Blocked takes precedence over allowed |

Destination patterns support:
- **CIDR notation**: `"10.0.0.0/8"`, `"192.168.0.0/16"`
- **Domain globs**: `"*.google.com"` matches `www.google.com` and `mail.google.com`
- **Exact match**: `"example.com"` or `"8.8.8.8"`

Example:

```toml
[[authorized_clients]]
id = "client-uuid-1"
auth_secret = "hex-secret-1"
name = "restricted-client"

[authorized_clients.permissions]
allow_port_forwarding = false
allow_udp = true
max_connections = 10
blocked_destinations = ["*.torrent.com", "10.0.0.0/8"]
blocked_ports = [22, 25, 445]
allowed_ports = [{ start = 80, end = 80 }, { start = 443, end = 443 }, { start = 8000, end = 9000 }]
```

## `[management_api]` -- REST/WebSocket API

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable the management REST/WS API |
| `listen_addr` | string | `"127.0.0.1:9090"` | Management API bind address |
| `auth_token` | string | `""` | Bearer token for API authentication |
| `cors_origins` | string[] | `[]` | Allowed CORS origins (for external console dev) |
| `console_dir` | string? | -- | Path to built console static files |
| `tls_enabled` | bool | `false` | Enable TLS on management API |
| `tls.cert_path` | string? | -- | TLS certificate path (inherits from top-level `[tls]` if omitted and `tls_enabled = true`) |
| `tls.key_path` | string? | -- | TLS private key path (inherits from top-level `[tls]` if omitted and `tls_enabled = true`) |
| `auto_backup_interval_mins` | u32 | `0` | Periodically create a config backup every N minutes. `0` disables auto-backup. |
| `jwt_secret` | string | `""` | Secret key for signing JWT tokens. Auto-generated on first server run if left empty. |

:::warning
The `auth_token` protects all management API endpoints when using legacy token auth. The `jwt_secret` is used for JWT-based authentication (v2.8.0+). Use strong, random values for both in production.
:::

### `[[management_api.users]]` -- Console users

Pre-configure console users in TOML. Users can also be created at runtime via the console's self-registration endpoint or the admin user management page.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `username` | string | -- | Unique username |
| `password_hash` | string | -- | bcrypt-hashed password (generate with `prisma hash-password`) |
| `role` | string | `"client"` | User role: `"admin"` / `"operator"` / `"client"` |
| `enabled` | bool | `true` | Whether the user account is active |

Roles:
- **admin** — full access to all API endpoints and console pages, including user management
- **operator** — monitoring only; can view dashboards, metrics, and connections but cannot modify configuration or manage users
- **client** — can only view their own connection statistics

Example:

```toml
[management_api]
enabled = true
listen_addr = "127.0.0.1:9090"
auth_token = "your-secure-token-here"
jwt_secret = "auto-generated-on-first-run"

[[management_api.users]]
username = "admin"
password_hash = "$2b$10$..."  # bcrypt hash
role = "admin"
enabled = true

[[management_api.users]]
username = "viewer"
password_hash = "$2b$10$..."
role = "operator"
enabled = true
```

:::tip
You can either pre-configure users in `server.toml` or let them self-register via the console login page. Self-registered users are always assigned the **Client** role. An admin can later promote users via the console or the management API.
:::

**Auto-backup**: Set `auto_backup_interval_mins` to a non-zero value to create automatic config snapshots on a fixed schedule. The backup task runs in the background and will not interfere with active connections. Backups are stored alongside manual backups and can be viewed or restored from the console Config Backups page.

**Bind address**: By default the API listens on `127.0.0.1:9090` (localhost only). To expose it to the network, change `listen_addr` -- but ensure you have proper network-level access controls in place.

**Console**: Set `console_dir` to the path containing the built console static files. The server will serve the console at the management API address. Download pre-built files from the [latest release](https://github.com/prisma-proxy/prisma/releases/latest) or build from source with `cd apps/prisma-console && npm ci && npm run build`.

**CORS origins**: Only needed when running the console dev server on a different origin (e.g. `http://localhost:3000`). Not needed in production when the console is served by the server itself.

## SQLite Database (v2.12.0+)

As of v2.12.0, dynamic data — users, authorized clients, routing rules, and subscriptions — is stored in a **SQLite database** (`data.sql`) instead of the TOML config file. On first startup after upgrading, the server automatically migrates existing data from `server.toml` into the database.

Key behaviors:

- **Automatic migration** — existing `[[authorized_clients]]`, `[[management_api.users]]`, and `[[routing.rules]]` entries are imported into SQLite on first run. The original TOML entries are preserved but no longer read after migration.
- **File location** — the database is created alongside `server.toml` (e.g., `/etc/prisma/data.sql`).
- **Runtime changes** — all client, user, routing rule, and subscription changes via the Management API or Console are persisted to SQLite immediately.
- **Backups** — the `POST /api/config/backup` endpoint and auto-backup feature now include both the TOML config and the SQLite database (`data.sql`).
- **Static config** — server settings (listen addresses, TLS, camouflage, traffic shaping, performance, etc.) remain in `server.toml`.

:::tip
You can still pre-seed users and clients in `server.toml` for initial deployment. They will be imported into SQLite on first run. After that, manage them through the Console or API.
:::

## `[port_forwarding]` -- Reverse proxy

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable port forwarding / reverse proxy |
| `port_range_start` | u16 | `1024` | Minimum allowed forwarded port |
| `port_range_end` | u16 | `65535` | Maximum allowed forwarded port |
| `max_forwards_per_client` | u32? | `10` | Max port forwards per client |
| `max_connections_per_forward` | u32? | `100` | Max concurrent connections per individual forward |
| `default_idle_timeout_secs` | u64? | `300` | Close idle forwarded connections after N seconds (0 = disabled) |
| `allowed_ports` | u16[] | `[]` | Additional allowed ports outside the range |
| `denied_ports` | u16[] | `[]` | Explicitly denied ports (overrides range and allowed list) |
| `allowed_bind_addrs` | string[] | `[]` | Bind addresses clients may request (empty = wildcard only) |
| `global_bandwidth_up` | string? | -- | Global upload bandwidth limit across all forwards (e.g., `"1gbps"`) |
| `global_bandwidth_down` | string? | -- | Global download bandwidth limit across all forwards |
| `require_name` | bool | `false` | Require clients to name their forwards |
| `log_connections` | bool | `true` | Log each forwarded connection |
| `allowed_ips` | string[] | `[]` | IP CIDRs allowed to connect to forwarded ports (empty = allow all) |

Port resolution: a port is allowed when forwarding is enabled, the port is NOT in `denied_ports`, and the port is within the configured range OR in `allowed_ports`.

## `[routing]` -- Server-side routing rules

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `geoip_path` | string? | -- | Path to MaxMind GeoLite2-City.mmdb file for GeoIP-based routing and per-connection country/city lookups |
| `rules` | array | `[]` | Ordered list of routing rules |

Each rule in `[[routing.rules]]`:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Rule type: `domain` / `domain-suffix` / `domain-keyword` / `ip-cidr` / `geoip` / `port` / `all` |
| `value` | string | Match value (country code for `geoip`, e.g. `"cn"`, `"private"`) |
| `action` | string | Action: `"allow"` / `"direct"` / `"block"` (with aliases `"proxy"`, `"reject"`) |

## `[padding]` -- Per-frame padding

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `min` | u16 | `0` | Minimum random padding bytes per frame |
| `max` | u16 | `256` | Maximum random padding bytes per frame |

## `[performance]` -- Connection limits

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_connections` | u32 | `1024` | Maximum concurrent connections |
| `connection_timeout_secs` | u64 | `300` | Idle connection timeout in seconds |

## `[camouflage]` -- Anti-active-detection

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable camouflage |
| `tls_on_tcp` | bool | `false` | Wrap TCP transport in TLS (requires `[tls]` config) |
| `fallback_addr` | string? | -- | Decoy server address for non-Prisma connections (e.g., `"example.com:443"`) |
| `alpn_protocols` | string[] | `["h2", "http/1.1"]` | TLS/QUIC ALPN protocols |
| `h3_cover_site` | string? | -- | Upstream URL for HTTP/3 masquerade cover site |
| `h3_static_dir` | string? | -- | Local static files directory for H3 masquerade (fallback when `h3_cover_site` is not set) |
| `salamander_password` | string? | -- | Salamander UDP obfuscation password (QUIC only) |

## `[camouflage.tls_probe_guard]` -- TLS Probe Detection

Automatically detects and blocks IPs that exhibit repeated TLS handshake failures -- a strong indicator of active probing by censorship systems. When enabled, the server tracks per-IP handshake failure rates within a sliding window and temporarily blocks offending IPs.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Enable TLS probe guard (active by default when camouflage is enabled) |
| `max_failures` | u32 | `20` | Maximum handshake failures per IP before blocking |
| `failure_window_secs` | u64 | `120` | Sliding window duration in seconds for counting failures |
| `block_duration_secs` | u64 | `120` | Duration in seconds to block an offending IP |

Example:

```toml
[camouflage.tls_probe_guard]
enabled = true
max_failures = 20
failure_window_secs = 120
block_duration_secs = 120
```

:::tip Tuning
- **Lower `max_failures`** (e.g., 5-10) for aggressive defense in heavily probed environments, at the risk of blocking legitimate clients with flaky TLS stacks.
- **Increase `failure_window_secs`** (e.g., 300-600) to catch slow, distributed probing campaigns.
- **Increase `block_duration_secs`** (e.g., 3600) to impose longer penalties on confirmed probers.
:::

## `[ssh]` -- SSH transport

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable SSH transport listener |
| `listen_addr` | string | `"0.0.0.0:2222"` | SSH listen address |
| `host_key_path` | string? | -- | Path to SSH host key file (auto-generated if omitted) |
| `password` | string? | -- | SSH password authentication credential |
| `allowed_users` | string[] | `[]` | Allowed SSH usernames (empty = allow all) |
| `authorized_keys_path` | string? | -- | Path to `authorized_keys` file for public key auth |
| `fake_shell` | bool | `false` | Respond with a fake shell prompt to interactive sessions (further disguise) |
| `banner` | string | `"SSH-2.0-OpenSSH_9.6"` | SSH version banner string |

## `[wireguard]` -- WireGuard-compatible UDP transport

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable WireGuard transport |
| `listen_addr` | string | `"0.0.0.0:51820"` | WireGuard UDP listen address |
| `session_timeout_secs` | u64 | `180` | Peer session timeout in seconds |

## `[acls]` -- Per-client access control lists

ACLs provide fine-grained destination control per client. The key is a client identifier, and the value is an ACL object:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `client_id` | string | -- | Client ID this ACL applies to |
| `rules` | array | `[]` | Ordered list of ACL rules (first match wins) |
| `default_policy` | string | `"allow"` | Default policy when no rule matches: `"allow"` / `"deny"` |
| `enabled` | bool | `true` | Whether this ACL is active |

Each rule in `rules`:

| Field | Type | Description |
|-------|------|-------------|
| `action` | string | `"allow"` / `"deny"` |
| `matcher.type` | string | `"domain"` / `"domain-suffix"` / `"domain-keyword"` / `"ip-cidr"` / `"port"` |
| `matcher.value` | string | Match value |
| `description` | string? | Optional human-readable description |

Example:

```toml
[acls.client-uuid-1]
client_id = "client-uuid-1"
default_policy = "allow"
enabled = true

[[acls.client-uuid-1.rules]]
action = "deny"
description = "Block torrent trackers"
[acls.client-uuid-1.rules.matcher]
type = "domain-keyword"
value = "torrent"

[[acls.client-uuid-1.rules]]
action = "deny"
description = "Block private networks"
[acls.client-uuid-1.rules.matcher]
type = "ip-cidr"
value = "10.0.0.0/8"
```

## `[fallback]` -- Transport fallback

Server-side transport fallback configuration. When the primary transport fails or encounters repeated errors, the server can automatically activate fallback transports.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Whether transport fallback is enabled |
| `chain` | string[] | `["tcp", "quic", "websocket", "grpc"]` | Ordered list of transports to try: `"tcp"` / `"quic"` / `"websocket"` / `"grpc"` / `"xhttp"` / `"xporta"` |
| `health_check_interval` | u64 | `30` | Interval in seconds for health checks on each transport listener |
| `auto_switch_on_failure` | bool | `true` | Automatically switch to the next transport on failure |
| `max_consecutive_failures` | u32 | `5` | Maximum consecutive failures before triggering fallback |
| `migrate_back_on_recovery` | bool | `false` | Whether to migrate back to the primary transport when it recovers |

Example:

```toml
[fallback]
enabled = true
chain = ["tcp", "quic", "websocket", "grpc"]
health_check_interval = 30
auto_switch_on_failure = true
max_consecutive_failures = 5
migrate_back_on_recovery = true
```

## `[logging]` -- Log output

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `level` | string | `"info"` | Log level: `trace` / `debug` / `info` / `warn` / `error` |
| `format` | string | `"pretty"` | Log format: `pretty` / `json` |

## `[prisma_tls]` -- PrismaTLS (replaces REALITY)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable PrismaTLS |
| `auth_secret` | string | `""` | Auth secret (hex-encoded, 32 bytes) |
| `auth_rotation_hours` | u64 | `1` | Auth key rotation interval in hours |
| `mask_servers` | array | `[]` | Mask server pool for relay |

Each `[[prisma_tls.mask_servers]]`:

| Field | Type | Description |
|-------|------|-------------|
| `addr` | string | Mask server address (e.g., `"www.microsoft.com:443"`) |
| `names` | string[] | Allowed SNI names |

## `[traffic_shaping]` -- Anti-fingerprinting

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `padding_mode` | string | `"none"` | `"none"` / `"random"` / `"bucket"` |
| `bucket_sizes` | u16[] | `[128,256,512,1024,2048,4096,8192,16384]` | Bucket sizes for bucket padding mode |
| `timing_jitter_ms` | u32 | `0` | Max timing jitter (ms) on handshake frames |
| `chaff_interval_ms` | u32 | `0` | Chaff injection interval (ms), 0 = disabled |
| `coalesce_window_ms` | u32 | `0` | Frame coalescing window (ms), 0 = disabled |

## `[anti_rtt]` -- RTT normalization

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable cross-layer RTT normalization |
| `normalization_ms` | u32 | `150` | Target RTT in milliseconds to normalize transport ACKs to |

## `[congestion]` -- QUIC congestion control

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | string | `"bbr"` | Congestion control: `"brutal"` / `"bbr"` / `"adaptive"` / `"auto"` (maps to `"adaptive"`) |
| `target_bandwidth` | string? | -- | Target bandwidth for brutal/adaptive (e.g., `"100mbps"`) |

## `[port_hopping]` -- QUIC port hopping

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable QUIC port hopping |
| `base_port` | u16 | `10000` | Start of port range |
| `port_range` | u16 | `50000` | Number of ports in range |
| `interval_secs` | u64 | `60` | Seconds between port hops |
| `grace_period_secs` | u64 | `10` | Seconds to accept on old port after hop |

## `[cdn]` -- CDN transport listener

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable CDN transport listener (WS, gRPC, XHTTP) |
| `listen_addr` | string | `"0.0.0.0:443"` | CDN listener bind address |
| `tls.cert_path` | string? | -- | CDN TLS certificate (e.g. Cloudflare Origin Certificate) |
| `tls.key_path` | string? | -- | CDN TLS private key |
| `ws_tunnel_path` | string | `"/ws-tunnel"` | WebSocket tunnel endpoint path |
| `grpc_tunnel_path` | string | `"/tunnel.PrismaTunnel"` | gRPC tunnel service path |
| `cover_upstream` | string? | -- | Reverse proxy upstream URL for cover traffic |
| `cover_static_dir` | string? | -- | Static files directory for cover traffic |
| `trusted_proxies` | string[] | `[]` | Trusted proxy IP ranges (e.g. Cloudflare CIDRs) |
| `expose_management_api` | bool | `false` | Expose management API through CDN endpoint |
| `management_api_path` | string | `"/prisma-mgmt"` | Management API subpath on CDN |
| `xhttp_upload_path` | string | `"/api/v1/upload"` | XHTTP packet-up upload endpoint |
| `xhttp_download_path` | string | `"/api/v1/pull"` | XHTTP packet-up download endpoint |
| `xhttp_stream_path` | string | `"/api/v1/stream"` | XHTTP stream-one/stream-up endpoint |
| `xhttp_mode` | string? | -- | XHTTP mode: `"packet-up"` / `"stream-up"` / `"stream-one"` |
| `xhttp_nosse` | bool | `false` | Disable SSE wrapping for XHTTP download |
| `xhttp_extra_headers` | \[\[k,v\]\] | `[]` | Extra response headers for disguise |
| `response_server_header` | string? | -- | Override HTTP `Server` header |
| `padding_header` | bool | `true` | Add `X-Padding` response header |
| `enable_sse_disguise` | bool | `false` | Wrap download in SSE format |

### `[cdn.xporta]` -- XPorta transport

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable XPorta transport |
| `session_path` | string | `"/api/auth"` | XPorta session endpoint |
| `data_paths` | string[] | `["/api/v1/data", "/api/v1/sync", "/api/v1/update"]` | XPorta upload paths |
| `poll_paths` | string[] | `["/api/v1/notifications", "/api/v1/feed", "/api/v1/events"]` | XPorta long-poll download paths |
| `session_timeout_secs` | u64 | `300` | Session idle timeout in seconds |
| `max_sessions_per_client` | u16 | `8` | Max concurrent sessions per client |
| `cookie_name` | string | `"_sess"` | Session cookie name |
| `encoding` | string | `"json"` | Encoding: `"json"` / `"binary"` |

## Full example

```toml title="server.toml"
listen_addr = "0.0.0.0:8443"
quic_listen_addr = "0.0.0.0:8443"
dns_upstream = "8.8.8.8:53"
config_watch = true
shutdown_drain_timeout_secs = 30
ticket_rotation_hours = 6

[tls]
cert_path = "prisma-cert.pem"
key_path = "prisma-key.pem"

# Generate keys with: prisma gen-key
[[authorized_clients]]
id = "00000000-0000-0000-0000-000000000001"
auth_secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
name = "my-client"
bandwidth_up = "100mbps"
bandwidth_down = "500mbps"
quota = "500GB"
quota_period = "monthly"

[logging]
level = "info"       # trace | debug | info | warn | error
format = "pretty"    # pretty | json

[performance]
max_connections = 1024        # max concurrent connections
connection_timeout_secs = 300 # idle timeout in seconds

# Port forwarding (reverse proxy) -- allow clients to expose local services
[port_forwarding]
enabled = true
port_range_start = 10000
port_range_end = 20000
max_forwards_per_client = 10
max_connections_per_forward = 100
default_idle_timeout_secs = 300
require_name = false
log_connections = true
# denied_ports = [22, 25, 3389]
# allowed_ips = ["0.0.0.0/0"]
# global_bandwidth_up = "1gbps"
# global_bandwidth_down = "1gbps"

# Management API + console
[management_api]
enabled = true
listen_addr = "127.0.0.1:9090"
auth_token = "your-secure-token-here"
jwt_secret = "auto-generated-on-first-run"
console_dir = "/opt/prisma/console"  # Path to built console static files
# tls_enabled = false                # Set true to enable HTTPS on management API

# Console users (can also self-register via /api/auth/register)
[[management_api.users]]
username = "admin"
password_hash = "$2b$10$..."  # bcrypt hash, generate with: prisma hash-password
role = "admin"
enabled = true

# Per-frame padding
[padding]
min = 0
max = 256

# Camouflage (anti-active-detection)
[camouflage]
enabled = true
tls_on_tcp = true
fallback_addr = "example.com:443"
alpn_protocols = ["h2", "http/1.1"]
# salamander_password = "shared-obfuscation-key"  # Salamander UDP obfuscation (QUIC)
# h3_cover_site = "https://example.com"           # HTTP/3 masquerade cover site
# h3_static_dir = "/var/www/html"                 # OR serve local static files for H3

# TLS probe guard (auto-block IPs with repeated handshake failures)
[camouflage.tls_probe_guard]
enabled = true
max_failures = 20
failure_window_secs = 120
block_duration_secs = 120

# SSH transport (disguise as SSH server)
# [ssh]
# enabled = true
# listen_addr = "0.0.0.0:2222"
# host_key_path = "/etc/prisma/ssh_host_key"
# password = "ssh-password"
# allowed_users = ["admin"]
# fake_shell = true
# banner = "SSH-2.0-OpenSSH_9.6"

# WireGuard-compatible UDP transport
# [wireguard]
# enabled = true
# listen_addr = "0.0.0.0:51820"
# session_timeout_secs = 180

# PrismaTLS (replaces REALITY for active probing resistance)
# [prisma_tls]
# enabled = true
# auth_secret = "hex-encoded-32-bytes"
# auth_rotation_hours = 1
# [[prisma_tls.mask_servers]]
# addr = "www.microsoft.com:443"
# names = ["www.microsoft.com"]
# [[prisma_tls.mask_servers]]
# addr = "www.apple.com:443"
# names = ["www.apple.com"]

# Traffic shaping (anti-fingerprinting)
# [traffic_shaping]
# padding_mode = "bucket"
# bucket_sizes = [128, 256, 512, 1024, 2048, 4096, 8192, 16384]
# timing_jitter_ms = 30
# chaff_interval_ms = 500
# coalesce_window_ms = 5

# RTT normalization
# [anti_rtt]
# enabled = true
# normalization_ms = 150

# Congestion control (QUIC)
# [congestion]
# mode = "bbr"
# target_bandwidth = "100mbps"

# Port hopping (QUIC)
# [port_hopping]
# enabled = true
# base_port = 10000
# port_range = 50000
# interval_secs = 60
# grace_period_secs = 10

# CDN transport (WebSocket + gRPC + XHTTP through Cloudflare)
# [cdn]
# enabled = true
# listen_addr = "0.0.0.0:443"
# ws_tunnel_path = "/ws-tunnel"
# grpc_tunnel_path = "/tunnel.PrismaTunnel"
# cover_upstream = "http://127.0.0.1:3000"        # Reverse proxy to real website
# trusted_proxies = ["173.245.48.0/20"]            # Cloudflare IP ranges
# response_server_header = "nginx"
# [cdn.tls]
# cert_path = "origin-cert.pem"
# key_path = "origin-key.pem"

# XPorta transport (next-gen REST API simulation)
# [cdn.xporta]
# enabled = true
# session_path = "/api/auth"
# data_paths = ["/api/v1/data", "/api/v1/sync", "/api/v1/update"]
# poll_paths = ["/api/v1/notifications", "/api/v1/feed", "/api/v1/events"]
# session_timeout_secs = 300
# cookie_name = "_sess"
# encoding = "json"

# Static routing rules (persist across restarts)
# [routing]
# geoip_path = "/etc/prisma/GeoLite2-City.mmdb"
# [[routing.rules]]
# type = "ip-cidr"
# value = "10.0.0.0/8"
# action = "block"
# [[routing.rules]]
# type = "domain-keyword"
# value = "torrent"
# action = "block"

# Per-client ACLs
# [acls.client-uuid-1]
# client_id = "client-uuid-1"
# default_policy = "allow"
# enabled = true
# [[acls.client-uuid-1.rules]]
# action = "deny"
# description = "Block torrent sites"
# [acls.client-uuid-1.rules.matcher]
# type = "domain-keyword"
# value = "torrent"

# Transport fallback
# [fallback]
# enabled = true
# chain = ["tcp", "quic", "websocket", "grpc"]
# health_check_interval = 30
# auto_switch_on_failure = true
# max_consecutive_failures = 5
# migrate_back_on_recovery = false
```

## Validation rules

The server config is validated at startup. The following rules are enforced:

- `listen_addr` must not be empty
- At least one entry in `authorized_clients` is required
- Each `authorized_clients[].id` must not be empty
- Each `authorized_clients[].auth_secret` must not be empty and must be valid hex
- `logging.level` must be one of: `trace`, `debug`, `info`, `warn`, `error`
- `logging.format` must be one of: `pretty`, `json`
- `camouflage.tls_on_tcp = true` requires `tls.cert_path` and `tls.key_path` to be set
- `ssh.enabled = true` requires at least one of `ssh.password` or `ssh.authorized_keys_path`
- `ticket_rotation_hours` must be > 0
- `shutdown_drain_timeout_secs` must be > 0
