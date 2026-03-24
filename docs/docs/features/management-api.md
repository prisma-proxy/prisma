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

All endpoints require a Bearer token in the `Authorization` header:

```bash
curl -H "Authorization: Bearer your-secure-token-here" http://127.0.0.1:9090/api/health
```

If `auth_token` is empty, authentication is disabled (development mode only).

## REST Endpoints

### Health & Metrics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Server status, uptime, and version |
| `GET` | `/api/metrics` | Current metrics snapshot (connections, bytes, failures) |
| `GET` | `/api/metrics/history` | Time-series metrics history |

**Example:**

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/health
# {"status":"ok","uptime_secs":3600,"version":"2.1.4"}
```

### Connections

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/connections` | List all active connections with byte counters |
| `DELETE` | `/api/connections/:id` | Force-disconnect a session by ID |

### Clients

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/clients` | List all authorized clients |
| `POST` | `/api/clients` | Generate a new client (returns UUID + auth secret) |
| `PUT` | `/api/clients/:id` | Update client name or enabled status |
| `DELETE` | `/api/clients/:id` | Remove a client |

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
| `GET` | `/api/metrics/clients` | Per-client metrics snapshot (bytes, connections, latency) |

**Example:**

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/metrics/clients
# [{"client_id":"uuid","name":"laptop","active_connections":3,"bytes_up":1048576,"bytes_down":5242880,"avg_latency_ms":42}]
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

### Routing Rules

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/routes` | List all routing rules |
| `POST` | `/api/routes` | Add a new routing rule |
| `PUT` | `/api/routes/:id` | Update an existing rule |
| `DELETE` | `/api/routes/:id` | Remove a rule |

See [Routing Rules](/docs/features/routing-rules) for details on rule conditions and actions.

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

All endpoints at a glance (v2.1.4):

| Category | Endpoints | Description |
|----------|-----------|-------------|
| Health & Metrics | 3 REST + 1 WS | Server status, snapshots, history, real-time stream |
| Connections | 2 REST + 1 WS | List, disconnect, real-time events |
| Clients | 4 REST | CRUD for authorized clients |
| Client Permissions | 4 REST | Permissions, kick, block |
| Client Metrics | 1 REST | Per-client metrics snapshot |
| System | 1 REST | Platform and resource info |
| Configuration | 4 REST + 1 WS | Config read/write, hot-reload, reload stream |
| Config Backups | 5 REST | Backup, restore, diff |
| Bandwidth & Quotas | 5 REST | Per-client limits and usage |
| Alerts | 2 REST | Alert threshold management |
| Port Forwards | 3 REST | List, close, per-forward connections |
| ACLs | 4 REST | Per-client access control rules |
| Routing Rules | 4 REST | Server-side routing rule management |
| Logs | 1 WS | Real-time log streaming |
