---
sidebar_position: 4
---

# 管理 API

管理 API 通过 REST 端点和 WebSocket 流提供对 Prisma 服务器的实时监控和控制。它在 `prisma-mgmt` crate 中使用 [axum](https://github.com/tokio-rs/axum) 实现。

## 启用 API

在 `server.toml` 中添加 `[management_api]` 配置段：

```toml
[management_api]
enabled = true
listen_addr = "0.0.0.0:9090"
auth_token = "your-secure-token-here"
console_dir = "/opt/prisma/console"  # 可选：提供构建好的控制台
```

## 认证

管理 API 支持两种认证方式：

### 基于 JWT 的认证（v2.8.0+）

使用用户名和密码进行认证以获取 JWT 令牌。在后续请求中使用该令牌：

```bash
# 登录获取 JWT 令牌
curl -X POST -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-password"}' \
  http://127.0.0.1:9090/api/auth/login
# {"token":"eyJhbGciOi...","role":"admin","expires_in":86400}

# 使用 JWT 令牌
curl -H "Authorization: Bearer eyJhbGciOi..." http://127.0.0.1:9090/api/health
```

### 传统 Bearer 令牌

为保持向后兼容，仍然接受 `server.toml` 中的静态 `auth_token` 作为 Bearer 令牌。此方式授予完整的管理员级别访问权限：

```bash
curl -H "Authorization: Bearer your-secure-token-here" http://127.0.0.1:9090/api/health
```

如果 `auth_token` 和 `jwt_secret` 均为空，则禁用认证（仅限开发模式）。

## REST 端点

### 认证与用户

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/auth/login` | 使用用户名+密码认证，返回 JWT |
| `POST` | `/api/auth/register` | 自助注册为 Client 角色用户 |
| `GET` | `/api/auth/me` | 从 JWT 获取当前用户信息 |
| `GET` | `/api/users` | 列出所有用户（仅管理员） |
| `POST` | `/api/users` | 创建用户（仅管理员） |
| `PUT` | `/api/users/{username}` | 更新用户角色/状态（仅管理员） |
| `DELETE` | `/api/users/{username}` | 删除用户（仅管理员） |
| `PUT` | `/api/auth/password` | 修改当前用户密码（需认证） |
| `GET` | `/api/setup/status` | 检查初始设置是否完成（无需认证） |
| `POST` | `/api/setup/init` | 创建初始管理员用户（无需认证，仅限一次） |

**登录：**

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-password"}' \
  http://127.0.0.1:9090/api/auth/login
# {"token":"eyJhbGciOi...","role":"admin","expires_in":86400}
```

**自助注册：**

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"username": "newuser", "password": "strong-password"}' \
  http://127.0.0.1:9090/api/auth/register
# {"username":"newuser","role":"client","enabled":true}
```

自助注册用户将被分配 **Client** 角色，仅能查看自己的统计信息。

**修改密码：**

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"current_password": "old-password", "new_password": "new-strong-password"}' \
  http://127.0.0.1:9090/api/auth/password
# {"status":"ok"}
```

**检查设置状态：**

```bash
curl http://127.0.0.1:9090/api/setup/status
# {"setup_complete":false,"has_admin":false}
```

**首次设置（创建管理员）：**

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "strong-password"}' \
  http://127.0.0.1:9090/api/setup/init
# {"token":"eyJhbGciOi...","username":"admin","role":"admin"}
```

**列出用户（仅管理员）：**

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/users
# [{"username":"admin","role":"admin","enabled":true},{"username":"viewer","role":"operator","enabled":true}]
```

### 健康状态与指标

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 服务器状态、运行时间和版本 |
| `GET` | `/api/metrics` | 当前指标快照（连接数、字节数、失败次数） |
| `GET` | `/api/metrics/history` | 时间序列指标历史 |

**示例：**

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/health
# {"status":"ok","uptime_secs":3600,"version":"2.24.0"}
```

### 连接

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/connections` | 列出所有活跃连接及字节计数 |
| `DELETE` | `/api/connections/:id` | 按 ID 强制断开会话 |
| `GET` | `/api/connections/geo` | 活跃连接的 GeoIP 国家分布（需要配置 GeoIP） |

### 客户端

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/clients` | 列出所有授权客户端 |
| `POST` | `/api/clients` | 生成新客户端（返回 UUID + 认证密钥） |
| `PUT` | `/api/clients/:id` | 更新客户端名称或启用状态 |
| `DELETE` | `/api/clients/:id` | 删除客户端 |
| `GET` | `/api/clients/:id/secret` | 获取客户端认证密钥（返回十六进制编码的密钥） |
| `POST` | `/api/clients/share` | 生成客户端分享配置（TOML、`prisma://` URI 或二维码） |

**生成分享配置：**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "uuid", "format": "toml"}' \
  http://127.0.0.1:9090/api/clients/share
# {"format":"toml","content":"[identity]\nclient_id = \"uuid\"\nauth_secret = \"...\"\n..."}
```

支持的格式：`toml`、`uri`（返回 `prisma://` 链接）、`qr`（返回 SVG 二维码）。

**运行时创建客户端：**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "new-device"}' \
  http://127.0.0.1:9090/api/clients
# {"id":"uuid","name":"new-device","auth_secret_hex":"64-char-hex"}
```

:::warning
`auth_secret_hex` 仅在创建时返回一次。请妥善保存。
:::

### 系统

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/system/info` | 版本、平台、PID、CPU/内存使用率、证书到期时间、监听地址 |

### 配置

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/config` | 当前服务器配置（所有段，敏感信息已脱敏） |
| `PATCH` | `/api/config` | 热重载支持的字段（更改前自动备份配置） |
| `POST` | `/api/reload` | 从磁盘热重载整个服务器配置 |
| `GET` | `/api/config/tls` | TLS 证书信息 |

**支持热重载的字段：** `logging_level`、`logging_format`、`max_connections`、`port_forwarding_enabled`，以及所有流量整形、拥塞控制、伪装、路由和 ACL 设置。

**通过 POST /api/reload 热重载：**

触发从磁盘完整重读 `server.toml` 并应用所有可热重载的字段，无需重启服务器。现有连接不会中断。

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/reload
# {"status":"ok","reloaded_fields":["logging_level","traffic_shaping","routing"]}
```

### 配置备份

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/config/backups` | 列出带时间戳的配置备份 |
| `POST` | `/api/config/backup` | 创建手动备份 |
| `GET` | `/api/config/backups/:name` | 读取备份内容 |
| `POST` | `/api/config/backups/:name/restore` | 从备份恢复配置 |
| `DELETE` | `/api/config/backups/:name` | 删除备份 |
| `GET` | `/api/config/backups/:name/diff` | 比较备份与当前配置的差异 |

### 带宽与配额

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/clients/:id/bandwidth` | 每客户端带宽限制 |
| `PUT` | `/api/clients/:id/bandwidth` | 更新带宽限制 |
| `GET` | `/api/clients/:id/quota` | 每客户端配额使用情况 |
| `PUT` | `/api/clients/:id/quota` | 更新配额配置 |
| `GET` | `/api/bandwidth/summary` | 所有客户端带宽/配额概览 |

### 告警

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/alerts/config` | 告警阈值（证书到期、配额、握手失败峰值） |
| `PUT` | `/api/alerts/config` | 更新告警阈值（持久化到 `alerts.json`） |

### 端口转发

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/forwards` | 列出所有活跃的端口转发会话 |
| `POST` | `/api/forwards` | 创建新的端口转发 |
| `PUT` | `/api/forwards/:port` | 更新现有端口转发 |
| `DELETE` | `/api/forwards/:port` | 按远程端口关闭转发 |
| `GET` | `/api/forwards/:port/connections` | 列出特定转发的活跃连接 |

详见[端口转发](/docs/features/port-forwarding)了解完整配置和 API 响应格式。

### 访问控制列表（ACL）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/acls` | 列出所有 ACL 规则（每客户端访问控制） |
| `POST` | `/api/acls` | 创建新 ACL 规则 |
| `PUT` | `/api/acls/:id` | 更新现有 ACL 规则 |
| `DELETE` | `/api/acls/:id` | 删除 ACL 规则 |

ACL 规则限制特定客户端可访问的目标。规则按每客户端评估，优先于全局路由规则。

**示例：创建 ACL 规则**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "uuid",
    "condition": {"type": "DomainMatch", "value": "*.internal.corp"},
    "action": "Block",
    "enabled": true
  }' \
  http://127.0.0.1:9090/api/acls
```

### 客户端指标

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/metrics/clients` | 所有客户端指标快照（字节数、连接数、延迟百分位数） |
| `GET` | `/api/metrics/clients/:id` | 单客户端指标快照 |
| `GET` | `/api/metrics/clients/:id/history` | 时间序列历史（参数：`period=1h\|6h\|24h`） |

**示例：**

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/metrics/clients
# [{"client_id":"uuid","name":"laptop","active_connections":3,"bytes_up":1048576,"bytes_down":5242880,"latency_p50_ms":38,"latency_p95_ms":72,"latency_p99_ms":105}]
```

### 客户端权限

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/clients/:id/permissions` | 获取特定客户端的权限 |
| `PUT` | `/api/clients/:id/permissions` | 更新客户端权限 |
| `POST` | `/api/clients/:id/kick` | 强制断开客户端（终止所有活跃会话） |
| `POST` | `/api/clients/:id/block` | 封禁客户端（断开连接 + 阻止重连） |

**示例：踢出客户端**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:9090/api/clients/uuid-here/kick
# {"status":"ok","sessions_terminated":3}
```

**示例：更新权限**

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"can_forward": true, "can_udp": true, "max_connections": 50}' \
  http://127.0.0.1:9090/api/clients/uuid-here/permissions
```

### GeoIP

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/geoip/download` | 下载 GeoIP 数据库并自动配置 `geoip_path` |

触发服务端 GeoIP 数据库下载。服务器下载数据库文件后存储到配置的数据目录，并自动更新运行配置中的 `geoip_path`。返回下载进度和最终状态。

**示例：**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/geoip/download
# {"status":"ok","path":"/opt/prisma/data/geoip.mmdb","size_bytes":4521984}
```

### 文档

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/docs/openapi.json` | 管理 API 的 OpenAPI 3.0 规范 |

返回完整的 OpenAPI 3.0 规范文档。可导入 Swagger UI、Postman 或其他 OpenAPI 兼容工具进行交互式 API 探索。

### 路由规则

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/routes` | 列出所有路由规则 |
| `POST` | `/api/routes` | 添加新路由规则 |
| `PUT` | `/api/routes/:id` | 更新现有规则 |
| `DELETE` | `/api/routes/:id` | 删除规则 |

详见[路由规则](/docs/features/routing-rules)了解规则条件和操作。

### 路由测试（v2.13.0+）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/routes/test` | 测试域名或 IP 地址是否匹配已配置的路由规则 |

**示例：**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"target": "google.com"}' \
  http://127.0.0.1:9090/api/routes/test
# {"matched":true,"rule":{"type":"domain-suffix","value":"google.com","action":"proxy"},"index":3}
```

### 服务器 GeoIP（v2.13.0+）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/server/geo` | 获取服务器自身的 GeoIP 位置 |

**示例：**

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/server/geo
# {"country":"US","city":"San Francisco","lat":37.7749,"lon":-122.4194}
```

### 控制台设置（v2.12.0+）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/settings` | 获取控制台设置（注册开关、默认角色、会话过期、备份间隔） |
| `PUT` | `/api/settings` | 更新控制台设置（仅管理员） |

**示例：**

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/settings
# {"registration_enabled":true,"default_role":"client","session_expiry_hours":24,"backup_interval_mins":60}

curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"registration_enabled":false,"default_role":"client","session_expiry_hours":48,"backup_interval_mins":120}' \
  http://127.0.0.1:9090/api/settings
# {"status":"ok"}
```

### 兑换码（v2.12.0+）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/codes` | 生成兑换码（仅管理员） |
| `GET` | `/api/codes` | 列出所有兑换码（仅管理员） |
| `DELETE` | `/api/codes/:code` | 删除兑换码（仅管理员） |
| `POST` | `/api/redeem` | 兑换码以获取客户端凭证 |

**生成兑换码：**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"count": 5, "prefix": "PRISMA"}' \
  http://127.0.0.1:9090/api/codes
# {"codes":["PRISMA-A1B2","PRISMA-C3D4","PRISMA-E5F6","PRISMA-G7H8","PRISMA-I9J0"]}
```

**兑换码：**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code": "PRISMA-A1B2"}' \
  http://127.0.0.1:9090/api/redeem
# {"client_id":"uuid","auth_secret":"hex","name":"redeemed-PRISMA-A1B2"}
```

### 订阅（v2.12.0+）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/subscription` | 获取当前用户的订阅状态 |

**示例：**

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/subscription
# {"active":true,"clients":["uuid-1","uuid-2"],"redeemed_codes":["PRISMA-A1B2"],"expires_at":null}
```

### 邀请链接（v2.12.0+）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/invites` | 创建邀请链接（仅管理员） |
| `GET` | `/api/invites` | 列出所有邀请链接（仅管理员） |
| `DELETE` | `/api/invites/:id` | 删除邀请链接（仅管理员） |
| `GET` | `/api/invite/{token}/info` | 检查邀请链接有效性（无需认证） |
| `POST` | `/api/invite/{token}` | 通过邀请链接注册（无需认证） |

**创建邀请链接：**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"max_uses": 10, "expires_hours": 72}' \
  http://127.0.0.1:9090/api/invites
# {"id":"uuid","token":"abc123","url":"https://server:9090/invite/abc123","max_uses":10,"uses":0}
```

**通过邀请注册（无需认证）：**

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"username": "newuser", "password": "strong-password"}' \
  http://127.0.0.1:9090/api/invite/abc123
# {"token":"eyJhbGciOi...","user":{"username":"newuser","role":"client"}}
```

## WebSocket 端点

### 指标流

```
WS /api/ws/metrics
```

每秒推送一个 `MetricsSnapshot` JSON 对象：

```json
{
  "timestamp": "2025-01-01T00:00:00Z",
  "uptime_secs": 3600,
  "total_connections": 150,
  "active_connections": 12,
  "total_bytes_up": 1048576,
  "total_bytes_down": 5242880,
  "handshake_failures": 3
}
```

### 日志流

```
WS /api/ws/logs
```

实时推送日志条目。客户端可以发送过滤消息以减少噪音：

```json
{"level": "warn", "target": "prisma_server"}
```

日志条目：

```json
{
  "timestamp": "2025-01-01T00:00:01Z",
  "level": "INFO",
  "target": "prisma_server::handler",
  "message": "session_id=abc Handshake complete (TCP)"
}
```

发送 `{"level": "", "target": ""}` 以清除过滤器。

### 连接事件流

```
WS /api/ws/connections
```

实时推送连接生命周期事件（连接、断开、迁移）：

```json
{
  "event": "connected",
  "session_id": "abc123",
  "peer_addr": "203.0.113.5:54321",
  "transport": "quic",
  "client_id": "uuid",
  "timestamp": "2026-03-20T12:00:00Z"
}
```

### 配置重载流

```
WS /api/ws/reload
```

当服务器配置被重载时推送通知（通过 `POST /api/reload` 或 `PATCH /api/config`）：

```json
{
  "event": "config_reloaded",
  "changed_fields": ["logging_level", "traffic_shaping"],
  "timestamp": "2026-03-20T12:05:00Z"
}
```

## 端点总览

所有端点一览（v2.24.0）：

| 类别 | 端点数 | 描述 |
|------|--------|------|
| 认证与用户 | 10 REST | 登录、注册、修改密码、设置、用户 CRUD、角色管理 |
| 健康与指标 | 3 REST + 1 WS | 服务器状态、快照、历史、实时流 |
| 连接 | 3 REST + 1 WS | 列表、断开、GeoIP 分布、实时事件 |
| 客户端 | 6 REST | 授权客户端的 CRUD、密钥获取、分享配置 |
| 客户端权限 | 4 REST | 权限、踢出、封禁 |
| 客户端指标 | 3 REST | 所有客户端快照、单客户端快照、时序历史 |
| 系统 | 1 REST | 平台和资源信息 |
| 配置 | 4 REST + 1 WS | 配置读写、热重载、重载流 |
| 配置备份 | 5 REST | 备份、恢复、差异对比 |
| 带宽与配额 | 5 REST | 每客户端限制和使用情况 |
| 告警 | 2 REST | 告警阈值管理 |
| 端口转发 | 5 REST | CRUD、关闭、每转发连接 |
| ACL | 4 REST | 每客户端访问控制规则 |
| GeoIP | 1 REST | GeoIP 数据库下载和配置 |
| 文档 | 1 REST | OpenAPI 3.0 规范 |
| 路由规则 | 4 REST | 服务端路由规则管理 |
| 路由测试 | 1 REST | 测试域名/IP 是否匹配路由规则 |
| 服务器 GeoIP | 1 REST | 服务器 GeoIP 位置 |
| 控制台设置 | 2 REST | 控制台设置读写 |
| 兑换码 | 4 REST | 兑换码生成、列出、删除、兑换 |
| 订阅 | 1 REST | 用户订阅状态 |
| 邀请链接 | 5 REST | 邀请链接 CRUD 和公开兑换 |
| 日志 | 1 WS | 实时日志流 |
