---
sidebar_position: 3
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Installation

Prisma v2.26.0 supports Linux, macOS, Windows, FreeBSD, Docker, and mobile platforms (Android/iOS via prisma-gui). Choose the installation method that best fits your environment.

## One-Line Install

The fastest way to get Prisma running. Automatically detects your OS and architecture, downloads the v2.26.0 binary, and places it on your `PATH`.

<Tabs>
  <TabItem value="linux" label="Linux / macOS" default>

```bash
curl -fsSL https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.sh | bash
```

  </TabItem>
  <TabItem value="windows" label="Windows (PowerShell)">

```powershell
irm https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.ps1 | iex
```

  </TabItem>
</Tabs>

### Install + Setup

Add `--setup` to also generate credentials, TLS certificates, and example config files:

<Tabs>
  <TabItem value="linux" label="Linux / macOS" default>

```bash
curl -fsSL https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.sh | bash -s -- --setup
```

  </TabItem>
  <TabItem value="windows" label="Windows (PowerShell)">

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.ps1))) -Setup
```

  </TabItem>
</Tabs>

This creates:
- `.prisma-credentials` — client ID and auth secret
- `prisma-cert.pem` / `prisma-key.pem` — TLS certificate and key
- `server.toml` / `client.toml` — example config files (if not already present)

### Install a specific version

Pin to v2.26.0 explicitly (or any other release tag):

<Tabs>
  <TabItem value="linux" label="Linux / macOS" default>

```bash
curl -fsSL https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.sh | bash -s -- --version v2.26.0
```

  </TabItem>
  <TabItem value="windows" label="Windows (PowerShell)">

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.ps1))) -Version v2.26.0
```

  </TabItem>
</Tabs>

### Custom install directory

Use `--dir` (or set `PRISMA_INSTALL_DIR`) to install to a different location:

<Tabs>
  <TabItem value="linux" label="Linux / macOS" default>

```bash
curl -fsSL https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.sh | bash -s -- --dir ~/.local/bin
```

  </TabItem>
  <TabItem value="windows" label="Windows (PowerShell)">

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.ps1))) -Dir "C:\tools\prisma"
```

  </TabItem>
</Tabs>

### Uninstall

<Tabs>
  <TabItem value="linux" label="Linux / macOS" default>

```bash
curl -fsSL https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.sh | bash -s -- --uninstall
```

  </TabItem>
  <TabItem value="windows" label="Windows (PowerShell)">

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.ps1))) -Uninstall
```

  </TabItem>
</Tabs>

### Installer options reference

<Tabs>
  <TabItem value="linux" label="Linux / macOS" default>

| Option | Description |
|--------|-------------|
| `--setup` | Generate credentials, TLS certificate, and example configs |
| `--version VER` | Install a specific version (e.g., `v2.26.0`). Default: latest |
| `--dir DIR` | Install directory. Default: `/usr/local/bin` |
| `--config-dir DIR` | Config output directory for `--setup`. Default: current dir |
| `--uninstall` | Remove the prisma binary |
| `--force` | Overwrite existing installation without reporting current version |
| `--no-verify` | Skip SHA256 checksum verification |
| `--quiet` | Suppress informational output |

  </TabItem>
  <TabItem value="windows" label="Windows (PowerShell)">

| Option | Description |
|--------|-------------|
| `-Setup` | Generate credentials, TLS certificate, and example configs |
| `-Version VER` | Install a specific version (e.g., `v2.26.0`). Default: latest |
| `-Dir DIR` | Install directory. Default: `%LOCALAPPDATA%\prisma` |
| `-ConfigDir DIR` | Config output directory for `-Setup`. Default: current dir |
| `-Uninstall` | Remove the prisma binary and clean PATH |
| `-Force` | Overwrite existing installation without reporting current version |
| `-NoVerify` | Skip SHA256 checksum verification |
| `-Quiet` | Suppress informational output |

  </TabItem>
</Tabs>

## Platform-Specific Downloads

If you prefer to download the v2.26.0 binary directly:

<Tabs>
  <TabItem value="linux-x64" label="Linux x86_64" default>

```bash
curl -fsSL https://github.com/prisma-proxy/prisma/releases/download/v2.26.0/prisma-linux-amd64 -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma
```

  </TabItem>
  <TabItem value="linux-arm64" label="Linux aarch64">

```bash
curl -fsSL https://github.com/prisma-proxy/prisma/releases/download/v2.26.0/prisma-linux-arm64 -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma
```

  </TabItem>
  <TabItem value="linux-armv7" label="Linux ARMv7">

```bash
curl -fsSL https://github.com/prisma-proxy/prisma/releases/download/v2.26.0/prisma-linux-armv7 -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma
```

  </TabItem>
  <TabItem value="macos" label="macOS">

```bash
curl -fsSL https://github.com/prisma-proxy/prisma/releases/download/v2.26.0/prisma-darwin-$(uname -m | sed s/x86_64/amd64/) -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma
```

  </TabItem>
  <TabItem value="windows-x64" label="Windows x64">

```powershell
New-Item -Force -ItemType Directory "$env:LOCALAPPDATA\prisma" | Out-Null; Invoke-WebRequest -Uri "https://github.com/prisma-proxy/prisma/releases/download/v2.26.0/prisma-windows-amd64.exe" -OutFile "$env:LOCALAPPDATA\prisma\prisma.exe"; [Environment]::SetEnvironmentVariable("Path", "$([Environment]::GetEnvironmentVariable('Path','User'));$env:LOCALAPPDATA\prisma", "User")
```

  </TabItem>
  <TabItem value="windows-arm64" label="Windows ARM64">

```powershell
New-Item -Force -ItemType Directory "$env:LOCALAPPDATA\prisma" | Out-Null; Invoke-WebRequest -Uri "https://github.com/prisma-proxy/prisma/releases/download/v2.26.0/prisma-windows-arm64.exe" -OutFile "$env:LOCALAPPDATA\prisma\prisma.exe"; [Environment]::SetEnvironmentVariable("Path", "$([Environment]::GetEnvironmentVariable('Path','User'));$env:LOCALAPPDATA\prisma", "User")
```

  </TabItem>
  <TabItem value="freebsd" label="FreeBSD">

```bash
fetch -o /usr/local/bin/prisma https://github.com/prisma-proxy/prisma/releases/download/v2.26.0/prisma-freebsd-amd64 && chmod +x /usr/local/bin/prisma
```

  </TabItem>
</Tabs>

## Docker

Run the v2.26.0 server directly with Docker:

```bash
docker run --rm -v $(pwd):/config ghcr.io/yamimega/prisma:2.26.0 server -c /config/server.toml
```

Run the client:

```bash
docker run --rm -v $(pwd):/config -p 1080:1080 -p 8080:8080 ghcr.io/yamimega/prisma:2.26.0 client -c /config/client.toml
```

Run with Docker Compose:

```yaml title="docker-compose.yml"
version: "3.8"
services:
  prisma-server:
    image: ghcr.io/yamimega/prisma:2.26.0
    command: server -c /config/server.toml
    volumes:
      - ./server.toml:/config/server.toml:ro
      - ./prisma-cert.pem:/config/prisma-cert.pem:ro
      - ./prisma-key.pem:/config/prisma-key.pem:ro
    ports:
      - "8443:8443"
      - "8443:8443/udp"   # QUIC
      - "9090:9090"       # Management API
    restart: unless-stopped
```

Build locally:

```bash
git clone https://github.com/prisma-proxy/prisma.git && cd prisma
docker build -t prisma .
docker run --rm -v $(pwd):/config prisma server -c /config/server.toml
```

## Mobile: Android and iOS

Mobile support is provided through **prisma-gui**, a Tauri + React application that uses the `prisma-ffi` C shared library. The GUI app is available for:

- **Android** — APK download from GitHub Releases or Google Play (when available)
- **iOS** — TestFlight or App Store (when available)

The mobile app supports:
- Profile management with QR code import/export
- Subscription URLs with auto-update
- System proxy and TUN (VPN) modes
- Per-app proxy routing
- GeoIP lookups and latency testing

Download the latest prisma-gui release from the [GitHub Releases](https://github.com/prisma-proxy/prisma/releases) page.

## Install via Cargo

Works on any platform with a Rust toolchain:

```bash
cargo install --git https://github.com/prisma-proxy/prisma.git prisma-cli
```

Or from a local clone:

```bash
cargo install --path prisma-cli
```

## Build from Source

```bash
git clone https://github.com/prisma-proxy/prisma.git && cd prisma
cargo build --release
```

Binaries are placed in `target/release/`. Copy the `prisma` binary to a location on your `$PATH`:

```bash
sudo cp target/release/prisma /usr/local/bin/
```

### Build requirements

- Rust stable (1.75+)
- A C compiler (for native dependencies)
- On Linux: `libssl-dev` (or `openssl-devel`) for TLS, optionally `linux-headers` for io_uring
- On macOS: Xcode command-line tools
- On Windows: MSVC build tools

## Pre-built Binaries

Pre-built binaries for v2.26.0 are available for the following targets via GitHub Releases:

| Platform | Architectures |
|----------|--------------|
| Linux | x86_64, aarch64, ARMv7 |
| macOS | x86_64 (Intel), aarch64 (Apple Silicon) |
| Windows | x86_64, ARM64 |
| FreeBSD | x86_64 |

Check the [GitHub Releases](https://github.com/prisma-proxy/prisma/releases) page for the latest builds.

## Verify Installation

```bash
prisma version
prisma --help
```

## Configuration Paths

Prisma searches for configuration files in the following order:

| Platform | Paths |
|----------|-------|
| Linux / macOS | Current directory, `/etc/prisma/`, `$XDG_CONFIG_HOME/prisma/`, `~/.config/prisma/` |
| Windows | Current directory, `%PROGRAMDATA%\prisma\` |

## Next Steps

- [Getting Started](./getting-started.md) — run your first proxy session
- [CLI Reference](./cli-reference.md) — complete command documentation
- [Linux systemd deployment](./deployment/linux-systemd.md) — deploy as a system service
- [Docker deployment](./deployment/docker.md) — container deployment guide
