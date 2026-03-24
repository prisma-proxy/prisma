---
sidebar_position: 3
---

# Prisma 的工作原理

## 客户端和服务端

```mermaid
graph LR
    subgraph "你的设备"
        BR["浏览器"] --> CL["Prisma 客户端"]
    end
    subgraph "你的 VPS"
        SV["Prisma 服务端"]
    end
    subgraph "互联网"
        W["网站"]
    end
    CL <-->|"加密隧道\nPrismaVeil v5"| SV --> W
```

## 完整连接流程

```mermaid
sequenceDiagram
    participant Browser as 浏览器
    participant Client as Prisma 客户端
    participant Tunnel as 加密隧道
    participant Server as Prisma 服务端
    participant Website as example.com

    Browser->>Client: CONNECT example.com:443
    Note over Client: 用 PrismaVeil v5 加密
    Client->>Tunnel: 加密帧（随机字节）
    Tunnel->>Server: 加密帧到达
    Note over Server: 解密并获取网站
    Server->>Website: HTTPS 请求
    Website-->>Server: 响应
    Server->>Tunnel: 加密响应
    Tunnel->>Client: 解密
    Client->>Browser: 网页内容
```

## PrismaVeil v5 协议

### 握手过程（1-RTT）

```mermaid
sequenceDiagram
    participant C as 客户端
    participant S as 服务端
    C->>S: ClientInit（公钥 + 客户端ID + 认证证明）
    Note over S: 验证认证、派生共享密钥
    S->>C: ServerInit（服务端公钥 + 会话票据）
    Note over C,S: 对称加密激活（ChaCha20 或 AES-256-GCM）
```

### 加密层

```mermaid
graph TD
    D["应用数据"] --> E["PrismaVeil 加密\nChaCha20/AES-256 + 填充 + 防重放"]
    E --> T["传输加密\nTLS 1.3 / WireGuard / SSH"]
    T --> N["网络数据包"]
```

## 传输方式

| 传输 | 协议 | CDN | 隐蔽性 | 速度 |
|------|------|-----|-------|------|
| **QUIC** | UDP | 否 | 中 | 最快 |
| **TCP** | TCP | 否 | 中 | 快 |
| **WebSocket** | TCP | 是 | 中高 | 好 |
| **gRPC** | TCP | 是 | 高 | 好 |
| **XHTTP** | TCP | 是 | 高 | 好 |
| **XPorta** | TCP | 是 | 最高 | 中等 |
| **SSH** | TCP | 否 | 中 | 好 |
| **WireGuard** | UDP | 否 | 低 | 最快 |

### 传输选择决策树

```mermaid
graph TD
    START["开始"] --> Q1{"UDP 被屏蔽？"}
    Q1 -->|"否"| Q2{"需要隐藏 IP？"}
    Q1 -->|"是"| Q3{"有域名+CDN？"}
    Q2 -->|"否"| QUIC["使用 QUIC"]
    Q2 -->|"是"| Q3
    Q3 -->|"否"| TCP["使用 TCP"]
    Q3 -->|"是"| Q5{"审查严重？"}
    Q5 -->|"一般"| WS["使用 WebSocket"]
    Q5 -->|"严重"| XPORTA["使用 XPorta"]
    style QUIC fill:#22c55e,color:#000
    style XPORTA fill:#ef4444,color:#fff
```

## XMUX 多路复用

```mermaid
graph LR
    subgraph "XMUX 连接池"
        S1["流 1"] --> C1["连接 1"]
        S2["流 2"] --> C1
        S3["流 3"] --> C2["连接 2"]
    end
    C1 --> SV["服务器"]
    C2 --> SV
```

## 为什么 Prisma 难以被检测

```mermaid
graph TD
    T1["运营商读取流量"] -->|"防御"| D1["全部加密"]
    T2["防火墙屏蔽端口"] -->|"防御"| D2["运行在 443 端口"]
    T3["DPI 检测协议"] -->|"防御"| D3["无可识别签名"]
    T4["流量模式分析"] -->|"防御"| D4["填充+抖动+干扰"]
    T5["主动探测"] -->|"防御"| D5["伪装模式"]
    T6["服务器 IP 被封"] -->|"防御"| D6["CDN 传输隐藏 IP"]
    style D1 fill:#22c55e,color:#000
    style D2 fill:#22c55e,color:#000
    style D3 fill:#22c55e,color:#000
    style D4 fill:#22c55e,color:#000
    style D5 fill:#22c55e,color:#000
    style D6 fill:#22c55e,color:#000
```

## 下一步

前往[准备工作](./prepare.md)。
