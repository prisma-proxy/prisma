---
sidebar_position: 8
---

# 反检测特性 (Anti-Detection)

PrismaVeil 包含多层反检测机制，可抵御深度包检测 (DPI)、主动探测 (Active Probing) 和审查系统（如 GFW）的流量分析 (Traffic Analysis)。

## Salamander UDP 混淆 (Obfuscation)

Salamander 剥离 QUIC 协议头部并对所有 UDP 数据包进行 XOR 混淆 (Obfuscation)，使流量呈现为随机噪声。

### 工作原理

1. 使用 BLAKE3 从共享密码派生密钥流
2. 为每个数据包生成逐包 nonce（非确定性），防止关联攻击
3. 使用 nonce 密钥流对每个出站 UDP 数据包进行 XOR 运算后发送
4. 接收时提取 nonce 并 XOR 以恢复原始 QUIC 数据包
5. 结果：线路上没有可识别的 QUIC 或 TLS 头部

### 熵伪装 (Entropy Camouflage)

Salamander v2 在每个混淆数据包前添加短 ASCII 前缀。这降低了数据包的测量熵 (Entropy)，以通过 GFW Ex2（熵分析）检查——该检查会标记纯随机流量。ASCII 前缀从数据包 nonce 确定性派生，接收方可以无歧义地剥离。

### 配置

```toml
# 服务端
[camouflage]
salamander_password = "your-shared-obfuscation-password"

# 客户端
salamander_password = "your-shared-obfuscation-password"
```

### 使用场景

- 网络屏蔽所有可识别的 QUIC 流量
- 环境仅白名单已知协议（随机 UDP 仍可能通过）

## 端口跳跃 (Port Hopping)

定期更改 QUIC 连接使用的 UDP 端口，防止基于 IP:端口 的封锁。

### 工作原理

客户端和服务端使用 HMAC-SHA256 计算相同的端口：

```
current_port = base_port + HMAC-SHA256(auth_secret, epoch)[0..2] % port_range
epoch = floor(current_time / interval_secs)
```

过渡期间，宽限期允许在新旧端口上同时接受连接。

### 配置

```toml
# 服务端
[port_hopping]
enabled = true
base_port = 10000
port_range = 50000       # 端口范围 10000-60000
interval_secs = 60       # 每 60 秒跳跃一次
grace_period_secs = 10   # 双端口窗口期

# 客户端
[port_hopping]
enabled = true
# 客户端自动使用相同参数
```

## 拥塞控制 (Congestion Control)

三种模式应对不同网络条件：

### Brutal（Hysteria2 风格）

忽略丢包信号，以固定目标速率发送。可克服 ISP 限速。

```toml
[congestion]
mode = "brutal"
target_bandwidth = "100mbps"
```

### BBR（默认）

Google BBRv2 — 探测带宽和 RTT。与其他流量公平共享。

```toml
[congestion]
mode = "bbr"
```

### 自适应模式

以 BBR 行为启动。检测到故意限速（持续丢包 + 稳定 RTT）时逐渐增加激进性。限速停止时恢复 BBR 行为。

```toml
[congestion]
mode = "adaptive"
target_bandwidth = "100mbps"
```

## PrismaTLS

PrismaTLS 取代 REALITY 协议，提供主动探测 (Active Probing) 抵抗能力。它将认证标签隐藏在 TLS padding 扩展中，而非已弃用的 Session ID 字段。

- **PrismaAuth**：通过 padding 扩展信标 (Beacon) 进行身份验证（基于时间窗口轮换，位置随机化）
- **PrismaMask**：动态掩护服务器池 (Mask Server Pool)，自动健康检查和故障切换 (Failover)
- **PrismaFP**：字节级 ClientHello 构建，匹配 Chrome/Firefox/Safari 浏览器指纹 (Fingerprint)
- **PrismaFlow**：HTTP/2 SETTINGS 帧模拟 + RTT 归一化 (Normalization)

## 流量整形 (Traffic Shaping)

防御封装 TLS 指纹识别 (Fingerprinting)（USENIX Security 2024）：

- **桶填充 (Bucket Padding)**：将帧填充到固定大小集合中的最近尺寸
- **杂音注入 (Chaff Injection)**：空闲期间发送虚假帧作为背景噪声
- **时序抖动 (Timing Jitter)**：对握手 (Handshake) 阶段帧添加随机延迟
- **帧合并 (Frame Coalescing)**：在时间窗口内缓冲小帧并合并

### 配置

```toml
[traffic_shaping]
padding_mode = "bucket"
bucket_sizes = [128, 256, 512, 1024, 2048, 4096, 8192, 16384]
timing_jitter_ms = 30
chaff_interval_ms = 500
coalesce_window_ms = 5
```

## 伪装与回退 (Camouflage & Fallback)

非 PrismaVeil 连接会被透明代理 (Proxy) 到诱饵网站 (Decoy Site)，使服务器对主动探测者而言与普通 Web 服务器无法区分。

```toml
[camouflage]
enabled = true
fallback_addr = "127.0.0.1:8080"   # 要代理到的真实 Web 服务器
tls_on_tcp = true
```

## 逐帧填充 (Per-Frame Padding)

在协商范围内为每个加密数据帧添加随机填充 (Padding)，防止基于数据包大小分布的流量分析。

```toml
[padding]
min = 0
max = 256
```

## DNS 泄露防护 (DNS Leak Prevention)

四种 DNS 模式防止 DNS 查询泄露到隧道 (Tunnel) 外：

### 直连模式（默认）

不进行 DNS 处理 — 域名传递到服务端解析。当 SOCKS5/HTTP 代理处理所有流量时是安全的。

### 智能 DNS (Smart DNS)

被封锁的域名（Google、YouTube、Twitter 等）始终通过隧道路由 (Routing)。其他域名直接解析以提高速度。智能 DNS 还会覆盖直连路由规则 — 被封锁的域名始终走代理。

```toml
[dns]
mode = "smart"
```

### 虚假 DNS (Fake DNS)（TUN 模式）

从保留地址池（198.18.0.0/15）为所有域名分配虚假 IP。零 DNS 泄露 — 不会有真实 DNS 查询离开设备。当流量到达虚假 IP 时，会查找真实域名并进行代理。

```toml
[dns]
mode = "fake"
fake_ip_range = "198.18.0.0/15"
```

### 隧道全部 DNS (Tunnel All DNS)

每个 DNS 查询都通过 CMD_DNS_QUERY 加密 (Encryption) 并发送到隧道。服务端解析并返回响应。最大化隐私但延迟 (Latency) 略高。

```toml
[dns]
mode = "tunnel"
upstream = "8.8.8.8:53"   # 服务端上游 DNS
```

## TUN 模式（系统全局代理）

通过虚拟网络接口捕获所有系统流量 — 无需逐应用配置代理。游戏、系统服务和所有应用程序都会自动代理。

```toml
[tun]
enabled = true
device_name = "prisma-tun0"
mtu = 1500
dns = "fake"   # TUN 模式下使用虚假 DNS
```

支持所有主要平台：
- **Linux**：需要 `CAP_NET_ADMIN`（使用 `/dev/net/tun`）
- **Windows**：使用 Wintun 驱动（Windows 10+ 无需管理员安装）
- **macOS**：使用 utun 内核接口（需要 root 权限）

## 多传输协议 (Multi-Transport)

不同传输协议具有不同的可检测性特征：

| 传输协议 | DPI 抗性 | CDN 兼容 | UDP 支持 |
|-----------|---------|---------|----------|
| QUIC + Salamander | 最高 | 否 | 是（原生） |
| QUIC（标准） | 高 | 否 | 是（原生） |
| PrismaTLS | 最高 | 否 | TCP 回退 |
| XPorta | 最高 | 是 | TCP 回退 |
| XHTTP (stream-one) | 高 | 是 | TCP 回退 |
| WebSocket | 中 | 是 | TCP 回退 |
| gRPC | 中 | 是 | TCP 回退 |
| SSH | 中 | 否 | TCP 回退 |
| WireGuard | 中 | 否 | 是（原生） |
| TCP + TLS | 中 | 否 | TCP 回退 |
| TCP（原始） | 低 | 否 | TCP 回退 |

> **注意**：QUIC 传输支持 QUIC v2（RFC 9369）以增强抗协议僵化能力。
