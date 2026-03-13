---
sidebar_position: 7
---

# 伪装（抗主动检测）

Prisma 的伪装系统可抵御审查系统（如 GFW）的主动探测，这些系统通过连接并观察响应来识别代理协议。没有伪装时，PrismaVeil 握手可被轻易识别。

## 伪装的重要性

主动探测的工作方式：
1. 检测到可疑连接（例如通过流量分析）
2. 向服务器重放或发起连接
3. 发送 HTTP、TLS 或随机字节
4. 观察服务器的响应是否与真实 Web 服务器不同

如果服务器静默关闭连接或发送意外响应，就会被标记和封锁。伪装使服务器与真正的 HTTPS 网站无法区分。

## TLS-on-TCP

使用与 QUIC 相同的证书和密钥，将 TCP 传输包装在 TLS 层中。PrismaVeil 握手在 TLS 隧道内运行，因此外部流量看起来像标准 HTTPS。

**服务端配置：**

```toml
[tls]
cert_path = "cert.pem"
key_path = "key.pem"

[camouflage]
enabled = true
tls_on_tcp = true
```

**客户端配置：**

```toml
transport = "tcp"
tls_on_tcp = true
tls_server_name = "yourdomain.com"
skip_cert_verify = false
```

客户端通过 TLS 连接到服务器。在 TLS 隧道内，正常的 PrismaVeil 握手继续进行。

## 诱饵回退

当非 Prisma 连接到达时（HTTP 探测、浏览器访问、GFW 主动探测），服务器会将其反向代理到可配置的诱饵网站，而不是断开连接。这使服务器行为与真实的 HTTPS 反向代理完全一致。

```toml
[camouflage]
enabled = true
fallback_addr = "example.com:443"
```

当探测连接时：
1. 服务器预览前 3 个字节
2. 如果字节不匹配 PrismaVeil ClientHello，整个连接（包括预览的字节）会被转发到 `fallback_addr`
3. 探测者看到的是真实网站响应

## ALPN 自定义

默认情况下，QUIC 使用 `"prisma-v1"` 作为 ALPN 协议，这是一个指纹特征。启用伪装后，ALPN 默认设置为 `["h2", "http/1.1"]` — 与真实 HTTPS 站点使用的协议匹配。

```toml
[camouflage]
enabled = true
alpn_protocols = ["h2", "http/1.1"]
```

客户端必须使用匹配的 ALPN：

```toml
alpn_protocols = ["h2", "http/1.1"]
```

## 完整配置示例

### 服务端

```toml
listen_addr = "0.0.0.0:8443"
quic_listen_addr = "0.0.0.0:8443"

[tls]
cert_path = "/etc/prisma/cert.pem"
key_path = "/etc/prisma/key.pem"

[[authorized_clients]]
id = "your-client-uuid"
auth_secret = "your-hex-secret"
name = "laptop"

[camouflage]
enabled = true
tls_on_tcp = true
fallback_addr = "example.com:443"
alpn_protocols = ["h2", "http/1.1"]
```

### 客户端

```toml
socks5_listen_addr = "127.0.0.1:1080"
server_addr = "yourserver.com:8443"
transport = "tcp"
tls_on_tcp = true
tls_server_name = "yourserver.com"
alpn_protocols = ["h2", "http/1.1"]
skip_cert_verify = false

[identity]
client_id = "your-client-uuid"
auth_secret = "your-hex-secret"
```

## 最佳实践

- **使用真实域名证书** — 从 Let's Encrypt 获取域名证书。自签名证书可被检测。
- **选择热门诱饵站点** — 使用在您所在地区常被访问的站点（例如 CDN 端点、云提供商首页）。
- **ALPN 与诱饵匹配** — 如果诱饵站点提供 HTTP/2，使用 `["h2", "http/1.1"]`。这是默认配置。
- **谨慎使用 QUIC** — 在审查严格的网络中，QUIC/UDP 可能被完全封锁。TLS-on-TCP 通常更可靠。
- **设置 `tls_server_name`** — 确保 SNI 与证书的 CN 或 SAN 匹配，以获得干净的 TLS 握手。

## 配置参考

### 服务端 (`[camouflage]`)

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | bool | `false` | 启用伪装（激活诱饵回退和 ALPN 覆盖） |
| `tls_on_tcp` | bool | `false` | 将 TCP 传输包装在 TLS 中 |
| `fallback_addr` | string? | — | 非 Prisma 流量要代理到的诱饵服务器地址 |
| `alpn_protocols` | string[] | `["h2", "http/1.1"]` | TLS/QUIC ALPN 协议 |

### 客户端

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `tls_on_tcp` | bool | `false` | 通过 TLS 包装的 TCP 连接到服务器 |
| `tls_server_name` | string? | — | TLS SNI 服务器名称（默认使用 `server_addr` 中的主机名） |
| `alpn_protocols` | string[] | `["h2", "http/1.1"]` | TLS ALPN 协议（必须与服务端匹配） |
