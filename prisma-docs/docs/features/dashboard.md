---
sidebar_position: 5
---

# Dashboard

The Prisma dashboard is a real-time web interface for monitoring and managing the proxy server. It is built as a static site with Next.js 16, shadcn/ui, Recharts, and TanStack Query, and served directly by the Prisma server.

## Prerequisites

- A running Prisma server with the [Management API](/docs/features/management-api) enabled
- Dashboard static files (pre-built or built from source)

## Setup

### Using pre-built files

Download `prisma-dashboard.tar.gz` from the [latest release](https://github.com/Yamimega/prisma/releases/latest) and extract it:

```bash
mkdir -p /opt/prisma/dashboard
tar -xzf prisma-dashboard.tar.gz -C /opt/prisma/dashboard
```

### Building from source

```bash
cd prisma-dashboard
npm ci
npm run build
```

Static files are output to `prisma-dashboard/out/`.

### Server configuration

Point the server to the dashboard files in `server.toml`:

```toml
[management_api]
enabled = true
listen_addr = "127.0.0.1:9090"
auth_token = "your-secure-token-here"
dashboard_dir = "/opt/prisma/dashboard"  # or "./prisma-dashboard/out"
```

Start the server and access the dashboard at `http://127.0.0.1:9090/`.

## Authentication

The dashboard uses token-based authentication. Enter the `management_api.auth_token` from your server config on the login page. The token is stored in the browser's session storage and sent as a `Bearer` token with each API request.

All `/dashboard/*` routes are protected — unauthenticated users are redirected to `/login`.

## Architecture

The dashboard is built as a static single-page application (SPA) and served by the Prisma server's management API (axum). No separate Node.js process is needed in production.

```
Browser → prisma-server:9090 → static files (dashboard)
                              → /api/* (REST + WebSocket)
```

API calls from the dashboard go directly to the same-origin management API endpoints. WebSocket connections use a `?token=` query parameter for authentication (since the browser WebSocket API cannot send custom headers).

## Pages

### Overview

The main dashboard showing:
- **Metrics cards** — active connections, total bytes up/down, uptime
- **Traffic chart** — real-time bytes/sec upload and download over time (Recharts area chart)
- **Connection table** — active connections with peer address, transport type, mode, byte counters, and a disconnect button

Data sources: WebSocket push (metrics every 1s) + REST polling (connections every 5s).

### Server

Server information:
- Health status, version, and uptime
- Server configuration details (listen addresses, max connections, timeouts)
- TLS certificate info

### Clients

Client management:
- **Client list** — shows all authorized clients with name, status (enabled/disabled), and actions
- **Add client** — generates a new UUID + auth secret pair and displays the key once
- **Edit client** — update name, toggle enabled/disabled
- **Delete client** — remove a client from the auth store

Changes take effect immediately — no server restart required.

### Routing

Visual routing rules editor:
- **Rule list** — all rules sorted by priority, showing condition, action, and enabled status
- **Rule editor** — dialog form for creating new rules with condition type, value, and action
- **Toggle/delete** — enable, disable, or remove rules inline

See [Routing Rules](/docs/features/routing-rules) for details on rule types.

### Logs

Real-time log streaming:
- **Log viewer** — scrollable, monospace log output with colored level badges
- **Filters** — filter by log level (ERROR, WARN, INFO, DEBUG, TRACE) and target string
- **Auto-scroll** — automatically follows new log entries unless the user scrolls up
- **Clear** — clear the log buffer

Data source: WebSocket push (real-time log entries).

### Settings

Server configuration editor:
- **Editable fields** — logging level, logging format, max connections, port forwarding toggle
- **Read-only fields** — listen addresses (require server restart)
- **TLS info** — certificate status and file paths
- **Camouflage** — current camouflage configuration status (read-only)

## Development

For local development, you can run the Next.js dev server:

```bash
cd prisma-dashboard
npm install
npm run dev
# → http://localhost:3000
```

The dev server expects the Prisma management API running on the same origin or a CORS-enabled address. Configure `cors_origins` in your server config if using a different port:

```toml
[management_api]
cors_origins = ["http://localhost:3000"]
```
