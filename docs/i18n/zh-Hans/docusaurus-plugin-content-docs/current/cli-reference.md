---
sidebar_position: 6
---

# CLI 参考

`prisma` 二进制文件（v2.24.0）提供多个子命令，用于运行服务端和客户端（支持守护进程模式）、生成凭证、管理配置、启动控制台、导入服务器配置、管理订阅、测试延迟，以及通过管理 API 控制运行中的服务器。

## 全局参数

以下参数适用于所有子命令：

| 参数 | 环境变量 | 描述 |
|------|----------|------|
| `--json` | -- | 输出原始 JSON 而非格式化表格 |
| `--verbose`, `-v` | -- | 启用详细（debug）输出。如果 `RUST_LOG` 未设置则设为 `debug` |
| `--mgmt-url <URL>` | `PRISMA_MGMT_URL` | 管理 API 地址（覆盖自动检测） |
| `--mgmt-token <TOKEN>` | `PRISMA_MGMT_TOKEN` | 管理 API 认证令牌（覆盖自动检测） |

示例：

```bash
# 脚本化 JSON 输出
prisma clients list --json

# Debug 级别日志
prisma server -v -c server.toml

# 显式管理 API 连接
prisma status --mgmt-url https://my-server.com:9090 --mgmt-token my-token
```

---

## 服务端、客户端和控制台（守护进程模式）

`server`、`client` 和 `console` 命令都支持通过 `-d` 参数的**守护进程模式**，以及 `stop`/`status` 子命令来管理后台进程。

### `prisma server`

启动代理服务端。

```bash
prisma server [-d] [-c <PATH>] [--pid-file <PATH>] [--log-file <PATH>]
prisma server stop [--pid-file <PATH>]
prisma server status [--pid-file <PATH>]
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `-c, --config <PATH>` | `server.toml` | 服务端配置文件路径 |
| `-d, --daemon` | -- | 作为后台守护进程运行 |
| `--pid-file <PATH>` | `/tmp/prisma-server.pid` | 守护进程模式的 PID 文件路径 |
| `--log-file <PATH>` | `/var/log/prisma/prisma-server.log` | 守护进程模式的日志文件路径 |

| 子命令 | 描述 |
|--------|------|
| `stop` | 停止运行中的服务端守护进程（发送 SIGTERM） |
| `status` | 检查服务端守护进程是否正在运行 |

服务端同时启动 TCP 和 QUIC 监听器并等待客户端连接。启动时验证配置，验证失败则退出并报错。如果设置了 `config_watch = true`，服务端会在配置文件更改时自动重载。服务端也会在收到 `SIGHUP` 时重载。

如果当前目录找不到配置文件，CLI 会自动搜索标准位置（`/etc/prisma/`、`~/.config/prisma/`）。

**示例：**

```bash
# 前台模式
prisma server -c server.toml

# 守护进程模式
prisma server -d -c /etc/prisma/server.toml

# 自定义 PID 和日志路径的守护进程
prisma server -d -c server.toml --pid-file /run/prisma-server.pid --log-file /var/log/prisma/server.log

# 检查守护进程是否运行
prisma server status

# 停止守护进程
prisma server stop

# 触发热重载（前台运行时）
kill -HUP $(cat /tmp/prisma-server.pid)
```

### `prisma client`

启动代理客户端。

```bash
prisma client [-d] [-c <PATH>] [--pid-file <PATH>] [--log-file <PATH>]
prisma client stop [--pid-file <PATH>]
prisma client status [--pid-file <PATH>]
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `-c, --config <PATH>` | `client.toml` | 客户端配置文件路径 |
| `-d, --daemon` | -- | 作为后台守护进程运行 |
| `--pid-file <PATH>` | `/tmp/prisma-client.pid` | 守护进程模式的 PID 文件路径 |
| `--log-file <PATH>` | `/var/log/prisma/prisma-client.log` | 守护进程模式的日志文件路径 |

| 子命令 | 描述 |
|--------|------|
| `stop` | 停止运行中的客户端守护进程 |
| `status` | 检查客户端守护进程是否正在运行 |

客户端启动 SOCKS5 监听器（以及可选的 HTTP CONNECT 监听器和 TUN 设备），连接到远程服务器，执行 PrismaVeil v5 握手，然后开始代理流量。

**示例：**

```bash
# 前台模式
prisma client -c client.toml

# 守护进程模式
prisma client -d -c client.toml

# 详细前台模式
prisma client -v -c client.toml

# 检查状态和停止
prisma client status
prisma client stop
```

### `prisma console`

启动 Web 控制台，支持自动下载和反向代理。

```bash
prisma console [-d] [--mgmt-url <URL>] [--token <TOKEN>] [--port <PORT>] [--bind <ADDR>]
prisma console stop [--pid-file <PATH>]
prisma console status [--pid-file <PATH>]
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `--mgmt-url <URL>` | 从 `server.toml` 自动检测 | 代理请求的管理 API 地址 |
| `--token <TOKEN>` | 自动检测 | 管理 API 认证令牌 |
| `--port <PORT>` | `9091` | 控制台服务端口 |
| `--bind <ADDR>` | `0.0.0.0` | 控制台绑定地址 |
| `--no-open` | -- | 不自动打开浏览器 |
| `--update` | -- | 强制重新下载控制台资源 |
| `--dir <PATH>` | -- | 从本地目录提供控制台，而非自动下载 |
| `-d, --daemon` | -- | 作为后台守护进程运行 |
| `--pid-file <PATH>` | `/tmp/prisma-console.pid` | 守护进程模式的 PID 文件路径 |
| `--log-file <PATH>` | `/var/log/prisma/prisma-console.log` | 守护进程模式的日志文件路径 |

| 子命令 | 描述 |
|--------|------|
| `stop` | 停止运行中的控制台守护进程 |
| `status` | 检查控制台守护进程是否正在运行 |

首次运行时从 GitHub Releases 下载最新控制台并缓存到本地（Linux: `~/.cache/prisma/console/`，macOS: `~/Library/Caches/prisma/`，Windows: `%LOCALAPPDATA%\prisma\`）。启动本地服务器提供静态控制台并将 `/api/*` 请求反向代理到管理 API。

令牌自动检测顺序：`--token` 参数 > `PRISMA_MGMT_TOKEN` 环境变量 > `server.toml` 管理部分。管理 URL 自动检测顺序：`--mgmt-url` 参数 > `server.toml` 管理部分 > `http://127.0.0.1:9090`。

桌面系统会自动打开浏览器。无头/VPS 环境（SSH 会话、无 `$DISPLAY`）则打印 URL。

**示例：**

```bash
# 基本用法（从 server.toml 自动检测令牌）
prisma console

# 显式令牌
prisma console --token your-secure-token

# 连接远程服务器的管理 API
prisma console --mgmt-url https://my-server.com:9090 --token my-token

# 守护进程模式
prisma console -d --token your-secure-token

# 自定义端口和绑定地址
prisma console --port 8888 --bind 127.0.0.1 --token my-token

# 强制重新下载最新控制台
prisma console --update --token your-secure-token

# 从本地开发构建提供
prisma console --dir ./apps/prisma-console/out --token my-token
```

---

## 凭证和配置生成

### `prisma gen-key`

生成新的客户端身份标识（UUID + 认证密钥对）。

```bash
prisma gen-key
```

无需参数。输出一个新的 UUID 和 64 字符的十六进制密钥，以及可直接粘贴到服务端和客户端配置文件的 TOML 代码片段。

### `prisma gen-cert`

生成用于开发环境的自签名 TLS 证书。

```bash
prisma gen-cert [-o <DIR>] [--cn <NAME>]
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `-o, --output <DIR>` | `.` | 证书和密钥文件的输出目录 |
| `--cn <NAME>` | `prisma-server` | 证书的通用名称 |

:::warning
自签名证书仅适用于开发环境。生产环境请使用受信任 CA 或 Let's Encrypt 颁发的证书。
:::

### `prisma init`

生成带注释的配置文件，并自动生成密钥。

```bash
prisma init [--cdn] [--server-only] [--client-only] [--force]
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `--cdn` | -- | 包含预配置的 CDN 传输部分（WebSocket、gRPC、XHTTP、XPorta） |
| `--server-only` | -- | 仅生成服务端配置 |
| `--client-only` | -- | 仅生成客户端配置 |
| `--force` | -- | 覆盖已有文件 |

### `prisma profile new`

交互式配置文件生成向导，用于创建客户端连接配置。

```bash
prisma profile new [-o <PATH>] [--format <FORMAT>]
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `-o, --output <PATH>` | stdout | 输出文件路径 |
| `--format <FORMAT>` | `toml` | 输出格式：`toml`、`uri` 或 `json` |

通过 5 步交互式流程引导：
1. **服务器地址** -- 主机名/IP 和端口
2. **传输方式** -- TCP、QUIC、WebSocket、gRPC、XHTTP、XPorta、PrismaTLS 或 WireGuard
3. **客户端 ID** -- 使用已有 UUID 或生成新的
4. **认证密钥** -- 粘贴已有密钥或自动生成
5. **预览** -- 预览配置并确认

**示例：**

```bash
# 交互式向导，以 TOML 格式输出到 stdout
prisma profile new

# 以 prisma:// URI 格式输出到文件
prisma profile new --format uri -o profile.txt

# 以 JSON 格式输出
prisma profile new --format json -o profile.json
```

### `prisma validate`

在不启动服务的情况下验证配置文件。

```bash
prisma validate -c <PATH> [-t <TYPE>]
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `-c, --config <PATH>` | -- | 配置文件路径 |
| `-t, --type <TYPE>` | `server` | 配置类型：`server` 或 `client` |

解析 TOML 文件并执行结构和语义双重验证：
- **结构检查** -- TOML 语法、必填字段、类型正确性
- **语义检查** -- 端口范围（1-65535）、认证密钥长度、TLS 证书文件是否存在、地址格式
- **安全警告** -- 弱认证密钥、生产环境缺少 TLS、过于宽松的 ACL 规则

输出使用彩色格式：绿色表示通过、红色表示错误、黄色表示警告。验证通过时退出码为 0，否则打印错误并以非零退出码退出。

**示例：**

```bash
prisma validate -c server.toml
prisma validate -c client.toml -t client
```

---

## 订阅

### `prisma subscription`

管理服务器订阅，支持自动更新。

```bash
prisma subscription <SUBCOMMAND>
```

| 子命令 | 描述 |
|--------|------|
| `add --url <URL> --name <NAME>` | 添加新订阅并指定显示名称 |
| `update --url <URL>` | 重新获取并更新订阅中的服务器 |
| `list --url <URL>` | 列出订阅中的所有服务器 |
| `test --url <URL>` | 测试订阅中所有服务器的延迟 |

### `prisma latency-test`

测试到服务器的 TCP 连接延迟。

```bash
prisma latency-test [--url <URL>] [--servers <ADDRS>]
```

| 参数 | 描述 |
|------|------|
| `--url <URL>` | 从此订阅 URL 获取服务器 |
| `--servers <ADDRS>` | 逗号分隔的服务器地址（`host:port`） |

至少需要提供 `--url` 或 `--servers` 之一。结果按延迟排序，最佳服务器高亮显示。

---

## 诊断和测试

### `prisma version`

显示版本信息、协议版本和支持的功能。

```bash
prisma version
```

### `prisma status`

查询管理 API 获取服务器状态。

```bash
prisma status
```

### `prisma ping`

测量到服务器的握手 RTT。

```bash
prisma ping [-c <PATH>] [-s <HOST:PORT>] [--count <N>] [--interval <MS>]
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `-c, --config <PATH>` | `client.toml` | 客户端配置文件（用于认证凭证） |
| `-s, --server <HOST:PORT>` | -- | 覆盖配置中的服务器地址 |
| `--count <N>` | `5` | 发送 ping 的次数 |
| `--interval <MS>` | `1000` | 两次 ping 之间的间隔（毫秒） |

### `prisma speed-test`

运行针对服务器的带宽测量测试。

```bash
prisma speed-test -s <HOST:PORT> [-d <SECS>] [--direction <DIR>] [-C <PATH>]
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `-s, --server <HOST:PORT>` | -- | 服务器地址 |
| `-d, --duration <SECS>` | `10` | 测试持续时间（秒） |
| `--direction <DIR>` | `both` | 方向：`download`、`upload` 或 `both` |
| `-C, --config <PATH>` | `client.toml` | 客户端配置文件（用于认证凭证） |

### `prisma test-transport`

测试所有已配置的传输方式并报告哪些可用。

```bash
prisma test-transport [-c <PATH>]
```

### `prisma diagnose`

运行连接性诊断。测试 DNS 解析、TCP 连接、TLS 握手和 PrismaVeil 握手。

```bash
prisma diagnose [-c <PATH>]
```

### `prisma monitor`

交互式 TUI 仪表盘，用于实时服务器监控，基于 [ratatui](https://github.com/ratatui-org/ratatui) 构建。

```bash
prisma monitor [--interval <MS>]
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `--interval <MS>` | `1000` | 刷新间隔（毫秒） |

连接管理 API 并显示全屏终端仪表盘：
- **实时指标** -- 活跃连接数、上传/下载字节数、运行时间、CPU/内存
- **可滚动连接表格** -- 所有活跃连接，显示目标地址、传输方式、速度和数据计数
- **键盘控制** -- `q` 退出、`Tab` 切换面板、方向键滚动、`d` 断开所选连接

**示例：**

```bash
prisma monitor
prisma monitor --interval 500
prisma monitor --mgmt-url https://my-server.com:9090 --mgmt-token my-token
```

### `prisma completions`

生成 Shell 自动补全脚本。

```bash
prisma completions <SHELL>
```

| 参数 | 描述 |
|------|------|
| `<SHELL>` | 目标 Shell：`bash`、`fish`、`zsh`、`elvish`、`powershell` |

---

## 管理 API 命令

以下命令通过管理 API 与运行中的服务器通信。管理 API URL 和令牌按以下顺序解析：

1. `--mgmt-url` / `--mgmt-token` 命令行参数
2. `PRISMA_MGMT_URL` / `PRISMA_MGMT_TOKEN` 环境变量
3. 从当前目录或标准配置位置的 `server.toml` 自动检测

### `prisma clients`

管理授权客户端。

| 子命令 | 描述 |
|--------|------|
| `list` | 列出所有授权客户端 |
| `show <ID>` | 显示特定客户端的详情 |
| `create [--name NAME]` | 创建新客户端（自动生成密钥） |
| `delete <ID> [--yes]` | 删除客户端（`--yes` 跳过确认） |
| `enable <ID>` | 启用客户端 |
| `disable <ID>` | 禁用客户端 |
| `batch-create --count N --prefix <NAME>` | 批量创建客户端，自动编号命名 |
| `export [-o <FILE>]` | 将所有客户端导出为 JSON（默认：stdout） |
| `import <FILE>` | 从 JSON 文件导入客户端 |

**示例：**

```bash
# 批量创建 10 个客户端，前缀为 "device-"
prisma clients batch-create --count 10 --prefix "device-"

# 导出所有客户端
prisma clients export -o clients.json

# 从文件导入客户端
prisma clients import clients.json
```

### `prisma connections`

管理活跃连接。

| 子命令 | 描述 |
|--------|------|
| `list` | 列出活跃连接 |
| `disconnect <ID>` | 终止特定会话 |
| `watch [--interval N]` | 实时监控连接（默认间隔：2 秒） |

### `prisma metrics`

查看服务器指标和系统信息。

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `--watch` | -- | 自动刷新指标 |
| `--history` | -- | 显示历史指标 |
| `--period <PERIOD>` | `1h` | 历史周期：`1h`、`6h`、`24h`、`7d` |
| `--interval <SECS>` | `2` | 刷新间隔（秒，用于 `--watch`） |
| `--system` | -- | 显示系统信息而非指标 |

### `prisma bandwidth`

管理每客户端带宽限制和流量配额。

| 子命令 | 描述 |
|--------|------|
| `summary` | 显示所有客户端的带宽概览 |
| `get <ID>` | 显示特定客户端的带宽和配额 |
| `set <ID> [--upload BPS] [--download BPS]` | 设置上传/下载限速（位/秒，0 = 不限速） |
| `quota <ID> [--limit BYTES]` | 获取或设置流量配额（字节） |

### `prisma config`

管理服务器配置。

| 子命令 | 描述 |
|--------|------|
| `get` | 显示当前服务器配置 |
| `set <KEY> <VALUE>` | 更新配置值（点分格式，如 `logging.level`） |
| `tls` | 显示 TLS 配置 |
| `backup create` | 创建配置备份 |
| `backup list` | 列出所有备份 |
| `backup restore <NAME>` | 恢复备份 |
| `backup diff <NAME>` | 显示备份与当前配置的差异 |
| `backup delete <NAME>` | 删除备份 |

### `prisma routes`

管理服务端路由规则。

| 子命令 | 描述 |
|--------|------|
| `list` | 列出所有路由规则 |
| `create --name NAME --condition COND --action ACTION [--priority N]` | 创建路由规则 |
| `update <ID> [--condition COND] [--action ACTION] [--priority N] [--name NAME]` | 更新路由规则 |
| `delete <ID>` | 删除路由规则 |
| `setup <PRESET> [--clear]` | 应用预定义规则预设 |

条件格式：`TYPE:VALUE`，例如 `DomainMatch:*.ads.*`、`IpCidr:10.0.0.0/8`、`PortRange:80-443`、`All`。

可用预设：

| 预设 | 规则数 | 描述 |
|------|--------|------|
| `block-ads` | 10 | 屏蔽常见广告和广告网络域名 |
| `privacy` | 19 | 屏蔽广告 + 分析/遥测追踪器 |
| `allow-all` | 1 | 添加全匹配 Allow 规则（优先级 1000） |
| `block-all` | 1 | 添加全匹配 Block 规则（优先级 1000） |

### `prisma logs`

通过 WebSocket 实时流式传输服务器日志。

```bash
prisma logs [--level <LEVEL>] [--lines <N>]
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `--level <LEVEL>` | -- | 最低日志级别：`TRACE`、`DEBUG`、`INFO`、`WARN`、`ERROR` |
| `--lines <N>` | -- | 显示的最大日志行数 |

---

## 自更新

### `prisma update`

检查并安装来自 GitHub Releases 的更新。

```bash
prisma update [--check] [--yes]
```

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `--check` | -- | 仅检查更新，不下载安装 |
| `--yes` | -- | 跳过确认提示，直接安装 |

从 GitHub 下载最新版本，验证二进制文件，并替换当前运行的可执行文件。需要对二进制文件位置的写入权限。

**示例：**

```bash
# 检查更新
prisma update --check

# 带确认提示的更新
prisma update

# 无确认自动更新
prisma update --yes
```

---

## 快速参考

| 命令 | 用途 |
|------|------|
| `prisma server [-d] [-c PATH]` | 启动代理服务端（前台或守护进程） |
| `prisma server stop` | 停止服务端守护进程 |
| `prisma server status` | 检查服务端守护进程状态 |
| `prisma client [-d] [-c PATH]` | 启动代理客户端（前台或守护进程） |
| `prisma client stop` | 停止客户端守护进程 |
| `prisma client status` | 检查客户端守护进程状态 |
| `prisma console [-d] [--port PORT] [--token TOKEN]` | 启动 Web 控制台 |
| `prisma console stop` | 停止控制台守护进程 |
| `prisma console status` | 检查控制台守护进程状态 |
| `prisma gen-key` | 生成客户端凭证 |
| `prisma gen-cert` | 生成自签名 TLS 证书 |
| `prisma init [--cdn]` | 生成带注释的配置文件 |
| `prisma validate -c PATH` | 验证配置文件 |
| `prisma subscription add/update/list/test` | 管理订阅 |
| `prisma latency-test --url/--servers` | 测试到服务器的延迟 |
| `prisma version` | 显示版本和功能 |
| `prisma status` | 通过管理 API 查询服务器状态 |
| `prisma ping` | 测量握手 RTT |
| `prisma speed-test` | 带宽测量 |
| `prisma test-transport` | 测试所有传输方式 |
| `prisma diagnose` | 运行连接性诊断 |
| `prisma completions <SHELL>` | 生成 Shell 自动补全 |
| `prisma monitor` | 交互式 TUI 仪表盘 |
| `prisma profile new` | 交互式配置文件生成向导 |
| `prisma clients list/show/create/delete/enable/disable` | 管理授权客户端 |
| `prisma clients batch-create/export/import` | 批量客户端操作 |
| `prisma connections list/disconnect/watch` | 管理活跃连接 |
| `prisma metrics [--watch/--history/--system]` | 查看服务器指标 |
| `prisma bandwidth summary/get/set/quota` | 管理带宽限制 |
| `prisma config get/set/tls/backup` | 管理服务器配置 |
| `prisma routes list/create/update/delete/setup` | 管理路由规则 |
| `prisma logs [--level LEVEL]` | 实时流式传输服务器日志 |
| `prisma update [--check] [--yes]` | 检查并安装更新 |
