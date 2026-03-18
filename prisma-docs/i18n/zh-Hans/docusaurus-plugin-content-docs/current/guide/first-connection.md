---
sidebar_position: 9
---

# 你的第一次连接 (First Connection)

这是一切汇聚的时刻。在本章中，你将启动服务端、启动客户端、连接它们，并验证一切是否正常工作。

## 检查清单

开始之前，确保你已完成所有前面的步骤：

- [ ] 服务端：Prisma 已安装在你的 VPS 上
- [ ] 服务端：`server.toml` 已配置好你的凭证 (Credentials)
- [ ] 服务端：防火墙 (Firewall) 端口 8443 已开放（TCP 和 UDP）
- [ ] 客户端：Prisma 已安装在你的本地电脑上
- [ ] 客户端：`client.toml` 已配置好（或已创建 prisma-gui 配置）
- [ ] 客户端：凭证 (Credentials) 与服务端配置完全匹配

## 步骤 1：启动服务端

SSH 登录到你的服务器并启动 Prisma：

```bash
prisma server -c /etc/prisma/server.toml
```

你应该看到：

```
INFO  prisma_server > Prisma server v0.6.3 starting...
INFO  prisma_server > Listening on 0.0.0.0:8443 (TCP)
INFO  prisma_server > Listening on 0.0.0.0:8443 (QUIC)
INFO  prisma_server > Authorized clients: 1
INFO  prisma_server > Server ready!
```

:::tip 在后台运行
现在先让这个终端窗口保持打开。在[进阶设置](./advanced-setup.md)中，我们会将 Prisma 设置为在后台自动运行的系统服务。
:::

## 步骤 2：启动客户端

### 使用 prisma-gui

1. 打开 prisma-gui
2. 选择你的配置
3. 点击**连接**
4. 等待状态显示**已连接**

### 使用 CLI

在你的本地电脑上打开一个新终端并运行：

```bash
prisma client -c ~/client.toml
```

你应该看到：

```
INFO  prisma_client > Prisma client v0.6.3 starting...
INFO  prisma_client > SOCKS5 proxy listening on 127.0.0.1:1080
INFO  prisma_client > HTTP proxy listening on 127.0.0.1:8080
INFO  prisma_client > Connecting to 203.0.113.45:8443 via QUIC...
INFO  prisma_client > Connected! Handshake completed in 45ms
```

关键信息是 **"Connected!"** —— 这意味着客户端成功连接到了服务端。

在服务端，你应该看到：

```
INFO  prisma_server > New client connected: "我的第一个客户端" (a1b2c3d4...)
```

## 步骤 3：验证是否正常工作

现在让我们确认流量确实在通过代理 (Proxy) 传输。

### 测试 1：检查你的 IP 地址

打开一个新终端并运行：

```bash
curl --socks5 127.0.0.1:1080 https://httpbin.org/ip
```

预期输出：

```json
{
  "origin": "203.0.113.45"
}
```

显示的 IP 地址应该是你**服务器的 IP**，而不是你本地的 IP。如果你看到的是服务器的 IP，恭喜——它正常工作了！

### 测试 2：访问网站

配置浏览器使用代理（参见[配置客户端](./configure-client.md#设置系统代理-system-proxy)），然后访问：

- https://whatismyipaddress.com —— 应该显示你服务器的 IP
- https://www.google.com —— 应该正常加载
- 任何你常用的网站 —— 应该正常工作

### 测试 3：检查 DNS 泄漏 (DNS Leak)

访问 https://www.dnsleaktest.com 并运行扩展测试。显示的 DNS 服务器应该来自你服务器所在的位置，而不是你本地的运营商。

## 理解连接状态 (Connection Status)

### 服务端消息

| 消息 | 含义 |
|------|------|
| `Server ready!` | 服务器正在运行并等待连接 |
| `New client connected: "名称"` | 一个客户端成功通过认证 |
| `Client disconnected: "名称"` | 一个客户端正常断开连接 |
| `Authentication failed` | 凭证错误——检查 id/auth_secret |

### 客户端消息

| 消息 | 含义 |
|------|------|
| `Connected! Handshake completed` | 成功连接到服务端，握手 (Handshake) 完成 |
| `SOCKS5 proxy listening on ...` | 准备好接受浏览器连接 |
| `Connection closed, reconnecting...` | 连接断开，正在尝试重连 |
| `Failed to connect` | 无法连接到服务器（参见下面的故障排查） |

## 故障排查 (Troubleshooting)

如果有什么不能正常工作，按照以下步骤依次检查：

### 问题："Connection refused" 或 "Connection timed out"（连接被拒绝或超时）

```
ERROR prisma_client > Failed to connect to 203.0.113.45:8443: Connection refused
```

**检查清单：**
1. 服务端是否在运行？SSH 登录到你的服务器并检查：
   ```bash
   ps aux | grep prisma
   ```
2. 防火墙是否开放？在服务器上：
   ```bash
   sudo ufw status
   # 确保 8443 显示为 ALLOW
   ```
3. 你能否 ping 通服务器？
   ```bash
   ping 你的服务器IP
   ```
4. 服务端和客户端配置中的端口是否一致？

### 问题："Authentication failed"（认证失败）

```
ERROR prisma_client > Authentication failed: invalid credentials
```

**这意味着服务端拒绝了你的凭证。** 检查：

1. `client.toml` 中的 `client_id` 是否与 `server.toml` 中的 `id` 匹配
2. `client.toml` 中的 `auth_secret` 是否与 `server.toml` 中的 `auth_secret` 匹配
3. 是否有多余的空格或缺少的字符
4. 两个值是否是从 `prisma gen-key` 精确复制的

:::tip 仔细复制粘贴
auth_secret 有 64 个字符。复制时很容易不小心漏掉一个字符。请使用复制粘贴而不是手动输入。
:::

### 问题："TLS handshake failed" 或证书错误 (Certificate Error)

```
ERROR prisma_client > TLS error: certificate verify failed
```

**如果使用自签名证书：** 确保客户端配置中设置了 `skip_cert_verify = true`。

**如果使用 Let's Encrypt：** 确保：
1. 证书中的域名与你的服务器地址匹配
2. 证书未过期
3. `skip_cert_verify = false`（或未设置，因为 false 是默认值）

### 问题："Address already in use"（地址已被使用）

```
ERROR prisma_client > Address already in use: 127.0.0.1:1080
```

另一个程序（或另一个 Prisma 实例）已经在使用端口 1080。要么：
1. 停止那个程序
2. 在你的客户端配置中更改 `socks5_listen_addr` 的端口（例如改为 `127.0.0.1:1081`）

### 问题：已连接但网站无法加载

如果客户端显示"已连接"但网站仍然无法加载：

1. **检查代理设置：** 确保你的浏览器配置了 `127.0.0.1:1080`（SOCKS5）或 `127.0.0.1:8080`（HTTP）
2. **用 curl 测试：** 运行 `curl --socks5 127.0.0.1:1080 https://httpbin.org/ip` 看看代理本身是否工作
3. **检查 DNS：** 在 Firefox 中，在代理设置中启用"使用 SOCKS v5 时代理 DNS"
4. **查看服务端日志：** SSH 登录到服务器查看日志输出是否有错误

### 问题：连接速度很慢 (Slow Connection)

1. **尝试不同的传输方式 (Transport)：** 如果用 QUIC 很慢，试试 TCP（反之亦然）
2. **检查服务器位置：** 地理位置离你更近的服务器会更快
3. **检查服务器负载：** 在服务器上运行 `top` 查看 CPU/内存是否满载
4. **检查网络质量：** 在服务器上运行速度测试：`curl -o /dev/null -w "%{speed_download}" https://speed.cloudflare.com/__down?bytes=100000000`

## 成功！

如果你从客户端检查时能看到服务器的 IP，**你已经成功搭建了 Prisma！** 你的网络流量现在通过服务器加密 (Encryption) 传输。

```mermaid
graph LR
    A["你的电脑 ✓"] -->|"已加密 ✓"| B["Prisma 服务器 ✓"]
    B -->|"正常流量"| C["互联网"]

    style A fill:#22c55e,color:#000
    style B fill:#22c55e,color:#000
```

## 你学到了什么

在本章中，你学到了：

- 如何**启动服务端**和**启动客户端**
- 如何**验证**连接是否正常工作（IP 检查、浏览器、DNS 泄漏测试）
- 如何**阅读连接状态消息**（服务端和客户端）
- 如何**排查**最常见的问题
- 每条**错误消息**的含义以及如何修复

## 下一步

你的设置已经可以正常工作了！现在让我们把它变得更好。前往[进阶设置](./advanced-setup.md)学习如何将 Prisma 设为系统服务、路由 (Routing) 规则、CDN 设置和性能优化。
