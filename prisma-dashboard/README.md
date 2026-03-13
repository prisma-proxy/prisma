# Prisma Dashboard

Real-time web dashboard for monitoring and managing the [Prisma](https://github.com/Yamimega/prisma) proxy server. Built as a static site and served directly by the Prisma server.

## Build

```bash
npm ci
npm run build
```

Static files are output to `out/`. Configure the server to serve them:

```toml
[management_api]
enabled = true
listen_addr = "127.0.0.1:9090"
auth_token = "your-secure-token-here"
dashboard_dir = "./prisma-dashboard/out"
```

Then access the dashboard at `http://127.0.0.1:9090/`. Log in using the `auth_token` from your server config.

## Development

```bash
npm install
npm run dev
# → http://localhost:3000
```

During development, the dashboard connects to the management API on the same origin. Start the Prisma server with the management API enabled and configure `cors_origins` if running the dev server on a different port.

## Pages

| Page | Description |
|------|-------------|
| **Overview** | Live metrics, traffic chart, active connections |
| **Server** | Health, config, TLS info |
| **Clients** | Add/remove/toggle clients at runtime |
| **Routing** | Visual routing rules editor |
| **Logs** | Real-time log stream with filtering |
| **Settings** | Server config editor |

## Tech Stack

- [Next.js 16](https://nextjs.org/) (App Router, static export)
- [shadcn/ui](https://ui.shadcn.com/) (component library)
- [Recharts](https://recharts.org/) (traffic charts)
- [TanStack Query](https://tanstack.com/query) (data fetching)
