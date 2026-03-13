---
sidebar_position: 5
---

# 控制面板

Prisma 控制面板是用于监控和管理代理服务器的实时 Web 界面。它使用 Next.js 16、shadcn/ui、Recharts 和 TanStack Query 构建为静态站点，由 Prisma 服务器直接提供服务。

## 前提条件

- 一个已启用[管理 API](/docs/features/management-api) 的运行中的 Prisma 服务器
- 控制面板静态文件（预构建或从源代码构建）

## 设置

### 使用预构建文件

从[最新版本](https://github.com/Yamimega/prisma/releases/latest)下载 `prisma-dashboard.tar.gz` 并解压：

```bash
mkdir -p /opt/prisma/dashboard
tar -xzf prisma-dashboard.tar.gz -C /opt/prisma/dashboard
```

### 从源代码构建

```bash
cd prisma-dashboard
npm ci
npm run build
```

静态文件输出到 `prisma-dashboard/out/`。

### 服务端配置

在 `server.toml` 中将服务器指向控制面板文件：

```toml
[management_api]
enabled = true
listen_addr = "127.0.0.1:9090"
auth_token = "your-secure-token-here"
dashboard_dir = "/opt/prisma/dashboard"  # 或 "./prisma-dashboard/out"
```

启动服务器后访问 `http://127.0.0.1:9090/` 即可打开控制面板。

## 认证

控制面板使用基于令牌的认证。在登录页面输入服务器配置中的 `management_api.auth_token`。令牌存储在浏览器的会话存储中，并以 `Bearer` 令牌的形式随每个 API 请求发送。

所有 `/dashboard/*` 路由都受保护 — 未认证用户将被重定向到 `/login`。

## 架构

控制面板构建为静态单页应用程序 (SPA)，由 Prisma 服务器的管理 API (axum) 提供服务。生产环境无需单独的 Node.js 进程。

```
浏览器 → prisma-server:9090 → 静态文件（控制面板）
                              → /api/*（REST + WebSocket）
```

控制面板的 API 调用直接发送到同源管理 API 端点。WebSocket 连接使用 `?token=` 查询参数进行认证（因为浏览器 WebSocket API 无法发送自定义头部）。

## 页面

### 概览

主控制面板页面显示：
- **指标卡片** — 活跃连接数、总上传/下载字节数、运行时间
- **流量图表** — 实时上传和下载字节/秒随时间变化（Recharts 面积图）
- **连接表格** — 活跃连接的对端地址、传输类型、模式、字节计数和断开按钮

数据源：WebSocket 推送（每秒指标）+ REST 轮询（每 5 秒连接状态）。

### 服务器

服务器信息：
- 健康状态、版本和运行时间
- 服务器配置详情（监听地址、最大连接数、超时时间）
- TLS 证书信息

### 客户端

客户端管理：
- **客户端列表** — 显示所有授权客户端的名称、状态（启用/禁用）和操作
- **添加客户端** — 生成新的 UUID + 认证密钥对，密钥仅显示一次
- **编辑客户端** — 更新名称、切换启用/禁用
- **删除客户端** — 从认证存储中移除客户端

更改立即生效 — 无需重启服务器。

### 路由

可视化路由规则编辑器：
- **规则列表** — 所有规则按优先级排序，显示条件、操作和启用状态
- **规则编辑器** — 用于创建新规则的对话框表单，包含条件类型、值和操作
- **切换/删除** — 内联启用、禁用或删除规则

详见[路由规则](/docs/features/routing-rules)了解规则类型。

### 日志

实时日志流：
- **日志查看器** — 可滚动的等宽字体日志输出，带有彩色级别标签
- **过滤器** — 按日志级别（ERROR、WARN、INFO、DEBUG、TRACE）和目标字符串过滤
- **自动滚动** — 自动跟随新日志条目，除非用户向上滚动
- **清除** — 清除日志缓冲区

数据源：WebSocket 推送（实时日志条目）。

### 设置

服务器配置编辑器：
- **可编辑字段** — 日志级别、日志格式、最大连接数、端口转发开关
- **只读字段** — 监听地址（需要重启服务器）
- **TLS 信息** — 证书状态和文件路径
- **伪装** — 当前伪装配置状态（只读）

## 开发

本地开发时，可以运行 Next.js 开发服务器：

```bash
cd prisma-dashboard
npm install
npm run dev
# → http://localhost:3000
```

开发服务器要求 Prisma 管理 API 运行在同源或已启用 CORS 的地址上。如果使用不同端口，在服务器配置中配置 `cors_origins`：

```toml
[management_api]
cors_origins = ["http://localhost:3000"]
```
