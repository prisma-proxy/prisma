---
title: prisma-cli Reference
---

# prisma-cli Reference

`prisma-cli` is the CLI binary crate, built with clap 4. It provides commands for running the server and client, managing the server via the management API, generating keys and certificates, importing server configs, and running diagnostics.

**Binary name:** `prisma`

---

## Global Flags

| Flag | Env Var | Default | Description |
|------|---------|---------|-------------|
| `--json` | -- | `false` | Output raw JSON |
| `-v, --verbose` | -- | `false` | Enable debug output |
| `--mgmt-url <URL>` | `PRISMA_MGMT_URL` | auto-detect | Management API URL |
| `--mgmt-token <TOKEN>` | `PRISMA_MGMT_TOKEN` | auto-detect | Management API auth token |

---

## Commands

### `prisma server` -- Start proxy server

| Flag | Default | Description |
|------|---------|-------------|
| `-c, --config` | `server.toml` | Config file path |
| `-d, --daemon` | `false` | Run as background daemon |
| `--pid-file` | `/tmp/prisma-server.pid` | PID file path |
| `--log-file` | `/var/log/prisma/prisma-server.log` | Log file (daemon) |

Subcommands: `stop`, `status`

### `prisma client` -- Start proxy client

Same flags as server. Config default: `client.toml`.

### `prisma console` -- Web management console

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | `9091` | Console port |
| `--bind` | `0.0.0.0` | Bind address |
| `--no-open` | `false` | Skip auto-open browser |
| `--update` | `false` | Force re-download assets |
| `--dir` | -- | Serve from local directory |

### `prisma gen-key` -- Generate client credentials

Generates UUID client_id + 32-byte auth_secret. Shows server.toml and client.toml snippets.

### `prisma gen-cert` -- Generate self-signed TLS cert

| Flag | Default | Description |
|------|---------|-------------|
| `-o, --output` | `.` | Output directory |
| `--cn` | `prisma-server` | Common name |

### `prisma init` -- Generate annotated config files

| Flag | Description |
|------|-------------|
| `--cdn` | Include CDN section |
| `--server-only` | Server config only |
| `--client-only` | Client config only |
| `--force` | Overwrite existing |

### `prisma validate` -- Validate config file

```bash
prisma validate -c server.toml -t server
```

### `prisma import` -- Import proxy URIs

```bash
prisma import --uri 'prisma://...'
prisma import --file servers.txt
prisma import --url 'https://sub.example.com'
```

### `prisma clients` -- Manage authorized clients

`list`, `show <ID>`, `create [--name]`, `delete <ID>`, `enable <ID>`, `disable <ID>`

### `prisma connections` -- Manage active connections

`list`, `disconnect <ID>`, `watch [--interval SECS]`

### `prisma metrics` -- View server metrics

`--watch`, `--history [--period 1h|6h|24h|7d]`, `--system`

### `prisma bandwidth` -- Manage bandwidth

`summary`, `get <ID>`, `set <ID> [--upload BPS] [--download BPS]`, `quota <ID> [--limit BYTES]`

### `prisma config` -- Manage server config

`get`, `set <KEY> <VALUE>`, `tls`, `backup create|list|restore|diff|delete`

### `prisma routes` -- Manage routing rules

`list`, `create --name --condition --action [--priority]`, `update`, `delete`, `setup <PRESET> [--clear]`

Conditions: `DomainMatch:*.ads.*`, `IpCidr:10.0.0.0/8`, `PortRange:80-443`, `All`

Presets: `block-ads`, `privacy`, `allow-all`, `block-all`

### `prisma logs` -- Stream live server logs

```bash
prisma logs [--level INFO] [--lines 100]
```

### `prisma ping` -- Ping server

```bash
prisma ping [-c client.toml] [--count 5] [--interval 1000]
```

### `prisma diagnose` -- Run connectivity diagnostics

### `prisma speed-test` -- Run speed test

```bash
prisma speed-test -s host:port [-d 10] [--direction both]
```

### `prisma subscription` -- Manage subscriptions

`add --url --name`, `update --url`, `list --url`, `test --url`

### `prisma latency-test` -- Test server latency

```bash
prisma latency-test --url 'https://sub.example.com'
prisma latency-test --servers 'addr1,addr2'
```

### `prisma version` -- Show version info

### `prisma completions` -- Shell completions

`bash`, `zsh`, `fish`, `powershell`, `elvish`

---

## Daemon Management

All services support: start (`-d`), stop (`stop`), status (`status`).

## API Client Auto-Detection

Resolution order: flags, env vars, server.toml parsing, fallback to `http://127.0.0.1:9090`.
