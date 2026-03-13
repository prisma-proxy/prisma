---
sidebar_position: 6
---

# 路由规则

路由规则引擎控制客户端可以连接到哪些目标。规则在连接时评估，在出站连接建立之前执行。

## 概述

规则通过[管理 API](/docs/features/management-api) 或[控制面板](/docs/features/dashboard)在运行时管理。无需重启服务器。

- 规则按**优先级顺序**评估（数值越低优先级越高）
- **第一个匹配的规则**决定操作
- 如果**没有规则匹配**，默认**允许**流量
- 规则可以**启用或禁用**而不必删除

## 规则条件

| 类型 | 值 | 匹配 |
|------|-----|------|
| `DomainMatch` | Glob 模式（如 `*.google.com`） | 匹配 glob 的域名目标 |
| `DomainExact` | 精确域名（如 `example.com`） | 精确域名匹配（不区分大小写） |
| `IpCidr` | CIDR 表示法（如 `192.168.0.0/16`） | CIDR 范围内的 IPv4 目标 |
| `PortRange` | 两个数字（如 `[80, 443]`） | 端口在范围内的目标 |
| `All` | — | 所有流量 |

## 规则操作

- **Allow** — 允许连接
- **Block** — 拒绝连接（客户端收到错误信息）

## 示例

### 阻止某个域名的所有流量

```json
{
  "name": "Block ads",
  "priority": 10,
  "condition": { "type": "DomainMatch", "value": "*.doubleclick.net" },
  "action": "Block",
  "enabled": true
}
```

### 仅允许 HTTPS 流量

```json
{
  "name": "Allow HTTPS",
  "priority": 1,
  "condition": { "type": "PortRange", "value": [443, 443] },
  "action": "Allow",
  "enabled": true
}
```

```json
{
  "name": "Block everything else",
  "priority": 100,
  "condition": { "type": "All", "value": null },
  "action": "Block",
  "enabled": true
}
```

### 阻止内网访问

```json
{
  "name": "Block RFC1918",
  "priority": 5,
  "condition": { "type": "IpCidr", "value": "10.0.0.0/8" },
  "action": "Block",
  "enabled": true
}
```

## 管理规则

### 通过管理 API

```bash
# 列出规则
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/api/routes

# 创建规则
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Block ads",
    "priority": 10,
    "condition": {"type": "DomainMatch", "value": "*.ads.example.com"},
    "action": "Block",
    "enabled": true
  }' \
  http://127.0.0.1:9090/api/routes

# 删除规则
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:9090/api/routes/<rule-id>
```

### 通过控制面板

在控制面板中导航到**路由**页面，可视化管理规则。您可以创建、编辑、切换、重新排序和删除规则，无需直接操作 API。

## 行为说明

- 域名匹配仅适用于带有域名类型地址的 `Connect` 命令。IP 地址不会被反向解析。
- `DomainMatch` 使用简单的 glob 匹配：`*.example.com` 匹配 `sub.example.com` 和 `example.com`。
- `IpCidr` 目前仅支持 IPv4。
- 规则存储在内存中。服务器重启后会被清除。持久化到文件的功能计划在未来版本中实现。
