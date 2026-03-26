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

Download `prisma-console.tar.gz` from the [latest release](https://github.com/prisma-proxy/prisma/releases/latest) and extract it:

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

The console supports two authentication modes:

- **Username + password (JWT-based)** — the primary login method as of v2.8.0. Users authenticate with a username and password; the server issues a JWT token that is stored in the browser and sent with each API request. A "Remember me" option is available for persistent login sessions across browser restarts.
- **Self-registration** — users can register themselves via the login page once an admin user exists (registration is gated until initial setup is complete). Self-registered users are assigned the **Client** role by default, which limits access to their own statistics only. An admin must promote users to higher roles.
- **Legacy bearer token** — for backward compatibility, the console still accepts the `management_api.auth_token` as a bearer token on the login page. This is useful for automated tooling or migration from pre-v2.8.0 setups.
- **Change password** — authenticated users can change their own password via the sidebar user menu, which calls `PUT /api/auth/password`

All `/console/*` routes are protected — unauthenticated users are redirected to `/login`.

## First-Run Setup

When no admin user exists, the console redirects to a setup wizard at `/setup`. This WordPress-style setup page:

1. Checks setup status via `GET /api/setup/status`
2. Presents a form to create the initial admin user (username + password)
3. Submits via `POST /api/setup/init` (no authentication required)
4. Auto-logs in with the returned JWT token and redirects to the dashboard

Once an admin user exists, the `/setup` page shows a "Setup complete" message and links to the login page.

:::note
Self-registration (`POST /api/auth/register`) is blocked until an admin user has been created through the setup wizard. This ensures the first user always has admin privileges.
:::

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
- **Sparkline charts** — mini inline sparkline charts on each metric card showing 5-minute trend
- **Server health score** — circular ring gauge (0-100) based on CPU, memory, cert expiry, error rate, and connection load
- **Traffic chart** — real-time bytes/sec with time-range selector (Live/1H/6H/24H/7D) and Mbps toggle. Live mode shows the last 60 seconds of data.
- **Transport pie chart** — connections grouped by transport type
- **Connection histogram** — connection duration distribution
- **GeoIP pie chart** — country distribution of active connections. Requires `geoip_path` configured in the server's routing section; shows a placeholder when GeoIP is not configured.
- **Live connection map** — Cloudflare-style SVG world map with arc lines from the server marker to client locations by GeoIP, proportionally-sized dots, and real-time animation
- **Connection table** — active connections with peer IP (port stripped), transport type, mode, byte counters, and a disconnect button. Summary stats cards (active count, total upload, total download) are displayed above the table. Grouped-by-IP view is the default.

Data sources: WebSocket push (metrics every 1s) + REST polling (connections every 5s).

### ~~Bandwidth~~ (removed)

:::note
The Bandwidth page has been removed from the console navigation as of v2.5. Per-client bandwidth monitoring is now integrated into the Clients detail page, and the standalone page was redundant.
:::

### Speed Test

Run throughput tests through the proxy connection:
- **Test servers** — 4 servers: Cloudflare (25 MB), Cloudflare (100 MB), Hetzner, OVH
- **Test runner** — multi-stream download (4 parallel streams) and upload speed measurement
- **Live progress** — real-time download/upload Mbps display during the test with progress bar
- **Results** — download speed, upload speed, and latency displayed in cards after completion
- **Trend chart** — Recharts LineChart showing download/upload across all history entries (visible when 2+ tests recorded)
- **Extended stats** — Min, Max, and Median for both download and upload across all history entries
- **History** — persistent test history (up to 50 entries) stored in localStorage, shown as a list with timestamps and relative time
- Test can be started and stopped mid-run

### Server

Server information:
- **Health status** -- server status badge, version, and uptime with auto-refresh every 10 seconds
- **Configuration** -- listen address, QUIC listen address, protocol version, DNS upstream, max connections, timeout, logging level/format, routing rules count
- **Feature badges** -- port forwarding, camouflage, CDN, and port hopping status (ON/OFF)
- **TLS information** -- TLS enabled/disabled status, certificate and key file paths
- **Port forwards table** -- active port forwards with port, protocol, bind address, active connections, and traffic counters. Full CRUD support: create, edit, and delete port forwards directly from the console.

### System

System monitoring:
- **System cards** — version, platform, PID, CPU and memory usage gauges
- **Real-time resource chart** — dual-axis area chart (CPU % left axis, memory % right axis) with a 60-point rolling window updated every 2 s. Shows current CPU and memory values below the chart.
- **Certificate expiry** — countdown with color coding (green &gt;30d, yellow 7-30d, red &lt;7d)
- **Active listeners** — table of all listening addresses and protocols

### Connection Events

Real-time WebSocket feed of connect/disconnect events:
- **Virtualized event list** — high-performance scrolling for thousands of events
- **Type filter** — filter by event type: All, Connect, Disconnect, Error
- **Search** — full-text search across event details (peer address, transport, client name)
- **Auto-scroll** — automatically follows new events; pauses when the user scrolls up
- **Color-coded badges** — green for connect, red for disconnect, yellow for error events

Data source: WebSocket push (`/api/ws/connections`).

### Clients

Client management:
- **Client list** — shows all authorized clients with name, status (enabled/disabled), active connection count, total bytes (up + down), and clickable links to the detail page
- **Client tags and permissions** — tag clients with labels and filter by tags in the list. Manage per-client permissions (port forwarding, UDP, destinations, ports, max connections, bandwidth) from the detail page.
- **Client share dialog** — generate a ready-to-use client configuration in three formats: TOML config (with syntax highlighting), `prisma://` URI, or QR code. Accessible from the client list or detail page.
- **Client detail** — per-client bandwidth limits (editable), quota utilization bar, latency cards (p50/p95/p99), 1 h traffic history area chart (from `/api/metrics/clients/:id/history`), and a filtered connection table
- **Connection history** — per-client timeline view showing connection events and traffic spikes over 24h
- **Bulk import/export** — export all clients as JSON, import clients from file
- **Add client** — generates a new UUID + auth secret pair and displays the key once
- **Edit client** — update name, toggle enabled/disabled, configure bandwidth/quota limits
- **Delete client** — remove a client from the auth store

Changes take effect immediately — no server restart required.

### Routing

Visual routing rules editor with a two-tab layout:

#### Manual Rules tab
- **Rule list** — all rules sorted by priority, showing type, match value, action, and enabled status
- **Inline edit** — click any rule to edit it directly in the table. Changes are saved immediately via the management API.
- **Rule editor** — dialog form for creating/editing rules with fields: type, match, action, name, priority, enabled
- **Rule types** — DOMAIN, DOMAIN-SUFFIX, DOMAIN-KEYWORD, IP-CIDR, GEOIP, PORT-RANGE, and FINAL (match-all)
- **Rule actions** — PROXY (tunnel through server), DIRECT (bypass proxy), REJECT (block connection)
- **Rule testing** — input field to test which rule matches a given domain or IP
- **Batch deletion** — select multiple rules and delete in bulk
- **Toggle/delete** — enable, disable, or remove rules inline

#### Quick Templates tab
- **Template categories** — pre-built rule sets organized by purpose: Privacy (Block Ads, Block Trackers), Network (Block Torrent/P2P), Regional (Block Gambling, Block Social Media), and Catch-all (Allow All, Block All)
- **One-click apply** — apply a template to instantly add a curated set of rules
- **Template preview** — view the rules a template will add before applying

See [Routing Rules](/docs/features/routing-rules) for details on rule types.

### User Management

*(Admin only)* Manage console users and their roles:
- **User table** — CRUD table listing all users with username, role badge (Admin / Operator / Client), enabled/disabled status, and creation date
- **Role badges** — color-coded badges: red for Admin, blue for Operator, green for Client
- **Enable/disable toggle** — quickly enable or disable a user account without deleting it
- **Create user** — dialog form to create a new user with username, password, and role assignment
- **Edit user** — update a user's role or reset their password
- **Delete user** — remove a user account permanently

This page is only visible to users with the **Admin** role.

### ~~Logs~~ (removed)

:::note
The Logs page has been removed from the console navigation as of v2.5. Log streaming functionality was unreliable over WebSocket in production environments. Use `prisma logs` via the CLI for real-time log access.
:::

### Settings

Server configuration editor with tabbed sections:
- **General** — listen addresses (editable), DNS upstream, connection timeout, port forwarding (with port range, allowed/denied ports, IP whitelist), management API toggle, auto-backup interval
- **Camouflage & CDN** — ALPN, salamander password, H3 cover, CDN paths, XPorta config (session path, encoding, timeout, sessions, cookie)
- **Traffic & Performance** — traffic shaping, congestion, port hopping, DNS, anti-RTT settings
- **TLS & Security** — certificate info, transport-only cipher, protocol version, PrismaTLS status
- **Alerts** — configure alert thresholds (cert expiry, quota warning, handshake spike)
- **Config Version History** — timeline of config changes with diff viewer and one-click restore to any previous version
- **Config diff preview** — shows changed fields before saving with confirm/cancel
- **Config validation** — inline validation for ports, addresses, CIDR format
- **Config export/import** — download/upload entire server config as JSON

### Console Settings (v2.12.0+)

Admin-configurable settings that control console behavior:
- **Registration toggle** — enable or disable self-registration for new users
- **Default role** — set the default role assigned to self-registered users (Client / Operator)
- **Session expiry** — configure JWT session expiry duration in hours
- **Backup interval** — set automatic backup interval in minutes (0 = disabled)

These settings are stored in the SQLite database and take effect immediately.

### Subscription Management (v2.12.0+)

*(Admin only)* Manage subscription codes and invite links for client onboarding:
- **Redemption codes** — generate batch codes in `PRISMA-XXXX` format. Codes are single-use and grant the redeemer a new client credential.
- **Code table** — list all generated codes with status (unused / redeemed / expired), creation date, and redeemed-by info
- **Invite links** — create shareable invite URLs with configurable max uses and expiry. Recipients can register and receive client credentials in one step.
- **Invite table** — list all invite links with usage count, max uses, expiry, and a copy-to-clipboard action

### Redeem Code (v2.12.0+)

*(Client users)* Enter a redemption code to receive client credentials:
- **Code input** — enter a `PRISMA-XXXX` code to redeem
- **Result display** — on success, displays the new client ID, auth secret, and a ready-to-use config snippet
- **My Clients** — view all clients associated with the current user's account

### Config Backups

Config backup and restore:
- **Backup list** — timestamped backups with name, size, and actions
- **Create backup** — create a manual snapshot of the current config
- **Restore** — restore config from a previous backup (auto-backs up current before restoring)
- **Diff viewer** — side-by-side colored diff comparing backup vs current config
- **Delete** — remove old backups

### Traffic Shaping

Traffic shaping and anti-analysis visualization:
- **Configuration cards** -- padding mode, padding range (bytes), timing jitter (ms), chaff interval, coalescing window, congestion control mode, target bandwidth
- **Anti-RTT** -- round-trip time normalization status and normalization value
- **Bucket size distribution chart** -- bar chart (Recharts) showing padding bucket size distribution
- **Port hopping** -- status (enabled/disabled), base port, range, and interval

## Additional Features

- **Role-based access control** — three roles control what each user can see and do: **Admin** (full access to all pages and settings, including subscription management and console settings), **Operator** (monitoring only — can view dashboards and metrics but cannot modify configuration or manage users), **Client** (simplified dashboard showing only My Clients, Subscription/Redeem, and Speed Test pages). Navigation items and UI elements adapt automatically based on the logged-in user's role.
- **i18n** — full English and Simplified Chinese translations, switchable from the sidebar
- **Theme toggle** — dark, light, and system mode, switchable from the sidebar footer. Preference is persisted in localStorage and applied on page load.
- **Notification center** — persistent notification drawer with history, accessible from the sidebar bell icon
- **Toast notification system** — non-blocking toast notifications for operation feedback (success, error, warning, info). Toasts auto-dismiss after 5 seconds and stack vertically when multiple appear. Used for config save confirmations, client operations, rule changes, and API errors.
- **Global search** — Ctrl+K command palette searching pages, clients, and config keys
- **Command palette generators** — hex (32/64/128 digit), UUID v4, base64 key generators with clipboard support
- **Data export** — export tables as CSV/JSON and charts as PNG
- **Client permissions** — per-client access control (port forwarding, UDP, destinations, ports, connections, bandwidth) via detail page
- **Responsive sidebar** — collapsible sidebar (icon-only mode), mobile drawer
- **Mobile responsive** — bottom tab navigation on mobile browsers with 5 primary tabs + More sheet
- **Dashboard widget customization** — reorder and hide dashboard cards on the Overview page. Layout preferences are persisted in localStorage.
- **Multi-server management** — connect to multiple Prisma servers from a single console instance. A server selector in the sidebar allows switching between servers without re-authenticating.
- **OpenAPI specification** — auto-generated API documentation served at `/api/docs/openapi.json`. Can be imported into Swagger UI or other OpenAPI-compatible tools.
- **Prometheus metrics** — the Overview page includes a scrape URL card showing the Prometheus-compatible metrics endpoint for Grafana/Prometheus integration.
- **One-click GeoIP download** — download and auto-configure the GeoIP database from the server settings. The server downloads the database and updates the `geoip_path` configuration automatically.

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
