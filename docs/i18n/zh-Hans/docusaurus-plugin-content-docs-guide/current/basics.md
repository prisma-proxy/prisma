---
sidebar_position: 2
---

# 理解基础概念

在安装 Prisma 之前，让我们先建立关于互联网工作原理的心理模型。

## 互联网如何工作

```mermaid
graph LR
    A["你的电脑"] -->|"请求"| R1["路由器"]
    R1 --> ISP["运营商"]
    ISP --> IX["互联网交换中心"]
    IX --> DSP["目标运营商"]
    DSP --> S["网站服务器"]
    S -->|"响应"| DSP --> IX --> ISP --> R1 --> A
```

## IP 地址和域名

**DNS** 将域名翻译成 IP 地址：

```mermaid
sequenceDiagram
    participant You as 你的电脑
    participant DNS as DNS 服务器
    participant Web as google.com

    You->>DNS: google.com 的 IP 是什么？
    DNS-->>You: 是 142.250.80.46
    You->>Web: 连接到 142.250.80.46
    Web-->>You: 这是网页！
```

## 端口和协议

| 端口 | 协议 | 用途 |
|------|------|------|
| 80 | HTTP | 网站（未加密） |
| 443 | HTTPS | 网站（加密） |
| 22 | SSH | 远程访问 |
| 1080 | SOCKS5 | 代理 |
| 8443 | 自定义 | Prisma 默认 |

## HTTP、HTTPS 和 TLS

```mermaid
graph TD
    subgraph "没有 HTTPS"
        A1["浏览器"] -->|"明文"| B1["运营商"] -->|"明文"| C1["网站"]
    end
    subgraph "有 HTTPS"
        A2["浏览器"] -->|"加密"| B2["运营商"] -->|"加密"| C2["网站"]
    end
```

:::warning HTTPS 还不够
即使使用 HTTPS，运营商仍能看到你访问了哪些域名。Prisma 连域名都能隐藏。
:::

## 什么是代理？

```mermaid
graph LR
    A["你的电脑"] -->|"请求"| P["代理服务器"]
    P -->|"替你请求"| W["网站"]
    W -->|"响应"| P -->|"响应"| A
```

## 代理与 VPN 的区别

```mermaid
graph TD
    subgraph "代理（Prisma）"
        PA["应用"] --> PP["代理客户端"] -->|"应用层加密"| PS["代理服务器"] --> PI["互联网"]
    end
    subgraph "传统 VPN"
        VA["所有流量"] --> VT["VPN 隧道"] -->|"隧道层加密"| VS["VPN 服务器"] --> VI["互联网"]
    end
```

| 特性 | 代理（Prisma） | 传统 VPN |
|------|--------------|---------|
| 覆盖范围 | 按应用或全系统（TUN） | 所有流量 |
| 抗检测 | 非常高（8 种传输） | 低 |
| CDN 支持 | 完整 | 罕见 |

## 防火墙和 DPI

```mermaid
graph LR
    A["你的电脑"] -->|"流量"| FW["防火墙/DPI"]
    FW -->|"允许"| I["互联网"]
    FW -->|"阻止"| X["被屏蔽！"]
    style FW fill:#ef4444,color:#fff
```

| DPI 技术 | Prisma 应对 |
|---------|-----------|
| 协议签名匹配 | PrismaVeil 无可识别签名 |
| 数据包大小分析 | 每帧随机填充 |
| 时间关联 | 时间抖动随机化 |
| 熵分析 | 熵伪装调整分布 |
| 主动探测 | 伪装模式以真实网站回应 |

## 总结

```mermaid
graph TD
    IP["IP 地址"] --> DNS["DNS"] --> PORT["端口"] --> PROTO["协议"]
    PROTO --> HTTPS["HTTPS/TLS"] --> PROXY["代理"] --> PRISMA["Prisma\n加密 + 不可检测"]
    style PRISMA fill:#22c55e,color:#000
```

## 下一步

前往 [Prisma 的工作原理](./how-prisma-works.md)。
