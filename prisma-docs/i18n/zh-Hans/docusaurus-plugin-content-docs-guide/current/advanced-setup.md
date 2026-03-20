---
sidebar_position: 10
---

# 进阶设置

恭喜！你已经有了一个可以正常工作的 Prisma 设置。本章介绍如何让它更稳健、更快速、功能更丰富。每个部分都是独立的——你可以选择你需要的部分。

## 将 Prisma 设为系统服务

目前，当你关闭终端时 Prisma 就会停止。让我们设置它在后台自动运行，即使服务器重启也能自动启动。

### 创建 systemd 服务文件

```bash
sudo nano /etc/systemd/system/prisma-server.service
```

粘贴以下内容：

```ini title="prisma-server.service"
[Unit]
# 在 "systemctl status" 中显示的描述
Description=Prisma Proxy Server
# 在网络就绪后启动
After=network-online.target
Wants=network-online.target

[Service]
# 运行 prisma server 命令
ExecStart=/usr/local/bin/prisma server -c /etc/prisma/server.toml
# 崩溃后自动重启
Restart=on-failure
# 重启前等待 5 秒
RestartSec=5
# 以 root 身份运行（需要特权端口时必须）
User=root
# 限制打开文件数（连接多时可以增加）
LimitNOFILE=65536

[Install]
# 开机启动
WantedBy=multi-user.target
```

### 启用并启动服务

```bash
# 重新加载 systemd 以识别新的服务文件
sudo systemctl daemon-reload

# 立即启动 Prisma
sudo systemctl start prisma-server

# 设置开机自启
sudo systemctl enable prisma-server

# 检查运行状态
sudo systemctl status prisma-server
```

预期输出：

```
● prisma-server.service - Prisma Proxy Server
     Loaded: loaded (/etc/systemd/system/prisma-server.service; enabled)
     Active: active (running) since ...
```

### 常用服务命令

```bash
sudo systemctl stop prisma-server      # 停止服务
sudo systemctl restart prisma-server   # 重启（例如修改配置后）
sudo systemctl status prisma-server    # 查看状态
sudo journalctl -u prisma-server -f   # 实时查看日志
```

## 路由规则 (Routing) / 分流 (Split Tunneling)

默认情况下，你的所有流量都通过代理 (Proxy)。路由 (Routing) 规则让你可以选择哪些流量走代理、哪些直连。

> **类比：** 把路由 (Routing) 规则想象成一个邮件分拣员。有些信件通过安全隧道 (Tunnel) 发送，而本地信件直接送达。

### 示例：绕过内网/私有网络

在你的 `client.toml` 中添加：

```toml
# ── 路由规则 ─────────────────────────────────────────────────
# 规则按顺序执行。第一个匹配的规则生效。

# 私有/内网 IP 地址直连（不需要代理）
[[routing.rules]]
type = "ip-cidr"              # 按 IP 地址范围匹配
value = "10.0.0.0/8"          # 私有网络范围
action = "direct"             # 直接连接（跳过代理）

[[routing.rules]]
type = "ip-cidr"
value = "172.16.0.0/12"       # 另一个私有网络范围
action = "direct"

[[routing.rules]]
type = "ip-cidr"
value = "192.168.0.0/16"      # 家庭网络范围
action = "direct"

# 其他所有流量走代理
[[routing.rules]]
type = "all"                  # 匹配所有
action = "proxy"              # 通过代理发送
```

### 示例：基于 GeoIP 的路由 (Routing)

如果你有 GeoIP 数据库，可以根据目标国家来路由 (Routing) 流量：

```toml
[routing]
geoip_path = "/etc/prisma/geoip.dat"    # 从 v2fly/geoip releases 下载

# 本地流量直连
[[routing.rules]]
type = "geoip"
value = "private"
action = "direct"

# 特定国家的流量直连
[[routing.rules]]
type = "geoip"
value = "cn"            # 国家代码
action = "direct"       # 国内流量直连

# 其他所有流量走代理
[[routing.rules]]
type = "all"
action = "proxy"
```

### 示例：基于域名的规则

```toml
# 屏蔽广告
[[routing.rules]]
type = "domain-keyword"
value = "ads"
action = "block"              # 完全屏蔽（不建立连接）

# 特定域名直连
[[routing.rules]]
type = "domain-suffix"
value = "example.com"
action = "direct"

# 其他所有流量走代理
[[routing.rules]]
type = "all"
action = "proxy"
```

## 使用 Cloudflare CDN

为了额外的安全性，你可以将服务器的 IP 隐藏在 Cloudflare 后面。这样即使有人发现你在使用 Prisma，他们也无法找到和屏蔽你的服务器。这是一种伪装 (Camouflage) 技术。

### 工作原理

```mermaid
graph LR
    A["你的电脑"] -->|"HTTPS"| B["Cloudflare CDN"]
    B -->|"HTTPS"| C["你的服务器"]
    C -->|"正常流量"| D["网站"]

    style B fill:#f59e0b,color:#000
```

Cloudflare 位于你的客户端和服务器之间。观察者看到的流量是发向 Cloudflare 的（数百万网站都在使用），而不是你的特定服务器。

### 设置概述

1. **获取一个域名**（可以找到价格实惠的域名）
2. **将域名添加到 Cloudflare**（免费计划即可）
3. **将域名指向你的服务器**（在 Cloudflare DNS 中添加 A 记录）
4. **启用 Cloudflare 代理**（橙色云朵图标）
5. **从 Cloudflare 控制台获取源站证书**
6. **配置服务端**启用 CDN 传输 (Transport)
7. **配置客户端 (Client)**通过 WebSocket 或 XPorta 连接

详细的 CDN 配置示例，请参见[配置示例](/docs/deployment/config-examples)页面。

## 速度优化

### 选择合适的传输方式 (Transport)

| 优先级 | 传输方式 (Transport) | 原因 |
|-------|---------|------|
| 速度 | QUIC | 多路复用，0-RTT 恢复 |
| 兼容性 | TCP | 到处都能用，好的备选 |
| 隐蔽 + 速度 | XHTTP stream-one | 没有 WebSocket 开销 |
| 最高隐蔽性 | XPorta | 最高隐蔽性但开销更大 |

### 选择合适的加密 (Encryption) 算法

| CPU 类型 | 推荐算法 | 原因 |
|---------|---------|------|
| 桌面端（Intel/AMD） | `aes-256-gcm` | 硬件 AES 加速 |
| 移动端/ARM | `chacha20-poly1305` | 没有 AES 硬件时更快 |
| 不确定 | `chacha20-poly1305` | 在所有设备上性能都不错 |

### 服务端优化

```toml
[performance]
max_connections = 2048          # 客户端 (Client) 多时可以增加
connection_timeout_secs = 600   # 更长的超时时间以保持稳定连接

[congestion]
mode = "bbr"    # BBR 拥塞控制 (Congestion Control)（适合大多数网络）
```

## 多用户 / 多客户端 (Client)

要与家人或朋友共享你的服务器，为每个人生成单独的密钥 (Key)：

```bash
prisma gen-key    # 为每个客户端运行一次
```

将每个客户端添加到服务端配置中：

```toml
[[authorized_clients]]
id = "小明的uuid"
auth_secret = "小明的密钥"
name = "小明的笔记本"
bandwidth_down = "200mbps"      # 可选：限制下载带宽 (Bandwidth)
quota = "100GB"                 # 可选：每月流量限额
quota_period = "monthly"

[[authorized_clients]]
id = "小红的uuid"
auth_secret = "小红的密钥"
name = "小红的手机"
bandwidth_down = "100mbps"
quota = "50GB"
quota_period = "monthly"
```

添加客户端后重启服务器：

```bash
sudo systemctl restart prisma-server
```

## 保持 Prisma 更新

### 使用安装脚本

运行相同的安装命令来更新：

```bash
curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.sh | bash
```

然后重启：

```bash
sudo systemctl restart prisma-server
```

### 使用 Docker

```bash
docker pull ghcr.io/yamimega/prisma:latest
docker restart prisma-server
```

## Web 管理控制台 (Console)

Prisma 包含一个用于监控和管理的 Web 控制台 (Console)。要启用它：

### 服务端配置

```toml
[management_api]
enabled = true                          # 开启管理 API
listen_addr = "127.0.0.1:9090"         # 只在本机监听
auth_token = "你的安全随机令牌"           # 创建一个强随机令牌
console_dir = "/opt/prisma/console"     # 控制台文件路径
```

### 下载并安装控制台文件

```bash
# 从 releases 下载最新的控制台构建
curl -fsSL https://github.com/Yamimega/prisma/releases/latest/download/prisma-console.tar.gz \
  -o /tmp/console.tar.gz

# 解压到控制台目录
sudo mkdir -p /opt/prisma/console
sudo tar -xzf /tmp/console.tar.gz -C /opt/prisma/console
```

### 访问控制台

打开浏览器访问 `https://你的服务器IP:9090`（或为了安全设置 SSH 隧道）。

控制台 (Console) 可以让你：
- 查看实时连接指标
- 管理客户端 (Client)（添加、删除、修改）
- 查看日志
- 监控带宽 (Bandwidth) 使用情况
- 运行速度测试

## 安全最佳实践

1. **使用强凭证** —— 始终用 `prisma gen-key` 生成凭证。永远不要自己编造。

2. **使用 Let's Encrypt 证书** —— 自签名证书用于测试没问题，但生产环境请使用 Let's Encrypt。

3. **保持 Prisma 更新** —— 更新包含安全修复。定期检查更新。

4. **限制管理 API 访问** —— 将管理 API 绑定到 `127.0.0.1` 并使用 SSH 隧道 (Tunnel) 远程访问。

5. **每个客户端使用唯一凭证** —— 每台设备应该有自己的客户端 ID (Client ID) 和认证密钥 (Auth Secret)。这样你可以撤销一台设备的访问权限而不影响其他设备。

6. **启用带宽 (Bandwidth) 限制** —— 如果与他人共享，设置每个客户端的带宽 (Bandwidth) 和流量配额限制以防止滥用。

7. **监控日志** —— 定期检查服务器日志，查看是否有未授权的访问尝试：
   ```bash
   sudo journalctl -u prisma-server --since "1 hour ago"
   ```

## 获取帮助

- **GitHub Issues：** https://github.com/Yamimega/prisma/issues —— 报告 bug 或提问
- **GitHub Discussions：** https://github.com/Yamimega/prisma/discussions —— 社区帮助
- **文档：** 你正在阅读的就是！查看文档的其他部分了解详细的配置参考

## 你学到了什么

在本章中，你学到了：

- 如何使用 systemd 将 Prisma 设为**系统服务**
- 如何设置**路由 (Routing) 规则**进行分流 (Split Tunneling)
- 如何使用 **Cloudflare CDN** 获得额外的隐蔽性
- 如何通过传输方式 (Transport) 和加密 (Encryption) 算法的选择来**优化速度**
- 如何添加**多个用户**并设置带宽 (Bandwidth) 限制
- 如何**更新** Prisma
- 如何设置 **Web 控制台 (Console)** 进行监控
- 生产环境部署的**安全最佳实践**

## 恭喜！

你已经完成了 Prisma 新手指南！你现在具备了以下知识：

1. 理解互联网隐私和代理 (Proxy) 的工作原理
2. 搭建和配置 Prisma 服务器
3. 连接客户端 (Client) 并验证连接
4. 优化和保护你的设置

更多高级话题，请浏览文档的其他部分：

- [服务端配置参考](/docs/configuration/server) —— 所有服务端选项
- [客户端配置参考](/docs/configuration/client) —— 所有客户端选项
- [配置示例](/docs/deployment/config-examples) —— 即用型模板
- [PrismaVeil 协议](/docs/security/prismaveil-protocol) —— 协议深入解析
- [管理 API](/docs/features/management-api) —— REST API 参考
