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

### URI Import

| Function | Returns | Description |
|----------|---------|-------------|
| `prisma_import_uri(uri)` | `*mut c_char` | Import single URI |
| `prisma_import_batch(text)` | `*mut c_char` | Import multiple URIs |

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

## Thread Safety

- Internal `Arc<Mutex<...>>` for all mutable state
- Callbacks invoked from arbitrary Tokio worker threads
- `ffi_catch!` macro wraps every extern "C" function to catch panics
- Global statics use `once_cell::sync::Lazy` for thread-safe init
