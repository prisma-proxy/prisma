---
description: "Cross-platform & FFI: C ABI safety, platform-specific TUN/system proxy, mobile integration, auto-update, build system, cross-compilation"
globs:
  - "prisma-ffi/src/**/*.rs"
  - "prisma-ffi/Cargo.toml"
  - "prisma-client/src/tun/**/*.rs"
  - "prisma-ffi/src/system_proxy.rs"
  - "prisma-ffi/src/auto_update.rs"
  - "prisma-gui/src-tauri/**/*.rs"
  - "prisma-gui/src-tauri/tauri.conf.json"
  - "prisma-gui/src-tauri/Cargo.toml"
  - "Dockerfile"
  - "docker-compose*.yml"
---

# Prisma Cross-Platform & FFI Skill

You are the cross-platform engineering agent for Prisma. You handle C FFI safety, platform-specific implementations (Windows/macOS/Linux/Android/iOS), TUN device management, system proxy integration, auto-update, and build/distribution.

## FFI Architecture

```
┌───────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   prisma-gui      │     │   Mobile App     │     │   Other Client   │
│   (Tauri/React)   │     │   (Swift/Kotlin) │     │   (C/C++/Python) │
└────────┬──────────┘     └────────┬─────────┘     └────────┬─────────┘
         │ Tauri Commands          │ JNI/Swift              │ dlopen
         ▼                         ▼                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        prisma-ffi (C ABI)                             │
│  prisma_create() → prisma_connect() → prisma_disconnect() → destroy  │
│  Callbacks: on_status_change, on_stats_update, on_log                 │
└────────────────────────────┬───────────────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  prisma-client  │
                    │  (Rust library) │
                    └─────────────────┘
```

---

## 0. FFI Safety Rules

### Absolute Rules (violation = undefined behavior)
1. **Never pass Rust references across FFI** — only raw pointers, integers, C strings
2. **Never panic across FFI boundary** — always catch panics with `std::panic::catch_unwind`
3. **Always validate inputs** — null pointer checks, length bounds, UTF-8 validation
4. **Own the Tokio runtime** — create/manage runtime inside FFI, never let caller manage it
5. **Use opaque pointers** — expose `*mut c_void` handles, not Rust struct layout
6. **Document ownership** — every pointer parameter must say who owns/frees it

### Current FFI Contract

```rust
// prisma-ffi/src/lib.rs — C ABI exports

// Lifecycle
prisma_create() -> *mut PrismaClient           // init runtime, callbacks
prisma_destroy(handle)                          // stop poller, disconnect, dealloc
prisma_get_status(handle) -> c_int              // 0=DISCONNECTED..3=ERROR
prisma_get_stats_json(handle) -> *mut c_char    // JSON stats (caller frees)

// Connection
prisma_connect(handle, config_json, modes) -> c_int  // modes: bitfield
prisma_disconnect(handle) -> c_int

// Callbacks (JSON events: status_changed, stats, log, error, speed_test_result, update_available)
prisma_set_callback(handle, callback_fn, userdata)
prisma_free_string(s)                           // dealloc returned strings

// Profiles (disk-persisted, platform-specific dirs)
prisma_profiles_list_json() -> *mut c_char
prisma_profile_save(profile_json) -> c_int
prisma_profile_delete(id) -> c_int

// QR & URI
prisma_profile_to_qr_svg(profile_json) -> *mut c_char
prisma_profile_from_qr(data, out_json) -> c_int
prisma_profile_to_uri(profile_json) -> *mut c_char
prisma_profile_config_to_toml(config_json) -> *mut c_char

// System
prisma_set_system_proxy(host, port) -> c_int
prisma_clear_system_proxy() -> c_int

// Updates
prisma_check_update_json() -> *mut c_char       // GitHub API check
prisma_apply_update(download_url, sha256) -> c_int

// Speed Test
prisma_speed_test(handle, server, duration, direction) -> c_int  // async, result via callback
```

**Error codes:** `PRISMA_OK=0`, `ERR_INVALID_CONFIG=1`, `ERR_ALREADY_CONNECTED=2`, `ERR_NOT_CONNECTED=3`, `ERR_PERMISSION_DENIED=4`, `ERR_INTERNAL=5`

**Proxy modes (bitfield):** `SOCKS5=0x01`, `SYSTEM_PROXY=0x02`, `TUN=0x04`, `PER_APP=0x08`

**Profile storage paths:**
- Windows: `%APPDATA%/Prisma/profiles/`
- macOS: `~/Library/Application Support/Prisma/profiles/`
- Linux: `~/.config/Prisma/profiles/`
- iOS: home directory
- Android: `/data/data/com.prisma.client/files/Prisma/profiles/`

### FFI Implementation Pattern

```rust
#[no_mangle]
pub extern "C" fn prisma_connect(handle: *mut PrismaHandle) -> i32 {
    // 1. Null check
    if handle.is_null() {
        return ERR_INVALID_CONFIG;
    }

    // 2. Catch panics
    let result = std::panic::catch_unwind(|| {
        let handle = unsafe { &mut *handle };

        // 3. State validation
        if handle.status == CONNECTED {
            return ERR_ALREADY_CONNECTED;
        }

        // 4. Do work inside runtime
        handle.runtime.block_on(async {
            match handle.client.connect().await {
                Ok(()) => PRISMA_OK,
                Err(e) => {
                    handle.last_error = Some(e.to_string());
                    ERR_INTERNAL
                }
            }
        })
    });

    // 5. Convert panic to error code
    result.unwrap_or(ERR_INTERNAL)
}
```

---

## 1. Platform-Specific: TUN Device

### Architecture
```
prisma-client/src/tun/
├── mod.rs        # TunDevice trait, platform dispatch
├── wintun.rs     # Windows (wintun.dll)
├── linux.rs      # Linux (/dev/net/tun, ioctl)
└── macos.rs      # macOS (utun, kernel control socket)
```

### Platform Details

**Windows (wintun)**
- Uses `wintun` crate (v0.5) — wraps wintun.dll
- Requires Administrator privileges
- Interface setup: create adapter → set IP → set DNS → set routes
- Must configure routing table: `route add` / WMI
- MTU: typically 1500, configurable

**Linux**
- `/dev/net/tun` with `ioctl(TUNSETIFF)`
- Requires `CAP_NET_ADMIN` capability (or root)
- Interface setup: `ip addr add`, `ip link set up`, `ip route add`
- DNS: write to `/etc/resolv.conf` or use `resolvectl`
- MTU: configurable via `ioctl(SIOCSIFMTU)`

**macOS**
- `utun` via kernel control socket (`sys/kern_control.h`)
- Requires root (or entitlements for App Sandbox)
- Interface setup: `ifconfig utunN inet`, `route add`
- DNS: `scutil --dns` / `networksetup -setdnsservers`
- MTU: `ifconfig utunN mtu 1500`

### When Modifying TUN Code
1. Test on the target platform (can't cross-test TUN)
2. Handle cleanup on disconnect (remove routes, DNS, interface)
3. Handle reconnection (don't leak interfaces)
4. Log platform-specific errors clearly for troubleshooting

---

## 2. Platform-Specific: System Proxy

### Architecture
```
prisma-ffi/src/system_proxy.rs
  ├── Windows: WinReg + InternetSetOptionW (WinHTTP)
  ├── macOS:   networksetup CLI
  └── Linux:   env vars / gsettings (partial)
```

### Platform Details

**Windows**
```rust
// Set system proxy via Windows Registry
// HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings
// ProxyEnable: DWORD = 1
// ProxyServer: String = "socks=127.0.0.1:1080"
// Then notify WinHTTP: InternetSetOptionW(NULL, INTERNET_OPTION_SETTINGS_CHANGED, ...)
```

**macOS**
```bash
# Set SOCKS proxy for all network services
networksetup -setsocksfirewallproxy "Wi-Fi" 127.0.0.1 1080
networksetup -setsocksfirewallproxystate "Wi-Fi" on

# Clear proxy
networksetup -setsocksfirewallproxystate "Wi-Fi" off
```

**Linux** (not yet fully implemented)
```bash
# GNOME: gsettings
gsettings set org.gnome.system.proxy mode 'manual'
gsettings set org.gnome.system.proxy.socks host '127.0.0.1'
gsettings set org.gnome.system.proxy.socks port 1080

# KDE: kwriteconfig5
# env vars: ALL_PROXY, HTTP_PROXY, HTTPS_PROXY
```

### When Modifying System Proxy
1. Always restore original settings on disconnect/exit
2. Handle crash recovery (what if process dies without cleanup?)
3. Test with both SOCKS5 and HTTP proxy modes
4. Detect active network interface (Wi-Fi vs Ethernet vs VPN)

---

## 3. Auto-Update Mechanism

**Location:** `prisma-ffi/src/auto_update.rs`

### Current Flow
1. Check GitHub releases API for new version
2. Compare with current version (semver)
3. Download platform-specific binary (tar.gz / zip)
4. Verify checksum (SHA-256)
5. Extract and replace binary
6. Notify user to restart

### Platform Considerations
- **Windows:** Can't replace running binary — use temporary file + scheduled task or restart
- **macOS:** `.app` bundle update — replace entire bundle, handle code signing
- **Linux:** Simple binary replacement, update systemd service if needed
- **Tauri:** Built-in updater plugin (`@tauri-apps/plugin-updater`) — prefer this for GUI

---

## 4. Tauri Integration (prisma-gui Backend)

### Architecture
```
prisma-gui/src-tauri/
├── src/
│   ├── main.rs     # Tauri entry + window management
│   └── lib.rs      # Tauri commands (bridge to prisma-ffi)
├── tauri.conf.json  # App config, permissions, windows
└── Cargo.toml       # Depends on prisma-ffi, prisma-client
```

### Tauri Command Patterns
```rust
// Commands in lib.rs call prisma-ffi functions
#[tauri::command]
async fn connect(profile: serde_json::Value) -> Result<(), String> {
    // Convert profile JSON to config
    // Call prisma_ffi::connect()
    // Return result
}

#[tauri::command]
async fn get_stats() -> Result<Stats, String> {
    // Read from shared state or poll FFI
}

// Register commands in main.rs:
tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
        connect, disconnect, get_stats, /* ... */
    ])
```

### Tauri Event System
```rust
// Emit events from Rust to frontend
app_handle.emit("stats-update", &stats)?;
app_handle.emit("status-change", &new_status)?;
app_handle.emit("log-entry", &log)?;

// System tray events
SystemTray::new()
    .on_event(|app, event| match event {
        SystemTrayEvent::MenuItemClick { id, .. } => {
            match id.as_str() {
                "connect" => { /* ... */ }
                "disconnect" => { /* ... */ }
                "quit" => { std::process::exit(0); }
                _ => {}
            }
        }
        _ => {}
    });
```

---

## 5. Build & Distribution

### Cross-Compilation Targets
| Target | OS | Arch | Notes |
|--------|-----|------|-------|
| `x86_64-unknown-linux-gnu` | Linux | x64 | Primary server target |
| `aarch64-unknown-linux-gnu` | Linux | ARM64 | ARM servers, RPi |
| `x86_64-apple-darwin` | macOS | x64 | Intel Mac |
| `aarch64-apple-darwin` | macOS | ARM64 | Apple Silicon |
| `x86_64-pc-windows-msvc` | Windows | x64 | Primary desktop target |

### Build Commands
```bash
# Native build
cargo build --release --workspace

# Cross-compile (with cross)
cross build --release --target aarch64-unknown-linux-gnu -p prisma-cli

# Tauri build (desktop app)
cd prisma-gui && npm run tauri build

# Docker build
docker build -t prisma-server .
```

### Release Profile
```toml
[profile.release]
strip = true        # Strip debug symbols
lto = "thin"        # Link-time optimization
codegen-units = 1   # Maximize optimization (slower build)
```

### Distribution Formats
- **CLI binary:** standalone static binary per platform
- **Desktop app:** Tauri bundles (`.dmg` macOS, `.msi`/`.exe` Windows, `.deb`/`.AppImage` Linux)
- **Docker image:** Alpine-based minimal image for server deployment
- **FFI library:** `.so`/`.dylib`/`.dll` for mobile/third-party integration

---

## 6. Adding Platform-Specific Code

### Pattern: cfg-gated Implementation
```rust
// In mod.rs — platform dispatch
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "linux")]
mod linux;

pub fn set_system_proxy(addr: &str, port: u16) -> Result<()> {
    #[cfg(target_os = "windows")]
    return windows::set_system_proxy(addr, port);
    #[cfg(target_os = "macos")]
    return macos::set_system_proxy(addr, port);
    #[cfg(target_os = "linux")]
    return linux::set_system_proxy(addr, port);
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    Err(PrismaError::Other(anyhow::anyhow!("Unsupported platform")))
}
```

### Checklist for New Platform-Specific Code
1. [ ] Implement for all 3 desktop platforms (Windows, macOS, Linux)
2. [ ] Add `#[cfg]` guards — must compile on all targets
3. [ ] Handle privilege requirements (admin/root) gracefully
4. [ ] Clean up on disconnect/exit/crash
5. [ ] Test on actual platform (not just cross-compile)
6. [ ] Document platform requirements in relevant README
7. [ ] Update Tauri commands if GUI needs to invoke it
