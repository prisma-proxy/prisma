# Prisma

**简体中文** | [English](./README.md)

基于 Rust 构建的下一代加密代理基础设施套件。Prisma 实现了 **PrismaVeil v5** 线路协议，融合现代密码学、多种传输方式和高级抗审查特性。

## 特性亮点

- **PrismaVeil v5 协议** — 1-RTT 握手、0-RTT 恢复，X25519 + BLAKE3 + ChaCha20/AES-256-GCM/Transport-Only，头部认证加密（AAD）、连接迁移、增强型 KDF
- **8 种传输方式** — QUIC v2、PrismaTLS、WebSocket、gRPC、XHTTP、XPorta、SSH、WireGuard
- **TUN 模式** — 通过虚拟网络接口实现系统级代理（Windows/Linux/macOS）
- **GeoIP 路由** — 基于 MaxMind MMDB 的国家和城市级智能分流，客户端和服务端均支持
- **PrismaTLS** — 替代 REALITY 的主动探测防御，浏览器指纹模拟 + 动态掩护服务器池
- **流量整形** — 桶填充、时序抖动、杂音注入、帧合并，抵御封装 TLS 指纹识别
- **抗审查** — Salamander UDP 混淆、HTTP/3 伪装、端口跳跃、TLS 伪装、熵伪装
- **端口转发** — 通过加密隧道实现类 frp 的反向代理
- **SQLite 后端** — 用户、客户端、路由规则和订阅存储在 SQLite 数据库中，支持从 TOML 自动迁移
- **订阅系统** — 兑换码（`PRISMA-XXXX`）和邀请链接，简化客户端接入流程
- **Web 管理控制台** — 实时仪表盘、首次运行设置向导、数据分析、客户端分享（TOML/URI/QR）、多服务器管理、路由模板、订阅管理、角色化仪表盘、配置历史（Next.js + shadcn/ui）
- **智能 DNS** — Fake IP、隧道、智能（GeoSite）和直连模式
- **CLI 工具** — `prisma monitor`（TUI 仪表盘）、`prisma validate`（配置检查）、`prisma profile new`（交互式向导）、批量客户端管理
- **CLI 自更新** — `prisma update` 检查 GitHub Releases 并自动替换二进制文件
- **原生 GUI 客户端** — Windows（Win32/GDI）、Android（Jetpack Compose）、iOS（SwiftUI）、macOS（菜单栏）
- **跨平台 GUI** — 速度测试、分流隧道、网络诊断、连接时间线、QR 摄像头扫描、完整备份/恢复、系统托盘（Tauri 2 + React）
- **OpenAPI 规范** — 完整 API 文档位于 `/api/docs/openapi.json`，支持第三方集成

## 快速开始

### 安装

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.sh | bash -s -- --setup

# Windows (PowerShell)
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.ps1))) -Setup
```

`--setup` 参数会自动生成凭证、TLS 证书和示例配置文件。

安装脚本还支持以下选项：

| 选项 | 描述 |
|------|------|
| `--version v0.2.1` | 安装指定版本 |
| `--dir ~/.local/bin` | 自定义安装目录 |
| `--config-dir DIR` | `--setup` 的配置文件输出目录 |
| `--uninstall` | 卸载 prisma |
| `--no-verify` | 跳过 SHA256 校验和验证 |
| `--force` | 覆盖已有安装而不提示 |
| `--quiet` | 静默模式，不输出信息 |

完整选项请运行 `install.sh --help` 或 `install.ps1 -Help`。

### 运行

```bash
# 启动服务端
prisma server -c server.toml

# 启动客户端
prisma client -c client.toml

# 测试代理
curl --socks5 127.0.0.1:1080 https://httpbin.org/ip
```

### 从源码构建

```bash
git clone https://github.com/prisma-proxy/prisma.git && cd prisma
cargo build --release
```

## 项目结构

```
prisma/
├── crates/
│   ├── prisma-core/     # 共享库：加密、协议、配置、DNS、路由、GeoIP
│   ├── prisma-server/   # 代理服务端（TCP、QUIC、CDN 入站）
│   ├── prisma-client/   # 代理客户端（SOCKS5、HTTP CONNECT、TUN 入站）
│   ├── prisma-mgmt/     # 管理 API（基于 axum 的 REST + WebSocket）
│   ├── prisma-cli/      # CLI 工具：服务端/客户端、TUI 监控、配置校验、配置向导
│   └── prisma-ffi/      # C FFI 库，供 GUI 客户端调用
├── apps/
│   ├── prisma-gui/      # 跨平台 GUI（Tauri 2 + React + TypeScript）
│   └── prisma-console/  # Web 管理控制台（Next.js + shadcn/ui）
├── docs/                # 文档站点（Docusaurus）
├── tools/
│   └── prisma-mcp/      # MCP 开发服务器
└── scripts/             # 安装脚本和基准测试
```

## 文档

完整文档请访问 **[yamimega.github.io/prisma](https://yamimega.github.io/prisma/)**，包括：

- [快速入门](https://yamimega.github.io/prisma/docs/getting-started) — 第一个代理会话教程
- [安装指南](https://yamimega.github.io/prisma/docs/installation) — 全平台、Docker、Cargo
- [服务端配置](https://yamimega.github.io/prisma/docs/configuration/server) — 完整配置参考
- [客户端配置](https://yamimega.github.io/prisma/docs/configuration/client) — 完整配置参考
- [路由规则](https://yamimega.github.io/prisma/docs/features/routing-rules) — 客户端/服务端路由 + GeoIP
- [PrismaTLS](https://yamimega.github.io/prisma/docs/features/prisma-tls) — 主动探测防御
- [流量整形](https://yamimega.github.io/prisma/docs/features/traffic-shaping) — 抗指纹识别
- [TUN 模式](https://yamimega.github.io/prisma/docs/features/tun-mode) — 系统级代理配置
- [配置示例](https://yamimega.github.io/prisma/docs/deployment/config-examples) — 8 种场景即用模板
- [PrismaVeil 协议](https://yamimega.github.io/prisma/docs/security/prismaveil-protocol) — 线路协议规范
- [控制台](https://yamimega.github.io/prisma/docs/features/console) — Web UI 配置
- [管理 API](https://yamimega.github.io/prisma/docs/features/management-api) — REST/WebSocket API 参考
- [GUI 客户端](https://yamimega.github.io/prisma/docs/features/gui-clients) — Windows、Android、iOS、macOS 应用

## 开发

```bash
# 运行测试
cargo test --workspace

# 代码检查
cargo fmt --all -- --check
cargo clippy --workspace -- -D warnings

# 构建 FFI 库
cargo build --release -p prisma-ffi

# 构建 GUI（需要 Node.js）
cd apps/prisma-gui && npm install && npm run tauri build

# 构建控制台
cd apps/prisma-console && npm ci && npm run build

# 构建文档
cd docs && npm install && npm start
```

## 许可证

GPLv3.0
