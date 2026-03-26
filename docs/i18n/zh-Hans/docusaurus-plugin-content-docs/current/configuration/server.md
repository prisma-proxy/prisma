---
sidebar_position: 1
---

# 服务端配置

服务端通过 TOML 文件配置（默认：`server.toml`）。配置按三层解析——编译默认值、TOML 文件、环境变量。详见[环境变量](./environment-variables.md)了解覆盖机制。

:::info 版本
此页面反映 Prisma **v2.24.0**。协议 v4 支持已移除；仅接受 PrismaVeil v5 (0x05)。
:::

## 顶级字段

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `listen_addr` | string | `"0.0.0.0:8443"` | TCP 监听地址，用于直连和 TLS 包裹连接 |
| `quic_listen_addr` | string | `"0.0.0.0:8443"` | QUIC/UDP 监听地址 |
| `dns_upstream` | string | `"8.8.8.8:53"` | `CMD_DNS_QUERY` 转发的上游 DNS 服务器 |
| `allow_transport_only_cipher` | bool | `false` | 允许客户端使用仅传输层加密模式（BLAKE3 MAC，无应用层加密）。仅当传输层已提供加密（TLS/QUIC）时安全。 |
| `config_watch` | bool | `false` | 监视配置文件变化并在运行时自动重载 |
| `shutdown_drain_timeout_secs` | u64 | `30` | 优雅关闭时等待进行中连接的秒数 |
| `ticket_rotation_hours` | u64 | `6` | 会话票据加密密钥轮换间隔（小时）。旧密钥保留 3 个轮换周期以允许优雅恢复。 |
| `public_address` | string? | -- | 公网服务器地址，用于共享客户端配置（如 `"proxy.example.com:8443"`）。若未设置则回退到 `listen_addr`。 |

## `[tls]` -- TLS 证书

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `cert_path` | string | -- | TLS 证书 PEM 文件路径 |
| `key_path` | string | -- | TLS 私钥 PEM 文件路径 |

QUIC 传输和 `camouflage.tls_on_tcp = true` **要求** TLS。

为开发环境生成自签名证书：

```bash
prisma gen-cert --output /etc/prisma --cn prisma-server
```

生产环境请使用受信任 CA 或 Let's Encrypt 颁发的证书。

## `[[authorized_clients]]` -- 客户端凭证

每个条目定义一个授权客户端。至少需要一个。

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `id` | string | -- | 客户端 UUID（使用 `prisma gen-key` 生成） |
| `name` | string? | -- | 可选的人类可读客户端标签 |
| `auth_secret` | string | -- | 64 个十六进制字符（32 字节）共享密钥 |
| `bandwidth_up` | string? | -- | 单客户端上传速率限制（如 `"100mbps"`） |
| `bandwidth_down` | string? | -- | 单客户端下载速率限制（如 `"500mbps"`） |
| `quota` | string? | -- | 单客户端流量配额（如 `"100GB"`） |
| `quota_period` | string? | -- | 配额重置周期：`"daily"` / `"weekly"` / `"monthly"` |
| `owner` | string? | -- | 所有者用户名，用于数据隔离。设置后，客户端角色用户只能看到自己拥有的客户端。 |

多客户端示例：

```toml
[[authorized_clients]]
id = "client-uuid-1"
auth_secret = "hex-secret-1"
name = "laptop"
bandwidth_up = "100mbps"
bandwidth_down = "500mbps"
quota = "500GB"
quota_period = "monthly"

[[authorized_clients]]
id = "client-uuid-2"
auth_secret = "hex-secret-2"
name = "phone"
```

客户端也可以通过[管理 API](/docs/features/management-api)或[控制台](/docs/features/console)在运行时管理，无需重启服务器。

### `[permissions]` -- 单客户端权限

每个 `[[authorized_clients]]` 条目可包含一个可选的 `[permissions]` 表，用于细粒度访问控制。未设置时，所有权限默认为不受限。

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `allow_port_forwarding` | bool | `true` | 是否允许此客户端进行端口转发 |
| `allow_udp` | bool | `true` | 是否允许此客户端进行 UDP 中继 |
| `allowed_destinations` | string[] | `[]` | 允许的目标模式（CIDR 或域名通配符）。空 = 允许全部 |
| `blocked_destinations` | string[] | `[]` | 阻止的目标模式。阻止优先于允许 |
| `max_connections` | u32 | `0` | 此客户端的最大并发连接数（0 = 无限制） |
| `bandwidth_limit` | u64? | -- | 单客户端带宽限制，单位字节/秒（null = 无限制） |
| `allowed_ports` | PortRange[] | `[]` | 允许的端口范围（每个包含 `start` 和 `end`）。空 = 允许所有端口 |
| `blocked_ports` | u16[] | `[]` | 阻止的端口。阻止优先于允许 |

目标模式支持：
- **CIDR 表示法**：`"10.0.0.0/8"`、`"192.168.0.0/16"`
- **域名通配符**：`"*.google.com"` 匹配 `www.google.com` 和 `mail.google.com`
- **精确匹配**：`"example.com"` 或 `"8.8.8.8"`

示例：

```toml
[[authorized_clients]]
id = "client-uuid-1"
auth_secret = "hex-secret-1"
name = "restricted-client"

[authorized_clients.permissions]
allow_port_forwarding = false
allow_udp = true
max_connections = 10
blocked_destinations = ["*.torrent.com", "10.0.0.0/8"]
blocked_ports = [22, 25, 445]
allowed_ports = [{ start = 80, end = 80 }, { start = 443, end = 443 }, { start = 8000, end = 9000 }]
```

## `[management_api]` -- REST/WebSocket API

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `enabled` | bool | `false` | 启用管理 REST/WS API |
| `listen_addr` | string | `"127.0.0.1:9090"` | 管理 API 绑定地址 |
| `auth_token` | string | `""` | API 认证的 Bearer 令牌 |
| `cors_origins` | string[] | `[]` | 允许的 CORS 来源（用于外部控制台开发） |
| `console_dir` | string? | -- | 已构建控制台静态文件路径 |
| `tls_enabled` | bool | `false` | 启用管理 API 的 TLS |
| `tls.cert_path` | string? | -- | TLS 证书路径（未设置时继承顶级 `[tls]` 配置） |
| `tls.key_path` | string? | -- | TLS 私钥路径（未设置时继承顶级 `[tls]` 配置） |
| `auto_backup_interval_mins` | u32 | `0` | 每隔 N 分钟自动创建一次配置备份。`0` 表示禁用自动备份。 |
| `jwt_secret` | string | `""` | JWT 令牌签名密钥。留空时在服务器首次运行时自动生成。 |

:::warning
`auth_token` 保护所有使用传统令牌认证的管理 API 端点。`jwt_secret` 用于基于 JWT 的认证（v2.8.0+）。生产环境请为两者使用强随机值。
:::

**绑定地址**：默认 API 监听 `127.0.0.1:9090`（仅本地）。要暴露到网络，请更改 `listen_addr`——但请确保有适当的网络级别访问控制。

**控制台**：将 `console_dir` 设置为包含已构建控制台静态文件的路径。服务器将在管理 API 地址提供控制台服务。从[最新版本](https://github.com/prisma-proxy/prisma/releases/latest)下载预构建文件，或使用 `cd apps/prisma-console && npm ci && npm run build` 从源码构建。

**CORS 来源**：仅在控制台开发服务器运行在不同来源时需要（如 `http://localhost:3000`）。生产环境中控制台由服务器自身提供时不需要。

### `[[management_api.users]]` -- 控制台用户

在 TOML 中预配置控制台用户。用户也可以通过控制台的自助注册端点或管理员用户管理页面在运行时创建。

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `username` | string | -- | 唯一用户名 |
| `password_hash` | string | -- | bcrypt 哈希密码（使用 `prisma hash-password` 生成） |
| `role` | string | `"client"` | 用户角色：`"admin"` / `"operator"` / `"client"` |
| `enabled` | bool | `true` | 用户账户是否激活 |

角色说明：
- **admin** — 完全访问所有 API 端点和控制台页面，包括用户管理
- **operator** — 仅监控；可查看仪表盘、指标和连接，但无法修改配置或管理用户
- **client** — 仅能查看自己的连接统计

示例：

```toml
[management_api]
enabled = true
listen_addr = "127.0.0.1:9090"
auth_token = "your-secure-token-here"
jwt_secret = "auto-generated-on-first-run"

[[management_api.users]]
username = "admin"
password_hash = "$2b$10$..."  # bcrypt hash
role = "admin"
enabled = true

[[management_api.users]]
username = "viewer"
password_hash = "$2b$10$..."
role = "operator"
enabled = true
```

:::tip
您可以在 `server.toml` 中预配置用户，也可以让用户通过控制台登录页面自助注册。自助注册的用户始终被分配 **Client** 角色。管理员可以稍后通过控制台或管理 API 提升用户角色。
:::

**自动备份**：将 `auto_backup_interval_mins` 设置为非零值，即可按固定间隔自动创建配置快照。备份任务在后台运行，不会影响活跃连接。备份与手动备份一同存储，可在控制台的"配置备份"页面查看或恢复。

## SQLite 数据库（v2.12.0+）

从 v2.12.0 起，动态数据——用户、授权客户端、路由规则和订阅——存储在 **SQLite 数据库**（`data.sql`）中，而非 TOML 配置文件。升级后首次启动时，服务器自动将 `server.toml` 中的现有数据迁移到数据库中。

关键行为：

- **自动迁移** — 现有的 `[[authorized_clients]]`、`[[management_api.users]]` 和 `[[routing.rules]]` 条目在首次运行时导入 SQLite。原始 TOML 条目保留但迁移后不再读取。
- **文件位置** — 数据库创建在 `server.toml` 同级目录（如 `/etc/prisma/data.sql`）。
- **运行时变更** — 通过管理 API 或控制台对客户端、用户、路由规则和订阅的所有更改立即持久化到 SQLite。
- **备份** — `POST /api/config/backup` 端点和自动备份功能现在同时包含 TOML 配置和 SQLite 数据库（`data.sql`）。
- **静态配置** — 服务器设置（监听地址、TLS、伪装、流量整形、性能等）仍保留在 `server.toml` 中。

:::tip
您仍可以在 `server.toml` 中预配置用户和客户端用于初始部署。它们将在首次运行时导入 SQLite。之后请通过控制台或 API 管理。
:::

## `[port_forwarding]` -- 反向代理

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `enabled` | bool | `false` | 启用端口转发/反向代理 |
| `port_range_start` | u16 | `1024` | 允许转发的最小端口号 |
| `port_range_end` | u16 | `65535` | 允许转发的最大端口号 |
| `max_forwards_per_client` | u32? | `10` | 每客户端最大端口转发数 |
| `max_connections_per_forward` | u32? | `100` | 每个转发的最大并发连接数 |
| `default_idle_timeout_secs` | u64? | `300` | 空闲转发连接关闭时间（0 = 禁用） |
| `allowed_ports` | u16[] | `[]` | 范围外的额外允许端口 |
| `denied_ports` | u16[] | `[]` | 明确拒绝的端口（覆盖范围和允许列表） |
| `allowed_bind_addrs` | string[] | `[]` | 客户端可请求的绑定地址（空 = 仅通配符） |
| `global_bandwidth_up` | string? | -- | 所有转发的全局上传带宽限制（如 `"1gbps"`） |
| `global_bandwidth_down` | string? | -- | 所有转发的全局下载带宽限制 |
| `require_name` | bool | `false` | 要求客户端为转发命名 |
| `log_connections` | bool | `true` | 记录每个转发连接 |
| `allowed_ips` | string[] | `[]` | 允许连接到转发端口的 IP CIDR（空 = 允许所有） |

端口解析：当转发启用且端口**不**在 `denied_ports` 中，且端口在配置范围内或在 `allowed_ports` 中时，该端口被允许。

## `[routing]` -- 服务端路由规则

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `geoip_path` | string? | -- | MaxMind GeoLite2-City.mmdb（城市级）文件路径，用于 GeoIP 路由 |
| `rules` | array | `[]` | 有序的路由规则列表 |

每个 `[[routing.rules]]`：

| 字段 | 类型 | 描述 |
|------|------|------|
| `type` | string | 规则类型：`domain` / `domain-suffix` / `domain-keyword` / `ip-cidr` / `geoip` / `port` / `all` |
| `value` | string | 匹配值（`geoip` 类型使用国家代码，如 `"cn"`、`"private"`） |
| `action` | string | 动作：`"allow"` / `"block"` / `"direct"`（或 `"proxy"` 映射为 allow） |

## `[padding]` -- 每帧填充

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `min` | u16 | `0` | 每帧最小随机填充字节数 |
| `max` | u16 | `256` | 每帧最大随机填充字节数 |

## `[performance]` -- 连接限制

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `max_connections` | u32 | `1024` | 最大并发连接数 |
| `connection_timeout_secs` | u64 | `300` | 空闲连接超时时间（秒） |

## `[camouflage]` -- 抗主动探测

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `enabled` | bool | `false` | 启用伪装 |
| `tls_on_tcp` | bool | `false` | 在 TCP 传输外包裹 TLS（需要 `[tls]` 配置） |
| `fallback_addr` | string? | -- | 非 Prisma 连接的诱饵服务器地址（如 `"example.com:443"`） |
| `alpn_protocols` | string[] | `["h2", "http/1.1"]` | TLS/QUIC ALPN 协议 |
| `h3_cover_site` | string? | -- | HTTP/3 伪装上游 URL |
| `h3_static_dir` | string? | -- | HTTP/3 伪装本地静态文件目录（`h3_cover_site` 未设置时的回退） |
| `salamander_password` | string? | -- | Salamander UDP 混淆密码（仅 QUIC） |

## `[camouflage.tls_probe_guard]` -- TLS 探测防御

自动检测并封锁出现重复 TLS 握手失败的 IP——这是审查系统主动探测的强烈信号。启用后，服务器在滑动窗口内追踪每个 IP 的握手失败率，并临时封锁违规 IP。

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `enabled` | bool | `true` | 启用 TLS 探测防御（伪装启用时默认开启） |
| `max_failures` | u32 | `20` | 封锁前每 IP 允许的最大握手失败次数 |
| `failure_window_secs` | u64 | `120` | 计数失败的滑动窗口时间（秒） |
| `block_duration_secs` | u64 | `120` | 封锁违规 IP 的持续时间（秒） |

示例：

```toml
[camouflage.tls_probe_guard]
enabled = true
max_failures = 20
failure_window_secs = 120
block_duration_secs = 120
```

:::tip 调优指南
- **降低 `max_failures`**（如 5-10）可在被频繁探测的环境中实现更积极的防御，但可能会误封 TLS 栈不稳定的合法客户端。
- **增大 `failure_window_secs`**（如 300-600）可捕获缓慢的分布式探测活动。
- **增大 `block_duration_secs`**（如 3600）可对已确认的探测者施加更长的封锁。
:::

## `[ssh]` -- SSH 传输

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `enabled` | bool | `false` | 启用 SSH 传输监听器 |
| `listen_addr` | string | `"0.0.0.0:2222"` | SSH 监听地址 |
| `host_key_path` | string? | -- | SSH 主机密钥文件路径（未设置时自动生成） |
| `password` | string? | -- | SSH 密码认证凭证 |
| `allowed_users` | string[] | `[]` | 允许的 SSH 用户名（空 = 允许所有） |
| `authorized_keys_path` | string? | -- | 公钥认证的 `authorized_keys` 文件路径 |
| `fake_shell` | bool | `false` | 对交互式会话响应虚假 shell 提示符（进一步伪装） |
| `banner` | string | `"SSH-2.0-OpenSSH_9.6"` | SSH 版本横幅字符串 |

## `[wireguard]` -- WireGuard 兼容 UDP 传输

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `enabled` | bool | `false` | 启用 WireGuard 传输 |
| `listen_addr` | string | `"0.0.0.0:51820"` | WireGuard UDP 监听地址 |
| `session_timeout_secs` | u64 | `180` | 对等会话超时（秒） |

## `[acls]` -- 每客户端访问控制列表

ACL 提供每客户端的细粒度目标控制。键是客户端标识符，值是 ACL 对象：

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `client_id` | string | -- | 此 ACL 适用的客户端 ID |
| `rules` | array | `[]` | 有序的 ACL 规则列表（首个匹配生效） |
| `default_policy` | string | `"allow"` | 无规则匹配时的默认策略：`"allow"` / `"deny"` |
| `enabled` | bool | `true` | 此 ACL 是否激活 |

每条规则的 `rules`：

| 字段 | 类型 | 描述 |
|------|------|------|
| `action` | string | `"allow"` / `"deny"` |
| `matcher.type` | string | `"domain"` / `"domain-suffix"` / `"domain-keyword"` / `"ip-cidr"` / `"port"` |
| `matcher.value` | string | 匹配值 |
| `description` | string? | 可选的人类可读描述 |

示例：

```toml
[acls.client-uuid-1]
client_id = "client-uuid-1"
default_policy = "allow"
enabled = true

[[acls.client-uuid-1.rules]]
action = "deny"
description = "屏蔽 torrent 追踪器"
[acls.client-uuid-1.rules.matcher]
type = "domain-keyword"
value = "torrent"

[[acls.client-uuid-1.rules]]
action = "deny"
description = "屏蔽私有网络"
[acls.client-uuid-1.rules.matcher]
type = "ip-cidr"
value = "10.0.0.0/8"
```

## `[fallback]` -- 传输回退

服务端传输回退配置。当主要传输失败或遇到重复错误时，服务器可以自动激活备用传输。

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `enabled` | bool | `false` | 是否启用传输回退 |
| `chain` | string[] | `["tcp", "quic", "websocket", "grpc"]` | 有序的传输尝试列表：`"tcp"` / `"quic"` / `"websocket"` / `"grpc"` / `"xhttp"` / `"xporta"` |
| `health_check_interval` | u64 | `30` | 每个传输监听器的健康检查间隔（秒） |
| `auto_switch_on_failure` | bool | `true` | 失败时自动切换到下一个传输 |
| `max_consecutive_failures` | u32 | `5` | 触发回退前的最大连续失败次数 |
| `migrate_back_on_recovery` | bool | `false` | 主要传输恢复时是否迁移回来 |

示例：

```toml
[fallback]
enabled = true
chain = ["tcp", "quic", "websocket", "grpc"]
health_check_interval = 30
auto_switch_on_failure = true
max_consecutive_failures = 5
migrate_back_on_recovery = true
```

## `[logging]` -- 日志输出

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `level` | string | `"info"` | 日志级别：`trace` / `debug` / `info` / `warn` / `error` |
| `format` | string | `"pretty"` | 日志格式：`pretty` / `json` |

## `[prisma_tls]` -- PrismaTLS（替代 REALITY）

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `enabled` | bool | `false` | 启用 PrismaTLS |
| `auth_secret` | string | `""` | 认证密钥（十六进制编码，32 字节） |
| `auth_rotation_hours` | u64 | `1` | 认证密钥轮换间隔（小时） |
| `mask_servers` | array | `[]` | 掩护服务器池 |

每个 `[[prisma_tls.mask_servers]]`：

| 字段 | 类型 | 描述 |
|------|------|------|
| `addr` | string | 掩护服务器地址（如 `"www.microsoft.com:443"`） |
| `names` | string[] | 允许的 SNI 名称 |

## `[traffic_shaping]` -- 抗指纹识别

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `padding_mode` | string | `"none"` | `"none"` / `"random"` / `"bucket"` |
| `bucket_sizes` | u16[] | `[128,256,512,1024,2048,4096,8192,16384]` | 桶填充模式的桶大小 |
| `timing_jitter_ms` | u32 | `0` | 握手帧的最大时序抖动（毫秒） |
| `chaff_interval_ms` | u32 | `0` | 杂音注入间隔（毫秒），0 = 禁用 |
| `coalesce_window_ms` | u32 | `0` | 帧合并窗口（毫秒），0 = 禁用 |

## `[anti_rtt]` -- RTT 归一化

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `enabled` | bool | `false` | 启用跨层 RTT 归一化 |
| `normalization_ms` | u32 | `150` | 将传输 ACK 归一化到的目标 RTT（毫秒） |

## `[congestion]` -- QUIC 拥塞控制

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `mode` | string | `"bbr"` | 拥塞控制：`"brutal"` / `"bbr"` / `"adaptive"` / `"auto"`（映射为 `"adaptive"`） |
| `target_bandwidth` | string? | -- | brutal/adaptive 模式的目标带宽（如 `"100mbps"`） |

## `[port_hopping]` -- QUIC 端口跳变

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `enabled` | bool | `false` | 启用 QUIC 端口跳变 |
| `base_port` | u16 | `10000` | 端口范围起始值 |
| `port_range` | u16 | `50000` | 端口范围数量 |
| `interval_secs` | u64 | `60` | 端口跳变间隔（秒） |
| `grace_period_secs` | u64 | `10` | 跳变后旧端口保留时间（秒） |

## `[cdn]` -- CDN 传输监听器

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `enabled` | bool | `false` | 启用 CDN 传输监听器（WS、gRPC、XHTTP） |
| `listen_addr` | string | `"0.0.0.0:443"` | CDN 监听绑定地址 |
| `tls.cert_path` | string? | -- | CDN TLS 证书（如 Cloudflare Origin 证书） |
| `tls.key_path` | string? | -- | CDN TLS 私钥 |
| `ws_tunnel_path` | string | `"/ws-tunnel"` | WebSocket 隧道端点路径 |
| `grpc_tunnel_path` | string | `"/tunnel.PrismaTunnel"` | gRPC 隧道服务路径 |
| `cover_upstream` | string? | -- | 伪装流量的反向代理上游 URL |
| `cover_static_dir` | string? | -- | 伪装流量的静态文件目录 |
| `trusted_proxies` | string[] | `[]` | 受信任的代理 IP 范围（如 Cloudflare CIDR） |
| `expose_management_api` | bool | `false` | 通过 CDN 端点暴露管理 API |
| `management_api_path` | string | `"/prisma-mgmt"` | CDN 上的管理 API 子路径 |
| `xhttp_upload_path` | string | `"/api/v1/upload"` | XHTTP packet-up 上传端点 |
| `xhttp_download_path` | string | `"/api/v1/pull"` | XHTTP packet-up 下载端点 |
| `xhttp_stream_path` | string | `"/api/v1/stream"` | XHTTP stream-one/stream-up 端点 |
| `xhttp_mode` | string? | -- | XHTTP 模式：`"packet-up"` / `"stream-up"` / `"stream-one"` |
| `xhttp_nosse` | bool | `false` | 禁用 XHTTP 下载的 SSE 包装 |
| `xhttp_extra_headers` | \[\[k,v\]\] | `[]` | 额外的伪装响应头 |
| `response_server_header` | string? | -- | 覆盖 HTTP `Server` 响应头 |
| `padding_header` | bool | `true` | 添加 `X-Padding` 响应头 |
| `enable_sse_disguise` | bool | `false` | 以 SSE 格式包装下载流 |

### `[cdn.xporta]` -- XPorta 传输

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `enabled` | bool | `false` | 启用 XPorta 传输 |
| `session_path` | string | `"/api/auth"` | XPorta 会话端点 |
| `data_paths` | string[] | `["/api/v1/data", "/api/v1/sync", "/api/v1/update"]` | XPorta 上传路径 |
| `poll_paths` | string[] | `["/api/v1/notifications", "/api/v1/feed", "/api/v1/events"]` | XPorta 长轮询下载路径 |
| `session_timeout_secs` | u64 | `300` | 会话空闲超时（秒） |
| `max_sessions_per_client` | u16 | `8` | 每客户端最大并发会话数 |
| `cookie_name` | string | `"_sess"` | 会话 Cookie 名称 |
| `encoding` | string | `"json"` | 编码方式：`"json"` / `"binary"` |

## 完整示例

```toml title="server.toml"
listen_addr = "0.0.0.0:8443"
quic_listen_addr = "0.0.0.0:8443"
dns_upstream = "8.8.8.8:53"
config_watch = true
shutdown_drain_timeout_secs = 30
ticket_rotation_hours = 6

[tls]
cert_path = "prisma-cert.pem"
key_path = "prisma-key.pem"

# 使用以下命令生成密钥：prisma gen-key
[[authorized_clients]]
id = "00000000-0000-0000-0000-000000000001"
auth_secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
name = "my-client"
bandwidth_up = "100mbps"
bandwidth_down = "500mbps"
quota = "500GB"
quota_period = "monthly"

[logging]
level = "info"       # trace | debug | info | warn | error
format = "pretty"    # pretty | json

[performance]
max_connections = 1024        # 最大并发连接数
connection_timeout_secs = 300 # 空闲超时时间（秒）

# 端口转发（反向代理）— 允许客户端暴露本地服务
[port_forwarding]
enabled = true
port_range_start = 10000
port_range_end = 20000
max_forwards_per_client = 10
max_connections_per_forward = 100
default_idle_timeout_secs = 300
require_name = false
log_connections = true

# 管理 API + 控制台
[management_api]
enabled = true
listen_addr = "127.0.0.1:9090"
auth_token = "your-secure-token-here"
jwt_secret = "auto-generated-on-first-run"
console_dir = "/opt/prisma/console"

# 控制台用户（也可通过 /api/auth/register 自助注册）
[[management_api.users]]
username = "admin"
password_hash = "$2b$10$..."  # bcrypt 哈希，使用以下命令生成：prisma hash-password
role = "admin"
enabled = true

# 每帧填充
[padding]
min = 0
max = 256

# 伪装（抗主动探测）
[camouflage]
enabled = true
tls_on_tcp = true
fallback_addr = "example.com:443"
alpn_protocols = ["h2", "http/1.1"]

# TLS 探测防御（自动封锁重复握手失败的 IP）
[camouflage.tls_probe_guard]
enabled = true
max_failures = 20
failure_window_secs = 120
block_duration_secs = 120

# 每客户端 ACL
# [acls.client-uuid-1]
# client_id = "client-uuid-1"
# default_policy = "allow"
# enabled = true
# [[acls.client-uuid-1.rules]]
# action = "deny"
# description = "屏蔽 torrent 站点"
# [acls.client-uuid-1.rules.matcher]
# type = "domain-keyword"
# value = "torrent"

# 传输回退
# [fallback]
# enabled = true
# chain = ["tcp", "quic", "websocket", "grpc"]
# health_check_interval = 30
# auto_switch_on_failure = true
# max_consecutive_failures = 5
# migrate_back_on_recovery = false
```

## 验证规则

服务端配置在启动时进行验证，以下规则将被强制执行：

- `listen_addr` 不能为空
- `authorized_clients` 中至少需要一个条目
- 每个 `authorized_clients[].id` 不能为空
- 每个 `authorized_clients[].auth_secret` 不能为空且必须是有效的十六进制字符串
- `logging.level` 必须是以下之一：`trace`、`debug`、`info`、`warn`、`error`
- `logging.format` 必须是以下之一：`pretty`、`json`
- `camouflage.tls_on_tcp = true` 需要设置 `tls.cert_path` 和 `tls.key_path`
- `ssh.enabled = true` 需要至少设置 `ssh.password` 或 `ssh.authorized_keys_path` 之一
- `ticket_rotation_hours` 必须 > 0
- `shutdown_drain_timeout_secs` 必须 > 0
