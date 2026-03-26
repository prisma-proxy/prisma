---
sidebar_position: 2
---

# 快速开始

本指南将引导您完成 Prisma v2.24.0 的安装和首次代理会话——支持预编译二进制文件或从源码构建。

## 前置要求

- 一台具有公网 IP 的服务器（VPS、云实例等）
- 一台客户端设备（笔记本、台式机或移动设备）
- 从源码构建：[Rust](https://rustup.rs/) 稳定版工具链和 Git

## 方式 A：预编译二进制文件（推荐）

下载适用于您平台的最新 v2.24.0 版本：

```bash
# Linux x86_64
curl -fsSL https://github.com/prisma-proxy/prisma/releases/download/v2.24.0/prisma-linux-amd64 -o prisma && chmod +x prisma

# macOS (Apple Silicon)
curl -fsSL https://github.com/prisma-proxy/prisma/releases/download/v2.24.0/prisma-darwin-arm64 -o prisma && chmod +x prisma

# macOS (Intel)
curl -fsSL https://github.com/prisma-proxy/prisma/releases/download/v2.24.0/prisma-darwin-amd64 -o prisma && chmod +x prisma
```

或使用一键安装脚本：

```bash
curl -fsSL https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.sh | bash
```

验证安装：

```bash
prisma version
```

预期输出：

```
Prisma v2.24.0
Protocol: PrismaVeil v5
Ciphers:  ChaCha20-Poly1305, AES-256-GCM, Transport-Only
Transports: QUIC, TCP, WebSocket, gRPC, XHTTP, XPorta, SSH, WireGuard
```

## 方式 B：从源码构建

```bash
git clone https://github.com/prisma-proxy/prisma.git && cd prisma
cargo build --release
sudo cp target/release/prisma /usr/local/bin/
```

## 快速上手

### 1. 生成凭证

```bash
prisma gen-key
```

输出：

```
Client ID:   a1b2c3d4-e5f6-7890-abcd-ef1234567890
Auth Secret: 4f8a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a

# 添加到 server.toml：
[[authorized_clients]]
id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
auth_secret = "4f8a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a"
name = "my-client"

# 添加到 client.toml：
[identity]
client_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
auth_secret = "4f8a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a"
```

### 2. 生成 TLS 证书（QUIC 必需）

```bash
prisma gen-cert --output . --cn prisma-server
```

这将在当前目录创建 `prisma-cert.pem` 和 `prisma-key.pem`。

### 3. 生成配置文件

最快的方式是使用 `prisma init`，它会生成带注释的配置文件并自动创建新的凭证：

```bash
prisma init
```

这将同时创建 `server.toml` 和 `client.toml`，包含自动生成的 UUID、认证密钥和详细注释。您也可以使用 `prisma init --cdn` 来包含完整注释的 CDN 传输配置部分。

或者，手动创建配置：

#### server.toml

```toml title="server.toml"
listen_addr = "0.0.0.0:8443"
quic_listen_addr = "0.0.0.0:8443"

# 启用配置文件变更时自动热重载
config_watch = true

[tls]
cert_path = "prisma-cert.pem"
key_path = "prisma-key.pem"

[[authorized_clients]]
id = "<gen-key 生成的 client-id>"
auth_secret = "<gen-key 生成的 auth-secret>"
name = "my-laptop"

[logging]
level = "info"
format = "pretty"

[performance]
max_connections = 1024
connection_timeout_secs = 300

[management]
enabled = true
listen_addr = "127.0.0.1:9090"
token = "your-secure-management-token"
```

#### client.toml

```toml title="client.toml"
socks5_listen_addr = "127.0.0.1:1080"
http_listen_addr = "127.0.0.1:8080"
server_addr = "<服务器IP>:8443"
cipher_suite = "chacha20-poly1305"
transport = "quic"
skip_cert_verify = true  # 开发环境中使用自签名证书时设为 true

[identity]
client_id = "<相同的 client-id>"
auth_secret = "<相同的 auth-secret>"

[logging]
level = "info"
format = "pretty"
```

### 4. 运行

**前台模式**（适合开发和调试）：

```bash
# 终端 1 — 启动服务端
prisma server -c server.toml

# 终端 2 — 启动客户端
prisma client -c client.toml
```

**守护进程模式**（后台进程，支持 PID 文件管理）：

```bash
# 以守护进程方式启动服务端
prisma server -d -c server.toml

# 以守护进程方式启动客户端
prisma client -d -c client.toml

# 查看状态
prisma server status
prisma client status

# 停止守护进程
prisma server stop
prisma client stop
```

### 5. 启动 Web 控制台（可选）

```bash
prisma console --token your-secure-management-token
```

该命令会自动下载（并缓存）Web 控制台，在 9091 端口启动本地服务器，并自动打开浏览器。

### 6. 测试连接

**SOCKS5 代理：**

```bash
curl --socks5 127.0.0.1:1080 https://httpbin.org/ip
```

**HTTP CONNECT 代理：**

```bash
curl --proxy http://127.0.0.1:8080 https://httpbin.org/ip
```

**浏览器配置：**

将浏览器的代理设置配置为使用 SOCKS5（`127.0.0.1:1080`）或 HTTP 代理（`127.0.0.1:8080`）。

## 下一步

- [安装](./installation.md) — 详细的各平台安装说明
- [CLI 参考](./cli-reference.md) — 完整的命令文档
- [服务端配置](./configuration/server.md) — 所有服务端配置选项
- [客户端配置](./configuration/client.md) — 所有客户端配置选项
- [路由规则](./features/routing-rules.md) — 基于域名/IP/GeoIP 的路由
- [Web 控制台](./features/console.md) — 实时监控面板
- [故障排除](./troubleshooting.md) — 常见问题与解决方案
