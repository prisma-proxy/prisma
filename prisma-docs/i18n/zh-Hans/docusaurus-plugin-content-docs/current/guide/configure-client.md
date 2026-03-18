---
sidebar_position: 8
---

# 配置客户端 (Client)

在本章中，你将配置 Prisma 客户端 (Client) 来连接你的服务器。我们同时介绍 GUI 应用和 CLI 的配置方法。

## 你需要准备什么

开始之前，确保你有以下信息：

- 你的**服务器 IP 地址**（例如 `203.0.113.45`）
- 你的**客户端 ID**（在服务器上运行 `prisma gen-key` 生成的）
- 你的**认证密钥 (Auth Secret)**（在服务器上运行 `prisma gen-key` 生成的）
- 你的服务器监听的**端口 (Port)**（默认：`8443`）

:::tip
如果你在安装服务端时使用了 `--setup`，这些值保存在你服务器上的 `/etc/prisma/.prisma-credentials` 中。用以下命令查看：
```bash
cat /etc/prisma/.prisma-credentials
```
:::

## 选项一：prisma-gui（桌面应用）

### 创建配置文件 (Profile)

1. **打开 prisma-gui**
2. 点击**"新建配置"**或 **+** 按钮
3. 填写以下字段：

| 字段 | 填写内容 | 示例 |
|------|---------|------|
| **配置名称 (Profile Name)** | 这个连接的名称（随你喜欢） | `我的服务器` |
| **服务器地址 (Server Address)** | 你服务器的 IP 地址和端口 | `203.0.113.45:8443` |
| **客户端 ID (Client ID)** | gen-key 生成的客户端 ID | `a1b2c3d4-e5f6-7890-...` |
| **认证密钥 (Auth Secret)** | gen-key 生成的认证密钥 | `4f8a2b1c9d3e7f6a...` |
| **传输方式 (Transport)** | 连接方式（先选 QUIC） | `QUIC` |
| **加密套件 (Cipher Suite)** | 加密 (Encryption) 算法 | `ChaCha20-Poly1305` |

4. 点击**保存**

### 传输 (Transport) 设置

基本 QUIC 连接（新手推荐）：

- **传输方式 (Transport)：** QUIC
- **跳过证书验证：** 开启（因为我们使用的是自签名证书）

TCP 连接（如果 UDP 被屏蔽）：

- **传输方式 (Transport)：** TCP
- 其他设置保持默认

### 连接

1. 从列表中选择你的配置
2. 点击**连接**
3. 连接成功后状态指示灯会变绿

## 选项二：CLI 配置

### 编写客户端配置

在你的本地电脑上创建一个名为 `client.toml` 的文件。

**Linux/macOS 上：**

```bash
nano ~/client.toml
```

**Windows 上（PowerShell）：**

```powershell
notepad $env:USERPROFILE\client.toml
```

粘贴以下配置。**将占位符值替换为你自己的值：**

```toml title="client.toml"
# ============================================================
# Prisma 客户端配置
# ============================================================

# ── 本地代理 (Proxy) 地址 ──────────────────────────────────────
# 这些是 Prisma 在你的电脑上监听的地址，
# 你的浏览器和其他应用会连接到这里。

# SOCKS5 代理 (Proxy) 地址。你的浏览器将连接到这里。
# "127.0.0.1" 表示只有本机可以使用。
# ":1080" 是端口号。
socks5_listen_addr = "127.0.0.1:1080"

# HTTP 代理 (Proxy) 地址（可选）。有些应用更喜欢 HTTP 代理。
# 如果不需要可以删除这一行。
http_listen_addr = "127.0.0.1:8080"

# ── 服务器连接 ──────────────────────────────────────────────
# 你的 Prisma 服务器的地址（你搭建的那台 VPS）。
# 替换为你服务器的实际 IP 地址和端口。
server_addr = "你的服务器IP:8443"

# 加密 (Encryption) 算法。ChaCha20 在所有设备上都很快。
# 另一个选项："aes-256-gcm"（在有 AES 硬件加速的 CPU 上更快）
cipher_suite = "chacha20-poly1305"

# 传输方式 (Transport)。"quic" 最快，推荐使用。
# 如果 QUIC 不能用（UDP 被屏蔽），改为 "tcp"。
transport = "quic"

# 使用自签名证书（由 gen-cert 生成）时设为 true。
# 使用 Let's Encrypt 或其他可信证书时设为 false。
skip_cert_verify = true

# ── 身份认证 ─────────────────────────────────────────────────
# 这些值必须与你服务端配置中的值完全匹配。
# 由服务器上的 "prisma gen-key" 生成。
[identity]
client_id = "你的客户端ID"          # 在此粘贴你的客户端 ID
auth_secret = "你的认证密钥"        # 在此粘贴你的认证密钥

# ── 日志 ──────────────────────────────────────────────────
[logging]
level = "info"      # 排查问题时用 "debug"，日常用 "info"
format = "pretty"   # 人类可读的输出
```

### 替换占位符

你**必须**替换三个值：

1. `你的服务器IP` —— 你的 VPS IP 地址（例如 `203.0.113.45`）
2. `你的客户端ID` —— 来自 `prisma gen-key` 的客户端 ID
3. `你的认证密钥` —— 来自 `prisma gen-key` 的认证密钥

### 完整的配置示例

以下是一个填写完成的配置示例（使用假数据）：

```toml title="client.toml（填写完成的示例）"
socks5_listen_addr = "127.0.0.1:1080"
http_listen_addr = "127.0.0.1:8080"
server_addr = "203.0.113.45:8443"
cipher_suite = "chacha20-poly1305"
transport = "quic"
skip_cert_verify = true

[identity]
client_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
auth_secret = "4f8a2b1c9d3e7f6a0b5c8d2e1f4a7b3c9d0e6f2a8b4c1d7e3f9a5b0c6d2e8f"

[logging]
level = "info"
format = "pretty"
```

### 验证配置

```bash
prisma validate -c ~/client.toml
```

预期输出：
```
Configuration is valid.
```

## 选择传输方式 (Transport)

以下是何时使用每种传输方式 (Transport) 的快速参考：

| 场景 | 传输方式 (Transport) | 配置值 |
|------|---------|-------|
| 正常网络，追求最快速度 | QUIC | `transport = "quic"` |
| UDP 被屏蔽 | TCP | `transport = "tcp"` |
| 需要隐藏服务器 IP（使用 CDN） | WebSocket | `transport = "ws"` |
| 严格审查环境（使用 CDN） | XPorta | `transport = "xporta"` |

对于新手，**先用 QUIC**。它是最快的，在大多数网络上都能工作。如果不行，切换到 TCP。

## 设置系统代理 (System Proxy)

Prisma 运行后，你需要告诉你的电脑通过它发送流量。有两种方法：

### 方案 A：只配置浏览器

这只会将浏览器的流量通过 Prisma。其他应用直接连接。

**Firefox：**
1. 打开 设置 > 网络设置
2. 选择"手动代理配置"
3. 设置 SOCKS 主机：`127.0.0.1`，端口：`1080`
4. 选择"SOCKS v5"
5. 勾选"使用 SOCKS v5 时代理 DNS"

**Chrome/Edge：**
Chrome 使用系统代理设置。请参见下面的方案 B，或使用代理扩展如 SwitchyOmega：
1. 安装 SwitchyOmega 扩展
2. 创建新的"代理服务器"类型的配置
3. 设置协议：SOCKS5，服务器：`127.0.0.1`，端口：`1080`
4. 点击扩展图标并选择你的配置

### 方案 B：配置系统全局代理 (System Proxy)

这会将你电脑的所有流量通过 Prisma。

**Windows：**
1. 打开 设置 > 网络和 Internet > 代理
2. 在"手动代理设置"下，点击"设置"
3. 开启"使用代理服务器"
4. 地址：`127.0.0.1`，端口：`8080`
5. 点击保存

**macOS：**
1. 打开 系统设置 > 网络
2. 选择你的活动连接（Wi-Fi 或以太网）
3. 点击"详细信息" > "代理"
4. 启用"SOCKS 代理"
5. 服务器：`127.0.0.1`，端口：`1080`

**Linux（GNOME）：**
1. 打开 设置 > 网络 > 网络代理
2. 选择"手动"
3. Socks 主机：`127.0.0.1`，端口：`1080`

### 方案 C：TUN 模式（高级）

TUN 模式创建一个虚拟网络设备，自动捕获所有流量。不需要为每个应用或系统设置代理 (Proxy)。这将在[进阶设置](./advanced-setup.md)中介绍。

## 从命令行测试

你可以不配置浏览器，直接用 `curl` 测试代理 (Proxy) 连接：

**SOCKS5 测试：**

```bash
curl --socks5 127.0.0.1:1080 https://httpbin.org/ip
```

**HTTP 代理 (Proxy) 测试：**

```bash
curl --proxy http://127.0.0.1:8080 https://httpbin.org/ip
```

如果 Prisma 正常工作，你应该在响应中看到你**服务器的 IP 地址**，而不是你自己的。

## 你学到了什么

在本章中，你学到了：

- 如何通过可视化配置文件 (Profile) 来设置 **prisma-gui**
- 如何编写 **CLI 客户端配置**，并解释了每一行
- 如何根据网络状况**选择传输方式 (Transport)**
- 如何设置**浏览器代理 (Proxy)**和**系统全局代理 (System Proxy)**
- 如何用 curl **测试**代理 (Proxy) 连接

## 下一步

一切配置完毕！让我们把所有部分连接起来，进行你的第一次连接。前往[你的第一次连接](./first-connection.md)。
