---
sidebar_position: 1
---

# Linux systemd Deployment

Deploy Prisma as a systemd service on Linux.

## Quick Deploy

Run these commands to set up Prisma as a system service:

```bash
# Install binary + create system user + set up directories
sudo useradd --system --no-create-home --shell /usr/sbin/nologin prisma
sudo mkdir -p /etc/prisma && sudo chown prisma:prisma /etc/prisma && sudo chmod 750 /etc/prisma
sudo cp prisma /usr/local/bin/prisma && sudo chmod 755 /usr/local/bin/prisma

# Copy config and TLS certs (adjust paths as needed)
sudo install -o prisma -g prisma -m 640 server.toml /etc/prisma/
sudo install -o prisma -g prisma -m 640 prisma-cert.pem prisma-key.pem /etc/prisma/
```

:::tip
Update `cert_path` and `key_path` in your config to `/etc/prisma/prisma-cert.pem` and `/etc/prisma/prisma-key.pem`.
:::

## Service Files

### Server

Create `/etc/systemd/system/prisma-server.service`:

```ini
[Unit]
Description=Prisma Proxy Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=prisma
Group=prisma
ExecStart=/usr/local/bin/prisma server -c /etc/prisma/server.toml
Restart=on-failure
RestartSec=5
LimitNOFILE=65535
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
NoNewPrivileges=true
ReadOnlyPaths=/etc/prisma
WorkingDirectory=/etc/prisma
StandardOutput=journal
StandardError=journal
SyslogIdentifier=prisma-server

[Install]
WantedBy=multi-user.target
```

### Client

Create `/etc/systemd/system/prisma-client.service`:

```ini
[Unit]
Description=Prisma Proxy Client
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=prisma
Group=prisma
ExecStart=/usr/local/bin/prisma client -c /etc/prisma/client.toml
Restart=on-failure
RestartSec=5
LimitNOFILE=65535
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
NoNewPrivileges=true
ReadOnlyPaths=/etc/prisma
WorkingDirectory=/etc/prisma
StandardOutput=journal
StandardError=journal
SyslogIdentifier=prisma-client

[Install]
WantedBy=multi-user.target
```

## Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now prisma-server   # enable + start in one command
sudo systemctl status prisma-server
```

For the client:

```bash
sudo systemctl enable --now prisma-client
```

## Logs

```bash
journalctl -u prisma-server -f              # follow live
journalctl -u prisma-server --since "1h ago" # recent logs
```

## Security Hardening

The service files include these systemd security directives:

| Directive | Effect |
|-----------|--------|
| `ProtectSystem=strict` | Filesystem read-only except allowed paths |
| `ProtectHome=true` | `/home`, `/root`, `/run/user` inaccessible |
| `PrivateTmp=true` | Private `/tmp` mount |
| `NoNewPrivileges=true` | Cannot gain new privileges |
| `ReadOnlyPaths=/etc/prisma` | Config files immutable at runtime |
| `LimitNOFILE=65535` | High file descriptor limit for many connections |

## Console (Optional)

```bash
sudo mkdir -p /opt/prisma/console
# From release:
sudo tar -xzf prisma-console.tar.gz -C /opt/prisma/console
# Or build from source:
cd apps/prisma-console && npm ci && npm run build && sudo cp -r out/ /opt/prisma/console/
```

Add to `server.toml`:

```toml
[management_api]
enabled = true
listen_addr = "127.0.0.1:9090"
auth_token = "your-secure-token"
console_dir = "/opt/prisma/console"
```

Update service file to allow console access:

```ini
ReadOnlyPaths=/etc/prisma /opt/prisma/console
```

## Directory Layout

```
/usr/local/bin/prisma              # Binary
/etc/prisma/server.toml            # Server config
/etc/prisma/client.toml            # Client config
/etc/prisma/*.pem                  # TLS certificates
/opt/prisma/console/               # Console (optional)
```
