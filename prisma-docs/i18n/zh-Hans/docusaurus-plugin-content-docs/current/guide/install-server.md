---
sidebar_position: 5
---

# 安装服务端 (Install Server)

在本章中，你将在你的远程服务器（VPS）上安装 Prisma。我们会先介绍最简单的方法，然后展示供高级用户使用的替代方案。

## 开始之前

确保你已经：
- 拥有一台运行 Ubuntu 22.04 或 Debian 12 的 VPS（参见[准备工作](./prepare.md)）
- 可以通过 SSH 连接到你的服务器
- 已经更新了你的服务器（`sudo apt update && sudo apt upgrade -y`）

## 方法一：一键安装脚本（推荐）

这是安装 Prisma 最简单的方式。脚本会自动检测你的操作系统和 CPU 架构，下载正确的二进制文件，并将其放置在正确的位置。

SSH 登录到你的服务器并运行：

```bash
curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.sh | bash
```

你应该看到类似这样的输出：

```
[INFO] Detected platform: linux-amd64
[INFO] Downloading prisma v0.6.3...
[INFO] Verifying checksum...
[INFO] Installing to /usr/local/bin/prisma
[INFO] Installation complete!
```

### 安装 + 初始化（更简单）

添加 `--setup` 参数可以同时生成凭证、TLS 证书和示例配置文件：

```bash
curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.sh | bash -s -- --setup
```

这会创建你需要的所有内容：
- `server.toml` —— 服务端示例配置
- `client.toml` —— 客户端示例配置
- `.prisma-credentials` —— 你的客户端 ID 和认证密钥 (Auth Secret)
- `prisma-cert.pem` / `prisma-key.pem` —— TLS 证书和私钥 (Private Key)

:::tip 推荐新手使用
使用 `--setup` 是最快的入门方式。它会生成所有需要的文件，你只需要做几处修改即可。
:::

## 方法二：Docker

如果你更喜欢 Docker（或者你的 VPS 已经安装了 Docker），可以在容器中运行 Prisma。

### 步骤 1：安装 Docker（如果尚未安装）

```bash
curl -fsSL https://get.docker.com | bash
```

### 步骤 2：创建配置目录

```bash
mkdir -p /etc/prisma
```

### 步骤 3：在 Docker 中运行 Prisma

```bash
docker run -d \
  --name prisma-server \
  --restart unless-stopped \
  -v /etc/prisma:/config \
  -p 8443:8443/tcp \
  -p 8443:8443/udp \
  ghcr.io/yamimega/prisma server -c /config/server.toml
```

每个部分的含义：
- `-d` —— 在后台运行
- `--name prisma-server` —— 给容器起个名字
- `--restart unless-stopped` —— 崩溃或服务器重启后自动重启
- `-v /etc/prisma:/config` —— 将你的配置目录共享给容器
- `-p 8443:8443/tcp` —— 开放 TCP 端口 8443
- `-p 8443:8443/udp` —— 开放 UDP 端口 8443

:::info Docker 说明
在容器启动之前，你仍然需要在 `/etc/prisma/` 中创建 `server.toml` 文件。我们将在[下一章](./configure-server.md)中完成这个操作。
:::

## 方法三：直接下载二进制文件 (Binary)

如果你想手动下载二进制文件：

```bash
# x86_64 架构（最常见）
curl -fsSL https://github.com/Yamimega/prisma/releases/latest/download/prisma-linux-amd64 \
  -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma

# ARM64 架构（树莓派 4、Oracle Cloud 免费套餐等）
curl -fsSL https://github.com/Yamimega/prisma/releases/latest/download/prisma-linux-arm64 \
  -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma
```

:::info 如何知道我是什么架构？
在你的服务器上运行 `uname -m`。如果显示 `x86_64`，使用 amd64 二进制文件。如果显示 `aarch64`，使用 arm64 二进制文件。
:::

## 方法四：从源码编译 (Build from Source)（高级）

如果你更喜欢自己编译 Prisma：

```bash
# 安装 Rust（如果尚未安装）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# 克隆并编译
git clone https://github.com/Yamimega/prisma.git
cd prisma
cargo build --release

# 安装二进制文件
sudo cp target/release/prisma /usr/local/bin/
```

从源码编译根据服务器硬件的不同可能需要几分钟时间。

## 验证安装

安装完成后，验证 Prisma 是否正常工作：

```bash
prisma --version
```

预期输出：
```
prisma 0.6.3
```

你还可以查看所有可用命令：

```bash
prisma --help
```

预期输出：
```
Prisma - Next-generation encrypted proxy

Usage: prisma <COMMAND>

Commands:
  server      Start the proxy server
  client      Start the proxy client
  gen-key     Generate a client ID and auth secret
  gen-cert    Generate a self-signed TLS certificate
  init        Generate example config files
  validate    Validate a config file
  console     Launch the web management console
  help        Print this message or the help of the given subcommand(s)

Options:
  -V, --version  Print version
  -h, --help     Print help
```

## 目录结构 (Directory Structure)

安装完成后，文件位于以下位置：

```
/usr/local/bin/prisma          ← Prisma 二进制文件（程序本身）
/etc/prisma/                   ← 配置目录（你需要创建）
    server.toml                ← 服务端配置文件
    prisma-cert.pem            ← TLS 证书
    prisma-key.pem             ← TLS 私钥
```

如果你使用了 `--setup`，配置文件会在当前目录中。让我们把它们移动到标准位置：

```bash
sudo mkdir -p /etc/prisma
sudo mv server.toml client.toml prisma-cert.pem prisma-key.pem /etc/prisma/
sudo mv .prisma-credentials /etc/prisma/
```

## 安装问题排查 (Troubleshooting)

### 安装后提示 "command not found"

二进制文件可能不在你的 PATH 中。尝试使用完整路径运行：

```bash
/usr/local/bin/prisma --version
```

如果这样可以运行，将 `/usr/local/bin` 添加到你的 PATH：

```bash
export PATH=$PATH:/usr/local/bin
```

### 权限被拒绝

确保二进制文件有执行权限：

```bash
sudo chmod +x /usr/local/bin/prisma
```

### "curl: command not found"

先安装 curl：

```bash
sudo apt install curl -y
```

### 架构不匹配

如果你看到类似 "cannot execute binary file" 的错误，说明你下载了错误架构的版本。检查你的架构：

```bash
uname -m
```

- `x86_64` 表示你需要 `amd64` 二进制文件
- `aarch64` 表示你需要 `arm64` 二进制文件

## 开放防火墙 (Firewall) 端口

你服务器的防火墙 (Firewall) 可能会阻止 Prisma 需要的端口。需要开放它们：

```bash
# 如果使用 ufw（Ubuntu 默认防火墙）
sudo ufw allow 8443/tcp
sudo ufw allow 8443/udp

# 验证
sudo ufw status
```

如果你的 VPS 提供商在其网页控制面板中有单独的"安全组"或"防火墙"设置，确保也在那里开放 8443 端口（TCP 和 UDP）。

:::warning 云服务商防火墙 (Cloud Provider Firewalls)
许多云服务商（如阿里云、腾讯云、AWS、Oracle Cloud 等）在网页控制台中有自己的防火墙设置。你必须在服务器的本地防火墙**和**云服务商的防火墙中**都**开放端口。
:::

## 你学到了什么

在本章中，你学到了：

- 如何使用**一键安装脚本**在服务器上安装 Prisma
- 替代方法：**Docker**、**直接下载**和**从源码编译**
- 如何**验证**安装是否正常
- Prisma 使用的**目录结构**
- 如何**开放防火墙 (Firewall) 端口**以便 Prisma 接受连接
- 如何排查常见的安装问题

## 下一步

Prisma 已安装完成！现在让我们创建服务端配置文件。前往[配置服务端](./configure-server.md)。
