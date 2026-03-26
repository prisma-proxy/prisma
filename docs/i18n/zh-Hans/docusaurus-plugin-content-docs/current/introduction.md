---
sidebar_position: 1
slug: /introduction
---

# 简介

Prisma 是一个基于 Rust 构建的新一代加密代理基础设施套件。它实现了 **PrismaVeil v5** 线路协议——融合现代密码学（包括后量子混合密钥交换）、八种传输方式和高级抗审查特性。**2.24.0** 版本新增了改进的错误传播、连接地图增强、路由规则修复、扩展分析、增强系统托盘、统一设置页面及更多生产级特性。

## 功能特性

### 协议与密码学

- **PrismaVeil v5 协议** — 1-RTT 握手 (Handshake)、0-RTT 会话恢复，X25519 + BLAKE3 + ChaCha20-Poly1305 / AES-256-GCM / Transport-Only 加密模式，头部认证加密（AAD）、连接迁移、增强型 KDF。协议 v4 已在 1.4.0 中移除。
- **后量子混合密钥交换** — ML-KEM-768 (Kyber) 与 X25519 组合，实现抗量子计算机的前向安全密钥协商。双方均支持时自动协商。
- **现代密码学** — X25519 ECDH、BLAKE3 KDF、ChaCha20-Poly1305 / AES-256-GCM AEAD
- **抗重放保护** — 基于 1024 位滑动窗口 nonce 位图
- **会话票据密钥轮换** — 自动密钥环轮换，可配置过期密钥保留时间以实现优雅的前向保密

### 传输方式

- **8 种传输方式**，支持自动回退：

| 传输方式 | 描述 |
|---------|------|
| **TCP** | TLS 加密的 TCP，具备 PrismaTLS 主动探测抵抗能力 |
| **QUIC** | QUIC v2 (RFC 9369)，支持 Salamander UDP 混淆和 BBR/Brutal/Adaptive 拥塞控制 |
| **WebSocket** | 基于 TLS 的 WebSocket，CDN 兼容 |
| **gRPC** | 基于 HTTP/2 的 gRPC 流式传输，CDN 兼容 |
| **XHTTP** | 分块 HTTP 传输，适用于限制性 CDN 环境 |
| **XPorta** | 新一代 CDN 传输，与普通 REST API 流量无法区分 |
| **SSH** | 通过标准 SSH 连接隧道传输，兼容性极强 |
| **WireGuard** | 使用 WireGuard 协议实现内核级转发性能 |

### 代理与路由

- **SOCKS5 代理接口**（RFC 1928），兼容各类应用程序
- **HTTP CONNECT 代理** — 适用于浏览器和 HTTP 感知客户端
- **TUN 模式** — 通过虚拟网络接口实现系统级代理（Windows/Linux/macOS）
- **端口转发 / 反向代理** — 通过服务器暴露本地服务（frp 风格）
- **路由规则引擎** — 基于域名/IP/端口/GeoIP 的允许/阻止过滤、ACL 文件、规则提供者
- **代理组** — 负载均衡、故障切换和基于 URL 测试的自动选择
- **GeoIP 路由** — 基于 MaxMind MMDB (GeoLite2-City.mmdb) 的国家和城市级智能分流，客户端和服务端均支持
- **智能 DNS** — Fake IP、隧道、智能（GeoSite）和直连模式

### 订阅

- **订阅管理** — 添加、更新、列出和测试订阅，支持自动更新
- **延迟测试** — 测量到订阅服务器或手动指定服务器列表的 RTT

### 抗审查

- **流量整形** — 桶填充、杂音注入、时序抖动、帧合并
- **PrismaTLS** — 主动探测抵抗，通过 padding 信标认证、掩护服务器池、浏览器指纹模拟
- **熵伪装** — 通过字节分布整形实现 DPI 豁免
- **Salamander UDP 混淆**、HTTP/3 伪装、端口跳跃、TLS 伪装

### 性能

- **io_uring 支持** — Linux 5.6+ 上的零拷贝 I/O，实现最大中继吞吐量
- **缓冲池** — 预分配、可复用的帧缓冲区，消除热路径上的分配开销
- **XMUX** — CDN 传输的连接复用和连接池
- **连接池** — 跨 SOCKS5/HTTP 请求复用传输连接
- **零拷贝中继** — `FrameEncoder` 使用预分配缓冲区和就地加解密
- **PrismaUDP** — UDP 中继，支持 FEC Reed-Solomon 前向纠错
- **拥塞控制** — BBR、Brutal 和 Adaptive 模式（QUIC）

### 运维与管理

- **守护进程 CLI 模式** — 将 server、client 和 console 作为后台守护进程运行，支持 PID 文件、日志文件和 `stop`/`status` 子命令
- **热重载配置** — SIGHUP 信号处理和自动配置文件监控，无需重启即可实时更新配置
- **优雅关闭** — 停止前排空活跃连接
- **配置文件监控** — 自动检测配置文件变更并触发热重载
- **管理 API** — REST + WebSocket API，用于实时监控和控制
- **Web 控制台** — 基于 Next.js + shadcn/ui 的实时控制台，包含指标、客户端管理和日志流
- **按客户端带宽和配额限制** — 上传/下载速率限制和可配置配额
- **按客户端指标** — 追踪每个授权客户端的带宽、连接数和使用量
- **连接背压** — 通过可配置的最大连接数限制实现
- **结构化日志**（pretty 或 JSON 格式），基于 `tracing`，支持广播

### 平台与集成

- **移动端 FFI** — C ABI 共享库（`prisma-ffi`），用于 GUI 和移动应用集成（Android/iOS）
- **跨平台** — Linux、macOS、Windows、FreeBSD，具有平台特定的 TUN、系统代理和自动更新支持

## 架构

Prisma 由六个 crate、一个控制台和一个文档站点组成：

```
prisma/
├── crates/
│   ├── prisma-core/       # 共享库：加密、协议（PrismaVeil v5）、配置、DNS、路由、
│   │                      #   GeoIP、带宽、缓冲池、流量整形、类型
│   ├── prisma-server/     # 代理服务端：TCP/QUIC/WS/gRPC/XHTTP/XPorta/SSH/WireGuard
│   │                      #   监听器、中继（标准 + io_uring）、认证、伪装、热重载
│   ├── prisma-client/     # 代理客户端：SOCKS5/HTTP CONNECT/TUN 入站、传输选择、
│   │                      #   连接池、代理组、DNS 解析器、指标
│   ├── prisma-mgmt/       # 管理 API：基于 axum 的 REST + WebSocket，认证中间件，
│   │                      #   客户端/连接/指标/带宽/配置/路由处理器
│   ├── prisma-cli/        # CLI 工具（clap 4）：server/client/console 运行器（支持守护进程模式）、
│   │                      #   gen-key、gen-cert、init、validate、subscription、latency-test、
│   │                      #   管理命令、Shell 补全
│   └── prisma-ffi/        # C FFI 共享库：生命周期、配置文件、QR 导入/导出、
│                          #   系统代理、自动更新、订阅导入、统计轮询
├── apps/
│   ├── prisma-gui/        # 跨平台 GUI（Tauri 2 + React + TypeScript）
│   └── prisma-console/    # Web 控制台（Next.js + shadcn/ui）
├── docs/                  # 文档站点（Docusaurus）
├── tools/
│   └── prisma-mcp/        # MCP 开发服务器
└── scripts/               # 安装脚本和基准测试
```

### 数据流 — 出站代理

作为出站代理使用时，应用程序连接到本地 SOCKS5 或 HTTP CONNECT 接口。客户端使用 PrismaVeil v5 协议加密流量，并通过八种传输方式之一发送到服务器，服务器将其转发到目标地址。

```mermaid
graph LR
    A[应用程序] -->|SOCKS5 / HTTP| B[prisma-client]
    B -->|PrismaVeil v5 / QUIC,TCP,WS,...| C[prisma-server]
    C -->|TCP| D[目标地址]
```

### 数据流 — 端口转发（反向代理）

端口转发允许您通过 Prisma 服务器暴露 NAT/防火墙后面的本地服务。外部连接到达服务器后，通过加密隧道中继到客户端的本地服务。

```mermaid
graph LR
    A[互联网] -->|TCP| B["prisma-server:port"]
    B -->|PrismaVeil v5| C[prisma-client]
    C -->|TCP| D[本地服务]
```

### 数据流 — 管理与控制台

管理 API 提供实时可观测性和控制。控制台通过服务端代理与管理 API 通信，以保护 API 令牌安全。

```mermaid
graph LR
    A[浏览器] -->|HTTP| B["prisma-console (Next.js)"]
    B -->|REST / WS| C["prisma-mgmt (axum)"]
    C --> D[ServerState]
```

## 2.24.0 新增功能

- **订阅错误传播** — 后端处理器现在返回真实的 SQL/数据库错误消息作为结构化 JSON，而非不透明的 500 错误，使订阅创建失败的调试更加直观
- **连接地图优化** — AnyChart 风格连接地图，改进缩放、平移和城市级圆点渲染
- **路由规则根因修复** — 修复了 TOML 到 JSON 反序列化器导致路由规则静默丢弃条件的问题

## 2.20.0 新增功能

- **更新代理/直连选项** — 自动更新现可通过代理或直连路由
- **路由测试修复** — 修复路由测试端点中域名后缀规则的误判问题
- **连接清理** — 断开连接时自动清除过期连接条目
- **图表优化** — 改进所有分析图表的轴标签、工具提示和暗色模式颜色
- **地图缩放** — 连接地图支持滚轮缩放和移动端双指缩放

## 2.19.0 新增功能

- **路由诊断日志** — 每条路由规则评估的详细日志输出，通过 `PRISMA_ROUTE_DEBUG=1` 启用
- **服务端 GeoIP 匹配** — 服务端路由规则现对 GeoIP 条件执行实时 MMDB 查询
- **Serde 往返测试** — 所有配置结构体的完整序列化/反序列化测试
- **Markdown 变更日志** — 从约定式提交生成机器可读的 `CHANGELOG.md`
- **异步更新安装** — GUI 自动更新异步下载和安装，不阻塞界面
- **Windows MoveFileEx** — 更新二进制替换使用 `MoveFileEx` 和 `MOVEFILE_DELAY_UNTIL_REBOOT` 处理锁定文件

## 2.18.0 新增功能

- **扩展时间范围** — 分析图表支持 1 小时、6 小时、12 小时、24 小时、7 天和 30 天时间窗口
- **Top-10 流量图表** — 新增按带宽消耗排名前 10 客户端的图表
- **缩放和平移** — 所有时间序列图表支持拖拽缩放和平移导航
- **CSV 导出** — 从任意图表视图导出分析数据为 CSV
- **暗色图表主题** — 图表跟随系统/应用暗色模式，具备适当对比度和网格颜色

## 2.17.0 新增功能

- **增强系统托盘** — 托盘菜单现显示实时上传/下载速度、代理模式快捷切换、更新可用性和最近连接
- **按应用代理页面** — 专用页面配置按应用代理规则，内置常用应用预设（浏览器、终端、开发工具）

## 2.16.0 新增功能

- **统一设置** — 统一设置页面，整合服务端、客户端和控制台配置
- **完整配置字段** — 所有传输特定字段（PrismaTLS、CDN、SSH、WireGuard、Fallback）现在在 GUI 中以验证表单形式暴露
- **优化表单** — 改进表单布局、内联验证和上下文帮助提示

## 2.15.0 新增功能

- **GeoSite 过滤支持** — 自动下载 GeoSite 域名列表，支持分类预设路由规则
- **路由 GeoIP 测试** — 服务端路由测试端点现使用实际 MMDB 查询进行 GeoIP 规则匹配
- **规则匹配分析** — 分析图表现显示所有连接的匹配规则名称（Default、Bypass 或命名规则）
- **头部控件** — 通知、主题和语言控件移至应用栏
- **设置清理** — 移除设置页面中重复的自动备份字段
- **侧边栏 Logo 优化** — 侧边栏 Logo 针对亮色和暗色主题进行了优化
- **连接地图可见性** — 提高了连接地图上国家的基础可见度

## 2.14.0 新增功能

- **连接地图重新设计** — 新增城市级别圆点，根据经纬度坐标定位
- **城市级 GeoIP 数据** — 连接 GeoIP 现包含城市名称及 MMDB 中的坐标信息
- **完整国家名称显示** — 连接表格显示完整国家名称而非 ISO 代码
- **订阅计划系统** — Free、Basic、Pro 计划预设及可配置限制
- **权限控制** — 兑换码/邀请链接的细粒度控制（端口转发、UDP、最大连接数、允许目标）
- **国际化扩展** — 订阅、兑换和设置页面完整国际化（EN + ZH）
- **SQLite 迁移 v2** — 计划和权限表的数据库架构迁移

## 2.13.0 新增功能

- **React 水合修复** — 修复所有控制台页面因客户端/服务端不匹配导致的水合错误
- **GeoIP 文字标签** — 使用跨平台文字标签替换 emoji 国旗，确保在所有操作系统上一致显示
- **路由规则匹配修复** — 修复 DomainKeyword 匹配和 GeoIP 跳过逻辑
- **服务端路由测试端点** — `POST /api/routes/test` 用于测试域名或 IP 是否匹配已配置的路由规则
- **拥塞模式 "auto"** — `congestion.mode = "auto"` 现映射为 adaptive 拥塞控制器

## 2.12.0 新增功能

- **SQLite 数据库** — 用户、客户端、路由规则和订阅现存储在 SQLite 数据库（`data.sql`）中，首次运行时从 TOML 配置自动迁移
- **订阅系统** — 兑换码（`PRISMA-XXXX`）和邀请链接，简化客户端接入流程
- **控制台设置标签页** — 管理员可配置设置：注册开关、默认角色、会话过期时间、备份间隔
- **角色化仪表盘** — 客户端角色用户看到简化视图，仅显示"我的客户端"和"订阅"页面
- **SQLite 感知备份** — 备份和恢复现包含 TOML 配置和 SQLite 数据（data.sql）

## 2.11.0 新增功能

- **Cloudflare 风格连接地图** — 重新设计的实时连接地图，带弧线和服务器标记
- **分享对话框 TOML 溢出修复** — 修复长 TOML 内容溢出分享对话框的问题
- **拥塞 "auto" 模式** — 服务端和客户端配置支持 `congestion.mode = "auto"`
- **规则提供者下载模式** — GUI 中新增规则提供者下载模式选择器（自动/直连/代理）

## 2.10.0 新增功能

- **控制台设置向导** — WordPress 风格的首次运行设置页面 `/setup`，创建初始管理员用户，无需预配置
- **设置 API** — `GET /api/setup/status` 和 `POST /api/setup/init` 端点（无需认证）用于程序化首次设置
- **修改密码** — `PUT /api/auth/password` 端点允许用户修改自己的密码
- **注册限制** — 在管理员用户存在之前，自助注册被阻止（通过设置流程强制执行）
- **分享配置修复** — `[server]` 配置中的 `public_address` 字段用于共享客户端配置，替代 `listen_addr`（0.0.0.0）
- **路由规则重新设计** — 双标签页布局（手动规则 + 模板），新规则类型（DOMAIN、DOMAIN-SUFFIX、DOMAIN-KEYWORD、IP-CIDR、GEOIP、FINAL），新动作（PROXY/DIRECT/REJECT），新模板（屏蔽种子下载、屏蔽赌博网站、屏蔽社交媒体）
- **Direct 路由动作** — `RuleAction::Direct` 用于匹配流量直连绕过代理
- **GUI：局域网服务模式** — `allowLan` 设置将本地代理绑定到 0.0.0.0 以便局域网共享
- **GUI：代理模式优化** — 持久化代理模式、httpPort 验证、托盘状态同步
- **GUI：macOS 系统代理修复** — 使用 HTTP/HTTPS 代理设置替代 SOCKS5
- **GUI："复制终端代理"** — 托盘菜单项复制平台适配的代理导出命令
- **GUI：连接虚拟化** — 高效虚拟化列表渲染，支持 1000+ 并发连接
- **GUI：状态同步** — 页面重载和应用恢复时正确检测重连状态
- **React 水合修复** — 延迟 localStorage 读取以兼容 SSR（修复错误 #418）

## 2.9.0 新增功能

- **CLI 自更新** — `prisma update [--check] [--yes]` 检查 GitHub Releases 并自动替换二进制文件
- **连接级 GeoIP 含城市** — 连接信息现在包含 `country` 和 `city` 字段，使用 maxminddb（GeoLite2-City.mmdb）替代 v2fly geoip.dat
- **基于所有者的客户端数据隔离** — 授权客户端的 `owner` 字段；客户端角色用户只能看到自己拥有的客户端和指标
- **客户端配额修复** — 配额端点在未配置配额时返回默认零值而非 404

## 2.8.0 新增功能

- **GeoIP 分析** — 新增 `GET /api/connections/geo` 接口，返回活跃连接的国家分布；控制台概览页新增实时 GeoIP 饼图
- **按客户端指标 API** — 新增三个接口：`GET /api/metrics/clients`、`GET /api/metrics/clients/{id}`、`GET /api/metrics/clients/{id}/history`，返回流量、连接数、活跃连接、延迟 p50/p95/p99 及时序历史
- **自动备份** — `[management_api]` 中新增 `auto_backup_interval_mins`，可启用后台定期配置快照（`0` = 禁用）
- **QUIC 主机名支持** — 客户端现通过异步 DNS 解析 QUIC 连接主机名（修复 `hostname:port` 地址的"无效套接字地址语法"错误）
- **RouteAction 别名** — 服务端路由动作现接受 `reject`、`REJECT`、`BLOCK` 作为 `Block` 的别名
- **控制台改进** — 概览页新增 GeoIP 饼图；系统页新增实时 CPU/内存面积图；客户端页新增活跃连接数和流量列及延迟/历史图表；带宽页新增指标汇总卡片；测速页新增 4 个测试服务器、趋势图和扩展统计；实时流量窗口限制为 60 秒
- **GUI 传输模式** — 配置文件传输选项现包含 XHTTP、XPorta、PrismaTLS 和 WireGuard；QUIC 专属设置（端口跳变、熵伪装、SNI 切片）仅在选择 QUIC 传输时显示
- **全项目同步** — 版本引用、文档和功能感知在所有子项目间对齐
- **连接池文档** — `connection_pool.enabled` 在客户端配置参考中完整记录
- **密码套件自动选择文档** — `cipher_suite = "auto"` 及硬件检测行为已记录
- **i18n 同步** — 控制台所有语言环境键在 EN 和 ZH 之间同步

### 1.5.0

- **连接池** — 通过 `connection_pool.enabled = true` 启用传输连接复用
- **密码套件自动选择** — `cipher_suite = "auto"` 在 AES-NI/NEON 硬件上选择 AES-256-GCM，否则选择 ChaCha20-Poly1305
- **API 表面缩减** — 通过 `pub(crate)` 隐藏 prisma-core 内部函数
- **消除 unwrap** — 将 codec、handshake、xporta 热路径中的所有 `unwrap()` 替换为 `expect()` + 原因说明

### 1.4.0

- **v5 AAD 中继激活** — 头部认证加密已在所有中继热路径中激活（1.3.0 中为死代码）
- **服务端中继缓冲池** — 消除中继热路径上的每会话堆分配
- **客户端权限** — 细粒度的按客户端访问控制和权限
- **传输回退** — 有序传输回退，自动故障转移
- **后量子混合密钥交换** — ML-KEM-768 + X25519
- **守护进程模式** — 用于 server、client 和 console（`-d` 标志，配合 `stop`/`status` 子命令）
- **订阅管理** CLI 命令（`add`、`update`、`list`、`test`）
- **延迟测试** — `prisma latency-test`
- **热重载配置** — SIGHUP 和自动文件监控
- **会话票据密钥轮换** — 自动密钥环，实现前向保密
- **缓冲池** — 服务端和客户端预分配中继缓冲区
- **优雅关闭** — SIGTERM 时排空连接
- **按客户端指标**追踪
- **配置文件监控** — 文件变更时自动重载
- **`--verbose/-v` 全局标志** — 调试输出
- **管理 API 新增** — `/api/clients/:id/permissions`、`/api/clients/:id/kick`、`/api/clients/:id/block`
