---
sidebar_position: 10
---

# 进阶设置

## Cloudflare CDN 部署

```mermaid
graph LR
    CL["客户端"] -->|"WebSocket/XPorta"| CF["Cloudflare CDN"]
    CF -->|"HTTPS"| SV["Prisma 服务器"]
    SV --> WEB["网站"]
```

1. 将域名添加到 Cloudflare，创建 A 记录并启用代理
2. 从 Cloudflare 获取源站证书
3. 服务端使用 443 端口和源站证书
4. 客户端使用 `transport = "ws"` 或 `"xporta"`

## XMUX 连接池

```mermaid
graph LR
    subgraph "使用 XMUX"
        S1["流 1"] --> P1["连接 1"]
        S2["流 2"] --> P1
        S3["流 3"] --> P2["连接 2"]
    end
    P1 --> SV["服务器"]
    P2 --> SV
```

```toml
# [xmux] 配置节的存在即表示启用多路复用，无需单独的开关
[xmux]
max_connections_min = 1
max_connections_max = 4
max_concurrency_min = 8
max_concurrency_max = 128
```

## 路由规则（分流）

```toml
[[routing.rules]]
type = "ip-cidr"
value = "192.168.0.0/16"
action = "direct"

[[routing.rules]]
type = "domain-keyword"
value = "ads"
action = "block"

[[routing.rules]]
type = "all"
action = "proxy"
```

## 代理组故障转移

```mermaid
graph TD
    REQ["请求"] --> PG["故障转移组"]
    PG --> S1{"tokyo-1 可用？"}
    S1 -->|"是"| USE1["使用 tokyo-1"]
    S1 -->|"否"| S2{"singapore-1 可用？"}
    S2 -->|"是"| USE2["使用 singapore-1"]
    style USE1 fill:#22c55e,color:#000
```

## 规则提供者

```toml
[[rule_providers]]
name = "ad-block"
type = "domain"
url = "https://example.com/rules/ad-domains.txt"
interval_hours = 24
action = "block"
```

## io_uring 性能调优

Linux 5.11+ 自动启用 io_uring 零拷贝 I/O。

```toml
[performance]
max_connections = 4096

[congestion]
mode = "bbr"
```

## 安全最佳实践

1. 始终用 `prisma gen-key` 生成凭证
2. 生产环境使用 Let's Encrypt 证书
3. 管理 API 绑定到 `127.0.0.1`
4. 每台设备使用唯一凭证
5. 定期检查日志

## 恭喜！

你已经完成了 Prisma 新手指南。更多内容请查看：

- [服务端配置参考](/docs/configuration/server)
- [客户端配置参考](/docs/configuration/client)
- [配置示例](/docs/deployment/config-examples)
- [PrismaVeil 协议](/docs/security/prismaveil-protocol)
