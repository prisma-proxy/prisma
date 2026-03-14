---
sidebar_position: 2
---

# Docker

## 多阶段构建

Docker 镜像使用多阶段构建：Node.js 将仪表盘构建为静态文件，Rust 构建服务器二进制文件，最终镜像是包含两者的最小 Debian 运行时。

```dockerfile
FROM node:22-slim AS dashboard
WORKDIR /dashboard
COPY prisma-dashboard/package.json prisma-dashboard/package-lock.json ./
RUN npm ci
COPY prisma-dashboard/ ./
RUN npm run build

FROM rust:1-bookworm AS builder
WORKDIR /src
COPY . .
RUN cargo build --release -p prisma-cli

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /src/target/release/prisma /usr/local/bin/prisma
COPY --from=dashboard /dashboard/out /opt/prisma/dashboard
ENTRYPOINT ["prisma"]
```

构建好的仪表盘位于容器内的 `/opt/prisma/dashboard`。在服务端配置中设置 `dashboard_dir` 即可提供服务。

## 用法

### 服务端

```bash
docker run -d \
  --name prisma-server \
  -p 8443:8443/tcp \
  -p 8443:8443/udp \
  -p 9090:9090/tcp \
  -v /path/to/server.toml:/config/server.toml:ro \
  -v /path/to/certs:/config/certs:ro \
  prisma server -c /config/server.toml
```

Docker 环境下的 `server.toml` 示例：

```toml
[management_api]
enabled = true
listen_addr = "0.0.0.0:9090"
auth_token = "your-secure-token-here"
dashboard_dir = "/opt/prisma/dashboard"
```

通过 `http://<host>:9090/` 访问仪表盘。

### 客户端

```bash
docker run -d \
  --name prisma-client \
  -p 1080:1080 \
  -p 8080:8080 \
  -v /path/to/client.toml:/config/client.toml:ro \
  prisma client -c /config/client.toml
```

## Docker Compose

```yaml
services:
  prisma-server:
    build: .
    command: server -c /config/server.toml
    ports:
      - "8443:8443/tcp"
      - "8443:8443/udp"
      - "9090:9090/tcp"
    volumes:
      - ./server.toml:/config/server.toml:ro
      - ./certs:/config/certs:ro
    restart: unless-stopped
```
