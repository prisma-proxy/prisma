---
sidebar_position: 4
---

# 准备工作

## 部署架构选项

```mermaid
graph TD
    subgraph "方案 A：直连"
        A1["客户端"] -->|"QUIC/TCP"| A2["Prisma 服务器"]
        A2 --> A3["互联网"]
    end
    subgraph "方案 B：CDN 中转"
        B1["客户端"] -->|"WebSocket"| B2["Cloudflare CDN"]
        B2 --> B3["Prisma 服务器"] --> B4["互联网"]
    end
    style A2 fill:#3b82f6,color:#fff
    style B2 fill:#f59e0b,color:#000
```

| 架构 | 隐蔽性 | 速度 | 适用场景 |
|------|-------|------|---------|
| 直连 | 中 | 最快 | 审查较少的环境 |
| CDN 中转 | 高 | 好 | 需要隐藏服务器 IP |

## 你需要什么

```mermaid
graph LR
    LC["本地电脑\n（运行客户端）"] <-->|"加密隧道"| VPS["远程 VPS\n（运行服务端）"]
```

### 服务器要求

| 资源 | 最低 | 推荐 |
|------|------|------|
| CPU | 1 核 | 2 核 |
| 内存 | 256 MB | 512 MB |
| 带宽 | 500 GB/月 | 1 TB/月 |
| 系统 | 任何现代 Linux | Ubuntu 24.04 LTS |

### 防火墙规划

```mermaid
graph TD
    CL["客户端\n1080/8080"] -->|"出站 8443"| FW["防火墙"]
    FW -->|"入站 8443"| SV["服务端\n8443 TCP+UDP"]
```

| 端口 | 协议 | 用途 | 必需？ |
|------|------|------|--------|
| 8443 | TCP+UDP | Prisma | 是 |
| 22 | TCP | SSH | 是 |
| 443 | TCP | 替代端口 | 可选 |

## 连接服务器（SSH）

```bash
ssh root@你的服务器IP
```

## 终端基础

| 命令 | 功能 |
|------|------|
| `ls` | 列出文件 |
| `cd` | 切换目录 |
| `nano` | 编辑文件 |
| `sudo` | 管理员权限 |
| `systemctl` | 管理服务 |

## 更新服务器

```bash
sudo apt update && sudo apt upgrade -y
```

## 下一步

前往[安装服务端](./install-server.md)。
