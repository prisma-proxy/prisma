---
sidebar_position: 3
---

# 端口转发 (Port Forwarding)

Prisma 支持 frp 风格的端口转发（反向代理），允许您通过 Prisma 服务器暴露 NAT 或防火墙后面的本地服务。所有流量都通过加密的 PrismaVeil 隧道传输。自 v1.5.0 起，端口转发支持精细的逐转发配置、UDP 转发、通过管理 API 的运行时管理以及通过 FFI 的动态添加/删除。

## 工作原理

```
互联网 ──TCP/UDP──▶ prisma-server:port ──PrismaVeil──▶ prisma-client ──TCP/UDP──▶ 本地服务
```

### 协议流程

1. 客户端与服务端建立加密的 PrismaVeil 隧道
2. 客户端为每个配置的端口转发发送 `RegisterForward` 命令
3. 服务端验证请求的端口是否在允许范围内，并强制执行每客户端限制
4. 服务端对每个注册返回 `ForwardReady`（成功或失败）响应
5. 当外部连接到达服务端的转发端口时，服务端通过隧道发送 `ForwardConnect` 消息
6. 客户端打开到映射 `local_addr` 的本地连接，并通过加密隧道使用多路复用的 `stream_id` 双向中继数据

## 客户端配置

使用 `[[port_forwards]]` 条目将本地服务映射到远程端口。每个转发支持对协议、超时、带宽和访问控制的精细控制。

### 最小示例

```toml
[[port_forwards]]
name = "web"
local_addr = "127.0.0.1:3000"
remote_port = 10080
```

### 包含所有选项的完整示例

```toml
[[port_forwards]]
name = "web-frontend"
local_addr = "127.0.0.1:3000"
remote_port = 10080
protocol = "tcp"                # "tcp"（默认）或 "udp"
bind_addr = "0.0.0.0"          # 服务端绑定地址覆盖
max_connections = 50            # 最大并发连接数（0 = 无限制）
idle_timeout_secs = 600         # 空闲 N 秒后关闭连接（默认：300）
connect_timeout_secs = 5        # 连接本地服务的超时时间（默认：10）
bandwidth_up = "10mbps"         # 单转发上传限制
bandwidth_down = "50mbps"       # 单转发下载限制
allowed_ips = ["10.0.0.0/8"]   # 服务端监听的 IP 白名单（空 = 允许所有）
enabled = true                  # 启用/禁用此转发（默认：true）
retry_on_failure = true         # 本地连接失败时自动重试（默认：false）
buffer_size = 16384             # 自定义中继缓冲区大小（字节，默认：8192）

[[port_forwards]]
name = "game-server"
local_addr = "127.0.0.1:27015"
remote_port = 10027
protocol = "udp"
bandwidth_up = "5mbps"
bandwidth_down = "20mbps"

[[port_forwards]]
name = "api-server"
local_addr = "127.0.0.1:8000"
remote_port = 10081
enabled = false                 # 已禁用——连接时不会注册
```

### 客户端配置参考

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `name` | string | — | 此转发的标签名称（必填） |
| `local_addr` | string | — | 要暴露的本地服务地址（必填） |
| `remote_port` | u16 | — | 服务器端监听的端口（必填） |
| `protocol` | string | `"tcp"` | 传输协议：`"tcp"` 或 `"udp"` |
| `bind_addr` | string? | `"0.0.0.0"` | 服务端绑定地址覆盖 |
| `max_connections` | u32? | 无限制 | 此转发的最大并发连接数 |
| `idle_timeout_secs` | u64? | `300` | 空闲 N 秒后关闭连接 |
| `connect_timeout_secs` | u64? | `10` | 连接本地服务的超时时间 |
| `bandwidth_up` | string? | 无限制 | 单转发上传带宽限制（如 `"10mbps"`） |
| `bandwidth_down` | string? | 无限制 | 单转发下载带宽限制（如 `"50mbps"`） |
| `allowed_ips` | string[] | `[]` | 入站连接的 IP CIDR 白名单（空 = 允许所有） |
| `enabled` | bool | `true` | 启用/禁用此转发而不删除 |
| `retry_on_failure` | bool | `false` | 本地连接失败时自动重试 |
| `buffer_size` | usize? | `8192` | 自定义中继缓冲区大小（字节） |

## 服务端配置

启用端口转发并配置服务端策略：

### 最小示例

```toml
[port_forwarding]
enabled = true
port_range_start = 10000
port_range_end = 20000
```

### 包含所有选项的完整示例

```toml
[port_forwarding]
enabled = true
port_range_start = 10000
port_range_end = 20000

# 每客户端限制
max_forwards_per_client = 5               # 单客户端最多注册的转发数（默认：10）
max_connections_per_forward = 100          # 每个转发的默认最大连接数（默认：100）
default_idle_timeout_secs = 300            # 转发的默认空闲超时时间（默认：300）

# 端口访问控制
allowed_ports = [80, 443, 8080]            # 额外允许的特定端口（范围之外）
denied_ports = [22, 3306, 5432]            # 特定拒绝的端口（覆盖范围设置）

# 带宽限制（所有转发的全局设置）
global_bandwidth_up = "100mbps"            # 所有转发的总上传带宽
global_bandwidth_down = "500mbps"          # 所有转发的总下载带宽

# 访问控制
allowed_ips = ["0.0.0.0/0"]               # 允许连接的 IP CIDR（空 = 允许所有）
allowed_bind_addrs = ["0.0.0.0"]           # 客户端可请求的绑定地址

# 运维选项
require_name = true                        # 要求客户端为转发命名
log_connections = true                     # 记录每个转发连接（默认：true）
```

### 服务端配置参考

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `enabled` | bool | `false` | 必须为 `true` 才能允许端口转发 |
| `port_range_start` | u16 | `1024` | 允许转发的最小端口号 |
| `port_range_end` | u16 | `65535` | 允许转发的最大端口号 |
| `max_forwards_per_client` | u32? | `10` | 每客户端最大端口转发数 |
| `max_connections_per_forward` | u32? | `100` | 单个转发的默认最大连接数 |
| `default_idle_timeout_secs` | u64? | `300` | 转发的默认空闲超时时间 |
| `allowed_ports` | u16[] | `[]` | 额外允许的特定端口（范围之外） |
| `denied_ports` | u16[] | `[]` | 特定拒绝的端口（覆盖范围设置） |
| `global_bandwidth_up` | string? | 无限制 | 所有转发的总上传带宽 |
| `global_bandwidth_down` | string? | 无限制 | 所有转发的总下载带宽 |
| `allowed_ips` | string[] | `[]` | 允许连接到转发端口的 IP CIDR（空 = 允许所有） |
| `allowed_bind_addrs` | string[] | `[]` | 客户端可请求的绑定地址（空 = 仅通配符） |
| `require_name` | bool | `false` | 要求客户端为转发命名 |
| `log_connections` | bool | `true` | 记录每个转发连接 |

服务端会拒绝任何请求超出配置范围或在 `denied_ports` 列表中的端口的 `RegisterForward` 请求，并对每个认证客户端强制执行 `max_forwards_per_client` 限制。

## 管理 API

端口转发可通过[管理 API](/docs/features/management-api) 在运行时监控和管理。

### 列出所有活跃转发

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/forwards
```

响应：

```json
{
  "forwards": [
    {
      "remote_port": 10080,
      "name": "web-frontend",
      "client_id": "uuid",
      "bind_addr": "0.0.0.0:10080",
      "active_connections": 3,
      "total_connections": 142,
      "bytes_up": 1048576,
      "bytes_down": 5242880,
      "registered_at": "2026-03-20T00:00:00Z",
      "protocol": "tcp",
      "allowed_ips": ["10.0.0.0/8"]
    }
  ]
}
```

### 关闭转发

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:9090/api/forwards/10080
```

### 列出特定转发的连接

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:9090/api/forwards/10080/connections
```

响应：

```json
{
  "remote_port": 10080,
  "connections": [
    {
      "stream_id": 42,
      "peer_addr": "203.0.113.5:54321",
      "connected_at": "2026-03-20T12:00:00Z",
      "bytes_up": 2048,
      "bytes_down": 8192
    }
  ]
}
```

## 动态 FFI（运行时添加/删除）

GUI 和移动客户端可通过 `prisma-ffi` 在运行时添加或删除端口转发，无需重启连接：

```c
// 动态添加转发（JSON 匹配 PortForwardConfig）
int prisma_add_forward(PrismaHandle* h, const char* json);

// 按远程端口删除转发
int prisma_remove_forward(PrismaHandle* h, uint16_t remote_port);
```

`prisma_add_forward` 的 JSON 示例：

```json
{
  "name": "new-service",
  "local_addr": "127.0.0.1:9000",
  "remote_port": 10090,
  "protocol": "tcp",
  "max_connections": 20,
  "bandwidth_down": "10mbps"
}
```

## 使用场景

- **将本地 Web 服务器暴露到互联网** — 本地开发并与他人共享
- **访问 NAT 后面的服务** — 无需开放防火墙端口
- **开发和预发布环境的安全隧道** — 所有流量端到端加密
- **远程访问内部工具** — 暴露控制台、管理面板或 API
- **游戏服务器托管** — 使用 `protocol = "udp"` 暴露 NAT 后的 UDP 游戏服务器
- **逐转发带宽控制** — 限制单个转发的吞吐量以防止滥用

## 安全注意事项

- 仅在需要时在服务端启用端口转发（默认 `enabled = false`）
- 将端口范围限制在必要的最小范围（避免使用 `1024-65535`）
- 使用 `denied_ports` 阻止敏感服务（SSH、数据库），即使在允许范围内
- 设置 `max_forwards_per_client` 以防止资源耗尽
- 在客户端和服务端使用 `allowed_ips` 限制谁可以连接到转发端口
- 每个转发端口在服务器的公共接口上绑定——请确保防火墙规则适当
- 服务端在接受之前验证请求的端口是否在配置范围内
- 所有转发流量都通过 PrismaVeil 隧道加密传输
- 启用 `log_connections = true`（默认）以便审计
