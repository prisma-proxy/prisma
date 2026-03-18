---
sidebar_position: 9
---

# PrismaTLS

PrismaTLS 是 PrismaVeil 的主动探测抵抗系统，用于取代 REALITY 协议。它使服务器在主动探测者看来与真实网站完全一致，同时通过隐藏在 TLS 握手中的信标对合法的 PrismaVeil 客户端进行身份验证。

## 为什么用 PrismaTLS 取代 REALITY

REALITY 将认证数据嵌入 TLS `legacy_session_id` 字段（32 字节）。这种方式存在严重问题：

1. **TLS 1.3 弃用趋势**：浏览器正在逐步取消 TLS 1.3 中的非空 Session ID，任何携带 32 字节 Session ID 的连接都会立即引起怀疑
2. **固定模式**：认证数据始终位于相同偏移位置，使用正确的启发式方法即可检测
3. **单一掩护服务器**：掩护服务器宕机时没有故障切换能力

## 架构

```
Application Data
    ↓
PrismaVeil v5 (framing, AEAD encryption with AAD, stream mux, traffic shaping, connection migration)
    ↓
PrismaTLS (auth embedding, ClientHello construction, mask relay)
    ↓
TLS 1.3 (actual cryptographic transport)
    ↓
TCP / QUIC v2
```

## 组件

### PrismaAuth — Padding 扩展信标 (Beacon)

认证标签隐藏在 TLS `padding` 扩展中，其位置由共享密钥 (Key) 派生。

- **基于时间窗口轮换 (Epoch Rotation)**：标签位置每小时变化一次（可配置）
- **位置随机化 (Position Randomization)**：标签偏移量随每个时间窗口变化，无固定模式
- **前向保密 (Forward Secrecy)**：过去的连接不可关联
- **常数时间验证 (Constant-Time Verification)**：抵抗时序攻击

### PrismaMask — 动态掩护服务器池 (Mask Server Pool)

支持多个掩护服务器，具备自动健康检查 (Health Check) 和故障切换 (Failover) 功能。

- 每 60 秒通过 TCP 连接进行健康检查
- 在健康服务器之间进行轮询负载均衡 (Load Balancing)
- RTT 测量用于时序归一化
- 掩护服务器宕机时自动切换

### PrismaFP — 浏览器指纹模拟 (Fingerprint Mimicry)

在字节级别构建 TLS ClientHello，精确匹配真实浏览器。

- 支持 Chrome、Firefox、Safari 配置文件
- 正确的密码套件顺序、扩展顺序和 GREASE 值
- JA3/JA4 指纹验证
- 填充至目标大小（Chrome 为 512 字节）

### PrismaFlow — 流量归一化 (Traffic Normalization)

握手 (Handshake) 后的指纹防御机制。

- HTTP/2 SETTINGS 帧模拟（匹配 Chrome/Firefox/Safari）
- RTT 归一化（延迟响应以掩盖代理跳转）

## 配置

### 服务端

```toml
[prisma_tls]
enabled = true
auth_secret = "hex-encoded-32-bytes"
auth_rotation_hours = 1

[[prisma_tls.mask_servers]]
addr = "www.microsoft.com:443"
names = ["www.microsoft.com"]

[[prisma_tls.mask_servers]]
addr = "www.apple.com:443"
names = ["www.apple.com"]
```

### 客户端

```toml
transport = "prisma-tls"
tls_server_name = "www.microsoft.com"
fingerprint = "chrome"
prisma_auth_secret = "hex-encoded-32-bytes"
```

## 工作原理

1. 客户端构建模拟 Chrome 指纹的 TLS ClientHello（PrismaFP）
2. 客户端将认证标签嵌入 padding 扩展中基于时间窗口派生的位置（PrismaAuth）
3. 服务端收到 ClientHello，检查 padding 中的认证标签
4. **已认证**：在 TLS 通道内继续 PrismaVeil 握手
5. **未认证**：透明转发至掩护服务器（PrismaMask）
6. 主动探测者看到的完全是真实的掩护网站 — 无法区分

## CDN 兼容性

PrismaTLS 和 CDN 传输适用于不同的威胁模型：

| 模式 | 适用场景 | 是否隐藏服务器 IP？ |
|------|---------|---------------------|
| **QUIC v2 + Salamander** | 直连访问，低延迟 | 否 |
| **TCP + PrismaTLS** | 直连访问，最强主动探测抵抗 | 否 |
| **WebSocket over CDN** | 需要隐藏服务器 IP | 是 |
| **XPorta over CDN** | 最高隐蔽性，隐藏服务器 IP | 是 |

CDN 模式不使用 PrismaTLS，因为 Cloudflare 在边缘节点终止 TLS — padding 扩展对源服务器不可见。
