# prisma-mgmt 参考

`prisma-mgmt` 是管理 API crate，基于 axum 构建。提供 REST 和 WebSocket 端点，用于监控和控制运行中的 Prisma 服务端。

**路径：** `prisma-mgmt/src/`

---

## 认证中间件

所有 API 端点（`/api/prometheus` 除外）都受 Bearer Token 认证保护。

```
Authorization: Bearer your-secret-token
```

---

## 完整 REST API 参考

### 健康和指标

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/metrics` | 当前指标快照 |
| `GET` | `/api/metrics/history` | 历史指标（参数：`period`） |

### 系统信息

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/api/system/info` | 系统和运行时信息 |

### 连接管理

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/api/connections` | 列出所有活跃连接 |
| `DELETE` | `/api/connections/{id}` | 强制断开连接 |

### 客户端管理

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/api/clients` | 列出所有授权客户端 |
| `POST` | `/api/clients` | 创建新客户端 |
| `PUT` | `/api/clients/{id}` | 更新客户端 |
| `DELETE` | `/api/clients/{id}` | 删除客户端 |

### 带宽和配额

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/api/clients/{id}/bandwidth` | 获取客户端带宽限制 |
| `PUT` | `/api/clients/{id}/bandwidth` | 设置客户端带宽限制 |
| `GET` | `/api/clients/{id}/quota` | 获取客户端流量配额 |
| `PUT` | `/api/clients/{id}/quota` | 设置客户端流量配额 |
| `GET` | `/api/bandwidth/summary` | 所有客户端带宽摘要 |

### 配置管理

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/api/config` | 获取当前配置（密钥已脱敏） |
| `PATCH` | `/api/config` | 更新配置字段 |
| `GET` | `/api/config/tls` | TLS 证书信息 |

### 配置备份

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/api/config/backups` | 列出所有备份 |
| `POST` | `/api/config/backup` | 创建新备份 |
| `GET` | `/api/config/backups/{name}` | 获取备份内容 |
| `POST` | `/api/config/backups/{name}/restore` | 恢复备份 |
| `GET` | `/api/config/backups/{name}/diff` | 备份差异比较 |
| `DELETE` | `/api/config/backups/{name}` | 删除备份 |

### 端口转发

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/api/forwards` | 列出端口转发 |
| `DELETE` | `/api/forwards/{port}` | 取消注册端口转发 |
| `GET` | `/api/forwards/{port}/connections` | 端口转发连接列表 |

### 路由规则

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/api/routes` | 列出路由规则 |
| `POST` | `/api/routes` | 创建路由规则 |
| `PUT` | `/api/routes/{id}` | 更新路由规则 |
| `DELETE` | `/api/routes/{id}` | 删除路由规则 |

### 访问控制列表

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/api/acls` | 列出所有 ACL |
| `GET` | `/api/acls/{client_id}` | 获取客户端 ACL |
| `PUT` | `/api/acls/{client_id}` | 设置客户端 ACL |
| `DELETE` | `/api/acls/{client_id}` | 删除客户端 ACL |

### 告警配置

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/api/alerts/config` | 获取告警阈值 |
| `PUT` | `/api/alerts/config` | 更新告警阈值 |

### 配置重载

| 方法 | 路径 | 描述 |
|------|------|------|
| `POST` | `/api/reload` | 触发配置热重载 |

### Prometheus 指标

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/api/prometheus` | Prometheus 格式指标（无需认证） |

---

## WebSocket 端点

| 路径 | 描述 |
|------|------|
| `/api/ws/metrics` | 实时指标流（每秒推送） |
| `/api/ws/logs` | 实时日志流 |
| `/api/ws/connections` | 实时连接事件 |
| `/api/ws/reload` | 重载事件通知 |
