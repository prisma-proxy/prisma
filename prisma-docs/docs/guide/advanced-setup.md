---
sidebar_position: 10
---

# Going Further

Congratulations! You have a working Prisma setup. This chapter covers how to make it more robust, faster, and feature-rich. Each section is independent -- you can pick and choose what you need.

## Running Prisma as a System Service

Right now, Prisma stops when you close the terminal. Let's make it run automatically in the background, even after server reboots.

### Create a systemd service file

```bash
sudo nano /etc/systemd/system/prisma-server.service
```

Paste the following:

```ini title="prisma-server.service"
[Unit]
# Description shown in "systemctl status"
Description=Prisma Proxy Server
# Start after the network is ready
After=network-online.target
Wants=network-online.target

[Service]
# Run the prisma server command
ExecStart=/usr/local/bin/prisma server -c /etc/prisma/server.toml
# Restart automatically if it crashes
Restart=on-failure
# Wait 5 seconds before restarting
RestartSec=5
# Run as root (needed for privileged ports)
User=root
# Limit the number of open files (increase for many connections)
LimitNOFILE=65536

[Install]
# Start at boot
WantedBy=multi-user.target
```

### Enable and start the service

```bash
# Reload systemd to pick up the new service file
sudo systemctl daemon-reload

# Start Prisma now
sudo systemctl start prisma-server

# Enable auto-start on boot
sudo systemctl enable prisma-server

# Check that it's running
sudo systemctl status prisma-server
```

Expected output:

```
● prisma-server.service - Prisma Proxy Server
     Loaded: loaded (/etc/systemd/system/prisma-server.service; enabled)
     Active: active (running) since ...
```

### Useful service commands

```bash
sudo systemctl stop prisma-server      # Stop the server
sudo systemctl restart prisma-server   # Restart (e.g., after config changes)
sudo systemctl status prisma-server    # Check status
sudo journalctl -u prisma-server -f   # View live logs
```

## Routing Rules (Split Tunneling)

By default, ALL your traffic goes through the proxy. Routing rules let you choose which traffic goes through the proxy and which connects directly.

> **Analogy:** Think of routing rules like a mail sorter. Some letters go through the secure tunnel, while local letters are delivered directly.

### Example: Bypass local/private networks

Add this to your `client.toml`:

```toml
# ── Routing Rules ─────────────────────────────────────────────
# Rules are evaluated in order. The first matching rule wins.

# Private/local IP addresses connect directly (no proxy needed)
[[routing.rules]]
type = "ip-cidr"              # Match by IP address range
value = "10.0.0.0/8"          # Private network range
action = "direct"             # Connect directly (skip proxy)

[[routing.rules]]
type = "ip-cidr"
value = "172.16.0.0/12"       # Another private range
action = "direct"

[[routing.rules]]
type = "ip-cidr"
value = "192.168.0.0/16"      # Home network range
action = "direct"

# Everything else goes through the proxy
[[routing.rules]]
type = "all"                  # Match everything
action = "proxy"              # Send through the proxy
```

### Example: GeoIP-based routing

If you have a GeoIP database, you can route traffic based on the destination country:

```toml
[routing]
geoip_path = "/etc/prisma/geoip.dat"    # Download from v2fly/geoip releases

# Local traffic goes direct
[[routing.rules]]
type = "geoip"
value = "private"
action = "direct"

# Traffic to specific countries goes direct
[[routing.rules]]
type = "geoip"
value = "cn"            # Country code
action = "direct"       # Direct connection for domestic traffic

# Proxy everything else
[[routing.rules]]
type = "all"
action = "proxy"
```

### Example: Domain-based rules

```toml
# Block ads
[[routing.rules]]
type = "domain-keyword"
value = "ads"
action = "block"              # Block entirely (no connection)

# Specific domains go direct
[[routing.rules]]
type = "domain-suffix"
value = "example.com"
action = "direct"

# Everything else through proxy
[[routing.rules]]
type = "all"
action = "proxy"
```

## Using Prisma with Cloudflare CDN

For extra security, you can hide your server's IP behind Cloudflare. This way, even if someone discovers you are using Prisma, they cannot find and block your server directly.

### How it works

```mermaid
graph LR
    A["Your Computer"] -->|"HTTPS"| B["Cloudflare CDN"]
    B -->|"HTTPS"| C["Your Server"]
    C -->|"Normal"| D["Websites"]

    style B fill:#f59e0b,color:#000
```

Cloudflare sits between your client and server. Observers see traffic going to Cloudflare (which millions of websites use), not to your specific server.

### Setup overview

1. **Get a domain name** (you can find inexpensive domains)
2. **Add it to Cloudflare** (free plan works)
3. **Point the domain to your server** (A record in Cloudflare DNS)
4. **Enable Cloudflare proxy** (orange cloud icon)
5. **Get an Origin Certificate** from Cloudflare dashboard
6. **Configure the server** with CDN transport enabled
7. **Configure the client** to connect via WebSocket or XPorta

For detailed CDN configuration examples, see the [Configuration Examples](/docs/deployment/config-examples) page.

## Speed Optimization

### Choose the right transport

| Priority | Transport | Why |
|----------|-----------|-----|
| Speed | QUIC | Multiplexed streams, 0-RTT resumption |
| Compatibility | TCP | Works everywhere, good fallback |
| Stealth + Speed | XHTTP stream-one | No WebSocket overhead |
| Maximum stealth | XPorta | Highest stealth but more overhead |

### Choose the right cipher

| CPU Type | Recommended Cipher | Why |
|----------|-------------------|-----|
| Desktop (Intel/AMD) | `aes-256-gcm` | Hardware AES acceleration |
| Mobile/ARM | `chacha20-poly1305` | Faster without AES hardware |
| Not sure | `chacha20-poly1305` | Good performance everywhere |

### XMUX Connection Pooling

XMUX multiplexes multiple proxy streams over a single transport connection, reducing handshake overhead -- especially useful for CDN transports:

```toml
# Client config
mux_enabled = true              # Enable XMUX multiplexing
mux_max_streams = 128           # Max concurrent streams per connection
mux_max_connections = 4         # Number of pooled transport connections
```

### io_uring (Linux)

On Linux kernels 5.11+, Prisma automatically uses io_uring for zero-copy I/O when available. This provides significant throughput improvements for high-bandwidth scenarios. No configuration is needed -- it is enabled automatically when the kernel supports it.

To verify io_uring is active, check the server logs at debug level:

```bash
prisma server -c /etc/prisma/server.toml  # Look for: "io_uring: enabled"
```

### Server-side optimization

```toml
[performance]
max_connections = 2048          # Increase if you have many clients
connection_timeout_secs = 600   # Longer timeout for stable connections

[congestion]
mode = "bbr"    # BBR congestion control (best for most networks)
```

## Proxy Groups

Proxy groups let you use multiple servers with automatic selection strategies. Add these to your `client.toml`:

```toml
# Auto-select the lowest-latency server
[[proxy_groups]]
name = "auto-best"
type = "auto-url"
servers = ["tokyo-1", "singapore-1", "us-west-1"]
test_url = "https://www.google.com/generate_204"
test_interval_secs = 300

# Fallback chain
[[proxy_groups]]
name = "fallback"
type = "fallback"
servers = ["tokyo-1", "singapore-1"]

# Load balance (round-robin)
[[proxy_groups]]
name = "balanced"
type = "load-balance"
servers = ["tokyo-1", "singapore-1"]
strategy = "round-robin"
```

Use a proxy group in routing rules:

```toml
[[routing.rules]]
type = "domain-suffix"
value = "netflix.com"
action = "proxy"
proxy_group = "auto-best"       # Use the auto-select group
```

## Rule Providers

Rule providers let you load routing rules from remote URLs, keeping your config clean and rules up-to-date:

```toml
[[rule_providers]]
name = "ad-block"
type = "domain"
url = "https://example.com/rules/ad-domains.txt"
interval_hours = 24              # Refresh every 24 hours
action = "block"

[[rule_providers]]
name = "direct-domains"
type = "domain"
url = "https://example.com/rules/direct-domains.txt"
interval_hours = 24
action = "direct"
```

Rule providers are fetched on startup and refreshed at the configured interval.

## Per-Client ACLs (Server-Side)

Access Control Lists restrict which destinations each client can reach. Configure them in `server.toml`:

```toml
[[authorized_clients]]
id = "kid-device-uuid"
auth_secret = "kid-device-secret"
name = "kid-tablet"

[[authorized_clients.acl]]
type = "domain-suffix"
value = "educational-site.com"
policy = "allow"

[[authorized_clients.acl]]
type = "domain-keyword"
value = "learning"
policy = "allow"

[[authorized_clients.acl]]
type = "all"
policy = "deny"       # Block everything else
```

ACLs can also be managed dynamically via the management API:

```bash
# View ACLs for a client
curl http://127.0.0.1:9090/api/acls/CLIENT-UUID -H "Authorization: Bearer TOKEN"

# Set ACLs for a client
curl -X PUT http://127.0.0.1:9090/api/acls/CLIENT-UUID \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rules": [{"type": "domain-suffix", "value": "example.com", "policy": "allow"}, {"type": "all", "policy": "deny"}]}'
```

## Multiple Users / Clients

To share your server with family or friends, generate a separate key for each person:

```bash
prisma gen-key    # Run once per client
```

Add each client to the server config:

```toml
[[authorized_clients]]
id = "uuid-for-alice"
auth_secret = "secret-for-alice"
name = "alice-laptop"
bandwidth_down = "200mbps"      # Optional: limit download speed
quota = "100GB"                 # Optional: monthly data limit
quota_period = "monthly"

[[authorized_clients]]
id = "uuid-for-bob"
auth_secret = "secret-for-bob"
name = "bob-phone"
bandwidth_down = "100mbps"
quota = "50GB"
quota_period = "monthly"
```

Restart the server after adding clients:

```bash
sudo systemctl restart prisma-server
```

## Keeping Prisma Updated

### Using the install script

Run the same install command to update:

```bash
curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.sh | bash
```

Then restart:

```bash
sudo systemctl restart prisma-server
```

### Using Docker

```bash
docker pull ghcr.io/yamimega/prisma:latest
docker restart prisma-server
```

## Web Console

Prisma includes a web console for monitoring and management. To enable it:

### Server config

```toml
[management_api]
enabled = true                          # Turn on the management API
listen_addr = "127.0.0.1:9090"         # Listen on localhost only
auth_token = "your-secure-random-token" # Create a strong random token
console_dir = "/opt/prisma/console"     # Path to console files
```

### Download and install console files

```bash
# Download the latest console build from releases
curl -fsSL https://github.com/Yamimega/prisma/releases/latest/download/prisma-console.tar.gz \
  -o /tmp/console.tar.gz

# Extract to the console directory
sudo mkdir -p /opt/prisma/console
sudo tar -xzf /tmp/console.tar.gz -C /opt/prisma/console
```

### Access the console

Open your browser and go to `https://YOUR-SERVER-IP:9090` (or set up an SSH tunnel for security).

The console lets you:
- View real-time connection metrics
- Manage clients (add, remove, modify)
- View logs
- Monitor bandwidth usage
- Run speed tests

## Security Best Practices

1. **Use strong credentials** -- Always use `prisma gen-key` to generate credentials. Never make up your own.

2. **Use Let's Encrypt certificates** -- Self-signed certificates are fine for testing, but use Let's Encrypt for production.

3. **Keep Prisma updated** -- Updates include security fixes. Check for updates regularly.

4. **Limit management API access** -- Bind the management API to `127.0.0.1` and use SSH tunneling to access it remotely.

5. **Use unique credentials per client** -- Each device should have its own Client ID and Auth Secret. This way, you can revoke access for one device without affecting others.

6. **Enable bandwidth limits** -- If sharing with others, set per-client bandwidth and quota limits to prevent abuse.

7. **Monitor logs** -- Check server logs periodically for unauthorized access attempts:
   ```bash
   sudo journalctl -u prisma-server --since "1 hour ago"
   ```

## Where to Get Help

- **GitHub Issues:** https://github.com/Yamimega/prisma/issues -- Report bugs or ask questions
- **GitHub Discussions:** https://github.com/Yamimega/prisma/discussions -- Community help
- **Documentation:** You are here! Check the other sections of the docs for detailed configuration reference

## What you learned

In this chapter, you learned:

- How to run Prisma as a **system service** with systemd
- How to set up **routing rules** for split tunneling
- How to use Prisma with **Cloudflare CDN** for extra stealth
- How to use **XMUX connection pooling** for CDN transports
- How **io_uring** provides zero-copy I/O on Linux
- How to **optimize speed** with transport and cipher choices
- How to set up **proxy groups** for auto-selection, fallback, and load balancing
- How to use **rule providers** for remote routing rule lists
- How to configure **per-client ACLs** for access control
- How to add **multiple users** with bandwidth limits
- How to **update** Prisma
- How to set up the **web console** for monitoring
- **Security best practices** for production deployments

## Congratulations!

You have completed the Prisma Beginner's Guide! You now have the knowledge to:

1. Understand how internet privacy and proxies work
2. Set up and configure a Prisma server
3. Connect clients and verify the connection
4. Optimize and secure your setup

For more advanced topics, explore the rest of the documentation:

- [Server Configuration Reference](/docs/configuration/server) -- All server options
- [Client Configuration Reference](/docs/configuration/client) -- All client options
- [Configuration Examples](/docs/deployment/config-examples) -- Ready-to-use templates
- [PrismaVeil Protocol](/docs/security/prismaveil-protocol) -- Deep dive into the protocol
- [Management API](/docs/features/management-api) -- REST API reference
