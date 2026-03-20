---
sidebar_position: 9
---

# 首次连接

## 连接过程

```mermaid
sequenceDiagram
    participant You as 你
    participant CL as Prisma 客户端
    participant SV as Prisma 服务端
    participant Web as 互联网

    You->>CL: 启动客户端
    CL->>SV: 连接到 server:8443
    Note over CL,SV: PrismaVeil v5 握手（1-RTT）
    CL->>SV: ClientInit
    SV-->>CL: ServerInit
    Note over CL,SV: 加密通道建立！
    CL-->>You: "Connected!"

    You->>CL: curl --socks5 127.0.0.1:1080 httpbin.org/ip
    CL->>SV: 加密请求
    SV->>Web: 获取 httpbin.org/ip
    Web-->>SV: {"origin": "203.0.113.45"}
    SV-->>CL: 加密响应
    CL-->>You: 显示服务器 IP = 成功！
```

## 步骤 1：启动服务端

```bash
prisma server -c /etc/prisma/server.toml
```

## 步骤 2：启动客户端

```bash
prisma client -c ~/client.toml
```

## 步骤 3：验证

```bash
curl --socks5 127.0.0.1:1080 https://httpbin.org/ip
```

显示的应该是**服务器的 IP**。

## 故障排查

```mermaid
graph TD
    A["连接失败"] --> B{"服务端运行中？"}
    B -->|"检查"| B1["ps aux | grep prisma"]
    B -->|"是"| C{"防火墙开放？"}
    C -->|"是"| D{"凭证匹配？"}
    D -->|"是"| E["检查 skip_cert_verify"]
```

| 问题 | 解决 |
|------|------|
| 连接被拒绝 | 检查服务端运行状态和防火墙 |
| 认证失败 | 凭证必须完全匹配 |
| TLS 错误 | 设置 `skip_cert_verify = true` |
| 速度慢 | 尝试不同传输方式 |

## 成功！

```mermaid
graph LR
    A["你的电脑"] -->|"加密"| B["Prisma 服务器"] --> C["互联网"]
    style A fill:#22c55e,color:#000
    style B fill:#22c55e,color:#000
```

## 下一步

前往[进阶设置](./advanced-setup.md)。
