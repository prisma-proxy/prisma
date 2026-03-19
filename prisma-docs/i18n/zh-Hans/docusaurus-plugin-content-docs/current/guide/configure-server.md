---
sidebar_position: 6
---

# 配置服务端 (Configure Server)

在本章中，你将创建服务端配置文件。我们会解释每一行的含义，让你确切理解每个设置的作用。

## 理解 TOML 格式

Prisma 使用 **TOML**（Tom's Obvious Minimal Language，汤姆的显而易见的最小语言）作为配置文件格式。TOML 是一种设计得易于阅读的简单文件格式。以下是快速入门：

### 键和值

键值对为一个名称赋予一个值：

```toml
# 这是注释（Prisma 会忽略）
listen_addr = "0.0.0.0:8443"    # 文本值（用引号括起来）
max_connections = 1024           # 数字值（不用引号）
enabled = true                   # 布尔值（true 或 false）
```

### 段落 (Sections)

段落 (Sections) 将相关设置分组在一起。用方括号表示：

```toml
[logging]                  # 这是 "logging" 段落的开始
level = "info"             # 这属于 "logging" 段落
format = "pretty"          # 这也属于 "logging"

[performance]              # 这是新段落的开始
max_connections = 1024
```

### 段落数组 (Arrays of Sections)

有时候你需要同一类型的多个项目。双方括号创建一个数组：

```toml
[[authorized_clients]]     # 第一个客户端
id = "client-1-uuid"
name = "笔记本"

[[authorized_clients]]     # 第二个客户端
id = "client-2-uuid"
name = "手机"
```

这就是你需要知道的所有 TOML 知识！

## 步骤 1：生成凭证 (Credentials)

在编写配置之前，你需要生成一个**客户端 ID (Client ID)** 和**认证密钥 (Auth Secret)**。它们就像用户名和密码，客户端用它们来向服务端证明自己的身份。

```bash
prisma gen-key
```

预期输出：

```
Client ID:   a1b2c3d4-e5f6-7890-abcd-ef1234567890
Auth Secret: 4f8a2b1c9d3e7f6a0b5c8d2e1f4a7b3c9d0e6f2a8b4c1d7e3f9a5b0c6d2e8f
```

:::warning 保存好这些值！
复制并保存好这两个值。你在服务端和客户端配置中都需要它们。如果丢失了，你随时可以用 `prisma gen-key` 重新生成。
:::

## 步骤 2：生成 TLS 证书 (Certificate)

TLS 证书是 QUIC 传输 (Transport) 所必需的，也是所有部署的推荐项。现在我们使用自签名证书 (Self-signed Certificate)（个人使用完全没问题）：

```bash
prisma gen-cert --output /etc/prisma --cn prisma-server
```

预期输出：

```
Certificate written to /etc/prisma/prisma-cert.pem
Private key written to /etc/prisma/prisma-key.pem
```

这会创建两个文件：
- `prisma-cert.pem` —— 证书 (Certificate)（公开的，可以分享）
- `prisma-key.pem` —— 私钥 (Private Key)（务必保密！）

:::info 自签名证书 (Self-signed) vs. Let's Encrypt
**自签名证书**对于个人使用和测试来说完全没问题。对于生产环境（特别是使用 CDN 传输时），你应该使用来自 **Let's Encrypt** 的证书（它是免费的）。我们将在[进阶设置](./advanced-setup.md)中介绍这个。
:::

## 步骤 3：编写服务端配置

现在让我们创建配置文件。打开文本编辑器：

```bash
sudo nano /etc/prisma/server.toml
```

粘贴以下配置。**每一行都有注释解释其作用：**

```toml title="server.toml"
# ============================================================
# Prisma 服务端配置
# ============================================================

# 服务器监听 TCP 连接的地址和端口。
# "0.0.0.0" 表示"在所有网络接口上监听"（接受来自任何地方的连接）。
# ":8443" 是端口号。
listen_addr = "0.0.0.0:8443"

# QUIC（UDP）连接的地址和端口。
# 通常与 listen_addr 相同。
quic_listen_addr = "0.0.0.0:8443"

# ── TLS 证书 ──────────────────────────────────────────────
# TLS（传输层安全）加密连接。
# 这些文件是上一步中用 "prisma gen-cert" 创建的。
[tls]
cert_path = "/etc/prisma/prisma-cert.pem"   # 证书文件路径
key_path = "/etc/prisma/prisma-key.pem"     # 私钥文件路径

# ── 授权客户端 (Authorized Clients) ──────────────────────────
# 每个连接的客户端都必须在这里列出。
# id 和 auth_secret 来自 "prisma gen-key"。
# 你可以添加多个 [[authorized_clients]] 段落
# 来支持多个客户端（如笔记本、手机、平板）。
[[authorized_clients]]
id = "在此粘贴你的客户端ID"                    # 来自 gen-key 的客户端 ID (Client ID)
auth_secret = "在此粘贴你的认证密钥"            # 来自 gen-key 的认证密钥 (Auth Secret)
name = "我的第一个客户端"                       # 一个友好的名称（供你参考）

# ── 日志 ──────────────────────────────────────────────────
# 控制 Prisma 在控制台输出什么信息。
[logging]
level = "info"      # 详细程度：trace > debug > info > warn > error
                     # "info" 适合日常使用。排查问题时用 "debug"。
format = "pretty"   # "pretty" 人类可读，"json" 机器可读

# ── 性能 ──────────────────────────────────────────────────
[performance]
max_connections = 1024         # 最大同时连接数
connection_timeout_secs = 300  # 5 分钟（300 秒）后关闭空闲连接

# ── 填充 (Padding) ───────────────────────────────────────────
# 给每个数据帧添加随机的额外字节，防止基于数据包大小的流量分析。
# 数值越高 = 隐私越好，但带宽 (Bandwidth) 消耗越多。
[padding]
min = 0     # 每帧最小填充字节数
max = 256   # 每帧最大填充字节数
```

### 替换占位符

你**必须**将两个值替换为步骤 1 中生成的值：

1. 将 `在此粘贴你的客户端ID` 替换为你的客户端 ID (Client ID)
2. 将 `在此粘贴你的认证密钥` 替换为你的认证密钥 (Auth Secret)

例如，如果你的 gen-key 输出是：

```
Client ID:   a1b2c3d4-e5f6-7890-abcd-ef1234567890
Auth Secret: 4f8a2b1c9d3e7f6a0b5c8d2e1f4a7b3c9d0e6f2a8b4c1d7e3f9a5b0c6d2e8f
```

那么 authorized_clients 段落应该是：

```toml
[[authorized_clients]]
id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
auth_secret = "4f8a2b1c9d3e7f6a0b5c8d2e1f4a7b3c9d0e6f2a8b4c1d7e3f9a5b0c6d2e8f"
name = "我的第一个客户端"
```

保存文件（在 nano 中按 `Ctrl + O`，回车，`Ctrl + X`）。

## 步骤 4：验证配置

在运行服务器之前，让我们确保配置文件没有错误：

```bash
prisma validate -c /etc/prisma/server.toml
```

如果一切正确，你会看到：

```
Configuration is valid.
```

如果有错误，消息会准确告诉你哪里出了问题。常见错误：

| 错误信息 | 含义 | 解决方法 |
|---------|------|---------|
| `authorized_clients must not be empty` | 你忘了添加客户端凭证 | 添加一个 `[[authorized_clients]]` 段落 |
| `invalid hex in auth_secret` | auth_secret 不是有效的十六进制 | 从 `prisma gen-key` 输出中精确复制 |
| `cert_path: file not found` | TLS 证书文件不存在 | 重新运行 `prisma gen-cert` 或检查路径 |

## 步骤 5：测试运行

让我们启动服务器以确保一切正常：

```bash
prisma server -c /etc/prisma/server.toml
```

你应该看到类似这样的输出：

```
INFO  prisma_server > Prisma server v0.9.0 starting...
INFO  prisma_server > Listening on 0.0.0.0:8443 (TCP)
INFO  prisma_server > Listening on 0.0.0.0:8443 (QUIC)
INFO  prisma_server > Authorized clients: 1
INFO  prisma_server > Server ready!
```

按 `Ctrl + C` 暂时停止服务器。我们稍后会将它设置为系统服务。

:::tip 如果出现错误
如果服务器无法启动，检查：
1. 证书文件是否在正确的路径？
2. 你是否替换了占位符值？
3. 端口 8443 是否已被占用？（用 `sudo ss -tlnp | grep 8443` 检查）
4. 运行 `prisma validate -c /etc/prisma/server.toml` 检查配置错误
:::

## 添加多个客户端

如果你想从多台设备连接，为每台设备生成一个新密钥：

```bash
prisma gen-key    # 为每台设备再运行一次
```

然后在你的配置中添加另一个 `[[authorized_clients]]` 段落：

```toml
[[authorized_clients]]
id = "第一个客户端的uuid"
auth_secret = "第一个客户端的密钥"
name = "笔记本"

[[authorized_clients]]
id = "第二个客户端的uuid"
auth_secret = "第二个客户端的密钥"
name = "手机"
```

## 常见错误 (Common Mistakes)

以下是新手最常犯的错误，以及如何避免：

### 1. 直接使用占位符文本

**错误：**
```toml
id = "在此粘贴你的客户端ID"
```

**正确：**
```toml
id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
```

### 2. 凭证 (Credentials) 不匹配

服务端配置中的 `id` 和 `auth_secret` 必须与客户端配置中的值**完全一致**。即使差一个字符，连接也会失败。

### 3. 文件路径错误

确保 `cert_path` 和 `key_path` 指向实际存在的文件。可以用以下命令验证：

```bash
ls -la /etc/prisma/prisma-cert.pem /etc/prisma/prisma-key.pem
```

### 4. 忘记开放防火墙 (Firewall) 端口

如果防火墙阻止了 8443 端口，Prisma 将无法接收连接。参见[上一章](./install-server.md#开放防火墙-firewall-端口)的防火墙说明。

## 使用 Let's Encrypt 证书 (Certificate)（生产环境）

在生产环境中，使用来自 Let's Encrypt 的免费证书代替自签名证书。这需要一个指向你服务器的域名。

### 步骤 1：将域名指向你的服务器

在你的域名注册商的 DNS 设置中，添加一条 **A 记录**：
- **名称：** `proxy`（或你想要的任何子域名）
- **值：** 你服务器的 IP 地址

### 步骤 2：安装 certbot

```bash
sudo apt install certbot -y
```

### 步骤 3：获取证书

```bash
sudo certbot certonly --standalone -d proxy.yourdomain.com
```

### 步骤 4：更新 server.toml

```toml
[tls]
cert_path = "/etc/letsencrypt/live/proxy.yourdomain.com/fullchain.pem"
key_path = "/etc/letsencrypt/live/proxy.yourdomain.com/privkey.pem"
```

:::info
Let's Encrypt 证书每 90 天过期一次。Certbot 会通过 systemd 定时器自动续期。你可以用以下命令验证：`sudo systemctl list-timers | grep certbot`
:::

## 你学到了什么

在本章中，你学到了：

- **TOML** 配置格式的基础知识（键、值、段落）
- 如何用 `prisma gen-key` **生成凭证 (Credentials)**
- 如何用 `prisma gen-cert` **生成 TLS 证书 (Certificate)**
- 如何编写**完整的服务端配置**，并解释了每一行
- 如何**验证**和**测试**你的配置
- 如何添加**多个客户端**
- 如何使用 **Let's Encrypt** 获取生产环境的 TLS 证书

## 下一步

服务端配置完成！现在让我们在你的电脑上安装客户端。前往[安装客户端](./install-client.md)。
