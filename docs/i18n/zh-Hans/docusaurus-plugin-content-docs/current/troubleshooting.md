---
sidebar_position: 9
---

# 故障排除

Prisma v2.24.0 的常见问题及其解决方案。

## 认证失败

**症状：** 客户端连接失败，显示 "Authentication failed" 或 `AcceptStatus::AuthFailed`。

**原因：**
- `client.toml` 中的 `client_id` 与 `server.toml` 中 `authorized_clients` 的任何条目都不匹配
- 客户端和服务端配置中的 `auth_secret` 不匹配
- `auth_secret` 不是有效的十六进制（必须恰好 64 个十六进制字符）
- 客户端在服务端被禁用（使用 `prisma clients list` 检查）

**解决方案：**

1. 重新运行 `prisma gen-key` 生成新的密钥对
2. 将输出复制到 `server.toml` 和 `client.toml`
3. 验证值完全匹配——没有多余的空格或截断
4. 检查客户端是否已启用：`prisma clients show <ID>`

## TLS 证书错误

**症状：** 连接失败并出现 TLS 相关错误，如 `CertificateRequired`、`InvalidCertificate` 或 `HandshakeFailure`。

**原因：**
- 配置路径中的证书或密钥文件不存在
- 证书过期或无效
- 客户端使用 `skip_cert_verify = false` 连接到自签名证书的服务器
- 证书 CN 与服务器地址不匹配

**解决方案：**

- 验证 `server.toml` 中的文件路径是否正确且文件存在
- 在开发环境中使用自签名证书时，在 `client.toml` 中设置 `skip_cert_verify = true`
- 生产环境请使用受信任 CA 颁发的证书（推荐 Let's Encrypt）
- 重新生成证书：`prisma gen-cert -o . --cn prisma-server`
- 检查证书详情：`openssl x509 -in prisma-cert.pem -noout -text`

## 控制台无法访问

**症状：** 无法在浏览器中访问 Web 控制台，或控制台页面无法加载。

**原因：**
- 控制台绑定到 `0.0.0.0` 但防火墙阻止了 9091 端口
- TLS 不匹配：管理 API 使用 HTTPS 但控制台尝试 HTTP（或反之）
- 未提供令牌或令牌不正确
- 控制台资源尚未下载

**解决方案：**

1. 验证控制台是否正在运行：
   ```bash
   prisma console status
   ```

2. 检查绑定地址和端口：
   ```bash
   # 默认绑定到 0.0.0.0:9091——可从任何接口访问
   prisma console --port 9091 --bind 0.0.0.0 --token your-token

   # 仅本地访问：
   prisma console --bind 127.0.0.1 --token your-token
   ```

3. 确保管理 API 从控制台服务器可达：
   ```bash
   curl -H "Authorization: Bearer your-token" http://127.0.0.1:9090/api/health
   ```

4. 如果在反向代理（nginx、Caddy）后面，确保 WebSocket 升级头被传递以支持实时功能。

5. 如果资源损坏，强制重新下载控制台资源：
   ```bash
   prisma console --update --token your-token
   ```

## 端口转发问题

**症状：** 客户端日志显示 `ForwardReady` 且 `success = false`，或端口转发不工作。

**原因：**
- 服务端未启用端口转发（`enabled = false` 或缺失）
- 请求的 `remote_port` 超出服务端允许的范围
- 该端口在服务端已被占用
- 防火墙阻止了服务端的转发端口

**解决方案：**

1. 验证服务端已启用端口转发：

   ```toml
   [port_forwarding]
   enabled = true
   port_range_start = 10000
   port_range_end = 20000
   ```

2. 确保客户端的 `remote_port` 值在服务端配置的范围内

3. 检查该端口在服务端是否已被其他进程占用：
   ```bash
   ss -tlnp | grep <port>
   ```

4. 验证防火墙规则允许转发端口：
   ```bash
   # Linux (iptables)
   sudo iptables -L -n | grep <port>

   # Linux (ufw)
   sudo ufw status
   ```

## 连接断开与重连

**症状：** 连接在一段时间不活动后或特定网络条件下被断开。

**原因：**
- `connection_timeout_secs` 设置对于空闲连接来说过低
- 中间路由器的 NAT 超时（特别是 UDP/QUIC）
- 网络切换（Wi-Fi 到移动网络等）
- 服务端 `max_connections` 限制已达

**解决方案：**

1. 在 `server.toml` 中增加超时时间：
   ```toml
   [performance]
   connection_timeout_secs = 600  # 10 分钟
   ```

2. 对于 QUIC，启用端口跳变以应对 NAT 重绑定：
   ```toml
   # client.toml
   [quic]
   port_hopping = true
   ```

3. 如果服务器达到限制，增加最大连接数：
   ```toml
   [performance]
   max_connections = 4096
   ```

4. 检查服务器指标以了解连接压力：
   ```bash
   prisma metrics --watch
   ```

## 配置重载问题

**症状：** 配置文件的更改未被检测到，或 `SIGHUP` 无效。

**原因：**
- `server.toml` 中未设置 `config_watch = true`
- 配置文件有语法错误（TOML 解析失败）
- SIGHUP 信号发送到了错误的 PID
- Linux 上 inotify 限制已达

**解决方案：**

1. 在 `server.toml` 中启用配置文件监视：
   ```toml
   config_watch = true
   ```

2. 在期望重载前验证配置：
   ```bash
   prisma validate -c server.toml
   ```

3. 向正确的 PID 发送 SIGHUP：
   ```bash
   # 如果作为守护进程运行
   kill -HUP $(cat /tmp/prisma-server.pid)

   # 或检查 PID
   prisma server status
   ```

4. 在 Linux 上，如果文件监视器未触发，检查 inotify 限制：
   ```bash
   cat /proc/sys/fs/inotify/max_user_watches
   # 如需增加：
   echo 65536 | sudo tee /proc/sys/fs/inotify/max_user_watches
   ```

5. 检查服务器日志中的重载事件：
   ```bash
   prisma logs --level INFO | grep -i reload
   ```

## QUIC 连接失败（UDP 被阻断）

**症状：** 当 `transport = "quic"` 时客户端无法连接，但服务器通过 TCP 可达。

**原因：**
- 防火墙或网络阻断了服务器端口的 UDP 流量
- 某些网络（企业、酒店）完全阻断 UDP
- 服务端 `quic_listen_addr` 未配置

**解决方案：**

1. 在 `client.toml` 中切换到 TCP 传输：
   ```toml
   transport = "tcp"
   ```

2. 或使用通过 HTTPS 工作的 CDN 兼容传输：
   ```toml
   transport = "ws"    # WebSocket
   transport = "grpc"  # gRPC
   transport = "xhttp" # HTTP 分块
   transport = "xporta" # REST API 模拟
   ```

3. 验证 UDP 可达性：
   ```bash
   # 从客户端机器
   nc -u -z server-ip 8443
   ```

4. 确保服务器防火墙允许 UDP：
   ```bash
   # Linux
   sudo ufw allow 8443/udp
   ```

## XPorta 会话问题

**症状：** XPorta 传输无法连接或频繁断开。

**原因：**
- 服务端 `[cdn.xporta]` 未启用或路径与客户端配置不匹配
- 会话过期（默认 300 秒空闲超时）
- `data_paths` / `poll_paths` 在客户端和服务端配置中存在重叠
- CDN 缓存干扰会话数据

**解决方案：**

1. 验证服务端已启用 XPorta：
   ```toml
   [cdn.xporta]
   enabled = true
   session_path = "/api/auth"
   data_paths = ["/api/v1/data", "/api/v1/sync", "/api/v1/update"]
   poll_paths = ["/api/v1/notifications", "/api/v1/feed", "/api/v1/events"]
   ```

2. 确保 `session_path`、`data_paths` 和 `poll_paths` 在客户端和服务端之间完全匹配

3. 检查 `encoding` 是否兼容（服务端 `"json"` 或 `"binary"`，客户端可使用 `"auto"`）

4. 对于 Cloudflare 部署，验证 `poll_timeout_secs` 在 100 以下（默认 55）

5. 在 CDN 配置中禁用 XPorta 路径的缓存

## 常见错误消息

| 错误消息 | 原因 | 解决方法 |
|---------|------|---------|
| `AcceptStatus::AuthFailed` | 客户端 ID 或认证密钥不匹配 | 重新运行 `prisma gen-key` 并更新两端配置 |
| `AcceptStatus::VersionMismatch` | 客户端和服务端协议版本不同 | 确保两端都是 v2.24.0（仅 PrismaVeil v5） |
| `AcceptStatus::ServerBusy` | 服务端 `max_connections` 限制已达 | 增加 `performance.max_connections` |
| `AcceptStatus::QuotaExceeded` | 客户端流量配额已用尽 | 通过 `prisma bandwidth quota <ID> --limit <BYTES>` 增加配额 |
| `Connection refused` | 服务器未运行或端口错误 | 检查 `prisma server status` 并验证端口 |
| `Connection timed out` | 防火墙阻止或服务器不可达 | 检查防火墙规则，尝试 `prisma diagnose` |
| `Certificate verify failed` | 自签名证书未设置 `skip_cert_verify` | 设置 `skip_cert_verify = true` 或使用有效 CA 证书 |
| `Config file not found` | 配置不在当前目录或标准路径中 | 运行 `prisma init` 或传递 `--config <path>` |
| `Config validation failed` | 无效 TOML 或验证规则失败 | 运行 `prisma validate -c <path>` 查看详情 |
| `Address already in use` | 端口已被其他进程占用 | 更改监听端口或停止冲突进程 |

## 守护进程模式问题

**症状：** 守护进程无法启动，或 `stop`/`status` 命令不工作。

**原因：**
- 上次运行的 PID 文件仍然存在（过期 PID）
- 日志目录不存在
- PID 或日志文件路径权限被拒绝

**解决方案：**

1. 检查守护进程状态：
   ```bash
   prisma server status
   ```

2. 如果存在过期 PID 文件，删除它：
   ```bash
   rm /tmp/prisma-server.pid
   ```

3. 确保日志目录存在：
   ```bash
   sudo mkdir -p /var/log/prisma
   sudo chown $(whoami) /var/log/prisma
   ```

4. 如果默认路径不可写，使用自定义 PID 和日志路径：
   ```bash
   prisma server -d --pid-file ~/.prisma/server.pid --log-file ~/.prisma/server.log
   ```

## 优雅关闭问题

**症状：** 关闭时活跃连接立即被断开而非排空。

**原因：**
- 使用了 `kill -9`（SIGKILL）而非 `kill`（SIGTERM）或 `prisma server stop`
- 进程不是守护进程子进程（PID 不匹配）

**解决方案：**

始终使用 `prisma server stop` 或发送 SIGTERM：

```bash
# 推荐
prisma server stop

# 或手动 SIGTERM
kill $(cat /tmp/prisma-server.pid)

# 永远不要使用 SIGKILL 进行优雅关闭
# kill -9 ... 不会排空连接
```

## 调试日志

启用 debug 或 trace 日志以诊断问题：

```toml
[logging]
level = "debug"   # 或 "trace" 以获取最详细的输出
format = "pretty"
```

或通过环境变量覆盖，无需修改配置文件：

```bash
PRISMA_LOGGING_LEVEL=trace prisma server -c server.toml
```

或使用 `-v`（详细）标志：

```bash
prisma server -v -c server.toml
```

调试日志中需要关注的关键内容：

- **握手**：`PrismaVeil v5 handshake` 步骤完成消息
- **连接生命周期**：建立、中继启动、拆除事件
- **端口转发**：`RegisterForward`、`ForwardReady` 结果
- **加密**：加密/解密错误、nonce 计数器值
- **配置重载**：`Config reloaded` 或 `Config watch triggered` 消息
- **会话票据**：`Session ticket issued`、`Session resumed (0-RTT)` 消息
- **缓冲池**：`Buffer pool created`、分配/回收事件

## 运行诊断

进行全面的连接性检查，使用内置诊断工具：

```bash
prisma diagnose -c client.toml
```

这将测试：
1. 服务器地址的 DNS 解析
2. 到服务器端口的 TCP 连接
3. TLS 握手
4. PrismaVeil v5 握手和认证
5. 传输特定的连接性

测试所有传输方式：

```bash
prisma test-transport -c client.toml
```

## 获取帮助

如果上述故障排除步骤未能解决您的问题：

1. 收集调试日志：`prisma server -v -c server.toml 2>&1 | tee prisma-debug.log`
2. 运行诊断：`prisma diagnose -c client.toml`
3. 检查版本：`prisma version`
4. 在 [GitHub](https://github.com/prisma-proxy/prisma/issues) 上提交问题，附上日志和诊断输出
