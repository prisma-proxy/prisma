---
sidebar_position: 1
---

# Linux systemd 部署

将 Prisma 部署为 Linux 上的 systemd 服务。

## 快速部署

运行以下命令将 Prisma 设置为系统服务：

```bash
# 安装二进制文件 + 创建系统用户 + 设置目录
sudo useradd --system --no-create-home --shell /usr/sbin/nologin prisma
sudo mkdir -p /etc/prisma && sudo chown prisma:prisma /etc/prisma && sudo chmod 750 /etc/prisma
sudo cp prisma /usr/local/bin/prisma && sudo chmod 755 /usr/local/bin/prisma

# 复制配置文件和 TLS 证书（根据需要调整路径）
sudo install -o prisma -g prisma -m 640 server.toml /etc/prisma/
sudo install -o prisma -g prisma -m 640 prisma-cert.pem prisma-key.pem /etc/prisma/
```

:::tip
请将配置中的 `cert_path` 和 `key_path` 更新为 `/etc/prisma/prisma-cert.pem` 和 `/etc/prisma/prisma-key.pem`。
:::

## 服务文件

### 服务端

创建 `/etc/systemd/system/prisma-server.service`：

```ini
[Unit]
Description=Prisma Proxy Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=prisma
Group=prisma
ExecStart=/usr/local/bin/prisma server -c /etc/prisma/server.toml
Restart=on-failure
RestartSec=5
LimitNOFILE=65535
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
NoNewPrivileges=true
ReadOnlyPaths=/etc/prisma
WorkingDirectory=/etc/prisma
StandardOutput=journal
StandardError=journal
SyslogIdentifier=prisma-server

[Install]
WantedBy=multi-user.target
```

### 客户端

创建 `/etc/systemd/system/prisma-client.service`：

```ini
[Unit]
Description=Prisma Proxy Client
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=prisma
Group=prisma
ExecStart=/usr/local/bin/prisma client -c /etc/prisma/client.toml
Restart=on-failure
RestartSec=5
LimitNOFILE=65535
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
NoNewPrivileges=true
ReadOnlyPaths=/etc/prisma
WorkingDirectory=/etc/prisma
StandardOutput=journal
StandardError=journal
SyslogIdentifier=prisma-client

[Install]
WantedBy=multi-user.target
```

## 启用并启动

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now prisma-server   # 一条命令同时启用并启动
sudo systemctl status prisma-server
```

对于客户端：

```bash
sudo systemctl enable --now prisma-client
```

## 日志

```bash
journalctl -u prisma-server -f              # 实时跟踪
journalctl -u prisma-server --since "1h ago" # 最近的日志
```

## 安全加固 (Security Hardening)

服务文件包含以下 systemd 安全指令：

| 指令 | 效果 |
|------|------|
| `ProtectSystem=strict` | 文件系统只读，仅允许特定路径写入 |
| `ProtectHome=true` | `/home`、`/root`、`/run/user` 不可访问 |
| `PrivateTmp=true` | 私有 `/tmp` 挂载 |
| `NoNewPrivileges=true` | 禁止获取新权限 |
| `ReadOnlyPaths=/etc/prisma` | 配置文件运行时不可修改 |
| `LimitNOFILE=65535` | 高文件描述符限制以支持大量连接 |

## 控制台（可选）

```bash
sudo mkdir -p /opt/prisma/console
# 从发布版：
sudo tar -xzf prisma-console.tar.gz -C /opt/prisma/console
# 或从源码构建：
cd apps/prisma-console && npm ci && npm run build && sudo cp -r out/ /opt/prisma/console/
```

在 `server.toml` 中添加：

```toml
[management_api]
enabled = true
listen_addr = "127.0.0.1:9090"
auth_token = "your-secure-token"
console_dir = "/opt/prisma/console"
```

更新服务文件以允许控制台访问：

```ini
ReadOnlyPaths=/etc/prisma /opt/prisma/console
```

## 目录布局

```
/usr/local/bin/prisma              # 二进制文件
/etc/prisma/server.toml            # 服务端配置
/etc/prisma/client.toml            # 客户端配置
/etc/prisma/*.pem                  # TLS 证书
/opt/prisma/console/               # 控制台（可选）
```
