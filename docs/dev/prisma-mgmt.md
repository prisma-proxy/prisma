---
title: prisma-mgmt Reference
---

# prisma-mgmt Reference

`prisma-mgmt` is the management API crate, built on axum. It provides REST and WebSocket endpoints for monitoring and controlling a running Prisma server.

**Path:** `crates/prisma-mgmt/src/`

---

## Auth Middleware

All API endpoints (except `/api/prometheus`) are protected by bearer token authentication.

```
Authorization: Bearer your-secret-token
```

---

## Complete REST API Reference

### Health and Metrics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check: version, uptime |
| `GET` | `/api/metrics` | Current metrics snapshot |
| `GET` | `/api/metrics/history` | Historical metrics (param: `period`) |
| `GET` | `/api/system/info` | System and runtime information |

### Connections

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/connections` | List all active connections |
| `DELETE` | `/api/connections/{id}` | Disconnect a connection |
| `GET` | `/api/connections/geo` | GeoIP country distribution of active connections |

### Clients

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/clients` | List all authorized clients |
| `POST` | `/api/clients` | Create a new client (generates UUID + secret) |
| `PUT` | `/api/clients/{id}` | Update client settings |
| `DELETE` | `/api/clients/{id}` | Remove a client |

### Bandwidth and Quotas

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/clients/{id}/bandwidth` | Get bandwidth limits |
| `PUT` | `/api/clients/{id}/bandwidth` | Set bandwidth limits (body: `{upload_bps, download_bps}`) |
| `GET` | `/api/clients/{id}/quota` | Get traffic quota |
| `PUT` | `/api/clients/{id}/quota` | Set traffic quota (body: `{quota_bytes}`) |
| `GET` | `/api/bandwidth/summary` | Summary for all clients |

### Client Metrics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/metrics/clients` | All-client metrics snapshot (bytes, connections, latency percentiles) |
| `GET` | `/api/metrics/clients/{id}` | Single-client metrics snapshot |
| `GET` | `/api/metrics/clients/{id}/history` | Time-series history (param: `period=1h\|6h\|24h`) |

### Client Permissions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/clients/{id}/permissions` | Get per-client permissions |
| `PUT` | `/api/clients/{id}/permissions` | Update per-client permissions |
| `POST` | `/api/clients/{id}/kick` | Force-disconnect all sessions for a client |
| `POST` | `/api/clients/{id}/block` | Disconnect + block reconnection |

### Configuration

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config` | Get current config (secrets redacted) |
| `PATCH` | `/api/config` | Update config fields (JSON merge-patch) |
| `GET` | `/api/config/tls` | TLS certificate info |

### Config Backups

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config/backups` | List all backups |
| `POST` | `/api/config/backup` | Create new backup |
| `GET` | `/api/config/backups/{name}` | Get backup contents |
| `POST` | `/api/config/backups/{name}/restore` | Restore backup + reload |
| `GET` | `/api/config/backups/{name}/diff` | Diff against current |
| `DELETE` | `/api/config/backups/{name}` | Delete backup |

### Port Forwards

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/forwards` | List all port forwards |
| `DELETE` | `/api/forwards/{port}` | Unregister a forward |
| `GET` | `/api/forwards/{port}/connections` | Forward connections |

### Routing Rules

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/routes` | List all routing rules |
| `POST` | `/api/routes` | Create rule (body: `{name, condition, action, priority}`) |
| `PUT` | `/api/routes/{id}` | Update rule |
| `DELETE` | `/api/routes/{id}` | Delete rule |

### ACLs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/acls` | List all per-client ACL rules |
| `GET` | `/api/acls/{client_id}` | Get ACL for a client |
| `PUT` | `/api/acls/{client_id}` | Set ACL rules |
| `DELETE` | `/api/acls/{client_id}` | Remove ACL |

### Alerts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/alerts/config` | Get alert thresholds |
| `PUT` | `/api/alerts/config` | Update thresholds |

### Reload and Prometheus

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/reload` | Trigger config hot-reload |
| `GET` | `/api/prometheus` | Prometheus metrics (no auth) |

---

## WebSocket Endpoints

| Path | Description |
|------|-------------|
| `/api/ws/metrics` | Real-time metrics stream (1s interval) |
| `/api/ws/logs` | Real-time structured log stream |
| `/api/ws/connections` | Real-time connection events |
| `/api/ws/reload` | Reload event notifications |

---

## State

```rust
pub struct MgmtState {
    pub state: ServerState,
    pub bandwidth: Option<Arc<BandwidthLimiterStore>>,
    pub quotas: Option<Arc<QuotaStore>>,
    pub config_path: Option<PathBuf>,
    pub alert_config: Arc<RwLock<AlertConfig>>,
}

pub struct AlertConfig {
    pub cert_expiry_days: u32,          // default: 30
    pub quota_warn_percent: u8,         // default: 80
    pub handshake_spike_threshold: u64, // default: 100
}
```

Key fields on `ServerState` used by `prisma-mgmt`:

```rust
// per_client_metrics: lock-free hot-path accumulator per client UUID
pub per_client_metrics: Arc<DashMap<Uuid, Arc<ClientMetricsAccumulator>>>,
// per_client_history: ring buffer of historical data points (snapshotted every 60s)
pub per_client_history: Arc<RwLock<HashMap<Uuid, VecDeque<ClientMetricsHistoryPoint>>>>,
```

## Background Tasks

`spawn_periodic_backup(state)` is called inside `serve()` and runs for the lifetime of the server. Each iteration it reads `management_api.auto_backup_interval_mins` from the live config, sleeps for that interval, then calls `handlers::backup::auto_backup()`. When `auto_backup_interval_mins = 0` the task sleeps for 60 s before rechecking, so enabling auto-backup at runtime takes effect within 60 s without a restart.
