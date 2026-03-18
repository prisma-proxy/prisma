---
sidebar_position: 6
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# GUI 客户端

Prisma 为所有主流平台提供 GUI 客户端。主要的桌面客户端是 **prisma-gui**，一个基于 Tauri 2 + React 的跨平台应用，可在 Windows、macOS 和 Linux 上运行。移动平台使用原生客户端，通过 **prisma-ffi**（一个基于相同 Rust 代码库构建的 C-ABI 共享库）连接到核心 Prisma 逻辑。

```
prisma-ffi  ←──────────────────────────────────────┐
    │                                               │
    ├── prisma-gui          (Tauri 2 + React)       │  桌面端 (Win/Mac/Linux)
    ├── prisma-gui-android  (Kotlin + JNI)           │  同一 C API
    └── prisma-gui-ios      (Swift + xcframework)   │
```

---

## prisma-gui（桌面端）

主要的桌面客户端是一个 **Tauri 2** 应用，前端使用 **React + TypeScript**（v0.6.3）。它提供了一个功能完整的 GUI，可在 Windows、macOS 和 Linux 上通过单一代码库管理 Prisma 连接。

### 架构

```
React (Vite + React Router) ─── Tauri IPC ─── Rust commands ─── prisma-ffi
                                                    │
                                            系统托盘 (桌面端)
```

前端使用 **Zustand** 进行状态管理，**Recharts** 绘制图表，**Radix UI** 作为组件库，**react-i18next** 实现国际化（英文 + 简体中文），**TailwindCSS** 进行样式设计。

### 页面

应用有 **6 个页面**，可通过侧边栏导航（可折叠）或窄视口下的底部导航访问：

| 页面 | 描述 |
|------|------|
| **主页** | 连接开关、实时速度图表、会话统计（上传/下载速度、已传输数据、运行时间）、代理模式选择器（SOCKS5/系统代理/TUN/按应用）、连接质量指示器、每日数据用量、连接历史 |
| **配置文件** | 配置文件列表，支持搜索、排序（按名称/最近使用/延迟）、每个配置文件的指标（延迟、总数据量、会话数、峰值速度）。通过 5 步向导创建/编辑（连接、认证、传输、路由和 TUN、审核）。支持以 TOML、prisma:// URI 或二维码分享配置文件。可从二维码或 JSON 文件导入。支持复制和批量导出/导入 |
| **路由规则** | 路由规则编辑器，支持 DOMAIN、IP-CIDR、GEOIP 和 FINAL 规则类型。操作：PROXY、DIRECT、REJECT。支持 JSON 格式导入/导出规则 |
| **日志** | 实时日志查看器，虚拟化滚动，搜索并高亮匹配文本，级别过滤（ALL/ERROR/WARN/INFO/DEBUG），级别统计标签，暂停/恢复自动滚动，导出为文本文件 |
| **速度测试** | 通过代理运行速度测试，可配置服务器（Cloudflare/Google）和持续时间（5-60 秒）。测量下载、上传和延迟。持久化测试历史，支持列表和图表视图，汇总统计（平均值/最佳值） |
| **设置** | 语言（英文/中文）、主题（跟随系统/浅色/深色）、开机启动、最小化到托盘、代理端口（HTTP/SOCKS5）、DNS 设置（直连/隧道/Fake-IP/智能）、自动重连（可配置延迟和最大尝试次数）、数据管理（导出/导入设置和完整备份）、自动更新检查和安装 |

### 系统托盘集成

在桌面平台上，prisma-gui 显示一个**系统托盘图标**，具有以下功能：

- **状态感知图标** — 在断开连接、正在连接和已连接状态之间切换
- **连接/断开切换** — 从托盘菜单快速连接/断开
- **配置文件切换器** — 列出所有配置文件的子菜单，当前活跃的配置文件带有标记
- **复制代理地址** — 将本地代理地址复制到剪贴板
- **实时工具提示** — 显示实时上传/下载速度（如 "Prisma Up: 1.2 MB/s Down: 4.5 MB/s"）
- **显示窗口/退出** — 标准窗口管理操作

### 键盘快捷键

所有快捷键使用 `Cmd`（macOS）或 `Ctrl`（Windows/Linux）作为修饰键：

| 快捷键 | 操作 |
|--------|------|
| `Mod+1` 到 `Mod+6` | 导航到主页、配置文件、路由规则、日志、速度测试、设置 |
| `Mod+K` | 切换连接/断开 |
| `Mod+N` | 前往配置文件页面 |

### 连接管理

- **代理模式** — 在主页可选择：SOCKS5、系统代理、TUN、按应用（可同时启用多个）
- **自动重连** — 在设置中配置重试延迟（秒）和最大尝试次数
- **连接历史** — 记录连接/断开事件，包含配置文件名称、延迟、会话传输数据和时间戳
- **连接质量指示器** — 基于速度稳定性的实时信号质量（优秀/良好/一般/较差）
- **每日数据用量追踪** — 持久化的每日上传/下载追踪，自动清理 90 天前的数据

### 通知

- **状态栏** — 底部持久显示的状态栏，展示连接状态、实时速度/数据统计和消息通知
- **通知历史** — 铃铛图标带未读标记；点击查看完整通知历史，包含时间戳和严重级别（错误、警告、成功、信息）
- **桌面通知** — 通过 Tauri 通知插件

### 剪贴板导入

当应用窗口获得焦点时，会自动检查剪贴板中的 `prisma://` URI，并提示用户导入检测到的配置文件。

### 构建

```bash
cd prisma-gui

# 开发
npm run dev
npm run tauri dev

# 生产
npm run tauri build
# 输出：平台特定的安装包（MSI、DMG、AppImage、deb）
```

### 安装

从[发布页面](https://github.com/Yamimega/prisma/releases/latest)下载适合您平台的安装包：

- **Windows**：`prisma-gui_x.y.z_x64-setup.exe` 或 `.msi`
- **macOS**：`prisma-gui_x.y.z_aarch64.dmg` 或 `_x64.dmg`
- **Linux**：`.AppImage`、`.deb` 或 `.rpm`

---

## 功能对比

| 功能 | prisma-gui（桌面端） | Android | iOS |
|------|---------------------|---------|-----|
| SOCKS5 代理 | ✓ | ✓ | ✓ |
| 系统代理 | ✓ | ✓ | — |
| TUN 模式 | ✓ | ✓ (VPN) | ✓ (NEPacketTunnel) |
| 按应用代理 | ✓ | ✓ | ✓ (NEAppProxy) |
| 二维码导入 | ✓ (粘贴 URI) | ✓ (摄像头) | ✓ (摄像头) |
| 配置分享 (TOML/URI/QR) | ✓ | — | — |
| 速度图表 | ✓ | ✓ | ✓ |
| 速度测试（含历史） | ✓ | — | — |
| 路由规则编辑器 | ✓ | ✓ | ✓ |
| 自动更新 | ✓ | ✓ | App Store |
| 系统托盘/菜单栏 | ✓ | — | — |
| 键盘快捷键 | ✓ | — | — |
| 剪贴板导入 | ✓ | — | — |
| 自动重连 | ✓ | — | — |
| 通知历史 | ✓ | — | — |
| 国际化（英文 + 中文） | ✓ | — | — |
| 完整备份/恢复 | ✓ | — | — |
| 连接历史 | ✓ | — | — |
| 每日数据用量追踪 | ✓ | — | — |

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

| 标志 | 值 | 描述 |
|------|-----|------|
| `PRISMA_MODE_SOCKS5` | `0x01` | 在 127.0.0.1:1080 上启动本地 SOCKS5 监听器 |
| `PRISMA_MODE_SYSTEM_PROXY` | `0x02` | 配置操作系统系统代理 |
| `PRISMA_MODE_TUN` | `0x04` | 创建 TUN/VPN 接口 |
| `PRISMA_MODE_PER_APP` | `0x08` | 按应用路由 (Routing)（仅 Android/iOS） |

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

| 模式 | Android 实现机制 |
|------|------------------|
| SOCKS5 | 在 127.0.0.1:1080 上直接启动 SOCKS5 监听器 |
| 系统代理 (System Proxy) | 通过 `VpnService.Builder.setHttpProxy()` 设置 `ProxyInfo` |
| TUN | `VpnService.Builder.establish()` — 创建 tun fd |
| 按应用 (Per-App) | `VpnService.Builder.addAllowedApplication()` |

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

### prisma-gui：系统代理设置失败

设置系统代理需要平台特定的权限。在 macOS 上，应用调用 `networksetup`，可能会提示输入管理员凭据。在 Linux 上，系统代理配置取决于您的桌面环境。

### prisma-gui：托盘图标不可见

在 Linux 上，系统托盘支持取决于您的桌面环境和合成器。请确保安装了兼容的系统托盘实现（如 `libappindicator`）。在 GNOME 上，您可能需要 AppIndicator 扩展。
