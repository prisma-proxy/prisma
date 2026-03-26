---
sidebar_position: 3
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# 安装

Prisma v2.24.0 支持 Linux、macOS、Windows、FreeBSD、Docker 和移动平台（Android/iOS 通过 prisma-gui）。选择最适合您环境的安装方式。

## 一键安装

最快的安装方式。自动检测操作系统和架构，下载 v2.24.0 二进制文件并放置到 `PATH` 中。

<Tabs>
  <TabItem value="linux" label="Linux / macOS" default>

```bash
curl -fsSL https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.sh | bash
```

  </TabItem>
  <TabItem value="windows" label="Windows (PowerShell)">

```powershell
irm https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.ps1 | iex
```

  </TabItem>
</Tabs>

### 安装 + 初始化

添加 `--setup` 参数同时生成凭证、TLS 证书和示例配置文件：

<Tabs>
  <TabItem value="linux" label="Linux / macOS" default>

```bash
curl -fsSL https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.sh | bash -s -- --setup
```

  </TabItem>
  <TabItem value="windows" label="Windows (PowerShell)">

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.ps1))) -Setup
```

  </TabItem>
</Tabs>

生成的文件：
- `.prisma-credentials` — 客户端 ID 和认证密钥
- `prisma-cert.pem` / `prisma-key.pem` — TLS 证书和私钥
- `server.toml` / `client.toml` — 示例配置文件（如果不存在）

### 安装指定版本

固定到 v2.24.0（或其他发布标签）：

<Tabs>
  <TabItem value="linux" label="Linux / macOS" default>

```bash
curl -fsSL https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.sh | bash -s -- --version v2.24.0
```

  </TabItem>
  <TabItem value="windows" label="Windows (PowerShell)">

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.ps1))) -Version v2.24.0
```

  </TabItem>
</Tabs>

### 自定义安装目录

使用 `--dir`（或设置 `PRISMA_INSTALL_DIR`）指定安装位置：

<Tabs>
  <TabItem value="linux" label="Linux / macOS" default>

```bash
curl -fsSL https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.sh | bash -s -- --dir ~/.local/bin
```

  </TabItem>
  <TabItem value="windows" label="Windows (PowerShell)">

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.ps1))) -Dir "C:\tools\prisma"
```

  </TabItem>
</Tabs>

### 卸载

<Tabs>
  <TabItem value="linux" label="Linux / macOS" default>

```bash
curl -fsSL https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.sh | bash -s -- --uninstall
```

  </TabItem>
  <TabItem value="windows" label="Windows (PowerShell)">

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.ps1))) -Uninstall
```

  </TabItem>
</Tabs>

### 安装脚本选项参考

<Tabs>
  <TabItem value="linux" label="Linux / macOS" default>

| 选项 | 描述 |
|------|------|
| `--setup` | 生成凭证、TLS 证书和示例配置文件 |
| `--version VER` | 安装指定版本（如 `v2.24.0`）。默认：最新版本 |
| `--dir DIR` | 安装目录。默认：`/usr/local/bin` |
| `--config-dir DIR` | `--setup` 的配置文件输出目录。默认：当前目录 |
| `--uninstall` | 删除 prisma 二进制文件 |
| `--force` | 覆盖已有安装而不报告当前版本 |
| `--no-verify` | 跳过 SHA256 校验和验证 |
| `--quiet` | 静默模式，不输出信息 |

  </TabItem>
  <TabItem value="windows" label="Windows (PowerShell)">

| 选项 | 描述 |
|------|------|
| `-Setup` | 生成凭证、TLS 证书和示例配置文件 |
| `-Version VER` | 安装指定版本（如 `v2.24.0`）。默认：最新版本 |
| `-Dir DIR` | 安装目录。默认：`%LOCALAPPDATA%\prisma` |
| `-ConfigDir DIR` | `-Setup` 的配置文件输出目录。默认：当前目录 |
| `-Uninstall` | 删除 prisma 二进制文件并清理 PATH |
| `-Force` | 覆盖已有安装而不报告当前版本 |
| `-NoVerify` | 跳过 SHA256 校验和验证 |
| `-Quiet` | 静默模式，不输出信息 |

  </TabItem>
</Tabs>

## 各平台手动下载

如果您更倾向于直接下载 v2.24.0 二进制文件：

<Tabs>
  <TabItem value="linux-x64" label="Linux x86_64" default>

```bash
curl -fsSL https://github.com/prisma-proxy/prisma/releases/download/v2.24.0/prisma-linux-amd64 -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma
```

  </TabItem>
  <TabItem value="linux-arm64" label="Linux aarch64">

```bash
curl -fsSL https://github.com/prisma-proxy/prisma/releases/download/v2.24.0/prisma-linux-arm64 -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma
```

  </TabItem>
  <TabItem value="linux-armv7" label="Linux ARMv7">

```bash
curl -fsSL https://github.com/prisma-proxy/prisma/releases/download/v2.24.0/prisma-linux-armv7 -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma
```

  </TabItem>
  <TabItem value="macos" label="macOS">

```bash
curl -fsSL https://github.com/prisma-proxy/prisma/releases/download/v2.24.0/prisma-darwin-$(uname -m | sed s/x86_64/amd64/) -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma
```

  </TabItem>
  <TabItem value="windows-x64" label="Windows x64">

```powershell
New-Item -Force -ItemType Directory "$env:LOCALAPPDATA\prisma" | Out-Null; Invoke-WebRequest -Uri "https://github.com/prisma-proxy/prisma/releases/download/v2.24.0/prisma-windows-amd64.exe" -OutFile "$env:LOCALAPPDATA\prisma\prisma.exe"; [Environment]::SetEnvironmentVariable("Path", "$([Environment]::GetEnvironmentVariable('Path','User'));$env:LOCALAPPDATA\prisma", "User")
```

  </TabItem>
  <TabItem value="windows-arm64" label="Windows ARM64">

```powershell
New-Item -Force -ItemType Directory "$env:LOCALAPPDATA\prisma" | Out-Null; Invoke-WebRequest -Uri "https://github.com/prisma-proxy/prisma/releases/download/v2.24.0/prisma-windows-arm64.exe" -OutFile "$env:LOCALAPPDATA\prisma\prisma.exe"; [Environment]::SetEnvironmentVariable("Path", "$([Environment]::GetEnvironmentVariable('Path','User'));$env:LOCALAPPDATA\prisma", "User")
```

  </TabItem>
  <TabItem value="freebsd" label="FreeBSD">

```bash
fetch -o /usr/local/bin/prisma https://github.com/prisma-proxy/prisma/releases/download/v2.24.0/prisma-freebsd-amd64 && chmod +x /usr/local/bin/prisma
```

  </TabItem>
</Tabs>

## Docker

直接使用 Docker 运行 v2.24.0 服务端：

```bash
docker run --rm -v $(pwd):/config ghcr.io/yamimega/prisma:2.24.0 server -c /config/server.toml
```

运行客户端：

```bash
docker run --rm -v $(pwd):/config -p 1080:1080 -p 8080:8080 ghcr.io/yamimega/prisma:2.24.0 client -c /config/client.toml
```

使用 Docker Compose：

```yaml title="docker-compose.yml"
version: "3.8"
services:
  prisma-server:
    image: ghcr.io/yamimega/prisma:2.24.0
    command: server -c /config/server.toml
    volumes:
      - ./server.toml:/config/server.toml:ro
      - ./prisma-cert.pem:/config/prisma-cert.pem:ro
      - ./prisma-key.pem:/config/prisma-key.pem:ro
    ports:
      - "8443:8443"
      - "8443:8443/udp"   # QUIC
      - "9090:9090"       # 管理 API
    restart: unless-stopped
```

本地构建：

```bash
git clone https://github.com/prisma-proxy/prisma.git && cd prisma
docker build -t prisma .
docker run --rm -v $(pwd):/config prisma server -c /config/server.toml
```

## 移动端：Android 和 iOS

移动端支持通过 **prisma-gui** 提供，这是一个使用 `prisma-ffi` C 共享库的 Tauri + React 应用。GUI 应用可用于：

- **Android** — 从 GitHub Releases 下载 APK 或通过 Google Play（即将推出）
- **iOS** — TestFlight 或 App Store（即将推出）

移动端应用支持：
- 配置文件管理，支持二维码导入/导出
- 订阅 URL，支持自动更新
- 系统代理和 TUN (VPN) 模式
- 按应用代理路由
- GeoIP 查询和延迟测试

从 [GitHub Releases](https://github.com/prisma-proxy/prisma/releases) 页面下载最新的 prisma-gui 版本。

## 通过 Cargo 安装

适用于任何安装了 Rust 工具链的平台：

```bash
cargo install --git https://github.com/prisma-proxy/prisma.git prisma-cli
```

或从本地克隆安装：

```bash
cargo install --path prisma-cli
```

## 从源码构建

```bash
git clone https://github.com/prisma-proxy/prisma.git && cd prisma
cargo build --release
```

二进制文件将生成在 `target/release/` 目录下。将 `prisma` 二进制文件复制到 `$PATH` 中的某个位置：

```bash
sudo cp target/release/prisma /usr/local/bin/
```

### 构建要求

- Rust stable (1.75+)
- C 编译器（用于原生依赖）
- Linux 上需要：`libssl-dev`（或 `openssl-devel`）用于 TLS，可选 `linux-headers` 用于 io_uring
- macOS 上需要：Xcode 命令行工具
- Windows 上需要：MSVC 构建工具

## 预编译二进制文件

以下目标平台的 v2.24.0 预编译二进制文件通过 GitHub Releases 提供：

| 平台 | 架构 |
|------|------|
| Linux | x86_64, aarch64, ARMv7 |
| macOS | x86_64 (Intel), aarch64 (Apple Silicon) |
| Windows | x86_64, ARM64 |
| FreeBSD | x86_64 |

请查看 [GitHub Releases](https://github.com/prisma-proxy/prisma/releases) 页面获取最新构建。

## 验证安装

```bash
prisma version
prisma --help
```

## 配置文件搜索路径

Prisma 按以下顺序搜索配置文件：

| 平台 | 路径 |
|------|------|
| Linux / macOS | 当前目录、`/etc/prisma/`、`$XDG_CONFIG_HOME/prisma/`、`~/.config/prisma/` |
| Windows | 当前目录、`%PROGRAMDATA%\prisma\` |

## 下一步

- [快速开始](./getting-started.md) — 运行您的第一个代理会话
- [CLI 参考](./cli-reference.md) — 完整的命令文档
- [Linux systemd 部署](./deployment/linux-systemd.md) — 部署为系统服务
- [Docker 部署](./deployment/docker.md) — 容器化部署指南
