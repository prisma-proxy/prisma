# prisma-mgmt Reference

`prisma-mgmt` is the management API crate, built on axum. It provides REST and WebSocket endpoints for monitoring and controlling a running Prisma server.

**Path:** `prisma-mgmt/src/`

---

## Module Map

| Module | Path | Purpose |
|--------|------|---------|
| `router` | `router.rs` | Axum router builder with all endpoints |
| `auth` | `auth.rs` | Bearer token authentication middleware |
| `handlers::health` | `handlers/health.rs` | Health check, metrics snapshot, metrics history |
| `handlers::system` | `handlers/system.rs` | System information |
| `handlers::connections` | `handlers/connections.rs` | Active connection management |
| `handlers::clients` | `handlers/clients.rs` | Client CRUD operations |
| `handlers::bandwidth` | `handlers/bandwidth.rs` | Bandwidth limits and quota management |
| `handlers::config` | `handlers/config.rs` | Server config get/patch, TLS info |
| `handlers::backup` | `handlers/backup.rs` | Config backup/restore/diff |
| `handlers::forwards` | `handlers/forwards.rs` | Port forward management |
| `handlers::routes` | `handlers/routes.rs` | Routing rule CRUD |
| `handlers::acls` | `handlers/acls.rs` | Access control list management |
| `handlers::alerts` | `handlers/alerts.rs` | Alert threshold configuration |
| `handlers::reload` | `handlers/reload.rs` | Config hot-reload trigger |
| `handlers::prometheus_export` | `handlers/prometheus_export.rs` | Prometheus metrics endpoint |
| `ws::metrics` | `ws/metrics.rs` | WebSocket metrics stream |
| `ws::logs` | `ws/logs.rs` | WebSocket log stream |
| `ws::connections` | `ws/connections.rs` | WebSocket connections stream |
| `ws::reload` | `ws/reload.rs` | WebSocket reload notifications |

---

## Auth Middleware

All API endpoints (except `/api/prometheus`) are protected by bearer token authentication.

**Configuration:**

```toml
[management_api]
enabled = true
listen_addr = "0.0.0.0:9090"
auth_token = "your-secret-token"
```

**Usage:**

```
Authorization: Bearer your-secret-token
```

Requests without a valid token receive `401 Unauthorized`.

---

## State

```rust
pub struct MgmtState {
    pub state: ServerState,           // Core server state
    pub bandwidth: Option<Arc<BandwidthLimiterStore>>,
    pub quotas: Option<Arc<QuotaStore>>,
    pub config_path: Option<PathBuf>, // For reload and backup
    pub alert_config: Arc<RwLock<AlertConfig>>,
}
```

**`AlertConfig`:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cert_expiry_days` | `u32` | `30` | Warn when TLS cert expires within this many days |
| `quota_warn_percent` | `u8` | `80` | Warn when client uses this % of quota |
| `handshake_spike_threshold` | `u64` | `100` | Alert on handshake rate spikes |

---

## Complete REST API Reference

### Health and Metrics

#### `GET /api/health`

Health check endpoint.

**Response:** `200 OK`

```json
{
  "status": "ok",
  "version": "0.9.0",
  "protocol_version": 5,
  "uptime_secs": 86400
}
```

#### `GET /api/metrics`

Current metrics snapshot.

**Response:** `200 OK`

```json
{
  "active_connections": 42,
  "total_connections": 1250,
  "bytes_up": 1073741824,
  "bytes_down": 5368709120,
  "uptime_secs": 86400,
  "clients_online": 3,
  "per_client": {
    "client-uuid": {
      "active_connections": 15,
      "bytes_up": 524288000,
      "bytes_down": 2147483648
    }
  }
}
```

#### `GET /api/metrics/history`

Historical metrics over time.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period` | `String` | `"1h"` | Time period: `1h`, `6h`, `24h`, `7d` |

**Response:** `200 OK` -- array of timestamped metric snapshots.

---

### System Information

#### `GET /api/system/info`

System and runtime information.

**Response:** `200 OK`

```json
{
  "os": "linux",
  "arch": "x86_64",
  "cpu_count": 8,
  "memory_total_bytes": 17179869184,
  "memory_used_bytes": 4294967296,
  "load_avg": [1.2, 0.8, 0.5],
  "hostname": "prisma-server-01"
}
```

---

### Connections

#### `GET /api/connections`

List all active connections.

**Response:** `200 OK`

```json
[
  {
    "session_id": "uuid",
    "client_id": "uuid",
    "client_name": "my-client",
    "destination": "example.com:443",
    "transport": "quic",
    "cipher_suite": "chacha20-poly1305",
    "started_at": "2025-01-01T00:00:00Z",
    "bytes_up": 1024,
    "bytes_down": 4096,
    "duration_secs": 120
  }
]
```

#### `DELETE /api/connections/{id}`

Forcefully disconnect a connection by session ID.

**Response:** `200 OK`

```json
{"status": "disconnected", "session_id": "uuid"}
```

---

### Clients

#### `GET /api/clients`

List all authorized clients.

**Response:** `200 OK`

```json
[
  {
    "id": "uuid",
    "name": "my-client",
    "enabled": true,
    "online": true,
    "active_connections": 5,
    "total_bytes_up": 1073741824,
    "total_bytes_down": 5368709120,
    "bandwidth_up": "100mbps",
    "bandwidth_down": "200mbps",
    "quota": "100gb",
    "quota_used": 53687091200
  }
]
```

#### `POST /api/clients`

Create a new client. Generates a UUID and auth secret.

**Request body:**

```json
{"name": "new-client"}
```

**Response:** `201 Created`

```json
{
  "id": "generated-uuid",
  "auth_secret": "64-hex-chars",
  "name": "new-client"
}
```

#### `PUT /api/clients/{id}`

Update a client.

**Request body:**

```json
{
  "name": "updated-name",
  "enabled": true,
  "bandwidth_up": "50mbps",
  "bandwidth_down": "100mbps",
  "quota": "50gb"
}
```

**Response:** `200 OK`

#### `DELETE /api/clients/{id}`

Remove a client.

**Response:** `200 OK`

```json
{"status": "removed", "id": "uuid"}
```

---

### Bandwidth and Quotas

#### `GET /api/clients/{id}/bandwidth`

Get bandwidth limits for a client.

**Response:** `200 OK`

```json
{
  "upload_bps": 104857600,
  "download_bps": 209715200
}
```

#### `PUT /api/clients/{id}/bandwidth`

Set bandwidth limits for a client.

**Request body:**

```json
{
  "upload_bps": 104857600,
  "download_bps": 209715200
}
```

**Response:** `200 OK`

#### `GET /api/clients/{id}/quota`

Get traffic quota for a client.

**Response:** `200 OK`

```json
{
  "quota_bytes": 107374182400,
  "used_bytes": 53687091200,
  "percent_used": 50.0
}
```

#### `PUT /api/clients/{id}/quota`

Set traffic quota for a client.

**Request body:**

```json
{"quota_bytes": 107374182400}
```

**Response:** `200 OK`

#### `GET /api/bandwidth/summary`

Get bandwidth summary for all clients.

**Response:** `200 OK`

```json
[
  {
    "client_id": "uuid",
    "client_name": "my-client",
    "upload_bps": 104857600,
    "download_bps": 209715200,
    "current_upload_bps": 5242880,
    "current_download_bps": 10485760
  }
]
```

---

### Configuration

#### `GET /api/config`

Get the current server configuration (secrets redacted).

**Response:** `200 OK` -- JSON representation of the server config.

#### `PATCH /api/config`

Update configuration fields. Uses JSON merge-patch semantics.

**Request body:**

```json
{"logging": {"level": "debug"}}
```

**Response:** `200 OK`

```json
{"status": "updated", "changed_fields": ["logging.level"]}
```

#### `GET /api/config/tls`

Get TLS certificate information.

**Response:** `200 OK`

```json
{
  "cert_path": "/etc/prisma/cert.pem",
  "key_path": "/etc/prisma/key.pem",
  "subject": "CN=prisma-server",
  "issuer": "CN=prisma-server",
  "not_before": "2025-01-01T00:00:00Z",
  "not_after": "2026-01-01T00:00:00Z",
  "days_until_expiry": 365
}
```

---

### Config Backups

#### `GET /api/config/backups`

List all config backups.

**Response:** `200 OK`

```json
[
  {"name": "backup-2025-01-01T00-00-00", "created_at": "2025-01-01T00:00:00Z", "size_bytes": 2048}
]
```

#### `POST /api/config/backup`

Create a new backup of the current config.

**Response:** `201 Created`

```json
{"name": "backup-2025-01-01T12-00-00", "created_at": "2025-01-01T12:00:00Z"}
```

#### `GET /api/config/backups/{name}`

Get the contents of a specific backup.

**Response:** `200 OK` -- the backup TOML content.

#### `POST /api/config/backups/{name}/restore`

Restore a backup (overwrites current config and triggers reload).

**Response:** `200 OK`

```json
{"status": "restored", "reload_summary": "..."}
```

#### `GET /api/config/backups/{name}/diff`

Show diff between a backup and the current config.

**Response:** `200 OK`

```json
{"diff": "--- backup\n+++ current\n@@ ...\n-old_value\n+new_value"}
```

#### `DELETE /api/config/backups/{name}`

Delete a backup.

**Response:** `200 OK`

---

### Port Forwards

#### `GET /api/forwards`

List all registered port forwards.

**Response:** `200 OK`

```json
[
  {
    "remote_port": 2222,
    "name": "ssh",
    "client_id": "uuid",
    "active_connections": 1,
    "total_connections": 42,
    "bytes_up": 1048576,
    "bytes_down": 2097152
  }
]
```

#### `DELETE /api/forwards/{port}`

Unregister a port forward.

**Response:** `200 OK`

#### `GET /api/forwards/{port}/connections`

List active connections for a specific port forward.

**Response:** `200 OK` -- array of connection info objects.

---

### Routing Rules

#### `GET /api/routes`

List all routing rules (static + dynamic).

**Response:** `200 OK`

```json
[
  {
    "id": "uuid",
    "name": "block-ads",
    "condition": "DomainMatch:*.ads.*",
    "action": "block",
    "priority": 100
  }
]
```

#### `POST /api/routes`

Create a new routing rule.

**Request body:**

```json
{
  "name": "block-ads",
  "condition": "DomainMatch:*.ads.*",
  "action": "block",
  "priority": 100
}
```

**Response:** `201 Created`

```json
{"id": "generated-uuid", "name": "block-ads"}
```

#### `PUT /api/routes/{id}`

Update a routing rule.

**Request body:**

```json
{"action": "allow", "priority": 50}
```

**Response:** `200 OK`

#### `DELETE /api/routes/{id}`

Delete a routing rule.

**Response:** `200 OK`

---

### Access Control Lists

#### `GET /api/acls`

List all per-client ACL rules.

**Response:** `200 OK`

#### `GET /api/acls/{client_id}`

Get ACL rules for a specific client.

**Response:** `200 OK`

#### `PUT /api/acls/{client_id}`

Set ACL rules for a client.

**Request body:**

```json
{
  "rules": [
    {"condition": "DomainMatch:*.blocked.com", "action": "deny", "priority": 1}
  ]
}
```

**Response:** `200 OK`

#### `DELETE /api/acls/{client_id}`

Remove all ACL rules for a client.

**Response:** `200 OK`

---

### Alerts

#### `GET /api/alerts/config`

Get current alert thresholds.

**Response:** `200 OK`

```json
{
  "cert_expiry_days": 30,
  "quota_warn_percent": 80,
  "handshake_spike_threshold": 100
}
```

#### `PUT /api/alerts/config`

Update alert thresholds.

**Request body:**

```json
{
  "cert_expiry_days": 14,
  "quota_warn_percent": 90
}
```

**Response:** `200 OK`

---

### Config Reload

#### `POST /api/reload`

Trigger a config hot-reload.

**Response:** `200 OK`

```json
{
  "status": "reloaded",
  "summary": "Updated 2 clients, changed logging level to debug"
}
```

---

### Prometheus Metrics

#### `GET /api/prometheus`

Prometheus-compatible metrics endpoint. **Not protected by auth** (designed for scraper access).

**Response:** `200 OK` -- Prometheus text format.

```
# HELP prisma_connections_active Active connection count
# TYPE prisma_connections_active gauge
prisma_connections_active 42
# HELP prisma_bytes_total Total bytes transferred
# TYPE prisma_bytes_total counter
prisma_bytes_total{direction="up"} 1073741824
prisma_bytes_total{direction="down"} 5368709120
```

---

## WebSocket Endpoints

All WebSocket endpoints are authenticated. Connect via `ws://` or `wss://` with the auth token as a query parameter or in the `Authorization` header.

### `GET /api/ws/metrics`

Real-time metrics stream. Pushes `MetricsSnapshot` JSON every second.

### `GET /api/ws/logs`

Real-time log stream. Pushes structured `LogEntry` JSON as they occur.

```json
{
  "timestamp": "2025-01-01T00:00:00Z",
  "level": "INFO",
  "target": "prisma_server::handler",
  "message": "New connection from client-uuid to example.com:443"
}
```

### `GET /api/ws/connections`

Real-time connection events. Pushes updates when connections are opened or closed.

### `GET /api/ws/reload`

Reload event notifications. Pushes a message when config reload occurs.

---

## Router Structure

The router is built in `router.rs` using axum's `Router`:

1. All `/api/*` routes are grouped under an auth middleware layer
2. The `/api/prometheus` endpoint is merged outside the auth layer
3. If `console_dir` is configured, static files are served as a fallback
4. CORS is configured based on `cors_origins` (or allows all origins if empty)

---

## Serving

`prisma_mgmt::serve(config, state)` starts the management API:

- **HTTPS mode:** When TLS config is present, uses `axum_server::bind_rustls`
- **HTTP mode:** When no TLS, uses `axum::serve` with TCP listener
- Inherits TLS config from the server if not explicitly set on the management API
