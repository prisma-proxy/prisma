---
sidebar_position: 6
---

# CLI 参考

`prisma` 二进制文件提供九个子命令，用于运行服务端和客户端、生成凭证、管理配置以及诊断。

## `prisma server`

启动代理服务端。

```bash
prisma server -c <PATH>
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `-c, --config <PATH>` | `server.toml` | 服务端配置文件路径 |

服务端同时启动 TCP 和 QUIC 监听器，等待客户端连接。启动时会验证配置，如果验证失败则退出并报错。

## `prisma client`

启动代理客户端。

```bash
prisma client -c <PATH>
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `-c, --config <PATH>` | `client.toml` | 客户端配置文件路径 |

客户端启动 SOCKS5 监听器（以及可选的 HTTP CONNECT 监听器），连接到远程服务器，执行 PrismaVeil 握手，然后开始代理流量。

## `prisma gen-key`

生成新的客户端身份标识（UUID + 认证密钥对）。

```bash
prisma gen-key
```

无需参数。输出一个新的 UUID 和 64 字符的十六进制密钥，以及可直接粘贴到服务端和客户端配置文件的 TOML 代码片段：

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

## `prisma gen-cert`

生成用于开发环境的自签名 TLS 证书。

```bash
prisma gen-cert -o <DIR> --cn <NAME>
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `-o, --output <DIR>` | `.` | 证书和密钥文件的输出目录 |
| `--cn <NAME>` | `prisma-server` | 证书的通用名称（Common Name） |

在输出目录生成两个文件：

- `prisma-cert.pem` — 自签名 X.509 证书
- `prisma-key.pem` — PEM 格式的私钥

示例：

```bash
prisma gen-cert -o /etc/prisma --cn my-server.example.com
```

:::warning
自签名证书仅适用于开发环境。生产环境请使用受信任 CA 或 Let's Encrypt 颁发的证书。使用自签名证书时，客户端必须设置 `skip_cert_verify = true`。
:::

## `prisma init`

生成带注释的配置文件，并自动生成密钥。

```bash
prisma init [OPTIONS]
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `--cdn` | — | 包含预配置的 CDN 部分 |
| `--server-only` | — | 仅生成服务端配置 |
| `--client-only` | — | 仅生成客户端配置 |
| `--force` | — | 覆盖已有文件 |

默认同时生成 `server.toml` 和 `client.toml`，包含新生成的 UUID、认证密钥和详细注释。使用 `--cdn` 可包含完整注释的 CDN 传输配置部分。

示例：

```bash
# 生成包含 CDN 部分的两个配置文件
prisma init --cdn

# 仅生成客户端配置，覆盖已有文件
prisma init --client-only --force
```

## `prisma validate`

在不启动服务的情况下验证配置文件。

```bash
prisma validate -c <PATH> [-t <TYPE>]
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `-c, --config <PATH>` | — | 配置文件路径 |
| `-t, --type <TYPE>` | `server` | 配置类型：`server` 或 `client` |

解析 TOML 文件并运行所有验证规则。验证通过则以代码 0 退出，否则输出错误信息并以非零代码退出。

示例：

```bash
prisma validate -c server.toml
prisma validate -c client.toml -t client
```

## `prisma status`

查询管理 API 获取服务器状态。

```bash
prisma status [-u <URL>] [-t <TOKEN>]
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `-u, --url <URL>` | `http://127.0.0.1:9090` | 管理 API 地址 |
| `-t, --token <TOKEN>` | — | 管理 API 认证令牌 |

连接到管理 API 并显示服务器健康状态、运行时间、版本和活跃连接数。

示例：

```bash
prisma status -u http://127.0.0.1:9090 -t your-auth-token
```

## `prisma speed-test`

运行针对服务器的带宽测试。

```bash
prisma speed-test -s <SERVER> [OPTIONS]
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `-s, --server <HOST:PORT>` | — | 服务器地址 |
| `-d, --duration <SECS>` | `10` | 测试持续时间（秒） |
| `--direction <DIR>` | `both` | 方向：`download`、`upload` 或 `both` |
| `-C, --config <PATH>` | `client.toml` | 客户端配置文件（用于认证凭证） |

使用客户端配置进行认证并建立隧道，然后在指定方向上测量吞吐量。

示例：

```bash
prisma speed-test -s my-server.example.com:8443 -d 15 --direction download
```

## `prisma version`

显示版本信息、协议版本和支持的功能。

```bash
prisma version
```

无需参数。输出 Prisma 版本、PrismaVeil 协议版本、支持的加密算法、支持的传输方式以及 v2 和 v3 的功能列表。
