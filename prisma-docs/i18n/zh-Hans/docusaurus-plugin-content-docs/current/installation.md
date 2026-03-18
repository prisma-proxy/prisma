---
sidebar_position: 3
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# 安装

## 一键安装

自动检测操作系统和架构，最快的安装方式。

<Tabs>
  <TabItem value="linux" label="Linux / macOS" default>

```bash
curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.sh | bash
```

  </TabItem>
  <TabItem value="windows" label="Windows (PowerShell)">

```powershell
irm https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.ps1 | iex
```

  </TabItem>
</Tabs>

### 安装 + 初始化

添加 `--setup` 参数同时生成凭证、TLS 证书和示例配置文件：

<Tabs>
  <TabItem value="linux" label="Linux / macOS" default>

```bash
curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.sh | bash -s -- --setup
```

  </TabItem>
  <TabItem value="windows" label="Windows (PowerShell)">

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.ps1))) -Setup
```

  </TabItem>
</Tabs>

生成的文件：
- `.prisma-credentials` — 客户端 ID 和认证密钥
- `prisma-cert.pem` / `prisma-key.pem` — TLS 证书和私钥
- `server.toml` / `client.toml` — 示例配置文件（如果不存在）

### 安装指定版本

固定到特定版本而非最新版本：

<Tabs>
  <TabItem value="linux" label="Linux / macOS" default>

```bash
curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.sh | bash -s -- --version v0.2.1
```

  </TabItem>
  <TabItem value="windows" label="Windows (PowerShell)">

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.ps1))) -Version v0.2.1
```

  </TabItem>
</Tabs>

### 自定义安装目录

使用 `--dir`（或设置 `PRISMA_INSTALL_DIR`）指定安装位置：

<Tabs>
  <TabItem value="linux" label="Linux / macOS" default>

```bash
curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.sh | bash -s -- --dir ~/.local/bin
```

  </TabItem>
  <TabItem value="windows" label="Windows (PowerShell)">

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.ps1))) -Dir "C:\tools\prisma"
```

  </TabItem>
</Tabs>

### 卸载

<Tabs>
  <TabItem value="linux" label="Linux / macOS" default>

```bash
curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.sh | bash -s -- --uninstall
```

  </TabItem>
  <TabItem value="windows" label="Windows (PowerShell)">

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.ps1))) -Uninstall
```

  </TabItem>
</Tabs>

### 安装脚本选项参考

<Tabs>
  <TabItem value="linux" label="Linux / macOS" default>

| 选项 | 描述 |
|------|------|
| `--setup` | 生成凭证、TLS 证书和示例配置文件 |
| `--version VER` | 安装指定版本（如 `v0.2.1`）。默认：最新版本 (latest) |
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
| `-Version VER` | 安装指定版本（如 `v0.2.1`）。默认：最新版本 (latest) |
| `-Dir DIR` | 安装目录。默认：`%LOCALAPPDATA%\prisma` |
| `-ConfigDir DIR` | `-Setup` 的配置文件输出目录。默认：当前目录 |
| `-Uninstall` | 删除 prisma 二进制文件并清理 PATH |
| `-Force` | 覆盖已有安装而不报告当前版本 |
| `-NoVerify` | 跳过 SHA256 校验和验证 |
| `-Quiet` | 静默模式，不输出信息 |

  </TabItem>
</Tabs>

## 各平台手动下载

如果您更倾向于直接下载二进制文件：

<Tabs>
  <TabItem value="linux-x64" label="Linux x86_64" default>

```bash
curl -fsSL https://github.com/Yamimega/prisma/releases/latest/download/prisma-linux-amd64 -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma
```

  </TabItem>
  <TabItem value="linux-arm64" label="Linux aarch64">

```bash
curl -fsSL https://github.com/Yamimega/prisma/releases/latest/download/prisma-linux-arm64 -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma
```

  </TabItem>
  <TabItem value="linux-armv7" label="Linux ARMv7">

```bash
curl -fsSL https://github.com/Yamimega/prisma/releases/latest/download/prisma-linux-armv7 -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma
```

  </TabItem>
  <TabItem value="macos" label="macOS">

```bash
curl -fsSL https://github.com/Yamimega/prisma/releases/latest/download/prisma-darwin-$(uname -m | sed s/x86_64/amd64/) -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma
```

  </TabItem>
  <TabItem value="windows-x64" label="Windows x64">

```powershell
New-Item -Force -ItemType Directory "$env:LOCALAPPDATA\prisma" | Out-Null; Invoke-WebRequest -Uri "https://github.com/Yamimega/prisma/releases/latest/download/prisma-windows-amd64.exe" -OutFile "$env:LOCALAPPDATA\prisma\prisma.exe"; [Environment]::SetEnvironmentVariable("Path", "$([Environment]::GetEnvironmentVariable('Path','User'));$env:LOCALAPPDATA\prisma", "User")
```

  </TabItem>
  <TabItem value="windows-arm64" label="Windows ARM64">

```powershell
New-Item -Force -ItemType Directory "$env:LOCALAPPDATA\prisma" | Out-Null; Invoke-WebRequest -Uri "https://github.com/Yamimega/prisma/releases/latest/download/prisma-windows-arm64.exe" -OutFile "$env:LOCALAPPDATA\prisma\prisma.exe"; [Environment]::SetEnvironmentVariable("Path", "$([Environment]::GetEnvironmentVariable('Path','User'));$env:LOCALAPPDATA\prisma", "User")
```

  </TabItem>
  <TabItem value="freebsd" label="FreeBSD">

```bash
fetch -o /usr/local/bin/prisma https://github.com/Yamimega/prisma/releases/latest/download/prisma-freebsd-amd64 && chmod +x /usr/local/bin/prisma
```

  </TabItem>
</Tabs>

## 通过 Cargo 安装

适用于任何安装了 Rust 工具链的平台：

```bash
cargo install --git https://github.com/Yamimega/prisma.git prisma-cli
```

或从本地克隆安装：

```bash
cargo install --path prisma-cli
```

## Docker

```bash
docker run --rm -v $(pwd):/config ghcr.io/yamimega/prisma server -c /config/server.toml
```

或本地构建：

```bash
git clone https://github.com/Yamimega/prisma.git && cd prisma
docker build -t prisma .
docker run --rm -v $(pwd):/config prisma server -c /config/server.toml
```

## 从源码构建

```bash
git clone https://github.com/Yamimega/prisma.git && cd prisma
cargo build --release
```

二进制文件将生成在 `target/release/` 目录下。将 `prisma` 二进制文件复制到 `$PATH` 中的某个位置：

```bash
sudo cp target/release/prisma /usr/local/bin/
```

## 预编译二进制文件

以下目标平台的预编译二进制文件通过 GitHub Releases 提供：

| 平台 | 架构 |
|------|------|
| Linux | x86_64, aarch64, ARMv7 |
| macOS | x86_64 (Intel), aarch64 (Apple Silicon) |
| Windows | x86_64, ARM64 |
| FreeBSD | x86_64 |

请查看 [GitHub Releases](https://github.com/Yamimega/prisma/releases) 页面获取最新构建。

## 验证安装

```bash
prisma --version
prisma --help
```

## 下一步

- [快速开始](./getting-started.md) — 运行您的第一个代理会话
- [Linux systemd 部署](./deployment/linux-systemd.md) — 部署为系统服务
