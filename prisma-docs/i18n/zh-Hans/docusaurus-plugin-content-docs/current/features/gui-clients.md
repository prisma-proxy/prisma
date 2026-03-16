---
sidebar_position: 6
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# GUI 客户端

<!-- TODO: translate -->

Prisma ships native GUI clients for all major platforms. Each client connects to the core Prisma logic through **prisma-ffi**, a C-ABI shared library built from the same Rust codebase as the CLI.

```
prisma-ffi  ←──────────────────────────────────────┐
    │                                               │
    ├── prisma-gui-windows  (Rust + Win32/GDI)      │
    ├── prisma-gui-android  (Kotlin + JNI)           │  same C API
    ├── prisma-gui-ios      (Swift + xcframework)   │
    └── prisma-gui-macos    (Swift + dylib)          │
```

## 功能对比

| Feature | Windows | Android | iOS | macOS |
|---------|---------|---------|-----|-------|
| SOCKS5 proxy | ✓ | ✓ | ✓ | ✓ |
| System proxy | ✓ | ✓ | — | ✓ |
| TUN mode | ✓ | ✓ (VPN) | ✓ (NEPacketTunnel) | ✓ |
| Per-app proxy | — | ✓ | ✓ (NEAppProxy) | — |
| QR code import | ✓ | ✓ (camera) | ✓ (camera) | ✓ |
| Speed graph | ✓ | ✓ | ✓ | ✓ |
| Routing rules editor | ✓ | ✓ | ✓ | ✓ |
| Auto-update | ✓ | ✓ | App Store | ✓ |
| System tray / menu bar | ✓ | — | — | ✓ |

---

## prisma-ffi

<!-- TODO: translate -->

All GUI clients link against `prisma-ffi`, a `cdylib`/`staticlib` crate that exposes the complete Prisma client API over a stable C ABI. The header is at `prisma-ffi/include/prisma_ffi.h`.

### 核心函数

```c
// Lifecycle
PrismaHandle* prisma_create(void);
void          prisma_destroy(PrismaHandle* h);

// Connection
int  prisma_connect(PrismaHandle* h, const char* config_json, uint32_t modes);
int  prisma_disconnect(PrismaHandle* h);
int  prisma_get_status(PrismaHandle* h);

// Events (stats, logs, status changes — delivered as JSON)
void prisma_set_callback(PrismaHandle* h, PrismaCallbackFn cb, void* userdata);

// Profiles
char* prisma_profiles_list_json(void);
int   prisma_profile_save(const char* json);
int   prisma_profile_delete(const char* id);
void  prisma_free_string(char* s);

// QR
char* prisma_profile_to_qr_svg(const char* profile_json);
int   prisma_profile_from_qr(const char* data, char** out_json);

// System proxy
int prisma_set_system_proxy(const char* host, uint16_t port);
int prisma_clear_system_proxy(void);

// Auto-update
char* prisma_check_update_json(void);
int   prisma_apply_update(const char* url, const char* sha256);
```

### 模式标志

| Flag | Value | Description |
|------|-------|-------------|
| `PRISMA_MODE_SOCKS5` | `0x01` | Start local SOCKS5 listener on 127.0.0.1:1080 |
| `PRISMA_MODE_SYSTEM_PROXY` | `0x02` | Configure OS system proxy |
| `PRISMA_MODE_TUN` | `0x04` | Create TUN/VPN interface |
| `PRISMA_MODE_PER_APP` | `0x08` | Per-app routing (Android/iOS only) |

### 事件 JSON

<!-- TODO: translate -->

The callback receives JSON events:

```json
// Status change
{"type":"status_changed","status":"connected"}

// Stats (delivered every 1s while connected)
{"type":"stats","bytes_up":1024,"bytes_down":4096,
 "speed_up_bps":512,"speed_down_bps":2048,"uptime_secs":60}

// Log entry
{"type":"log","level":"INFO","target":"prisma_client","msg":"Connected to server"}

// Update available
{"type":"update_available","version":"0.7.0","changelog":"..."}
```

### 构建 prisma-ffi

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

## Windows GUI

<!-- TODO: translate -->

A native Win32 application written in Rust using `windows-sys`. The UI is drawn with GDI — no external UI framework dependency.

### 特性

- **System tray** icon with right-click menu (Connect, Disconnect, Open, Check Update, Quit)
- **6 pages** — Home (speed graph + connect toggle), Profiles, Routing Rules, Logs, Speed Test, Settings
- **Rolling speed graph** — 60-sample history drawn with GDI polylines
- **Dark theme** by default with a navy/indigo palette

### 构建

```powershell
cargo build --release -p prisma-gui-windows
# Output: target/release/prisma-gui-windows.exe
```

The binary links `prisma-ffi` as a workspace dependency — no separate DLL is needed.

### 安装

<!-- TODO: translate -->

Download `prisma-windows-x64.zip` from the [releases page](https://github.com/Yamimega/prisma/releases/latest). Extract and run `prisma-gui-windows.exe`. On first run, the app creates a system tray icon and opens the main window.

---

## Android

<!-- TODO: translate -->

A Jetpack Compose application targeting Android 7.0+ (API 24). The Kotlin code calls `prisma-ffi` through a JNI bridge (`libprisma_client.so`).

### 架构

```
UI (Compose) ─── PrismaViewModel ─── PrismaJni (JNI) ─── libprisma_client.so
                                                                │
                                        PrismaVpnService ───────┘
```

- **`PrismaJni`** — Kotlin `object` wrapping all `external` native calls
- **`PrismaViewModel`** — manages the native handle lifecycle and emits `PrismaUiState` via `StateFlow`
- **`PrismaVpnService`** — `android.net.VpnService` subclass for TUN/per-app modes
- **`prisma_jni_bridge.c`** — JNI C layer that forwards calls to Rust FFI symbols

### 代理模式

| Mode | Android mechanism |
|------|-------------------|
| SOCKS5 | Direct SOCKS5 listener on 127.0.0.1:1080 |
| System Proxy | `ProxyInfo` set via `VpnService.Builder.setHttpProxy()` |
| TUN | `VpnService.Builder.establish()` — creates a tun fd |
| Per-App | `VpnService.Builder.addAllowedApplication()` |

### 构建

```bash
cd prisma-gui-android

# Debug APK
./gradlew assembleDebug

# Release APK (requires keystore)
./gradlew assembleRelease
```

The Gradle build expects the cross-compiled `.so` files under `app/src/main/jniLibs/`. A helper script at `scripts/build-android-ffi.sh` cross-compiles `prisma-ffi` for all four ABIs and copies them into place.

### QR 码导入

<!-- TODO: translate -->

Tap the QR icon on the Profiles screen to open the camera scanner (ML Kit barcode API). Scan a Prisma share QR code — the app decodes it via `prisma_profile_from_qr` and saves the profile automatically.

---

## iOS

<!-- TODO: translate -->

A SwiftUI application for iPhone and iPad targeting iOS 16+. The app uses Apple's NetworkExtension framework for VPN and per-app proxy functionality.

### 架构

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

### 构建 xcframework

```bash
# Build for device + simulator and merge into an xcframework
scripts/build-ios-xcframework.sh
# Output: prisma_client.xcframework
```

The Xcode project links this xcframework as a dependency.

### QR 码导入

<!-- TODO: translate -->

The Profiles screen has a QR scanner sheet (using `AVCaptureMetadataOutput`). The app also handles the `prisma://` URL scheme — share links open the app and auto-import the profile.

---

## macOS

<!-- TODO: translate -->

A menu bar application for macOS 13+ written in Swift and AppKit. The app runs as an accessory (no Dock icon) and shows a compact popover from the menu bar icon.

### 架构

```
AppDelegate
    └── MenuBarController
            ├── NSStatusItem  (menu bar icon, click → popover)
            └── NSPopover
                    └── MenuBarPopoverView (SwiftUI)
                            └── PrismaFFIClient (ObservableObject)
```

Clicking "Open App" in the popover switches the activation policy to `.regular`, which reveals the full window with Home, Profiles, Rules, Settings, and Logs views.

### 系统代理集成

<!-- TODO: translate -->

The macOS client can configure the system HTTP/HTTPS proxy via `networksetup`:

```swift
PrismaFFI.setSystemProxy(host: "127.0.0.1", port: 8080)
```

This calls `prisma_set_system_proxy` in the FFI, which invokes `networksetup -setwebproxy` for the active network service.

### 构建

```bash
# Swift Package Manager
cd prisma-gui-macos
swift build -c release

# Or via Xcode
xcodebuild -project PrismaMacOS.xcodeproj -scheme PrismaMacOS -configuration Release
```

---

## 通过 QR 码分享配置

<!-- TODO: translate -->

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

## 故障排除

### Android: "Native library not available"

<!-- TODO: translate -->

The `prisma_client` JNI library was not found. Ensure the cross-compiled `.so` files are placed in `app/src/main/jniLibs/<abi>/libprisma_client.so` before building the APK.

### iOS: "Missing entitlement"

<!-- TODO: translate -->

Network Extension entitlements require an explicit App ID with the NetworkExtension capability enabled in the Apple Developer portal. Provisioning profiles must include this capability.

### Windows: App won't start

<!-- TODO: translate -->

Ensure `prisma-gui-windows.exe` is run with a valid `USERPROFILE` environment variable set — it stores profiles under `%APPDATA%\prisma\profiles\`.

### macOS: "Operation not permitted" for system proxy

<!-- TODO: translate -->

System proxy changes via `networksetup` require administrator privileges. The app will prompt for your password via a macOS authorization dialog.
