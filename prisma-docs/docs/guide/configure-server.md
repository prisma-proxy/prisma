---
sidebar_position: 6
---

# Configuring the Server

In this chapter, you will create the server configuration file. We will explain every line, so you understand exactly what each setting does.

## Understanding TOML

Prisma uses **TOML** (Tom's Obvious Minimal Language) for its configuration files. TOML is a simple file format designed to be easy to read. Here is a quick introduction:

### Keys and values

A key-value pair assigns a value to a name:

```toml
# This is a comment (ignored by Prisma)
listen_addr = "0.0.0.0:8443"    # Text value (in quotes)
max_connections = 1024           # Number value (no quotes)
enabled = true                   # Boolean value (true or false)
```

### Sections

Sections group related settings together. They are written in square brackets:

```toml
[logging]                  # This starts the "logging" section
level = "info"             # This belongs to the "logging" section
format = "pretty"          # This also belongs to "logging"

[performance]              # This starts a new section
max_connections = 1024
```

### Arrays of sections

Sometimes you need multiple items of the same type. Double square brackets create an array:

```toml
[[authorized_clients]]     # First client
id = "client-1-uuid"
name = "laptop"

[[authorized_clients]]     # Second client
id = "client-2-uuid"
name = "phone"
```

That's all the TOML you need to know!

## Step 1: Generate Credentials

Before writing the config, you need to generate a **client ID** and **auth secret**. These are like a username and password that the client uses to prove its identity to the server.

```bash
prisma gen-key
```

Expected output:

```
Client ID:   a1b2c3d4-e5f6-7890-abcd-ef1234567890
Auth Secret: 4f8a2b1c9d3e7f6a0b5c8d2e1f4a7b3c9d0e6f2a8b4c1d7e3f9a5b0c6d2e8f
```

:::warning Save these values!
Copy and save both values somewhere safe. You will need them for both the server and client configuration. If you lose them, you can always generate new ones with `prisma gen-key`.
:::

## Step 2: Generate TLS Certificate

TLS certificates are required for QUIC transport and recommended for all deployments. For now, we will use a self-signed certificate (fine for personal use):

```bash
prisma gen-cert --output /etc/prisma --cn prisma-server
```

Expected output:

```
Certificate written to /etc/prisma/prisma-cert.pem
Private key written to /etc/prisma/prisma-key.pem
```

This creates two files:
- `prisma-cert.pem` -- The certificate (public, can be shared)
- `prisma-key.pem` -- The private key (keep this secret!)

:::info Self-signed vs. Let's Encrypt
A **self-signed certificate** is fine for personal use and testing. For production use (especially with CDN transports), you should use a certificate from **Let's Encrypt** (it's free). We will cover this in [Going Further](./advanced-setup.md).
:::

## Step 3: Write the Server Config

Now let's create the configuration file. Open your text editor:

```bash
sudo nano /etc/prisma/server.toml
```

Paste the following configuration. **Every line has a comment explaining what it does:**

```toml title="server.toml"
# ============================================================
# Prisma Server Configuration
# ============================================================

# The address and port the server listens on for TCP connections.
# "0.0.0.0" means "listen on all network interfaces" (accept
# connections from anywhere). ":8443" is the port number.
listen_addr = "0.0.0.0:8443"

# The address and port for QUIC (UDP) connections.
# Usually the same as listen_addr.
quic_listen_addr = "0.0.0.0:8443"

# ── TLS Certificate ──────────────────────────────────────────
# TLS (Transport Layer Security) encrypts the connection.
# These files were created by "prisma gen-cert" in the previous step.
[tls]
cert_path = "/etc/prisma/prisma-cert.pem"   # Path to the certificate file
key_path = "/etc/prisma/prisma-key.pem"     # Path to the private key file

# ── Authorized Clients ───────────────────────────────────────
# Each client that connects must be listed here.
# The id and auth_secret come from "prisma gen-key".
# You can add multiple [[authorized_clients]] sections for
# multiple clients (e.g., laptop, phone, tablet).
[[authorized_clients]]
id = "PASTE-YOUR-CLIENT-ID-HERE"              # The Client ID from gen-key
auth_secret = "PASTE-YOUR-AUTH-SECRET-HERE"    # The Auth Secret from gen-key
name = "my-first-client"                       # A friendly name (for your reference)

# ── Logging ───────────────────────────────────────────────────
# Controls what messages Prisma prints to the console.
[logging]
level = "info"      # How much detail: trace > debug > info > warn > error
                     # "info" is good for normal use. Use "debug" for troubleshooting.
format = "pretty"   # "pretty" for human-readable, "json" for machine-readable

# ── Performance ───────────────────────────────────────────────
[performance]
max_connections = 1024         # Maximum number of simultaneous connections
connection_timeout_secs = 300  # Close idle connections after 5 minutes (300 seconds)

# ── Padding ───────────────────────────────────────────────────
# Adds random extra bytes to each data frame to prevent traffic analysis
# based on packet sizes. Higher values = more privacy but more bandwidth.
[padding]
min = 0     # Minimum padding bytes per frame
max = 256   # Maximum padding bytes per frame
```

### Replace the placeholders

You **must** replace two values with the ones you generated in Step 1:

1. Replace `PASTE-YOUR-CLIENT-ID-HERE` with your Client ID
2. Replace `PASTE-YOUR-AUTH-SECRET-HERE` with your Auth Secret

For example, if your gen-key output was:

```
Client ID:   a1b2c3d4-e5f6-7890-abcd-ef1234567890
Auth Secret: 4f8a2b1c9d3e7f6a0b5c8d2e1f4a7b3c9d0e6f2a8b4c1d7e3f9a5b0c6d2e8f
```

Then the authorized_clients section should look like:

```toml
[[authorized_clients]]
id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
auth_secret = "4f8a2b1c9d3e7f6a0b5c8d2e1f4a7b3c9d0e6f2a8b4c1d7e3f9a5b0c6d2e8f"
name = "my-first-client"
```

Save the file (`Ctrl + O`, Enter, `Ctrl + X` in nano).

## Step 4: Validate the Config

Before running the server, let's make sure the config file has no errors:

```bash
prisma validate -c /etc/prisma/server.toml
```

If everything is correct, you will see:

```
Configuration is valid.
```

If there is an error, the message will tell you exactly what is wrong. Common errors:

| Error Message | What It Means | How to Fix |
|--------------|---------------|------------|
| `authorized_clients must not be empty` | You forgot to add client credentials | Add an `[[authorized_clients]]` section |
| `invalid hex in auth_secret` | The auth_secret is not valid hexadecimal | Copy it exactly from `prisma gen-key` output |
| `cert_path: file not found` | TLS certificate file doesn't exist | Run `prisma gen-cert` again or check the path |

## Step 5: Test Run

Let's start the server to make sure everything works:

```bash
prisma server -c /etc/prisma/server.toml
```

You should see output like:

```
INFO  prisma_server > Prisma server v0.9.0 starting...
INFO  prisma_server > Listening on 0.0.0.0:8443 (TCP)
INFO  prisma_server > Listening on 0.0.0.0:8443 (QUIC)
INFO  prisma_server > Authorized clients: 1
INFO  prisma_server > Server ready!
```

Press `Ctrl + C` to stop the server for now. We will set it up as a system service later.

:::tip If you see errors
If the server fails to start, check:
1. Are the certificate files in the right path?
2. Did you replace the placeholder values?
3. Is port 8443 already in use? (check with `sudo ss -tlnp | grep 8443`)
4. Run `prisma validate -c /etc/prisma/server.toml` to check for config errors
:::

## Adding Multiple Clients

If you want to connect from multiple devices, generate a new key for each one:

```bash
prisma gen-key    # Run this again for each device
```

Then add another `[[authorized_clients]]` section to your config:

```toml
[[authorized_clients]]
id = "first-client-uuid"
auth_secret = "first-client-secret"
name = "laptop"

[[authorized_clients]]
id = "second-client-uuid"
auth_secret = "second-client-secret"
name = "phone"
```

## Common Mistakes

Here are the most frequent mistakes beginners make, and how to avoid them:

### 1. Copying the placeholder text literally

**Wrong:**
```toml
id = "PASTE-YOUR-CLIENT-ID-HERE"
```

**Right:**
```toml
id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
```

### 2. Mismatched credentials

The `id` and `auth_secret` in the server config **must exactly match** the values in the client config. If even one character is different, the connection will fail.

### 3. Wrong file paths

Make sure the `cert_path` and `key_path` point to files that actually exist. You can verify with:

```bash
ls -la /etc/prisma/prisma-cert.pem /etc/prisma/prisma-key.pem
```

### 4. Forgetting to open firewall ports

Prisma won't receive connections if the firewall blocks port 8443. See the [previous chapter](./install-server.md#opening-firewall-ports) for firewall instructions.

## Advanced Server Options (v0.9.0)

These features are optional but powerful. You can add any of the following sections to your `server.toml` as needed.

### ShadowTLS v3 Transport

ShadowTLS mimics a real TLS handshake to a cover server. To enable ShadowTLS on the server:

```toml
[shadow_tls]
enabled = true
listen_addr = "0.0.0.0:8444"        # Separate port for ShadowTLS
cover_server = "www.google.com:443"  # Cover server to mimic
password = "your-shadow-tls-password" # Shared password with client
```

### SSH Transport

The SSH transport tunnels Prisma traffic through standard SSH connections:

```toml
[ssh_transport]
enabled = true
listen_addr = "0.0.0.0:22222"        # SSH transport port
host_key_path = "/etc/prisma/ssh_host_key"  # SSH host key
fake_shell = true                     # Show fake shell to interactive probers
```

Generate an SSH host key if you don't have one:

```bash
ssh-keygen -t ed25519 -f /etc/prisma/ssh_host_key -N ""
```

### WireGuard Transport

WireGuard provides kernel-level forwarding performance:

```toml
[wireguard_transport]
enabled = true
listen_addr = "0.0.0.0:51820"        # WireGuard UDP port
private_key = "YOUR-WG-PRIVATE-KEY"  # WireGuard private key
```

### Per-Client Access Control Lists (ACLs)

ACLs let you restrict which destinations each client can access:

```toml
[[authorized_clients]]
id = "client-uuid"
auth_secret = "client-secret"
name = "restricted-user"

# ACL rules for this client
[[authorized_clients.acl]]
type = "domain-suffix"
value = "example.com"
policy = "allow"

[[authorized_clients.acl]]
type = "all"
policy = "deny"       # Block everything not explicitly allowed
```

### Port Forwarding (Server-Side)

Allow clients to register port forwards on the server:

```toml
[port_forwarding]
enabled = true
allowed_ports = [3000, 8080, 8443]   # Ports clients can forward
max_forwards_per_client = 5           # Limit per client
```

### Config File Watching (Hot Reload)

Automatically reload the configuration when the file changes:

```toml
config_watch = true    # Watch server.toml for changes and auto-reload
```

You can also trigger a manual reload by sending SIGHUP to the process or via the management API:

```bash
# Manual reload via signal
kill -HUP $(pidof prisma)

# Manual reload via API
curl -X POST http://127.0.0.1:9090/api/reload -H "Authorization: Bearer YOUR-TOKEN"
```

### Session Ticket Key Rotation

Control how often session ticket keys are rotated for forward secrecy:

```toml
ticket_rotation_hours = 6    # Rotate keys every 6 hours (default)
```

Lower values improve forward secrecy but increase handshake overhead for returning clients.

## TLS with Let's Encrypt (Production)

For production deployments, use a free certificate from Let's Encrypt instead of a self-signed one. This requires a domain name pointing to your server.

### Step 1: Point your domain to your server

In your domain registrar's DNS settings, add an **A record**:
- **Name:** `proxy` (or whatever subdomain you want)
- **Value:** Your server's IP address

### Step 2: Install certbot

```bash
sudo apt install certbot -y
```

### Step 3: Get a certificate

```bash
sudo certbot certonly --standalone -d proxy.yourdomain.com
```

### Step 4: Update your server.toml

```toml
[tls]
cert_path = "/etc/letsencrypt/live/proxy.yourdomain.com/fullchain.pem"
key_path = "/etc/letsencrypt/live/proxy.yourdomain.com/privkey.pem"
```

:::info
Let's Encrypt certificates expire every 90 days. Certbot automatically renews them with a systemd timer. You can verify with: `sudo systemctl list-timers | grep certbot`
:::

## What you learned

In this chapter, you learned:

- The basics of **TOML** config format (keys, values, sections)
- How to **generate credentials** with `prisma gen-key`
- How to **generate TLS certificates** with `prisma gen-cert`
- How to write a **complete server configuration** with every line explained
- How to **validate** and **test** your configuration
- How to add **multiple clients**
- Advanced v0.9.0 options: **ShadowTLS v3**, **SSH**, **WireGuard** transports, **ACLs**, **port forwarding**, **config_watch**, and **ticket rotation**
- How to use **Let's Encrypt** for production TLS certificates

## Next step

The server is configured! Now let's set up the client on your computer. Head to [Installing the Client](./install-client.md).
