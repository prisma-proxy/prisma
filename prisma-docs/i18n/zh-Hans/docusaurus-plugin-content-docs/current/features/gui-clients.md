---
sidebar_position: 6
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# GUI 客户端

Prisma 为所有主流平台提供原生 GUI 客户端。每个客户端通过 **prisma-ffi**（一个基于相同 Rust 代码库构建的 C-ABI 共享库）连接到核心 Prisma 逻辑。

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

所有 GUI 客户端都链接 `prisma-ffi`，这是一个 `cdylib`/`staticlib` crate，通过稳定的 C ABI 暴露完整的 Prisma 客户端 API。头文件位于 `prisma-ffi/include/prisma_ffi.h`。

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

回调函数接收 JSON 事件：

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

使用 `windows-sys` 编写的原生 Win32 应用程序。UI 通过 GDI 绘制，不依赖外部 UI 框架。

### 特性

- **系统托盘**图标，右键菜单（连接、断开、打开、检查更新、退出）
- **6 个页面** — 主页（速度图表 + 连接开关）、配置文件、路由规则、日志、速度测试、设置
- **滚动速度图表** — 使用 GDI 折线绘制的 60 个采样点历史记录
- **深色主题**，默认使用海军蓝/靛蓝色调

### 构建

```powershell
cargo build --release -p prisma-gui-windows
# Output: target/release/prisma-gui-windows.exe
```

该二进制文件将 `prisma-ffi` 作为工作区依赖链接 — 不需要单独的 DLL。

### 安装

从[发布页面](https://github.com/Yamimega/prisma/releases/latest)下载 `prisma-windows-x64.zip`。解压后运行 `prisma-gui-windows.exe`。首次运行时，应用会创建系统托盘图标并打开主窗口。

---

## Android

基于 Jetpack Compose 的应用，目标 Android 7.0+（API 24）。Kotlin 代码通过 JNI 桥接（`libprisma_client.so`）调用 `prisma-ffi`。

### 架构

```
UI (Compose) ─── PrismaViewModel ─── PrismaJni (JNI) ─── libprisma_client.so
                                                                │
                                        PrismaVpnService ───────┘
```

- **`PrismaJni`** — 封装所有 `external` 原生调用的 Kotlin `object`
- **`PrismaViewModel`** — 管理原生句柄生命周期，通过 `StateFlow` 发射 `PrismaUiState`
- **`PrismaVpnService`** — 用于 TUN/按应用模式的 `android.net.VpnService` 子类
- **`prisma_jni_bridge.c`** — 将调用转发到 Rust FFI 符号的 JNI C 层

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

Gradle 构建期望交叉编译的 `.so` 文件位于 `app/src/main/jniLibs/` 下。辅助脚本 `scripts/build-android-ffi.sh` 会为所有四个 ABI 交叉编译 `prisma-ffi` 并将其复制到正确位置。

### QR 码导入

在配置文件页面点击 QR 图标打开相机扫描器（ML Kit 条形码 API）。扫描 Prisma 分享二维码 — 应用通过 `prisma_profile_from_qr` 解码并自动保存配置文件。

---

## iOS

面向 iPhone 和 iPad 的 SwiftUI 应用，目标 iOS 16+。该应用使用 Apple 的 NetworkExtension 框架实现 VPN 和按应用代理功能。

### 架构

```
SwiftUI Views ─── PrismaFFIClient (ObservableObject) ─── prisma_ffi.xcframework
                                                               │
                 TunnelProvider (NEPacketTunnelProvider) ───────┘
                 ProxyProvider  (NEAppProxyProvider)    ───────┘
```

`PrismaFFIClient` 是一个 `ObservableObject`，使用 `Unmanaged` 指针桥接封装 C 回调，并在主线程上发布状态变更。

### Entitlements

主应用目标需要：
- `com.apple.developer.networking.networkextension` — `packet-tunnel-provider`、`app-proxy-provider`
- `com.apple.developer.networking.vpn.api` — 用于 VPN 按需规则

### 构建 xcframework

```bash
# Build for device + simulator and merge into an xcframework
scripts/build-ios-xcframework.sh
# Output: prisma_client.xcframework
```

Xcode 项目将此 xcframework 作为依赖链接。

### QR 码导入

配置文件页面有一个 QR 扫描器面板（使用 `AVCaptureMetadataOutput`）。该应用还处理 `prisma://` URL scheme — 分享链接会打开应用并自动导入配置文件。

---

## macOS

面向 macOS 13+ 的菜单栏应用，使用 Swift 和 AppKit 编写。应用以配件模式运行（无 Dock 图标），从菜单栏图标显示紧凑的弹出窗口。

### 架构

```
AppDelegate
    └── MenuBarController
            ├── NSStatusItem  (menu bar icon, click → popover)
            └── NSPopover
                    └── MenuBarPopoverView (SwiftUI)
                            └── PrismaFFIClient (ObservableObject)
```

在弹出窗口中点击"打开应用"会将激活策略切换为 `.regular`，显示包含主页、配置文件、规则、设置和日志视图的完整窗口。

### 系统代理集成

macOS 客户端可以通过 `networksetup` 配置系统 HTTP/HTTPS 代理：

```swift
PrismaFFI.setSystemProxy(host: "127.0.0.1", port: 8080)
```

这会调用 FFI 中的 `prisma_set_system_proxy`，该函数为活跃的网络服务调用 `networksetup -setwebproxy`。

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

所有客户端都支持通过扫描二维码导入配置文件。QR 负载是一个 `prisma://` URI，路径为 base64 编码的配置文件 JSON：

```
prisma://<base64(profile_json)>
```

从现有配置文件 JSON 生成二维码：

```bash
# Using the CLI
prisma profile export --id <id> --qr
# Outputs an SVG QR code to stdout

# Programmatically via FFI
char* svg = prisma_profile_to_qr_svg(profile_json);
```

---

## 故障排除

### Android："Native library not available"

未找到 `prisma_client` JNI 库。请确保在构建 APK 之前，将交叉编译的 `.so` 文件放置在 `app/src/main/jniLibs/<abi>/libprisma_client.so` 路径下。

### iOS："Missing entitlement"

Network Extension entitlements 需要在 Apple Developer 门户中启用了 NetworkExtension 功能的显式 App ID。Provisioning profiles 必须包含此功能。

### Windows：应用无法启动

确保 `prisma-gui-windows.exe` 运行时设置了有效的 `USERPROFILE` 环境变量 — 它将配置文件存储在 `%APPDATA%\prisma\profiles\` 下。

### macOS："Operation not permitted"（系统代理）

通过 `networksetup` 更改系统代理需要管理员权限。应用会通过 macOS 授权对话框提示输入密码。
