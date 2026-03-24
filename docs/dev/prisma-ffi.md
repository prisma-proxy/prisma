---
title: prisma-ffi Reference
---

# prisma-ffi Reference

`prisma-ffi` is the C FFI shared library crate for Prisma GUI (Tauri/React) and mobile clients (Android/iOS). It exposes a safe C ABI surface for lifecycle management, connection control, profile management, QR code handling, system proxy, auto-update, per-app proxy, proxy groups, port forwarding, speed testing, and mobile lifecycle.

**Path:** `crates/prisma-ffi/src/`

---

## Error Codes

| Constant | Value | Description |
|----------|-------|-------------|
| `PRISMA_OK` | `0` | Success |
| `PRISMA_ERR_INVALID_CONFIG` | `1` | Invalid configuration or input |
| `PRISMA_ERR_ALREADY_CONNECTED` | `2` | Already connected |
| `PRISMA_ERR_NOT_CONNECTED` | `3` | Not connected |
| `PRISMA_ERR_PERMISSION_DENIED` | `4` | OS permission denied |
| `PRISMA_ERR_INTERNAL` | `5` | Internal error |
| `PRISMA_ERR_NULL_POINTER` | `6` | NULL pointer passed |

## Status Codes

| Constant | Value | Description |
|----------|-------|-------------|
| `PRISMA_STATUS_DISCONNECTED` | `0` | Not connected |
| `PRISMA_STATUS_CONNECTING` | `1` | Connecting |
| `PRISMA_STATUS_CONNECTED` | `2` | Connected |
| `PRISMA_STATUS_ERROR` | `3` | Error state |

## Proxy Mode Flags (Bitfield)

| Constant | Value | Description |
|----------|-------|-------------|
| `PRISMA_MODE_SOCKS5` | `0x01` | SOCKS5 proxy |
| `PRISMA_MODE_SYSTEM_PROXY` | `0x02` | Set OS system proxy |
| `PRISMA_MODE_TUN` | `0x04` | TUN transparent proxy |
| `PRISMA_MODE_PER_APP` | `0x08` | Per-app proxy |

---

## Exported Functions

### Lifecycle

| Function | Returns | Description |
|----------|---------|-------------|
| `prisma_create()` | `*mut PrismaClient` | Create handle. NULL on failure |
| `prisma_destroy(handle)` | void | Destroy handle. Safe for NULL |
| `prisma_version()` | `*const c_char` | Static version string. Do NOT free |
| `prisma_free_string(s)` | void | Free a prisma-returned string |

### Connection

| Function | Returns | Description |
|----------|---------|-------------|
| `prisma_connect(handle, config_json, modes)` | `c_int` | Connect with config and mode flags |
| `prisma_disconnect(handle)` | `c_int` | Disconnect current session |
| `prisma_get_status(handle)` | `c_int` | Get connection status |
| `prisma_get_stats_json(handle)` | `*mut c_char` | Stats JSON. Caller must free |
| `prisma_set_callback(handle, cb, userdata)` | void | Register event callback |

### Profiles

| Function | Returns | Description |
|----------|---------|-------------|
| `prisma_profiles_list_json()` | `*mut c_char` | List profiles. Caller must free |
| `prisma_profile_save(json)` | `c_int` | Save profile |
| `prisma_profile_delete(id)` | `c_int` | Delete profile |
| `prisma_import_subscription(url)` | `*mut c_char` | Import from URL. Caller must free |
| `prisma_refresh_subscriptions()` | `*mut c_char` | Refresh all. Caller must free |

### QR and Sharing

| Function | Returns | Description |
|----------|---------|-------------|
| `prisma_profile_to_qr_svg(json)` | `*mut c_char` | QR SVG. Caller must free |
| `prisma_profile_from_qr(data, out_json)` | `c_int` | Decode QR to profile |
| `prisma_profile_to_uri(json)` | `*mut c_char` | Generate prisma:// URI |
| `prisma_profile_config_to_toml(json)` | `*mut c_char` | Convert to TOML |

### System Proxy

| Function | Returns | Description |
|----------|---------|-------------|
| `prisma_set_system_proxy(host, port)` | `c_int` | Set OS system proxy |
| `prisma_clear_system_proxy()` | `c_int` | Clear system proxy |

### Auto-Update

| Function | Returns | Description |
|----------|---------|-------------|
| `prisma_check_update_json()` | `*mut c_char` | Check for updates |
| `prisma_apply_update(url, sha256)` | `c_int` | Download and apply |

### Ping and Speed Test

| Function | Returns | Description |
|----------|---------|-------------|
| `prisma_ping(addr)` | `*mut c_char` | TCP latency measurement |
| `prisma_speed_test(handle, server, secs, dir)` | `c_int` | Non-blocking speed test |

### Per-App Proxy

| Function | Returns | Description |
|----------|---------|-------------|
| `prisma_set_per_app_filter(json)` | `c_int` | Set filter |
| `prisma_get_per_app_filter()` | `*mut c_char` | Get current filter |
| `prisma_get_running_apps()` | `*mut c_char` | List running apps |

### Proxy Groups

| Function | Returns | Description |
|----------|---------|-------------|
| `prisma_proxy_groups_init(json)` | `c_int` | Initialize groups |
| `prisma_proxy_groups_list()` | `*mut c_char` | List groups |
| `prisma_proxy_group_select(group, server)` | `c_int` | Select server |
| `prisma_proxy_group_test(group)` | `*mut c_char` | Test latency |

### Port Forwarding

| Function | Returns | Description |
|----------|---------|-------------|
| `prisma_port_forwards_list(handle)` | `*mut c_char` | List forwards |
| `prisma_port_forward_add(handle, json)` | `c_int` | Add forward |
| `prisma_port_forward_remove(handle, port)` | `c_int` | Remove forward |

### Mobile Lifecycle

| Function | Returns | Description |
|----------|---------|-------------|
| `prisma_get_network_type(handle)` | `c_int` | Get cached network type |
| `prisma_on_network_change(handle, type)` | `c_int` | Notify network change |
| `prisma_on_memory_warning(handle)` | `c_int` | Release caches |
| `prisma_on_background(handle)` | `c_int` | App entered background |
| `prisma_on_foreground(handle)` | `c_int` | App returned to foreground |
| `prisma_get_traffic_stats(handle)` | `*mut c_char` | Compact traffic stats |

---

---

## New Modules (v2.0.0)

### Connection Manager

The `connection` module manages the lifecycle of a proxy connection for the FFI layer:

| Status Code | Value | Meaning |
|-------------|-------|---------|
| `STATUS_DISCONNECTED` | `0` | Not connected |
| `STATUS_CONNECTING` | `1` | Connection in progress |
| `STATUS_CONNECTED` | `2` | Connected and relaying |

**Key methods:**

- `begin_connect(socks5_addr)` -- transition to CONNECTING, reset counters, return a stop receiver
- `mark_connected()` -- transition to CONNECTED
- `disconnect()` -- send stop signal, transition to DISCONNECTED
- `add_bytes_up(n)` / `add_bytes_down(n)` -- thread-safe atomic byte counters
- `get_stats_json()` -- returns JSON with bytes, speed (delta since last call), and uptime

**Stats JSON format:**

```json
{
  "type": "stats",
  "bytes_up": 102400,
  "bytes_down": 204800,
  "speed_up_bps": 8192,
  "speed_down_bps": 16384,
  "uptime_secs": 60
}
```

Speed is computed as the byte delta since the last call, converted to bits/sec. Designed to be polled once per second by the stats poller.

### Stats Poller

The `stats_poller` module runs a background tokio task that polls the connection manager once per second and emits stats JSON via a C callback:

```rust
pub type StatsCallback = unsafe extern "C" fn(
    event_json: *const c_char,
    userdata: *mut c_void,
);

StatsPoller::start(connection, callback, userdata) -> StatsPoller
```

The poller stops automatically when dropped or when `stop()` is called. The `userdata` pointer is passed through to the callback unchanged.

### Auto-Update

The `auto_update` module checks the GitHub releases API for newer versions:

- **`check()`** -- returns `Option<UpdateInfo>` with version, download URL, and changelog
- **`apply(download_url, expected_sha256)`** -- downloads the binary, verifies SHA-256 hash, saves to temp directory

Platform detection is automatic: the module selects the correct asset suffix for Windows, macOS, Linux, Android, and iOS.

**UpdateInfo structure:**

```json
{
  "version": "v2.0.1",
  "url": "https://github.com/.../prisma-windows-x64.zip",
  "changelog": "## What's new\n- Bug fixes..."
}
```

### GeoIP Module

The `geo` module provides IP-to-country resolution for GUI server location display:

- **`init(db_path)`** -- load a MaxMind GeoLite2-Country database file
- **`lookup_country(ip)`** -- returns `CountryInfo { code, name, cidrs }`
- **`lookup_country_code(ip)`** -- convenience function returning just the ISO alpha-2 code
- **`country_cidrs(country_code)`** -- returns CIDR blocks for a country
- **`is_initialized()`** -- check if the database is loaded

### Runtime Module

The `runtime` module provides a managed tokio runtime for FFI consumers:

```rust
let rt = PrismaRuntime::new()?;  // Multi-threaded, thread name "prisma-ffi"
rt.spawn(async { ... });          // Non-blocking spawn
rt.block_on(async { ... });       // Blocking (for FFI entry points)
rt.handle();                      // Get a Handle for spawning from other contexts
```

On mobile, the host app creates a `PrismaRuntime` to run async operations without interfering with the UI thread.

### iOS Bindings

The `ios` module provides iOS-specific C functions for Swift interop:

| Function | Description |
|----------|-------------|
| `prisma_ios_prepare_tunnel_config(json)` | Fill defaults for VPN tunnel config (MTU, DNS, routes) |
| `prisma_ios_get_tun_fd()` | Get the TUN file descriptor |
| `prisma_ios_set_tun_fd(fd)` | Set the TUN fd from NEPacketTunnelProvider |
| `prisma_ios_get_data_dir()` | Get `~/Documents/Prisma` path |
| `prisma_ios_vpn_permission_status()` | Get cached VPN permission (1=granted, 0=denied, -1=unknown) |
| `prisma_ios_set_vpn_permission(granted)` | Cache VPN permission status from Swift |
| `prisma_ios_get_info()` | Get iOS config JSON (ports, tun_fd, vpn_permission, version) |

**Tunnel config defaults:**

```json
{
  "mtu": 1400,
  "dns_servers": ["1.1.1.1", "8.8.8.8"],
  "included_routes": ["0.0.0.0/0", "::/0"],
  "excluded_routes": []
}
```

### Android JNI Bindings

The `android` module provides JNI entry points for `com.prisma.core.PrismaCore`:

| JNI Method | Maps To |
|------------|---------|
| `nativeInit(configJson)` | `prisma_init()` |
| `nativeStart()` | `prisma_start()` |
| `nativeStop()` | `prisma_stop()` |
| `nativeDestroy()` | `prisma_destroy()` |
| `nativeGetStatus()` | `prisma_get_status()` |
| `nativeProfilesList()` | `prisma_list_profiles()` |
| `nativeProfileSave(json)` | `prisma_save_profile()` |
| `nativeProfileDelete(id)` | `prisma_delete_profile()` |
| `nativeImportProfile(url)` | `prisma_import_profile()` |
| `nativeOnNetworkChange(type)` | Network type update (0=disconnected, 1=WiFi, 2=cellular, 3=ethernet) |
| `nativeOnMemoryWarning()` | Release caches on low memory |
| `nativeOnBackground()` | App entering background |
| `nativeOnForeground()` | App returning to foreground |
| `nativeSetSystemProxy(host, port)` | `prisma_set_system_proxy()` |
| `nativeClearSystemProxy()` | `prisma_clear_system_proxy()` |
| `nativeVersion()` | Get version string |
| `nativeProfileToQr(json)` | Generate QR SVG |
| `nativeCheckUpdate()` | Check for updates |

**v2.0.0 architecture note:** The Android module uses a global singleton (via `prisma_init` / `prisma_start` / `prisma_stop`) rather than per-handle pointers. JNI methods delegate directly to the global FFI functions.

---

## Thread Safety

- Internal `OnceLock<Mutex<...>>` for all mutable state
- Callbacks invoked from arbitrary Tokio worker threads
- `std::panic::catch_unwind` wraps every extern "C" function to catch panics
- Global statics use `OnceLock` for thread-safe initialization
- iOS atomics use `AtomicI32` with `SeqCst` ordering for cross-thread visibility
