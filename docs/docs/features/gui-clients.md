---
sidebar_position: 6
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# GUI Clients

:::info Repository Split
As of v2.26.0, the GUI desktop/mobile client has moved to its own repository: **[prisma-proxy/prisma-gui](https://github.com/prisma-proxy/prisma-gui)**. It uses a git submodule for the core Rust crates. All GUI development, issues, and releases now live in that repo.
:::

Prisma ships GUI clients for all major platforms. The primary desktop client is the **Prisma GUI** ([prisma-proxy/prisma-gui](https://github.com/prisma-proxy/prisma-gui)), a cross-platform Tauri 2 + React application that runs on Windows, macOS, Linux, Android, and iOS. It links against **prisma-ffi**, a C-ABI shared library built from the same Rust codebase as the CLI.

```
prisma-ffi  ←──────────────────────────────────────┐
    │                                               │
    ├── prisma-gui          (Tauri 2 + React)       │  desktop (Win/Mac/Linux)
    ├── prisma-gui-android  (Kotlin + JNI)           │  same C API
    └── prisma-gui-ios      (Swift + xcframework)   │
```

---

## prisma-gui (Desktop)

The primary desktop client is a **Tauri 2** application with a **React + TypeScript** frontend. It provides a full-featured GUI for managing Prisma connections across Windows, macOS, and Linux from a single codebase.

### Architecture

```
React (Vite + React Router) ─── Tauri IPC ─── Rust commands ─── prisma-ffi
                                                    │
                                            System tray (desktop)
```

The frontend uses **Zustand** for state management, **Recharts** for graphs, **Radix UI** for components, **react-i18next** for internationalization (English + Simplified Chinese), and **TailwindCSS** for styling.

### Pages

The app has **11 pages** accessible via sidebar navigation (collapsible) or bottom navigation on narrow viewports:

| Page | Description |
|------|-------------|
| **Home** | Connection toggle, real-time speed graph with current speed labels (&#8593;/&#8595; MB/s), session stats (upload/download speed, data transferred, uptime), proxy mode selector (SOCKS5/System Proxy/TUN/Per-App), connection quality indicator, daily data usage, connection history |
| **Profiles** | Profile list with search, sort (by name/last used/latency), per-profile metrics (latency, total data, session count, peak speed). Create/edit via a 5-step wizard (Connection, Auth, Transport, Routing & TUN, Review). The Transport step supports all 8 modes: **TCP**, **QUIC**, **WebSocket**, **gRPC**, **XHTTP**, **XPorta**, **PrismaTLS**, and **WireGuard**. QUIC-exclusive settings (port hopping, entropy camouflage, SNI slicing, Salamander) are only visible when QUIC is selected. Share profiles as TOML, prisma:// URI, or QR code. Import from QR or JSON file. Duplicate dialog with name editing, and bulk export/import. Mobile-optimized toolbar with overflow menu. **Latency testing** — tap a server to run a real-time latency test; results are displayed inline and persisted for sorting |
| **Subscriptions** | Manage subscription URLs that auto-update server profiles. Add/edit/delete subscriptions with custom update intervals (1h-7d). Manual refresh, auto-refresh on launch, import from clipboard or QR. Subscription status indicators (last updated, server count, expiry date). Supports Prisma, Clash, and base64 subscription formats |
| **Proxy Groups** | Visual proxy group manager matching the [Routing Rules](/docs/features/routing-rules#proxy-groups-v200) configuration. Create Select/AutoUrl/Fallback/LoadBalance groups. Drag-and-drop server ordering. Real-time latency indicators per server. Manual server selection for Select groups. URL test configuration for AutoUrl/Fallback groups |
| **Import** | Unified import page for adding servers and profiles from multiple sources: QR code scan (camera on mobile, paste on desktop), `prisma://` URI, clipboard detection, TOML file, JSON file, subscription URL, and Clash YAML. Batch import with preview and selective add |
| **Connections** | Real-time active connections list showing destination, rule matched, proxy chain, upload/download speed, and total data per connection. Close individual connections. Filter by domain, IP, or rule. Sort by speed, data, or duration. Connection metadata (start time, transport, matched routing rule) |
| **Rules** | Routing rules editor with DOMAIN, IP-CIDR, GEOIP, and FINAL rule types. Actions: PROXY, DIRECT, REJECT, or proxy group name. Import/export rules as JSON. Rule provider management (add remote rule set URLs). Mobile-responsive table (match column hidden on small screens) |
| **Logs** | Real-time log viewer with virtualized scrolling, search with text highlighting, level filter (ALL/ERROR/WARN/INFO/DEBUG), level statistics badges, pause/resume auto-scroll, export to text file |
| **Speed Test** | Run speed tests through the proxy with configurable server (Cloudflare/Google) and duration (5-60s). Measures download, upload, and latency. Persistent test history with list and chart views, summary statistics (average/best) |
| **Settings** | Language (English/Chinese), theme (system/light/dark), start on boot, minimize to tray, proxy ports (HTTP/SOCKS5), DNS settings (direct/tunnel/fake-IP/smart), auto-reconnect with configurable delay and max attempts, data management (export/import settings and full backups), auto-update check and install. **Split Tunneling** — visual two-column editor for proxy/direct domain routing, with drag-and-drop between columns. **LAN mode** — `allowLan` setting binds the local proxy to `0.0.0.0` instead of `127.0.0.1`, allowing other devices on the local network to use this device as a proxy gateway. |
| **Diagnostics** | Built-in network diagnostic tools — latency test, DNS lookup, and connection test. Three cards with input field and test button for each tool. Results displayed inline with color-coded pass/fail indicators |
| **Analytics** | Connection analytics, top domains, daily trend, rule breakdown, CSV export |

### System tray integration

On desktop platforms, prisma-gui displays a **system tray icon** with the following features:

- **Status-aware icon** — changes between disconnected, connecting, and connected states
- **Connect/Disconnect toggle** — quick connect/disconnect from the tray menu
- **Profile switcher** — submenu listing all profiles, with the active profile marked
- **Copy Proxy Address** — copies the local proxy address to clipboard
- **Copy Terminal Proxy** — copies a platform-appropriate terminal proxy export command (e.g., `export http_proxy=...` on macOS/Linux, `set http_proxy=...` on Windows)
- **Live tooltip** — shows real-time upload/download speeds (e.g., "Prisma Up: 1.2 MB/s Down: 4.5 MB/s")
- **Show Window / Quit** — standard window management actions

### Keyboard shortcuts

All shortcuts use `Cmd` (macOS) or `Ctrl` (Windows/Linux) as the modifier:

| Shortcut | Action |
|----------|--------|
| `Mod+1` through `Mod+6` | Navigate to Home, Profiles, Rules, Logs, Speed Test, Settings |
| `Mod+K` | Toggle connect/disconnect |
| `Mod+N` | Go to Profiles page |

### Connection management

- **Proxy modes** — selectable on the Home page: SOCKS5, System Proxy, TUN, Per-App (toggle multiple simultaneously)
- **Auto-reconnect** — configurable in Settings with retry delay (seconds) and maximum attempts
- **Connection history** — records connect/disconnect events with profile name, latency, session data transferred, and timestamps
- **Connection virtualization** — efficient virtualized list rendering using @tanstack/react-virtual for handling 1000+ simultaneous connections without lag
- **Status sync on reload** — proper reconnection detection when the page reloads or the app resumes from sleep, with debounced visibility-change listeners
- **Connection quality indicator** — real-time signal quality (Excellent/Good/Fair/Poor) based on speed stability
- **Daily data usage tracking** — persistent per-day upload/download tracking with automatic 90-day pruning
- **Quick connect FAB** — floating action button on mobile for one-tap connect/disconnect with elapsed duration badge

### Notifications

- **Status bar** — persistent bar at the bottom showing connection status, live speed/data stats, and toast notifications
- **Speed graph** — real-time speed graph now shows current speed labels and a disconnected placeholder when not connected
- **Notification history** — bell icon with unread badge; click to view full notification history with timestamps and severity levels (error, warning, success, info)
- **Desktop notifications** — via Tauri notification plugin

### QR Camera Scanner

In addition to importing QR codes from image files and pasting URIs, prisma-gui supports live webcam scanning for profile QR codes on desktop platforms. Click the camera icon on the Import or Profiles page to activate the webcam feed. Detected QR codes are parsed immediately and the profile is offered for import.

### Connection Timeline

The Connections page includes an SVG horizontal timeline showing active connection bars over a 5-minute sliding window. Each bar represents an active connection's lifespan. Hover over any bar to see a tooltip with destination, transport, rule matched, and data transferred.

### Clipboard import

When the app window gains focus, it automatically checks the clipboard for `prisma://` URIs and prompts the user to import the detected profile.

### Build

```bash
# Clone the GUI repository
git clone https://github.com/prisma-proxy/prisma-gui.git
cd prisma-gui

# Initialize the core crates submodule
git submodule update --init --recursive

# Development
npm install
npm run dev
npm run tauri dev

# Production
npm run tauri build
# Output: platform-specific installer (MSI, DMG, AppImage, deb)
```

### Installation

Download the appropriate installer for your platform from the [prisma-gui releases page](https://github.com/prisma-proxy/prisma-gui/releases/latest):

- **Windows**: `prisma-gui_x.y.z_x64-setup.exe` or `.msi`
- **macOS**: `prisma-gui_x.y.z_aarch64.dmg` or `_x64.dmg`
- **Linux**: `.AppImage`, `.deb`, or `.rpm`

---

## Feature comparison

| Feature | prisma-gui (Desktop) | Android | iOS |
|---------|---------------------|---------|-----|
| SOCKS5 proxy | ✓ | ✓ | ✓ |
| System proxy | ✓ | ✓ | — |
| TUN mode | ✓ | ✓ (VPN) | ✓ (NEPacketTunnel) |
| Per-app proxy | ✓ | ✓ | ✓ (NEAppProxy) |
| QR code import | ✓ (paste URI) | ✓ (camera) | ✓ (camera) |
| Profile sharing (TOML/URI/QR) | ✓ | ✓ | ✓ |
| Subscriptions | ✓ | ✓ | ✓ |
| Proxy groups | ✓ | ✓ | ✓ |
| Unified import page | ✓ | ✓ | ✓ |
| Active connections view | ✓ | ✓ | ✓ |
| Latency testing (server list) | ✓ | ✓ | ✓ |
| Speed graph | ✓ | ✓ | ✓ |
| Speed test with history | ✓ | ✓ | ✓ |
| Routing rules editor | ✓ | ✓ | ✓ |
| Rule providers (remote sets) | ✓ | ✓ | ✓ |
| Auto-update | ✓ | ✓ | App Store |
| System tray / menu bar | ✓ | — | — |
| Keyboard shortcuts | ✓ | — | — |
| Clipboard import | ✓ | ✓ | ✓ |
| Auto-reconnect | ✓ | ✓ | ✓ |
| Notification history | ✓ | ✓ | ✓ |
| i18n (English + Chinese) | ✓ | ✓ | ✓ |
| Full backup/restore | ✓ | ✓ | ✓ |
| Connection history | ✓ | ✓ | ✓ |
| Daily data usage tracking | ✓ | ✓ | ✓ |
| Diagnostics (latency/DNS/connection test) | ✓ | ✓ | ✓ |
| Split tunneling editor | ✓ | ✓ | ✓ |
| QR camera scanner | ✓ | ✓ (camera) | ✓ (camera) |
| Connection timeline | ✓ | ✓ | ✓ |

---

## prisma-ffi

All GUI clients link against `prisma-ffi`, a `cdylib`/`staticlib` crate that exposes the complete Prisma client API over a stable C ABI. The header is at `prisma-ffi/include/prisma_ffi.h`.

### Key functions (v2.0.0)

v2.0.0 uses a global singleton pattern instead of per-handle pointers:

```c
// Lifecycle (global singleton)
int   prisma_init(const char* config_json);   // Initialize client from JSON config
int   prisma_start(void);                      // Start background proxy loop
int   prisma_stop(void);                       // Stop the proxy
void  prisma_destroy(void);                    // Free all resources

// Status
char* prisma_get_status(void);    // JSON status (caller must free)
char* prisma_get_version(void);   // Version string (caller must free)
void  prisma_free_string(char* s); // Free any returned string

// Profiles
char* prisma_import_profile(const char* url);  // Parse share link (vmess://, vless://, etc.)
char* prisma_list_profiles(void);              // List all saved profiles as JSON
int   prisma_save_profile(const char* json);   // Save profile
int   prisma_delete_profile(const char* id);   // Delete profile by ID

// QR
char* prisma_profile_to_qr(const char* profile_json);  // Generate QR SVG
char* prisma_profile_from_qr(const char* qr_data);     // Parse prisma:// URI

// System proxy
int prisma_set_system_proxy(const char* host, uint16_t port);
int prisma_clear_system_proxy(void);

// Auto-update
UpdateInfo* auto_update::check(void);                        // Check GitHub releases
int         auto_update::apply(const char* url, const char* sha256); // Download + verify
```

### Return codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `-1` | Null pointer argument |
| `-2` | Invalid UTF-8 |
| `-3` | JSON parse error |
| `-4` | Client initialization failed |
| `-5` | Client not initialized |
| `-6` | Client already running |
| `-7` | Shutdown failed |
| `-8` | Operation failed |
| `-99` | Internal panic |

### Stats JSON (from ConnectionManager)

The stats poller delivers JSON events once per second:

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

### Platform-specific modules

| Module | Platform | Key Functions |
|--------|----------|---------------|
| `ios` | iOS | `prisma_ios_set_tun_fd`, `prisma_ios_prepare_tunnel_config`, `prisma_ios_get_info` |
| `android` | Android | JNI bridge via `Java_com_prisma_core_PrismaCore_native*` methods |
| `geo` | All | `geo::init(db_path)`, `geo::lookup_country(ip)`, `geo::country_cidrs(code)` |
| `runtime` | All | `PrismaRuntime::new()` for managed tokio runtime on mobile |
| `connection` | All | `ConnectionManager` for connection lifecycle and speed tracking |
| `stats_poller` | All | `StatsPoller::start(conn, callback, userdata)` for periodic stats delivery |
| `auto_update` | All | `auto_update::check()`, `auto_update::apply(url, sha256)` |

### Building prisma-ffi

```bash
# Desktop (produces prisma_ffi.dll / libprisma_ffi.so / libprisma_ffi.dylib)
cargo build --release -p prisma-ffi

# Android targets (requires Android NDK)
cargo build --release -p prisma-ffi --target aarch64-linux-android
cargo build --release -p prisma-ffi --target armv7-linux-androideabi
cargo build --release -p prisma-ffi --target x86_64-linux-android

# iOS / macOS (on macOS with Xcode)
cargo build --release -p prisma-ffi --target aarch64-apple-ios
cargo build --release -p prisma-ffi --target aarch64-apple-darwin
```

---

## Mobile Support

The Android and iOS clients have reached feature parity with the desktop client for core proxy functionality. Both mobile platforms support subscriptions, proxy groups, the unified import page, active connections view, latency testing, rule providers, and full i18n. The FFI mode constants used across all platforms are:

| Constant | Value | Description |
|----------|-------|-------------|
| `PRISMA_MODE_SOCKS5` | `0x01` | Local SOCKS5 listener |
| `PRISMA_MODE_SYSTEM_PROXY` | `0x02` | OS system proxy |
| `PRISMA_MODE_TUN` | `0x04` | TUN/VPN interface |
| `PRISMA_MODE_PER_APP` | `0x08` | Per-app routing (Android/iOS) |

---

## Android

A Kotlin application targeting Android 7.0+ (API 24) with Material Design 3 (Jetpack Compose). The Kotlin code calls `prisma-ffi` through a JNI bridge (`libprisma_client.so`). Key platform features include a full VPN service, per-app proxy filtering, and background auto-reconnect.

### Architecture

```
UI (Compose) ─── PrismaViewModel ─── PrismaJni (JNI) ─── libprisma_client.so
                                                                │
                                        PrismaVpnService ───────┘
```

- **`PrismaJni`** — Kotlin `object` wrapping all `external` native calls
- **`PrismaViewModel`** — manages the native handle lifecycle and emits `PrismaUiState` via `StateFlow`
- **`PrismaVpnService`** — `android.net.VpnService` subclass for TUN/per-app modes
- **`prisma_jni_bridge.c`** — JNI C layer that forwards calls to Rust FFI symbols

### Proxy modes

| Mode | Android mechanism |
|------|-------------------|
| SOCKS5 | Direct SOCKS5 listener on 127.0.0.1:1080 |
| System Proxy | `ProxyInfo` set via `VpnService.Builder.setHttpProxy()` |
| TUN | `VpnService.Builder.establish()` — creates a tun fd |
| Per-App | `VpnService.Builder.addAllowedApplication()` |

### Build

```bash
cd prisma-gui-android

# Debug APK
./gradlew assembleDebug

# Release APK (requires keystore)
./gradlew assembleRelease
```

The Gradle build expects the cross-compiled `.so` files under `app/src/main/jniLibs/`. A helper script at `scripts/build-android-ffi.sh` cross-compiles `prisma-ffi` for all four ABIs and copies them into place.

### Pages (Android)

The Android app mirrors the desktop page structure:

| Page | Description |
|------|-------------|
| **Home** | Connection toggle, speed graph, proxy mode selector (SOCKS5/TUN/Per-App), stats |
| **Profiles** | Server list with latency indicators, tap to test latency, create/edit/share profiles |
| **Subscriptions** | Add/manage subscription URLs, auto-refresh, import from clipboard or QR |
| **Proxy Groups** | Visual group management (Select/AutoUrl/Fallback/LoadBalance) |
| **Import** | QR scan via camera, clipboard detection, file import, subscription URL |
| **Connections** | Active connections list with speed, destination, and close button |
| **Rules** | Routing rules editor with rule provider support |
| **Settings** | Language, theme, proxy ports, DNS mode, auto-reconnect, backup/restore |

### QR code import

Tap the QR icon on the Profiles screen to open the camera scanner (ML Kit barcode API). Scan a Prisma share QR code — the app decodes it via `prisma_profile_from_qr` and saves the profile automatically.

---

## iOS

A Swift/SwiftUI application for iPhone and iPad targeting iOS 16+. The app uses Apple's NetworkExtension framework for on-demand VPN and per-app proxy functionality. Supports biometric authentication (Face ID / Touch ID) for app launch and profile access, and per-app control via `NEAppProxyProvider`.

### Architecture

```
SwiftUI Views ─── PrismaFFIClient (ObservableObject) ─── prisma_ffi.xcframework
                                                               │
                 TunnelProvider (NEPacketTunnelProvider) ───────┘
                 ProxyProvider  (NEAppProxyProvider)    ───────┘
```

`PrismaFFIClient` is an `ObservableObject` that wraps the C callback with an `Unmanaged` pointer bridge and publishes state changes on the main thread.

### Entitlements

The main app target requires:
- `com.apple.developer.networking.networkextension` — `packet-tunnel-provider`, `app-proxy-provider`
- `com.apple.developer.networking.vpn.api` — for VPN on-demand rules

### Building the xcframework

```bash
# Build for device + simulator and merge into an xcframework
scripts/build-ios-xcframework.sh
# Output: prisma_client.xcframework
```

The Xcode project links this xcframework as a dependency.

### Pages (iOS)

The iOS app mirrors the desktop page structure:

| Page | Description |
|------|-------------|
| **Home** | Connection toggle, speed graph, proxy mode selector (SOCKS5/TUN/Per-App), stats |
| **Profiles** | Server list with latency indicators, tap to test latency, create/edit/share profiles |
| **Subscriptions** | Add/manage subscription URLs, auto-refresh, import from clipboard or QR |
| **Proxy Groups** | Visual group management (Select/AutoUrl/Fallback/LoadBalance) |
| **Import** | QR scan via camera, clipboard detection, file import, subscription URL |
| **Connections** | Active connections list with speed, destination, and close button |
| **Rules** | Routing rules editor with rule provider support |
| **Settings** | Language, theme, DNS mode, auto-reconnect, backup/restore |

### QR code import

The Profiles screen has a QR scanner sheet (using `AVCaptureMetadataOutput`). The app also handles the `prisma://` URL scheme — share links open the app and auto-import the profile.

---

## Profile sharing via QR code

All clients support importing profiles by scanning a QR code. The QR payload is a `prisma://` URI where the path is the base64-encoded profile JSON:

```
prisma://<base64(profile_json)>
```

To generate a QR code from an existing profile JSON:

```bash
# Using the CLI
prisma profile export --id <id> --qr
# Outputs an SVG QR code to stdout

# Programmatically via FFI
char* svg = prisma_profile_to_qr_svg(profile_json);
```

---

## Troubleshooting

### Android: "Native library not available"

The `prisma_client` JNI library was not found. Ensure the cross-compiled `.so` files are placed in `app/src/main/jniLibs/<abi>/libprisma_client.so` before building the APK.

### iOS: "Missing entitlement"

Network Extension entitlements require an explicit App ID with the NetworkExtension capability enabled in the Apple Developer portal. Provisioning profiles must include this capability.

### prisma-gui: System proxy fails

Setting the system proxy requires platform-specific permissions. On macOS, the system proxy is now configured using HTTP/HTTPS proxy settings (`networksetup -setwebproxy` / `-setsecurewebproxy`) instead of SOCKS5, providing broader application compatibility. The app may prompt for administrator credentials. On Linux, system proxy configuration depends on your desktop environment.

### prisma-gui: Tray icon not visible

On Linux, system tray support depends on your desktop environment and compositor. Ensure a compatible system tray implementation (e.g., `libappindicator`) is installed. On GNOME, you may need the AppIndicator extension.
