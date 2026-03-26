---
sidebar_position: 7
---

# PrismaUDP（游戏代理）

PrismaUDP 是 PrismaVeil 中专为代理 UDP 流量设计的子协议 — 适用于游戏、VoIP、视频通话和 DNS。

## 概述

与使用 CMD_CONNECT 的 TCP 代理流量不同，UDP 流量使用一对专用命令：

- **CMD_UDP_ASSOCIATE (0x09)**：客户端请求 UDP 中继会话
- **CMD_UDP_DATA (0x0A)**：双向 UDP 数据报中继

## 工作原理

### SOCKS5 UDP ASSOCIATE

1. 应用程序向 Prisma 客户端发送 SOCKS5 UDP ASSOCIATE 请求
2. 客户端绑定本地 UDP 套接字并回复绑定的地址/端口
3. 客户端建立到服务器的 PrismaVeil 隧道并发送 CMD_UDP_ASSOCIATE
4. 服务器分配服务端 UDP 套接字并确认
5. 应用程序将 UDP 数据报（带 SOCKS5 UDP 头部）发送到本地套接字
6. 客户端剥离 SOCKS5 头部，封装为 CMD_UDP_DATA，加密后通过隧道发送
7. 服务器解密，提取目标地址，转发原始 UDP 数据报
8. 响应沿反向路径返回

### 线路格式

**CMD_UDP_DATA 有效载荷：**

```
[assoc_id:4][frag:1][addr_type:1][dest_addr:var][dest_port:2][udp_payload:var]
```

| 字段 | 说明 |
|------|------|
| `assoc_id` | UDP 关联标识符 |
| `frag` | 分片信息（0 = 未分片） |
| `addr_type` | 0x01=IPv4, 0x03=域名, 0x04=IPv6 |
| `dest_addr` | 目标地址字节 |
| `dest_port` | 目标端口（大端序） |
| `udp_payload` | 原始 UDP 有效载荷 |

## 前向纠错 (Forward Error Correction, FEC)

PrismaUDP 支持可选的 Reed-Solomon FEC，无需重传即可恢复丢失的数据包：

- **Reed-Solomon 纠删编码**：每 `data_shards` 个数据包生成 `parity_shards` 个冗余数据包
- **无重传延迟**：丢失的数据包通过校验数据重建，而非重传
- **可配置开销**：默认 10 个数据 + 3 个校验 = 约 30% 带宽开销

### FEC 配置

```toml
[udp_fec]
enabled = true
data_shards = 10      # 每个 FEC 组的原始数据包数
parity_shards = 3     # 每个组的校验数据包数
```

### FEC 线路格式

启用 FEC 的数据报设置 FLAG_FEC (0x0002) 标志，并在有效载荷前添加 4 字节 FEC 头部：

```
[fec_group:2 LE][fec_index:1][fec_total:1][payload:var]
```

## 性能建议

| 场景 | 推荐配置 |
|------|----------|
| 竞技游戏 | QUIC 传输 + Brutal 拥塞控制 (Congestion Control) + FEC（3 校验） |
| 休闲游戏 | QUIC 传输 + BBR 拥塞控制 (Congestion Control) + 无 FEC |
| VoIP | QUIC 传输 + BBR 拥塞控制 (Congestion Control) + FEC（2 校验） |
| DNS 中继 | 任意传输协议，无需 FEC |

## 配置示例

### 客户端 (client.toml)

```toml
transport = "quic"

[congestion]
mode = "brutal"
target_bandwidth = "50mbps"

[udp_fec]
enabled = true
data_shards = 10
parity_shards = 3
```

### 服务端 (server.toml)

```toml
# PrismaUDP 在所有传输协议上自动可用
# 无需额外的服务端配置
```
