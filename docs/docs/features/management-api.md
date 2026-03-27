---
sidebar_position: 4
---

# Management API

The management API provides live monitoring and control of the Prisma server via REST endpoints and WebSocket streams. It is implemented in the `prisma-mgmt` crate using [axum](https://github.com/tokio-rs/axum).

## Enabling the API

Add the `[management_api]` section to your `server.toml`:

```toml
[management_api]
enabled = true
listen_addr = "0.0.0.0:9090"
auth_token = "your-secure-token-here"
console_dir = "/opt/prisma/console"  # optional: serve built console
```

## Authentication

The management API supports two authentication methods:

### JWT-based authentication (v2.8.0+)

Authenticate with username and password to receive a JWT token. Use the token in subsequent requests:

```bash
# Login to get a JWT token
curl -X POST -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-password"}' \
  http://127.0.0.1:9090/api/auth/login
# {"token":"eyJhbGciOi...","role":"admin","expires_in":86400}

# Use the JWT token
curl -H "Authorization: Bearer eyJhbGciOi..." http://127.0.0.1:9090/api/health
```

### Legacy bearer token

For backward compatibility, the static `auth_token` from `server.toml` is still accepted as a Bearer token. This grants full admin-level access:

```bash
curl -H "Authorization: Bearer your-secure-token-here" http://127.0.0.1:9090/api/health
```

If both `auth_token` and `jwt_secret` are empty, authentication is disabled (development mode only).

## REST Endpoints

### Auth & Users

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/login` | Authenticate with username+password, returns JWT |
| `POST` | `/api/auth/register` | Self-register as Client role user |
| `GET` | `/api/auth/me` | Get current user info from JWT |
| `GET` | `/api/users` | List all users (admin only) |
| `POST` | `/api/users` | Create user (admin only) |
| `PUT` | `/api/users/{username}` | Update user role/status (admin only) |
| `DELETE` | `/api/users/{username}` | Delete user (admin only) |
| `PUT` | `/api/auth/password` | Change current user's password (requires auth) |
| `GET` | `/api/setup/status` | Check if initial setup is complete (no auth required) |
| `POST` | `/api/setup/init` | Create initial admin user (no auth required, one-time only) |

**Login:**

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-password"}' \
  http://127.0.0.1:9090/api/auth/login
# {"token":"eyJhbGciOi...","role":"admin","expires_in":86400}
```

**Self-register:**

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"username": "newuser", "password": "strong-password"}' \
  http://127.0.0.1:9090/api/auth/register
# {"username":"newuser","role":"client","enabled":true}
```

Self-registered users are assigned the **Client** role and can only view their own statistics.

**Change password:**

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"current_password": "old-password", "new_password": "new-strong-password"}' \
  http://127.0.0.1:9090/api/auth/password
# {"status":"ok"}
```

:::note
Self-registration is only available after the initial admin user has been created via `/api/setup/init` or the console setup wizard.
:::

**Check setup status (no auth required):**

```bash
curl http://127.0.0.1:9090/api/setup/status
# {"needs_setup":true}
```

**Initial setup (no auth required, one-time):**

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "strong-password"}' \
  http://127.0.0.1:9090/api/setup/init
# {"token":"eyJhbGciOi...","user":{"username":"admin","role":"admin","enabled":true}}
```

**List users (admin only):**

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/users
# [{"username":"admin","role":"admin","enabled":true},{"username":"viewer","role":"operator","enabled":true}]
```

### Health & Metrics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Server status, uptime, and version |
| `GET` | `/api/metrics` | Current metrics snapshot (connections, bytes, failures) |
| `GET` | `/api/metrics/history` | Time-series metrics history |

**Example:**

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/health
# {"status":"ok","uptime_secs":3600,"version":"2.26.0"}
```

### Connections

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/connections` | List all active connections with byte counters |
| `DELETE` | `/api/connections/:id` | Force-disconnect a session by ID |
| `GET` | `/api/connections/geo` | Country distribution of active connections (requires `geoip_path` configured) |

### Clients

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/clients` | List all authorized clients |
| `POST` | `/api/clients` | Generate a new client (returns UUID + auth secret) |
| `PUT` | `/api/clients/:id` | Update client name or enabled status |
| `DELETE` | `/api/clients/:id` | Remove a client |
| `GET` | `/api/clients/:id/secret` | Get client auth secret (returns the hex-encoded secret) |
| `POST` | `/api/clients/share` | Generate a share config for a client (TOML, `prisma://` URI, or QR code) |

**Generating a share config:**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "uuid", "format": "toml"}' \
  http://127.0.0.1:9090/api/clients/share
# {"format":"toml","content":"[identity]\nclient_id = \"uuid\"\nauth_secret = \"...\"\n..."}
```

Supported formats: `toml`, `uri` (returns `prisma://` link), `qr` (returns SVG QR code).

**Creating a client at runtime:**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "new-device"}' \
  http://127.0.0.1:9090/api/clients
# {"id":"uuid","name":"new-device","auth_secret_hex":"64-char-hex"}
```

:::warning
The `auth_secret_hex` is only returned once at creation time. Store it securely.
:::

### System

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/system/info` | Version, platform, PID, CPU/memory usage, cert expiry, listeners |

### Configuration

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config` | Current server config (all sections, secrets redacted) |
| `PATCH` | `/api/config` | Hot-reload supported fields (auto-backs up config before changes) |
| `POST` | `/api/reload` | Hot-reload the entire server configuration from disk |
| `GET` | `/api/config/tls` | TLS certificate info |

**Hot-reloadable fields:** `logging_level`, `logging_format`, `max_connections`, `port_forwarding_enabled`, and all traffic shaping, congestion, camouflage, routing, and ACL settings.

**Hot reload via POST /api/reload:**

Triggers a full re-read of `server.toml` from disk and applies all hot-reloadable fields without restarting the server. Existing connections are not interrupted.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/reload
# {"status":"ok","reloaded_fields":["logging_level","traffic_shaping","routing"]}
```

### Config Backups

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config/backups` | List timestamped config backups |
| `POST` | `/api/config/backup` | Create a manual backup |
| `GET` | `/api/config/backups/:name` | Read backup content |
| `POST` | `/api/config/backups/:name/restore` | Restore config from backup |
| `DELETE` | `/api/config/backups/:name` | Delete a backup |
| `GET` | `/api/config/backups/:name/diff` | Diff backup vs current config |

### Bandwidth & Quotas

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/clients/:id/bandwidth` | Per-client bandwidth limits |
| `PUT` | `/api/clients/:id/bandwidth` | Update bandwidth limits |
| `GET` | `/api/clients/:id/quota` | Per-client quota usage |
| `PUT` | `/api/clients/:id/quota` | Update quota config |
| `GET` | `/api/bandwidth/summary` | All clients' bandwidth/quota summary |

### Alerts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/alerts/config` | Alert thresholds (cert expiry, quota, handshake spike) |
| `PUT` | `/api/alerts/config` | Update alert thresholds (persisted to `alerts.json`) |

### Port Forwards

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/forwards` | List all active port forward sessions |
| `POST` | `/api/forwards` | Create a new port forward |
| `PUT` | `/api/forwards/:port` | Update an existing port forward |
| `DELETE` | `/api/forwards/:port` | Close a forward by remote port |
| `GET` | `/api/forwards/:port/connections` | List active connections for a specific forward |

See [Port Forwarding](/docs/features/port-forwarding) for full configuration and API response formats.

### Access Control Lists (ACLs)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/acls` | List all ACL rules (per-client access control) |
| `POST` | `/api/acls` | Create a new ACL rule |
| `PUT` | `/api/acls/:id` | Update an existing ACL rule |
| `DELETE` | `/api/acls/:id` | Remove an ACL rule |

ACL rules restrict which destinations specific clients can access. Rules are evaluated per-client and take precedence over global routing rules.

**Example: Create an ACL rule**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "uuid",
    "condition": {"type": "DomainMatch", "value": "*.internal.corp"},
    "action": "Block",
    "enabled": true
  }' \
  http://127.0.0.1:9090/api/acls
```

### Client Metrics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/metrics/clients` | All clients: bytes, connections, latency percentiles |
| `GET` | `/api/metrics/clients/:id` | Single client metrics snapshot |
| `GET` | `/api/metrics/clients/:id/history` | Time-series history (`?period=1h\|6h\|24h`, default `1h`) |

**Example:**

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/metrics/clients
# [{"client_id":"uuid","client_name":"laptop","active_connections":3,"bytes_up":1048576,
#   "bytes_down":5242880,"connection_count":42,"last_seen":"2026-03-24T12:00:00Z",
#   "latency_p50_ms":12.5,"latency_p95_ms":38.2,"latency_p99_ms":71.0}]
```

### Client Permissions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/clients/:id/permissions` | Get permissions for a specific client |
| `PUT` | `/api/clients/:id/permissions` | Update client permissions |
| `POST` | `/api/clients/:id/kick` | Force-disconnect a client (terminates all active sessions) |
| `POST` | `/api/clients/:id/block` | Block a client (disconnect + prevent reconnection) |

**Example: Kick a client**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:9090/api/clients/uuid-here/kick
# {"status":"ok","sessions_terminated":3}
```

**Example: Update permissions**

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"can_forward": true, "can_udp": true, "max_connections": 50}' \
  http://127.0.0.1:9090/api/clients/uuid-here/permissions
```

### GeoIP

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/geoip/download` | Download GeoIP database and auto-configure `geoip_path` |

Triggers a server-side download of the GeoIP database. The server downloads the database file, stores it in the configured data directory, and automatically updates the `geoip_path` in the running configuration. Returns download progress and final status.

**Example:**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/geoip/download
# {"status":"ok","path":"/opt/prisma/data/geoip.mmdb","size_bytes":4521984}
```

### Documentation

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/docs/openapi.json` | OpenAPI 3.0 specification for the management API |

Returns the complete OpenAPI 3.0 specification document. Can be imported into Swagger UI, Postman, or other OpenAPI-compatible tools for interactive API exploration.

### Routing Rules

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/routes` | List all routing rules |
| `POST` | `/api/routes` | Add a new routing rule |
| `PUT` | `/api/routes/:id` | Update an existing rule |
| `DELETE` | `/api/routes/:id` | Remove a rule |

See [Routing Rules](/docs/features/routing-rules) for details on rule conditions and actions.

### Route Testing (v2.13.0+)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/routes/test` | Test a domain or IP address against configured routing rules |

**Example:**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"target": "google.com"}' \
  http://127.0.0.1:9090/api/routes/test
# {"matched":true,"rule":{"type":"domain-suffix","value":"google.com","action":"proxy"},"index":3}
```

### Server GeoIP (v2.13.0+)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/server/geo` | Get the server's own GeoIP location |

**Example:**

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/server/geo
# {"country":"US","city":"San Francisco","lat":37.7749,"lon":-122.4194}
```

### Console Settings (v2.12.0+)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings` | Get console settings (registration, default role, session expiry, backup interval) |
| `PUT` | `/api/settings` | Update console settings (admin only) |

**Example:**

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/settings
# {"registration_enabled":true,"default_role":"client","session_expiry_hours":24,"backup_interval_mins":60}

curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"registration_enabled":false,"default_role":"client","session_expiry_hours":48,"backup_interval_mins":120}' \
  http://127.0.0.1:9090/api/settings
# {"status":"ok"}
```

### Redemption Codes (v2.12.0+)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/codes` | Generate redemption codes (admin only) |
| `GET` | `/api/codes` | List all redemption codes (admin only) |
| `DELETE` | `/api/codes/:code` | Delete a redemption code (admin only) |
| `POST` | `/api/redeem` | Redeem a code to get client credentials |

**Generate codes:**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"count": 5, "prefix": "PRISMA"}' \
  http://127.0.0.1:9090/api/codes
# {"codes":["PRISMA-A1B2","PRISMA-C3D4","PRISMA-E5F6","PRISMA-G7H8","PRISMA-I9J0"]}
```

**Redeem a code:**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code": "PRISMA-A1B2"}' \
  http://127.0.0.1:9090/api/redeem
# {"client_id":"uuid","auth_secret":"hex","name":"redeemed-PRISMA-A1B2"}
```

### Subscription (v2.12.0+)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/subscription` | Get current user's subscription status |

**Example:**

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/subscription
# {"active":true,"clients":["uuid-1","uuid-2"],"redeemed_codes":["PRISMA-A1B2"],"expires_at":null}
```

### Invite Links (v2.12.0+)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/invites` | Create an invite link (admin only) |
| `GET` | `/api/invites` | List all invite links (admin only) |
| `DELETE` | `/api/invites/:id` | Delete an invite link (admin only) |
| `GET` | `/api/invite/{token}/info` | Check invite link validity (no auth required) |
| `POST` | `/api/invite/{token}` | Redeem an invite link (no auth required) |

**Create an invite link:**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"max_uses": 10, "expires_hours": 72}' \
  http://127.0.0.1:9090/api/invites
# {"id":"uuid","token":"abc123","url":"https://server:9090/invite/abc123","max_uses":10,"uses":0}
```

**Redeem an invite (no auth):**

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"username": "newuser", "password": "strong-password"}' \
  http://127.0.0.1:9090/api/invite/abc123
# {"token":"eyJhbGciOi...","user":{"username":"newuser","role":"client"}}
```

## WebSocket Endpoints

### Metrics stream

```
WS /api/ws/metrics
```

Pushes a `MetricsSnapshot` JSON object every second:

```json
{
  "timestamp": "2025-01-01T00:00:00Z",
  "uptime_secs": 3600,
  "total_connections": 150,
  "active_connections": 12,
  "total_bytes_up": 1048576,
  "total_bytes_down": 5242880,
  "handshake_failures": 3
}
```

### Log stream

```
WS /api/ws/logs
```

Pushes log entries in real-time. Clients can send filter messages to reduce noise:

```json
{"level": "warn", "target": "prisma_server"}
```

Log entries:

```json
{
  "timestamp": "2025-01-01T00:00:01Z",
  "level": "INFO",
  "target": "prisma_server::handler",
  "message": "session_id=abc Handshake complete (TCP)"
}
```

Send `{"level": "", "target": ""}` to clear filters.

### Connection events stream

```
WS /api/ws/connections
```

Pushes real-time connection lifecycle events (connect, disconnect, migration):

```json
{
  "event": "connected",
  "session_id": "abc123",
  "peer_addr": "203.0.113.5:54321",
  "transport": "quic",
  "client_id": "uuid",
  "timestamp": "2026-03-20T12:00:00Z"
}
```

### Configuration reload stream

```
WS /api/ws/reload
```

Pushes notifications when the server configuration is reloaded (via `POST /api/reload` or `PATCH /api/config`):

```json
{
  "event": "config_reloaded",
  "changed_fields": ["logging_level", "traffic_shaping"],
  "timestamp": "2026-03-20T12:05:00Z"
}
```

## Endpoint Summary

All endpoints at a glance (v2.26.0):

| Category | Endpoints | Description |
|----------|-----------|-------------|
| Auth & Users | 10 REST | Login, register, user CRUD, role management |
| Health & Metrics | 3 REST + 1 WS | Server status, snapshots, history, real-time stream |
| Connections | 3 REST + 1 WS | List, disconnect, GeoIP distribution, real-time events |
| Clients | 6 REST | CRUD for authorized clients, secret retrieval, share config |
| Client Permissions | 4 REST | Permissions, kick, block |
| Client Metrics | 3 REST | Per-client metrics snapshot, single-client, and history |
| System | 1 REST | Platform and resource info |
| Configuration | 4 REST + 1 WS | Config read/write, hot-reload, reload stream |
| Config Backups | 5 REST | Backup, restore, diff |
| Bandwidth & Quotas | 5 REST | Per-client limits and usage |
| Alerts | 2 REST | Alert threshold management |
| Port Forwards | 5 REST | CRUD, close, per-forward connections |
| ACLs | 4 REST | Per-client access control rules |
| GeoIP | 1 REST | GeoIP database download and configuration |
| Documentation | 1 REST | OpenAPI 3.0 specification |
| Routing Rules | 4 REST | Server-side routing rule management |
| Route Testing | 1 REST | Test domain/IP against routing rules |
| Server GeoIP | 1 REST | Server GeoIP location |
| Console Settings | 2 REST | Console settings read/write |
| Redemption Codes | 4 REST | Code generation, listing, deletion, redemption |
| Subscription | 1 REST | User subscription status |
| Invite Links | 5 REST | Invite link CRUD and public redemption |
| Logs | 1 WS | Real-time log streaming |
