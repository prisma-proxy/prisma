---
sidebar_position: 8
---

# 配置客户端

## 配置流程

```mermaid
graph TD
    START["开始"] --> CREDS["准备凭证"]
    CREDS --> METHOD{"GUI 还是 CLI？"}
    METHOD -->|"GUI"| GUI["创建配置"]
    METHOD -->|"CLI"| TOML["编写 client.toml"]
    GUI --> TRANSPORT["选择传输方式"]
    TOML --> TRANSPORT
    TRANSPORT --> DONE["准备连接！"]
    style DONE fill:#22c55e,color:#000
```

## CLI 配置

```toml title="client.toml"
socks5_listen_addr = "127.0.0.1:1080"
http_listen_addr = "127.0.0.1:8080"
server_addr = "你的服务器IP:8443"
cipher_suite = "chacha20-poly1305"
transport = "quic"
skip_cert_verify = true

[identity]
client_id = "你的客户端ID"
auth_secret = "你的认证密钥"

[logging]
level = "info"
format = "pretty"
```

## 传输选择

```mermaid
graph TD
    Q1{"UDP 被屏蔽？"} -->|"否"| QUIC["QUIC"]
    Q1 -->|"是"| Q2{"有 CDN？"}
    Q2 -->|"否"| TCP["TCP"]
    Q2 -->|"是"| Q3{"审查严重？"}
    Q3 -->|"一般"| WS["WebSocket"]
    Q3 -->|"严重"| XPORTA["XPorta"]
    style QUIC fill:#22c55e,color:#000
    style XPORTA fill:#ef4444,color:#fff
```

## 订阅管理

```toml
[[subscriptions]]
url = "https://example.com/sub/token"
auto_update = true
```

## 代理组

```mermaid
graph LR
    AUTO["自动选择"] --> S1["东京"]
    AUTO --> S2["新加坡"]
    FB["故障转移"] --> S1
    FB --> S2
```

```toml
[[proxy_groups]]
name = "auto-best"
type = "auto-url"
servers = ["tokyo-1", "singapore-1"]
test_url = "https://www.google.com/generate_204"
```

## DNS 和 TUN 模式

```toml
[dns]
mode = "tunnel"

[tun]
enabled = true
```

## 下一步

前往[首次连接](./first-connection.md)。
