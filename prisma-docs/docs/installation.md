---
sidebar_position: 3
---

# Installation

## Install via Cargo

The quickest way to install Prisma is with `cargo install`:

```bash
cargo install --path prisma-cli
```

This compiles and installs the `prisma` binary into your Cargo bin directory (usually `~/.cargo/bin/`).

## One-Line Install

**Linux (x86_64):**

```bash
curl -fsSL https://github.com/Yamimega/prisma/releases/latest/download/prisma-linux-amd64 -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma
```

**Linux (aarch64):**

```bash
curl -fsSL https://github.com/Yamimega/prisma/releases/latest/download/prisma-linux-arm64 -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma
```

**macOS (Apple Silicon / Intel):**

```bash
curl -fsSL https://github.com/Yamimega/prisma/releases/latest/download/prisma-darwin-$(uname -m) -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma
```

**Windows (PowerShell):**

```powershell
Invoke-WebRequest -Uri "https://github.com/Yamimega/prisma/releases/latest/download/prisma-windows-amd64.exe" -OutFile "$env:LOCALAPPDATA\prisma.exe"
```

**Cargo (all platforms):**

```bash
cargo install --git https://github.com/Yamimega/prisma.git prisma-cli
```

## Build from source

```bash
git clone https://github.com/Yamimega/prisma.git && cd prisma
cargo build --release
```

Binaries are placed in `target/release/`. Copy the `prisma` binary to a location on your `$PATH`:

```bash
sudo cp target/release/prisma /usr/local/bin/
```

## Pre-built binaries

Pre-built binaries will be available for the following targets via CI releases:

| Platform | Architecture |
|----------|-------------|
| Linux | x86_64, aarch64 |
| macOS | x86_64, aarch64 |
| Windows | x86_64 |

Check the GitHub releases page for the latest builds.

## Verify installation

```bash
prisma --help
```

## Next steps

- [Getting Started](./getting-started.md) — run your first proxy session
- [Linux systemd deployment](./deployment/linux-systemd.md) — deploy as a system service
