---
sidebar_position: 9
---

# Troubleshooting

Common issues and their solutions for Prisma v2.26.0.

## Authentication Failed

**Symptom:** Client fails to connect with "Authentication failed" or `AcceptStatus::AuthFailed`.

**Causes:**
- `client_id` in `client.toml` does not match any entry in `server.toml`'s `authorized_clients`
- `auth_secret` does not match between client and server configs
- `auth_secret` is not valid hex (must be exactly 64 hex characters)
- Client is disabled on the server (check with `prisma clients list`)

**Solution:**

1. Re-run `prisma gen-key` to generate a fresh key pair
2. Copy the output to both `server.toml` and `client.toml`
3. Verify the values match exactly -- no extra whitespace or truncation
4. Check that the client is enabled: `prisma clients show <ID>`

## TLS Certificate Errors

**Symptom:** Connection fails with TLS-related errors such as `CertificateRequired`, `InvalidCertificate`, or `HandshakeFailure`.

**Causes:**
- Certificate or key file not found at the configured path
- Certificate expired or invalid
- Client connecting with `skip_cert_verify = false` to a self-signed certificate
- Mismatched certificate CN and server address

**Solution:**

- Verify file paths in `server.toml` are correct and files exist
- For self-signed certificates in development, set `skip_cert_verify = true` in `client.toml`
- For production, use a certificate from a trusted CA (Let's Encrypt recommended)
- Regenerate certificates: `prisma gen-cert -o . --cn prisma-server`
- Check certificate details: `openssl x509 -in prisma-cert.pem -noout -text`

## Console Not Accessible

**Symptom:** Cannot access the web console in the browser, or the console page does not load.

**Causes:**
- Console is bound to `0.0.0.0` but firewall blocks port 9091
- TLS mismatch: the management API uses HTTPS but the console tries HTTP (or vice versa)
- Token not provided or incorrect
- Console assets not downloaded yet

**Solution:**

1. Verify the console is running:
   ```bash
   prisma console status
   ```

2. Check the bind address and port:
   ```bash
   # Default binds to 0.0.0.0:9091 -- accessible from any interface
   prisma console --port 9091 --bind 0.0.0.0 --token your-token

   # For local-only access:
   prisma console --bind 127.0.0.1 --token your-token
   ```

3. Ensure the management API is reachable from the console server:
   ```bash
   curl -H "Authorization: Bearer your-token" http://127.0.0.1:9090/api/health
   ```

4. If behind a reverse proxy (nginx, Caddy), ensure WebSocket upgrade headers are passed through for real-time features.

5. Force re-download console assets if they are corrupted:
   ```bash
   prisma console --update --token your-token
   ```

## Port Forwarding Issues

**Symptom:** Client logs show `ForwardReady` with `success = false`, or port forwarding does not work.

**Causes:**
- Port forwarding not enabled on the server (`enabled = false` or missing)
- Requested `remote_port` is outside the server's allowed range
- The port is already in use on the server
- Firewall blocking the forwarded port on the server

**Solution:**

1. Verify the server has port forwarding enabled:

   ```toml
   [port_forwarding]
   enabled = true
   port_range_start = 10000
   port_range_end = 20000
   ```

2. Ensure the client's `remote_port` values fall within the server's range

3. Check that the port is not already bound by another process on the server:
   ```bash
   ss -tlnp | grep <port>
   ```

4. Verify firewall rules allow the forwarded port:
   ```bash
   # Linux (iptables)
   sudo iptables -L -n | grep <port>

   # Linux (ufw)
   sudo ufw status
   ```

## Connection Drops and Reconnection

**Symptom:** Connections are dropped after a period of inactivity or under certain network conditions.

**Causes:**
- `connection_timeout_secs` is too low for idle connections
- NAT timeout on intermediate routers (especially for UDP/QUIC)
- Network switching (Wi-Fi to mobile, etc.)
- Server-side `max_connections` limit reached

**Solution:**

1. Increase the timeout in `server.toml`:
   ```toml
   [performance]
   connection_timeout_secs = 600  # 10 minutes
   ```

2. For QUIC, enable port hopping to survive NAT rebinding:
   ```toml
   # client.toml
   [quic]
   port_hopping = true
   ```

3. Increase max connections if the server is hitting limits:
   ```toml
   [performance]
   max_connections = 4096
   ```

4. Check server metrics for connection pressure:
   ```bash
   prisma metrics --watch
   ```

## Config Reload Issues

**Symptom:** Changes to config files are not picked up, or `SIGHUP` has no effect.

**Causes:**
- `config_watch = true` is not set in `server.toml`
- The config file has syntax errors (TOML parse failure)
- The SIGHUP signal was sent to the wrong PID
- File watcher inotify limits reached on Linux

**Solution:**

1. Enable config file watching in `server.toml`:
   ```toml
   config_watch = true
   ```

2. Validate the config before expecting a reload:
   ```bash
   prisma validate -c server.toml
   ```

3. Send SIGHUP to the correct PID:
   ```bash
   # If running as daemon
   kill -HUP $(cat /tmp/prisma-server.pid)

   # Or check the PID
   prisma server status
   ```

4. On Linux, check inotify limits if the file watcher is not triggering:
   ```bash
   cat /proc/sys/fs/inotify/max_user_watches
   # Increase if needed:
   echo 65536 | sudo tee /proc/sys/fs/inotify/max_user_watches
   ```

5. Check server logs for reload events:
   ```bash
   prisma logs --level INFO | grep -i reload
   ```

## QUIC Connection Fails (UDP Blocked)

**Symptom:** Client cannot connect when `transport = "quic"`, but the server is reachable via TCP.

**Causes:**
- Firewall or network blocking UDP traffic on the server port
- Some networks (corporate, hotel) block UDP entirely
- Server `quic_listen_addr` not configured

**Solution:**

1. Switch to TCP transport in `client.toml`:
   ```toml
   transport = "tcp"
   ```

2. Or use a CDN-compatible transport that works over HTTPS:
   ```toml
   transport = "ws"    # WebSocket
   transport = "grpc"  # gRPC
   transport = "xhttp" # HTTP chunks
   transport = "xporta" # REST API simulation
   ```

3. Verify UDP is reachable:
   ```bash
   # From client machine
   nc -u -z server-ip 8443
   ```

4. Ensure the server firewall allows UDP:
   ```bash
   # Linux
   sudo ufw allow 8443/udp
   ```

## XPorta Session Issues

**Symptom:** XPorta transport fails to connect or drops frequently.

**Causes:**
- Server `[cdn.xporta]` not enabled or paths don't match client config
- Session expired (default 300s idle timeout)
- `data_paths` / `poll_paths` overlap between client and server configs
- CDN caching interfering with session data

**Solution:**

1. Verify server has XPorta enabled:
   ```toml
   [cdn.xporta]
   enabled = true
   session_path = "/api/auth"
   data_paths = ["/api/v1/data", "/api/v1/sync", "/api/v1/update"]
   poll_paths = ["/api/v1/notifications", "/api/v1/feed", "/api/v1/events"]
   ```

2. Ensure `session_path`, `data_paths`, and `poll_paths` match exactly between client and server

3. Check that `encoding` is compatible (server `"json"` or `"binary"`, client can use `"auto"`)

4. For Cloudflare deployments, verify `poll_timeout_secs` is under 100 (default 55)

5. Disable CDN caching for XPorta paths in your CDN configuration

## Common Error Messages

| Error message | Cause | Fix |
|--------------|-------|-----|
| `AcceptStatus::AuthFailed` | Client ID or auth secret mismatch | Re-run `prisma gen-key` and update both configs |
| `AcceptStatus::VersionMismatch` | Client and server protocol versions differ | Ensure both are v2.26.0 (PrismaVeil v5 only) |
| `AcceptStatus::ServerBusy` | Server `max_connections` limit reached | Increase `performance.max_connections` |
| `AcceptStatus::QuotaExceeded` | Client traffic quota exhausted | Increase quota via `prisma bandwidth quota <ID> --limit <BYTES>` |
| `Connection refused` | Server not running or wrong port | Check `prisma server status` and verify port |
| `Connection timed out` | Firewall blocking, server unreachable | Check firewall rules, try `prisma diagnose` |
| `Certificate verify failed` | Self-signed cert without `skip_cert_verify` | Set `skip_cert_verify = true` or use a valid CA cert |
| `Config file not found` | Config not in current directory or standard paths | Run `prisma init` or pass `--config <path>` |
| `Config validation failed` | Invalid TOML or failed validation rules | Run `prisma validate -c <path>` for details |
| `Address already in use` | Port already bound by another process | Change listen port or stop conflicting process |

## Daemon Mode Issues

**Symptom:** Daemon does not start, or `stop`/`status` commands don't work.

**Causes:**
- PID file from a previous run still exists (stale PID)
- Log directory does not exist
- Permission denied on PID or log file paths

**Solution:**

1. Check daemon status:
   ```bash
   prisma server status
   ```

2. If stale PID file exists, remove it:
   ```bash
   rm /tmp/prisma-server.pid
   ```

3. Ensure log directory exists:
   ```bash
   sudo mkdir -p /var/log/prisma
   sudo chown $(whoami) /var/log/prisma
   ```

4. Use custom PID and log paths if defaults are not writable:
   ```bash
   prisma server -d --pid-file ~/.prisma/server.pid --log-file ~/.prisma/server.log
   ```

## Graceful Shutdown Issues

**Symptom:** Active connections are dropped immediately on shutdown instead of draining.

**Causes:**
- Using `kill -9` (SIGKILL) instead of `kill` (SIGTERM) or `prisma server stop`
- The process is not the daemon child (PID mismatch)

**Solution:**

Always use `prisma server stop` or send SIGTERM:

```bash
# Preferred
prisma server stop

# Or manual SIGTERM
kill $(cat /tmp/prisma-server.pid)

# NEVER use SIGKILL for graceful shutdown
# kill -9 ... will NOT drain connections
```

## Debug Logging

Enable debug or trace logging to diagnose issues:

```toml
[logging]
level = "debug"   # or "trace" for maximum detail
format = "pretty"
```

Or override via environment variable without modifying the config file:

```bash
PRISMA_LOGGING_LEVEL=trace prisma server -c server.toml
```

Or use the `-v` (verbose) flag:

```bash
prisma server -v -c server.toml
```

Key things to look for in debug logs:

- **Handshake**: `PrismaVeil v5 handshake` step completion messages
- **Connection lifecycle**: establishment, relay start, teardown events
- **Port forwarding**: `RegisterForward`, `ForwardReady` results
- **Crypto**: encryption/decryption errors, nonce counter values
- **Config reload**: `Config reloaded` or `Config watch triggered` messages
- **Session tickets**: `Session ticket issued`, `Session resumed (0-RTT)` messages
- **Buffer pool**: `Buffer pool created`, allocation/recycle events

## Running Diagnostics

For a comprehensive connectivity check, use the built-in diagnostics:

```bash
prisma diagnose -c client.toml
```

This tests:
1. DNS resolution of the server address
2. TCP connectivity to the server port
3. TLS handshake
4. PrismaVeil v5 handshake and authentication
5. Transport-specific connectivity

For testing all transports:

```bash
prisma test-transport -c client.toml
```

## Getting Help

If the troubleshooting steps above do not resolve your issue:

1. Collect debug logs: `prisma server -v -c server.toml 2>&1 | tee prisma-debug.log`
2. Run diagnostics: `prisma diagnose -c client.toml`
3. Check the version: `prisma version`
4. Open an issue on [GitHub](https://github.com/prisma-proxy/prisma/issues) with the logs and diagnostic output
