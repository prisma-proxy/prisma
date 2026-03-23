---
sidebar_position: 2
---

# Docker

## Multi-stage build

The Docker image uses a multi-stage build: Node.js builds the console as static files, Rust builds the server binary, and the final image is a minimal Debian runtime with both.

```dockerfile
FROM node:22-slim AS console
WORKDIR /console
COPY apps/prisma-console/package.json apps/prisma-console/package-lock.json ./
RUN npm ci
COPY apps/prisma-console/ ./
RUN npm run build

FROM rust:1-bookworm AS builder
WORKDIR /src
COPY . .
RUN cargo build --release -p prisma-cli

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /src/target/release/prisma /usr/local/bin/prisma
COPY --from=console /console/out /opt/prisma/console
ENTRYPOINT ["prisma"]
```

The built console is placed at `/opt/prisma/console` inside the container. Configure `console_dir` in your server config to serve it.

## Usage

### Server

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

Example `server.toml` for Docker:

```toml
[management_api]
enabled = true
listen_addr = "0.0.0.0:9090"
auth_token = "your-secure-token-here"
console_dir = "/opt/prisma/console"
```

Access the console at `http://<host>:9090/`.

### Client

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
