---
sidebar_position: 5
---

# Console

The Prisma console is a real-time web interface for monitoring and managing the proxy server. It is built as a static site with Next.js 16, shadcn/ui, Recharts, and TanStack Query, and served directly by the Prisma server.

## Prerequisites

- A running Prisma server with the [Management API](/docs/features/management-api) enabled
- Console static files (pre-built or built from source)

## Setup

### Using pre-built files

Download `prisma-console.tar.gz` from the [latest release](https://github.com/Yamimega/prisma/releases/latest) and extract it:

```bash
mkdir -p /opt/prisma/console
tar -xzf prisma-console.tar.gz -C /opt/prisma/console
```

### Building from source

```bash
cd apps/prisma-console
npm ci
npm run build
```

Static files are output to `apps/prisma-console/out/`.

### Server configuration

Point the server to the console files in `server.toml`:

```toml
[management_api]
enabled = true
listen_addr = "0.0.0.0:9090"
auth_token = "your-secure-token-here"
console_dir = "/opt/prisma/console"  # or "./apps/prisma-console/out"
```

Start the server and access the console at `https://your-server:9090/`.

### Using the CLI (`prisma console`)

The `prisma console` command automatically downloads and serves the console without manual setup.

#### Basic usage

```bash
prisma console --mgmt-url https://127.0.0.1:9090 --token your-secure-token
```

This downloads the latest console from GitHub Releases, caches it locally, and starts a local server that proxies API requests to your management API. The browser opens automatically on desktop systems.

#### All flags

| Flag | Default | Description |
|------|---------|-------------|
| `--mgmt-url` | auto-detect | Management API URL (auto-detected from `server.toml` if omitted) |
| `--token` | — | Bearer token for authentication (reads `management_api.auth_token` from `server.toml` if omitted) |
| `--config` / `-c` | `./server.toml` | Path to `server.toml` for auto-detection of `--mgmt-url` and `--token` |
| `--listen` / `-l` | `127.0.0.1:9091` | Local address for the console server |
| `--no-open` | `false` | Do not automatically open the browser |
| `--daemon` / `-d` | `false` | Run in the background as a daemon process |
| `--console-dir` | `~/.prisma/console` | Path to cached console static files |

#### Auto-detect from server.toml

When `--mgmt-url` and `--token` are omitted, the CLI reads `server.toml` (from the current directory or the path given by `--config`) and extracts `management_api.listen_addr` and `management_api.auth_token` automatically:

```bash
# Auto-detect everything from server.toml in the current directory
prisma console

# Auto-detect from a specific config file
prisma console -c /etc/prisma/server.toml
```

#### Daemon mode

Run the console server in the background:

```bash
# Start as daemon
prisma console -d

# Check status of the daemon
prisma console status

# Stop the daemon
prisma console stop
```

The daemon writes its PID to `~/.prisma/console.pid` and logs to `~/.prisma/console.log`.

#### Architecture: static file serving + reverse proxy

When launched via `prisma console`, the CLI starts a lightweight HTTP server that:

1. **Serves static files** — the pre-built console SPA from the cache directory
2. **Reverse-proxies API requests** — all `/api/*` and `/api/ws/*` requests are forwarded to the management API URL
3. **Injects authentication** — the `--token` is automatically added to proxied requests

```
Browser → prisma console (local :9091) → static files (console SPA)
                                        → /api/* → proxy → prisma-server:9090
                                        → /api/ws/* → WebSocket proxy → prisma-server:9090
```

This allows accessing the console without CORS configuration and without exposing the management API directly.

## Authentication

The console uses token-based authentication. Enter the `management_api.auth_token` from your server config on the login page. The token is stored in the browser's session storage and sent as a `Bearer` token with each API request.

All `/console/*` routes are protected — unauthenticated users are redirected to `/login`.

## Architecture

The console is built as a static single-page application (SPA) and served by the Prisma server's management API (axum). No separate Node.js process is needed in production.

```
Browser → prisma-server:9090 → static files (console)
                              → /api/* (REST + WebSocket)
```

API calls from the console go directly to the same-origin management API endpoints. WebSocket connections use a `?token=` query parameter for authentication (since the browser WebSocket API cannot send custom headers).

## Pages

### Overview

The main overview dashboard showing:
- **Metrics cards** — active connections, total bytes up/down, uptime
- **Traffic chart** — real-time bytes/sec with time-range selector (Live/1H/6H/24H/7D) and Mbps toggle
- **Transport pie chart** — connections grouped by transport type
- **Connection histogram** — connection duration distribution
- **Connection table** — active connections with peer address, transport type, mode, byte counters, and a disconnect button

Data sources: WebSocket push (metrics every 1s) + REST polling (connections every 5s).

### Server

Server information:
- Health status, version, and uptime
- Server configuration details (listen addresses, max connections, timeouts)
- TLS certificate info

### System

System monitoring:
- **System cards** — version, platform, PID, CPU and memory usage gauges
- **Certificate expiry** — countdown with color coding (green &gt;30d, yellow 7-30d, red &lt;7d)
- **Active listeners** — table of all listening addresses and protocols

### Clients

Client management:
- **Client list** — shows all authorized clients with name, status (enabled/disabled), clickable links to detail page
- **Client detail** — per-client bandwidth limits (editable), quota utilization bar, traffic chart, filtered connection table
- **Add client** — generates a new UUID + auth secret pair and displays the key once
- **Edit client** — update name, toggle enabled/disabled, configure bandwidth/quota limits
- **Delete client** — remove a client from the auth store

Changes take effect immediately — no server restart required.

### Routing

Visual routing rules editor:
- **Rule list** — all rules sorted by priority, showing condition, action, and enabled status
- **Inline edit** — click any rule field (condition, value, action) to edit it directly in the table without opening a dialog. Changes are saved immediately via the management API.
- **Rule editor** — dialog form for creating new rules with condition type, value, and action
- **Expanded rule types** — supports DOMAIN, DOMAIN-SUFFIX, DOMAIN-KEYWORD, IP-CIDR, GEOIP, PORT, and ALL rule types with auto-complete suggestions
- **Toggle/delete** — enable, disable, or remove rules inline

See [Routing Rules](/docs/features/routing-rules) for details on rule types.

### Logs

Real-time log streaming:
- **Log viewer** — scrollable, monospace log output with colored level badges
- **Filters** — filter by log level (ERROR, WARN, INFO, DEBUG, TRACE), target string, and message regex search
- **Auto-scroll** — automatically follows new log entries unless the user scrolls up
- **Clear** — clear the log buffer

Data source: WebSocket push (real-time log entries).

### Settings

Server configuration editor with tabbed sections:
- **General** — logging level, logging format, max connections, port forwarding toggle
- **Camouflage & CDN** — camouflage and CDN configuration (read-only)
- **Traffic & Performance** — traffic shaping, congestion, port hopping, DNS, anti-RTT settings
- **TLS & Security** — certificate info, transport-only cipher, protocol version, PrismaTLS status
- **Alerts** — configure alert thresholds (cert expiry, quota warning, handshake spike)

### Config Backups

Config backup and restore:
- **Backup list** — timestamped backups with name, size, and actions
- **Create backup** — create a manual snapshot of the current config
- **Restore** — restore config from a previous backup (auto-backs up current before restoring)
- **Diff viewer** — side-by-side colored diff comparing backup vs current config
- **Delete** — remove old backups

### Traffic Shaping

Traffic shaping visualization:
- **Bucket size chart** — bar chart showing padding bucket size distribution
- **Config cards** — padding mode, jitter, chaff status, coalescing window

## Additional Features

- **i18n** — full English and Simplified Chinese translations, switchable from the header
- **Theme toggle** — dark, light, and system mode, switchable from the header. Preference is persisted in localStorage and applied on page load.
- **Toast notification system** — non-blocking toast notifications for operation feedback (success, error, warning, info). Toasts auto-dismiss after 5 seconds and stack vertically when multiple appear. Used for config save confirmations, client operations, rule changes, and API errors.
- **Global search** — Ctrl+K command palette searching pages, clients, and config keys
- **Data export** — export tables as CSV/JSON and charts as PNG
- **Alert badge** — bell icon in header showing active alerts with severity levels
- **Responsive sidebar** — collapsible sidebar (icon-only mode), mobile drawer

## Development

For local development, you can run the Next.js dev server:

```bash
cd apps/prisma-console
npm install
npm run dev
# → http://localhost:3000
```

The dev server expects the Prisma management API running on the same origin or a CORS-enabled address. Configure `cors_origins` in your server config if using a different port:

```toml
[management_api]
cors_origins = ["http://localhost:3000"]
```
