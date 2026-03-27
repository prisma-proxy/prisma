---
sidebar_position: 6
---

# CLI Reference

The `prisma` binary (v2.26.0) provides subcommands for running the server and client (with daemon mode), generating credentials, managing configs, launching the console, managing subscriptions, testing latency, and controlling a live server via the management API.

## Global Flags

These flags apply to every subcommand:

| Flag | Env var | Description |
|------|---------|-------------|
| `--json` | -- | Output raw JSON instead of formatted tables |
| `--verbose`, `-v` | -- | Enable verbose (debug) output. Sets `RUST_LOG=debug` if not already set |
| `--mgmt-url <URL>` | `PRISMA_MGMT_URL` | Management API URL (overrides auto-detect from `server.toml`) |
| `--mgmt-token <TOKEN>` | `PRISMA_MGMT_TOKEN` | Management API auth token (overrides auto-detect) |

Examples:

```bash
# JSON output for scripting
prisma clients list --json

# Debug-level logging
prisma server -v -c server.toml

# Explicit management API connection
prisma status --mgmt-url https://my-server.com:9090 --mgmt-token my-token
```

---

## Server, Client, and Console (Daemon Mode)

The `server`, `client`, and `console` commands all support **daemon mode** via the `-d` flag and have `stop`/`status` subcommands for managing the background process.

### `prisma server`

Start the proxy server.

```bash
prisma server [-d] [-c <PATH>] [--pid-file <PATH>] [--log-file <PATH>]
prisma server stop [--pid-file <PATH>]
prisma server status [--pid-file <PATH>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-c, --config <PATH>` | `server.toml` | Path to the server configuration file |
| `-d, --daemon` | -- | Run as a background daemon process |
| `--pid-file <PATH>` | `/tmp/prisma-server.pid` | PID file path for daemon mode |
| `--log-file <PATH>` | `/var/log/prisma/prisma-server.log` | Log file path when daemonized |

| Subcommand | Description |
|------------|-------------|
| `stop` | Stop the running server daemon (sends SIGTERM) |
| `status` | Check if the server daemon is running |

The server starts both TCP and QUIC listeners and waits for client connections. It validates the configuration at startup and exits with an error if validation fails. If `config_watch = true` is set, the server automatically reloads on config file changes. The server also reloads on `SIGHUP`.

If the config file is not found in the current directory, the CLI automatically searches standard locations (`/etc/prisma/`, `~/.config/prisma/`).

**Examples:**

```bash
# Foreground mode
prisma server -c server.toml

# Daemon mode
prisma server -d -c /etc/prisma/server.toml

# Daemon with custom PID and log paths
prisma server -d -c server.toml --pid-file /run/prisma-server.pid --log-file /var/log/prisma/server.log

# Check if daemon is running
prisma server status

# Stop the daemon
prisma server stop

# Trigger hot-reload (when running in foreground)
kill -HUP $(cat /tmp/prisma-server.pid)
```

### `prisma client`

Start the proxy client.

```bash
prisma client [-d] [-c <PATH>] [--pid-file <PATH>] [--log-file <PATH>]
prisma client stop [--pid-file <PATH>]
prisma client status [--pid-file <PATH>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-c, --config <PATH>` | `client.toml` | Path to the client configuration file |
| `-d, --daemon` | -- | Run as a background daemon process |
| `--pid-file <PATH>` | `/tmp/prisma-client.pid` | PID file path for daemon mode |
| `--log-file <PATH>` | `/var/log/prisma/prisma-client.log` | Log file path when daemonized |

| Subcommand | Description |
|------------|-------------|
| `stop` | Stop the running client daemon |
| `status` | Check if the client daemon is running |

The client starts the SOCKS5 listener (and optionally the HTTP CONNECT listener and TUN device), connects to the remote server, performs the PrismaVeil v5 handshake, and begins proxying traffic.

**Examples:**

```bash
# Foreground mode
prisma client -c client.toml

# Daemon mode
prisma client -d -c client.toml

# Verbose foreground
prisma client -v -c client.toml

# Check status and stop
prisma client status
prisma client stop
```

### `prisma console`

Launch the web console with auto-download and reverse proxy.

```bash
prisma console [-d] [--mgmt-url <URL>] [--token <TOKEN>] [--port <PORT>] [--bind <ADDR>]
prisma console stop [--pid-file <PATH>]
prisma console status [--pid-file <PATH>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--mgmt-url <URL>` | auto-detect from `server.toml` | Management API URL to proxy requests to |
| `--token <TOKEN>` | auto-detect | Auth token for management API |
| `--port <PORT>` | `9091` | Port to serve the console on |
| `--bind <ADDR>` | `0.0.0.0` | Address to bind the console server to |
| `--no-open` | -- | Don't auto-open the browser |
| `--update` | -- | Force re-download of console assets |
| `--dir <PATH>` | -- | Serve console from a local directory instead of downloading |
| `-d, --daemon` | -- | Run as a background daemon process |
| `--pid-file <PATH>` | `/tmp/prisma-console.pid` | PID file path for daemon mode |
| `--log-file <PATH>` | `/var/log/prisma/prisma-console.log` | Log file path when daemonized |

| Subcommand | Description |
|------------|-------------|
| `stop` | Stop the running console daemon |
| `status` | Check if the console daemon is running |

On first run, downloads the latest console from GitHub Releases and caches it locally (`~/.cache/prisma/console/` on Linux, `~/Library/Caches/prisma/` on macOS, `%LOCALAPPDATA%\prisma\` on Windows). Starts a local server that serves the static console and reverse-proxies `/api/*` requests to the management API.

The token is auto-detected from: `--token` flag > `PRISMA_MGMT_TOKEN` env var > `server.toml` management section. The management URL is auto-detected from: `--mgmt-url` flag > `server.toml` management section > `http://127.0.0.1:9090`.

On desktop systems, the browser opens automatically. On headless/VPS (SSH sessions, no `$DISPLAY`), the URL is printed instead.

**Examples:**

```bash
# Basic usage (auto-detect token from server.toml)
prisma console

# Explicit token
prisma console --token your-secure-token

# Connect to remote server's management API
prisma console --mgmt-url https://my-server.com:9090 --token my-token

# Daemon mode
prisma console -d --token your-secure-token

# Custom port and bind address
prisma console --port 8888 --bind 127.0.0.1 --token my-token

# Force re-download latest console
prisma console --update --token your-secure-token

# Serve from local development build
prisma console --dir ./apps/prisma-console/out --token my-token
```

---

## Credential and Config Generation

### `prisma gen-key`

Generate a new client identity (UUID + auth secret pair).

```bash
prisma gen-key
```

No flags. Outputs a new UUID and 64-character hex secret, along with ready-to-paste TOML snippets for both server and client configs:

```
Client ID:   a1b2c3d4-e5f6-7890-abcd-ef1234567890
Auth Secret: 4f8a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a

# Add to server.toml:
[[authorized_clients]]
id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
auth_secret = "4f8a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a"
name = "my-client"

# Add to client.toml:
[identity]
client_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
auth_secret = "4f8a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a"
```

With `--json`:

```bash
prisma gen-key --json
```

```json
{
  "client_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "auth_secret": "4f8a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a"
}
```

### `prisma gen-cert`

Generate a self-signed TLS certificate for development use.

```bash
prisma gen-cert [-o <DIR>] [--cn <NAME>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-o, --output <DIR>` | `.` | Output directory for the certificate and key files |
| `--cn <NAME>` | `prisma-server` | Common Name for the certificate |

Generates two files in the output directory:

- `prisma-cert.pem` -- self-signed X.509 certificate
- `prisma-key.pem` -- private key in PEM format

**Examples:**

```bash
# Default (current directory, CN=prisma-server)
prisma gen-cert

# Custom output and CN
prisma gen-cert -o /etc/prisma --cn my-server.example.com
```

:::warning
Self-signed certificates are for development only. For production, use a certificate from a trusted CA or Let's Encrypt. When using self-signed certificates, clients must set `skip_cert_verify = true`.
:::

### `prisma init`

Generate annotated config files with auto-generated keys.

```bash
prisma init [--cdn] [--server-only] [--client-only] [--force]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--cdn` | -- | Include CDN transport section (WebSocket, gRPC, XHTTP, XPorta) pre-configured |
| `--server-only` | -- | Generate only server config |
| `--client-only` | -- | Generate only client config |
| `--force` | -- | Overwrite existing files |

By default, generates both `server.toml` and `client.toml` with fresh UUIDs, auth secrets, and comments explaining every option.

**Examples:**

```bash
# Generate both configs
prisma init

# Generate both configs with CDN section
prisma init --cdn

# Generate only the client config, overwriting if it exists
prisma init --client-only --force
```

### `prisma profile new`

Interactive profile generator wizard for creating client connection profiles.

```bash
prisma profile new [-o <PATH>] [--format <FORMAT>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-o, --output <PATH>` | stdout | Output file path |
| `--format <FORMAT>` | `toml` | Output format: `toml`, `uri`, or `json` |

Walks through a 5-step interactive flow:
1. **Server address** — hostname/IP and port
2. **Transport** — TCP, QUIC, WebSocket, gRPC, XHTTP, XPorta, PrismaTLS, or WireGuard
3. **Client ID** — existing UUID or generate a new one
4. **Auth secret** — paste existing secret or auto-generate
5. **Review** — preview the profile and confirm

**Examples:**

```bash
# Interactive wizard, output to stdout as TOML
prisma profile new

# Output as prisma:// URI to file
prisma profile new --format uri -o profile.txt

# Output as JSON
prisma profile new --format json -o profile.json
```

### `prisma validate`

Validate a config file without starting the server or client.

```bash
prisma validate -c <PATH> [-t <TYPE>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-c, --config <PATH>` | -- | Path to config file |
| `-t, --type <TYPE>` | `server` | Config type: `server` or `client` |

Parses the TOML file and runs both structural parsing and semantic validation rules:
- **Structural checks** — TOML syntax, required fields, correct types
- **Semantic checks** — port ranges (1-65535), auth secret length, TLS certificate file existence, address format
- **Security warnings** — weak auth secrets, missing TLS in production, overly permissive ACLs

Output uses colored formatting: green for pass, red for errors, yellow for warnings. Exits with code 0 if valid, or prints errors and exits with a non-zero code.

**Examples:**

```bash
prisma validate -c server.toml
prisma validate -c client.toml -t client
```

---

## Subscription

### `prisma subscription`

Manage server subscriptions with auto-update support.

```bash
prisma subscription <SUBCOMMAND>
```

| Subcommand | Description |
|------------|-------------|
| `add --url <URL> --name <NAME>` | Add a new subscription with a display name |
| `update --url <URL>` | Re-fetch and update servers from a subscription URL |
| `list --url <URL>` | List all servers from a subscription URL |
| `test --url <URL>` | Test latency to all servers from a subscription |

**Examples:**

```bash
# Add a subscription
prisma subscription add --url "https://provider.example.com/sub" --name "my-provider"

# Update (re-fetch) a subscription
prisma subscription update --url "https://provider.example.com/sub"

# List servers from a subscription
prisma subscription list --url "https://provider.example.com/sub"

# Test latency to all subscription servers
prisma subscription test --url "https://provider.example.com/sub"
```

### `prisma latency-test`

Test TCP connect latency to servers from a subscription URL or manual server list.

```bash
prisma latency-test [--url <URL>] [--servers <ADDRS>]
```

| Flag | Description |
|------|-------------|
| `--url <URL>` | Subscription URL to fetch servers from |
| `--servers <ADDRS>` | Comma-separated server addresses (`host:port`) |

At least one of `--url` or `--servers` must be provided. Results are sorted by latency, with the best server highlighted.

**Examples:**

```bash
# Test servers from a subscription
prisma latency-test --url "https://example.com/subscribe"

# Test specific servers
prisma latency-test --servers "1.2.3.4:8443,5.6.7.8:8443,server.example.com:8443"

# JSON output
prisma latency-test --json --servers "1.2.3.4:8443"
```

Output:

```
Testing latency to 3 servers...
+-------------------+------------------+---------+--------+
| Name              | Address          | Latency | Status |
+-------------------+------------------+---------+--------+
| 1.2.3.4:8443      | 1.2.3.4:8443     | 42ms    | OK     |
| 5.6.7.8:8443      | 5.6.7.8:8443     | 87ms    | OK     |
| server.example.com | server.example.com:8443 | 156ms | OK |
+-------------------+------------------+---------+--------+

Best: 1.2.3.4:8443 (1.2.3.4:8443) - 42ms
```

---

## Diagnostics and Testing

### `prisma version`

Display version information, protocol version, and supported features.

```bash
prisma version
```

No flags. Outputs the Prisma version, PrismaVeil protocol version, component versions, supported ciphers, supported transports, and feature lists. Use `--json` for machine-readable output.

**Examples:**

```bash
prisma version
prisma version --json
```

### `prisma status`

Query the management API for server status.

```bash
prisma status
```

No command-specific flags. Uses the global `--mgmt-url` and `--mgmt-token` flags (or the `PRISMA_MGMT_URL` / `PRISMA_MGMT_TOKEN` environment variables, or auto-detect from `server.toml`).

Connects to the management API and displays server health, uptime, version, and active connection count.

**Example:**

```bash
prisma status --mgmt-url https://127.0.0.1:9090 --mgmt-token your-auth-token
```

### `prisma ping`

Measure handshake RTT to the server.

```bash
prisma ping [-c <PATH>] [-s <HOST:PORT>] [--count <N>] [--interval <MS>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-c, --config <PATH>` | `client.toml` | Client config file (for auth credentials) |
| `-s, --server <HOST:PORT>` | -- | Override server address from config |
| `--count <N>` | `5` | Number of pings |
| `--interval <MS>` | `1000` | Interval between pings in milliseconds |

**Example:**

```bash
prisma ping -c client.toml --count 10 --interval 500
```

### `prisma speed-test`

Run a bandwidth measurement against the server.

```bash
prisma speed-test -s <HOST:PORT> [-d <SECS>] [--direction <DIR>] [-C <PATH>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-s, --server <HOST:PORT>` | -- | Server address |
| `-d, --duration <SECS>` | `10` | Test duration in seconds |
| `--direction <DIR>` | `both` | Direction: `download`, `upload`, or `both` |
| `-C, --config <PATH>` | `client.toml` | Client config file (for auth credentials) |

Uses the client config to authenticate and establish a tunnel, then measures throughput in the specified direction.

**Example:**

```bash
prisma speed-test -s my-server.example.com:8443 -d 15 --direction download
```

### `prisma test-transport`

Test all configured transports against the server and report which succeed.

```bash
prisma test-transport [-c <PATH>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-c, --config <PATH>` | `client.toml` | Client config file |

**Example:**

```bash
prisma test-transport -c client.toml
```

### `prisma diagnose`

Run connectivity diagnostics against the server. Tests DNS resolution, TCP connectivity, TLS handshake, and PrismaVeil handshake.

```bash
prisma diagnose [-c <PATH>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-c, --config <PATH>` | `client.toml` | Client config file |

**Example:**

```bash
prisma diagnose -c client.toml
```

### `prisma monitor`

Interactive TUI dashboard for real-time server monitoring, built with [ratatui](https://github.com/ratatui-org/ratatui).

```bash
prisma monitor [--interval <MS>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--interval <MS>` | `1000` | Refresh interval in milliseconds |

Connects to the management API and displays a full-screen terminal dashboard with:
- **Live metrics** — active connections, bytes up/down, uptime, CPU/memory
- **Scrollable connections table** — all active connections with destination, transport, speed, and data counters
- **Keyboard controls** — `q` quit, `Tab` cycle panels, arrow keys scroll, `d` disconnect selected

**Examples:**

```bash
prisma monitor
prisma monitor --interval 500
prisma monitor --mgmt-url https://my-server.com:9090 --mgmt-token my-token
```

### `prisma completions`

Generate shell completion scripts.

```bash
prisma completions <SHELL>
```

| Argument | Description |
|----------|-------------|
| `<SHELL>` | Shell to generate completions for: `bash`, `fish`, `zsh`, `elvish`, `powershell` |

**Examples:**

```bash
# Bash
prisma completions bash >> ~/.bash_completion

# Zsh
prisma completions zsh > ~/.zfunc/_prisma

# Fish
prisma completions fish > ~/.config/fish/completions/prisma.fish

# PowerShell
prisma completions powershell >> $PROFILE
```

---

## Management API Commands

The following commands communicate with a running server via the management API. The management API URL and token are resolved in this order:

1. `--mgmt-url` / `--mgmt-token` command-line flags
2. `PRISMA_MGMT_URL` / `PRISMA_MGMT_TOKEN` environment variables
3. Auto-detect from `server.toml` in the current directory or standard config locations

### `prisma clients`

Manage authorized clients.

```bash
prisma clients <SUBCOMMAND>
```

| Subcommand | Description |
|------------|-------------|
| `list` | List all authorized clients |
| `show <ID>` | Show details for a specific client |
| `create [--name NAME]` | Create a new client (auto-generates keys) |
| `delete <ID> [--yes]` | Delete a client (`--yes` skips confirmation) |
| `enable <ID>` | Enable a client |
| `disable <ID>` | Disable a client |
| `batch-create --count N --prefix <NAME>` | Create multiple clients at once with auto-numbered names |
| `export [-o <FILE>]` | Export all clients as JSON (default: stdout) |
| `import <FILE>` | Import clients from a JSON file |

**Examples:**

```bash
prisma clients list
prisma clients show a1b2c3d4-e5f6-7890-abcd-ef1234567890
prisma clients create --name "new-laptop"
prisma clients disable a1b2c3d4-e5f6-7890-abcd-ef1234567890
prisma clients delete a1b2c3d4-e5f6-7890-abcd-ef1234567890 --yes

# Batch create 10 clients with prefix "device-"
prisma clients batch-create --count 10 --prefix "device-"

# Export all clients
prisma clients export -o clients.json

# Import clients from file
prisma clients import clients.json
```

### `prisma connections`

Manage active connections.

```bash
prisma connections <SUBCOMMAND>
```

| Subcommand | Description |
|------------|-------------|
| `list` | List active connections |
| `disconnect <ID>` | Terminate a specific session |
| `watch [--interval N]` | Watch connections in real-time (default interval: 2s) |

**Examples:**

```bash
prisma connections list
prisma connections watch --interval 5
prisma connections disconnect session-id-here
```

### `prisma metrics`

View server metrics and system information.

```bash
prisma metrics [OPTIONS]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--watch` | -- | Auto-refresh metrics |
| `--history` | -- | Show historical metrics |
| `--period <PERIOD>` | `1h` | History period: `1h`, `6h`, `24h`, `7d` |
| `--interval <SECS>` | `2` | Refresh interval in seconds (for `--watch`) |
| `--system` | -- | Show system info instead of metrics |

**Examples:**

```bash
prisma metrics                          # Current snapshot
prisma metrics --watch                  # Live refresh every 2s
prisma metrics --watch --interval 5     # Live refresh every 5s
prisma metrics --history --period 24h   # Last 24 hours
prisma metrics --system                 # CPU, memory, uptime
prisma metrics --json                   # JSON output
```

### `prisma bandwidth`

Manage per-client bandwidth limits and quotas.

```bash
prisma bandwidth <SUBCOMMAND>
```

| Subcommand | Description |
|------------|-------------|
| `summary` | Show bandwidth summary for all clients |
| `get <ID>` | Show bandwidth and quota for a specific client |
| `set <ID> [--upload BPS] [--download BPS]` | Set upload/download limits in bits per second (0 = unlimited) |
| `quota <ID> [--limit BYTES]` | Get or set traffic quota in bytes |

**Examples:**

```bash
prisma bandwidth summary
prisma bandwidth get a1b2c3d4-e5f6-7890-abcd-ef1234567890
prisma bandwidth set a1b2c3d4-e5f6-7890-abcd-ef1234567890 --upload 10000000 --download 50000000
prisma bandwidth quota a1b2c3d4-e5f6-7890-abcd-ef1234567890 --limit 10737418240  # 10 GB
```

### `prisma config`

Manage server configuration via the management API.

```bash
prisma config <SUBCOMMAND>
```

| Subcommand | Description |
|------------|-------------|
| `get` | Show current server configuration |
| `set <KEY> <VALUE>` | Update a configuration value (dotted notation, e.g., `logging.level`) |
| `tls` | Show TLS configuration |
| `backup create` | Create a new configuration backup |
| `backup list` | List all backups |
| `backup restore <NAME>` | Restore a backup |
| `backup diff <NAME>` | Show diff between a backup and current config |
| `backup delete <NAME>` | Delete a backup |

**Examples:**

```bash
# View and modify config
prisma config get
prisma config set logging.level debug
prisma config tls

# Backup management
prisma config backup create
prisma config backup list
prisma config backup diff backup-2026-03-20
prisma config backup restore backup-2026-03-20
prisma config backup delete backup-2026-03-20
```

### `prisma routes`

Manage server-side routing rules.

```bash
prisma routes <SUBCOMMAND>
```

| Subcommand | Description |
|------------|-------------|
| `list` | List all routing rules |
| `create --name NAME --condition COND --action ACTION [--priority N]` | Create a routing rule |
| `update <ID> [--condition COND] [--action ACTION] [--priority N] [--name NAME]` | Update a routing rule |
| `delete <ID>` | Delete a routing rule |
| `setup <PRESET> [--clear]` | Apply a predefined rule preset |

Condition format: `TYPE:VALUE`, where TYPE is one of:

| Condition type | Example | Description |
|---------------|---------|-------------|
| `DomainMatch` | `DomainMatch:*.ads.*` | Wildcard domain match |
| `IpCidr` | `IpCidr:10.0.0.0/8` | IP CIDR range match |
| `PortRange` | `PortRange:80-443` | Port range match |
| `All` | `All` | Match everything |

Actions: `allow` or `block`.

#### `prisma routes setup`

Applies a named preset -- a curated set of rules created in one command.

```bash
prisma routes setup <PRESET> [--clear]
```

| Flag | Description |
|------|-------------|
| `--clear` | Delete all existing rules before applying the preset |

Available presets:

| Preset | Rules | Description |
|--------|-------|-------------|
| `block-ads` | 10 | Block common advertising and ad-network domains |
| `privacy` | 19 | Block ads + analytics/telemetry trackers |
| `allow-all` | 1 | Add a catch-all Allow rule (priority 1000) |
| `block-all` | 1 | Add a catch-all Block rule (priority 1000) |

**Examples:**

```bash
# List current rules
prisma routes list

# Create a rule
prisma routes create --name "block-ads" --condition "DomainMatch:*.doubleclick.net" --action block --priority 10

# Apply the privacy preset, clearing old rules
prisma routes setup privacy --clear

# Reset to allow-all
prisma routes setup allow-all --clear
```

### `prisma logs`

Stream live server logs via WebSocket.

```bash
prisma logs [--level <LEVEL>] [--lines <N>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--level <LEVEL>` | -- | Minimum log level: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `--lines <N>` | -- | Maximum number of log lines to display before stopping |

**Examples:**

```bash
prisma logs                     # Stream all logs
prisma logs --level WARN        # Only warnings and errors
prisma logs --lines 100         # Stop after 100 lines
prisma logs --level DEBUG --json  # JSON-formatted debug logs
```

---

## Self-Update

### `prisma update`

Check for and install updates from GitHub Releases.

```bash
prisma update [--check] [--yes]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--check` | -- | Only check for updates without downloading |
| `--yes` | -- | Skip confirmation prompt and install immediately |

Downloads the latest release from GitHub, verifies the binary, and replaces the running executable. Requires write permission to the binary's location.

**Examples:**

```bash
# Check for updates
prisma update --check

# Update with confirmation prompt
prisma update

# Auto-update without confirmation
prisma update --yes
```

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `prisma server [-d] [-c PATH]` | Start proxy server (foreground or daemon) |
| `prisma server stop` | Stop server daemon |
| `prisma server status` | Check server daemon status |
| `prisma client [-d] [-c PATH]` | Start proxy client (foreground or daemon) |
| `prisma client stop` | Stop client daemon |
| `prisma client status` | Check client daemon status |
| `prisma console [-d] [--port PORT] [--token TOKEN]` | Launch web console |
| `prisma console stop` | Stop console daemon |
| `prisma console status` | Check console daemon status |
| `prisma gen-key` | Generate client credentials |
| `prisma gen-cert` | Generate self-signed TLS certificate |
| `prisma init [--cdn]` | Generate annotated config files |
| `prisma validate -c PATH` | Validate a config file |
| `prisma subscription add/update/list/test` | Manage subscriptions |
| `prisma latency-test --url/--servers` | Test latency to servers |
| `prisma version` | Show version and features |
| `prisma status` | Query server status via management API |
| `prisma ping` | Measure handshake RTT |
| `prisma speed-test` | Bandwidth measurement |
| `prisma test-transport` | Test all transports |
| `prisma diagnose` | Run connectivity diagnostics |
| `prisma completions <SHELL>` | Generate shell completions |
| `prisma monitor` | Interactive TUI dashboard |
| `prisma profile new` | Interactive profile generator wizard |
| `prisma clients list/show/create/delete/enable/disable` | Manage authorized clients |
| `prisma clients batch-create/export/import` | Bulk client operations |
| `prisma connections list/disconnect/watch` | Manage active connections |
| `prisma metrics [--watch/--history/--system]` | View server metrics |
| `prisma bandwidth summary/get/set/quota` | Manage bandwidth limits |
| `prisma config get/set/tls/backup` | Manage server configuration |
| `prisma routes list/create/update/delete/setup` | Manage routing rules |
| `prisma logs [--level LEVEL]` | Stream live server logs |
| `prisma update [--check] [--yes]` | Check for and install updates |
