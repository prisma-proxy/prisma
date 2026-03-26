# prisma-cli 参考

`prisma-cli` 是 CLI 二进制 crate，使用 clap 4 构建。提供运行服务端和客户端、通过管理 API 管理服务端、生成密钥和证书、导入服务器配置以及运行诊断的命令。

**路径：** `crates/prisma-cli/src/`

**二进制名称：** `prisma`

---

## 全局标志

| 标志 | 环境变量 | 默认值 | 描述 |
|------|---------|--------|------|
| `--json` | -- | `false` | 输出原始 JSON |
| `-v, --verbose` | -- | `false` | 启用详细输出 |
| `--mgmt-url <URL>` | `PRISMA_MGMT_URL` | 自动检测 | 管理 API URL |
| `--mgmt-token <TOKEN>` | `PRISMA_MGMT_TOKEN` | 自动检测 | 管理 API 认证令牌 |

---

## 命令

### `prisma server` -- 启动服务端

```bash
prisma server [-c server.toml] [-d] [--pid-file PATH]
prisma server stop
prisma server status
```

### `prisma client` -- 启动客户端

```bash
prisma client [-c client.toml] [-d] [--pid-file PATH]
prisma client stop
prisma client status
```

### `prisma console` -- 启动 Web 控制台

```bash
prisma console [--port 9091] [--bind 0.0.0.0] [--no-open]
prisma console stop
prisma console status
```

### `prisma gen-key` -- 生成客户端密钥

```bash
prisma gen-key [--json]
```

### `prisma gen-cert` -- 生成自签名证书

```bash
prisma gen-cert [-o DIR] [--cn NAME]
```

### `prisma init` -- 生成配置文件

```bash
prisma init [--cdn] [--server-only] [--client-only] [--force]
```

### `prisma validate` -- 验证配置

```bash
prisma validate -c <PATH> [-t server|client]
```

### `prisma status` -- 查询服务端状态

```bash
prisma status
```

### `prisma version` -- 显示版本信息

```bash
prisma version [--json]
```

### `prisma completions` -- 生成 Shell 补全脚本

```bash
prisma completions bash|zsh|fish|powershell|elvish
```

### `prisma import` -- 导入服务器配置

```bash
prisma import --uri 'prisma://...'
prisma import --file servers.txt
prisma import --url 'https://example.com/subscribe'
```

### `prisma clients` -- 管理授权客户端

```bash
prisma clients list
prisma clients show <ID>
prisma clients create [--name NAME]
prisma clients delete <ID>
prisma clients enable <ID>
prisma clients disable <ID>
```

### `prisma connections` -- 管理活跃连接

```bash
prisma connections list
prisma connections disconnect <ID>
prisma connections watch [--interval SECS]
```

### `prisma metrics` -- 查看指标

```bash
prisma metrics [--watch] [--history] [--system]
```

### `prisma bandwidth` -- 管理带宽

```bash
prisma bandwidth summary
prisma bandwidth get <ID>
prisma bandwidth set <ID> [--upload BPS] [--download BPS]
prisma bandwidth quota <ID> [--limit BYTES]
```

### `prisma config` -- 管理配置

```bash
prisma config get
prisma config set <KEY> <VALUE>
prisma config tls
prisma config backup create|list|restore|diff|delete
```

### `prisma routes` -- 管理路由规则

```bash
prisma routes list
prisma routes create --name NAME --condition COND --action ACTION
prisma routes update <ID> [--condition COND] [--action ACTION]
prisma routes delete <ID>
prisma routes setup <PRESET> [--clear]
```

### `prisma logs` -- 实时日志流

```bash
prisma logs [--level LEVEL] [--lines N]
```

### `prisma ping` -- Ping 服务端

```bash
prisma ping [-c client.toml] [-s host:port] [--count N]
```

### `prisma diagnose` -- 连接诊断

```bash
prisma diagnose [-c client.toml]
```

### `prisma speed-test` -- 速度测试

```bash
prisma speed-test -s <HOST:PORT> [-d DURATION] [--direction both]
```

### `prisma subscription` -- 管理订阅

```bash
prisma subscription add --url URL --name NAME
prisma subscription update --url URL
prisma subscription list --url URL
prisma subscription test --url URL
```

### `prisma latency-test` -- 延迟测试

```bash
prisma latency-test --url URL
prisma latency-test --servers 'addr1,addr2'
```

---

## 守护进程管理

所有服务命令支持守护进程模式：

- **启动守护进程：** `prisma server -d`
- **检查状态：** `prisma server status`
- **停止守护进程：** `prisma server stop`

---

## API 客户端自动检测

管理 API 端点自动解析顺序：

1. `--mgmt-url` / `--mgmt-token` 标志
2. `PRISMA_MGMT_URL` / `PRISMA_MGMT_TOKEN` 环境变量
3. 从 `server.toml` 提取管理 API 地址和令牌
4. 回退到 `http://127.0.0.1:9090`
