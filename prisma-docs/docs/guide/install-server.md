---
sidebar_position: 5
---

# Installing the Server

In this chapter, you will install Prisma on your remote server (VPS). We will cover the easiest method first, then show alternatives for advanced users.

## Before You Begin

Make sure you:
- Have a VPS running Ubuntu 22.04 or Debian 12 (see [Preparation](./prepare.md))
- Can connect to your server via SSH
- Have updated your server (`sudo apt update && sudo apt upgrade -y`)

## Method 1: One-Line Install Script (Recommended)

This is the easiest way to install Prisma. The script automatically detects your operating system and CPU architecture, downloads the correct binary, and places it in the right location.

SSH into your server and run:

```bash
curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.sh | bash
```

You should see output like:

```
[INFO] Detected platform: linux-amd64
[INFO] Downloading prisma v0.9.0...
[INFO] Verifying checksum...
[INFO] Installing to /usr/local/bin/prisma
[INFO] Installation complete!
```

### Install + Setup (even easier)

Add `--setup` to also generate credentials, TLS certificates, and example config files:

```bash
curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.sh | bash -s -- --setup
```

This creates everything you need:
- `server.toml` -- Example server configuration
- `client.toml` -- Example client configuration
- `.prisma-credentials` -- Your client ID and auth secret
- `prisma-cert.pem` / `prisma-key.pem` -- TLS certificate and private key

:::tip Recommended for beginners
Using `--setup` is the fastest way to get started. It generates all the files you need, so you only have to make a few edits.
:::

## Method 2: Docker

If you prefer Docker (or your VPS already has Docker installed), you can run Prisma in a container.

### Step 1: Install Docker (if not already installed)

```bash
curl -fsSL https://get.docker.com | bash
```

### Step 2: Create a config directory

```bash
mkdir -p /etc/prisma
```

### Step 3: Run Prisma in Docker

```bash
docker run -d \
  --name prisma-server \
  --restart unless-stopped \
  -v /etc/prisma:/config \
  -p 8443:8443/tcp \
  -p 8443:8443/udp \
  ghcr.io/yamimega/prisma server -c /config/server.toml
```

What each part means:
- `-d` -- Run in the background
- `--name prisma-server` -- Give the container a name
- `--restart unless-stopped` -- Automatically restart if it crashes or the server reboots
- `-v /etc/prisma:/config` -- Share your config directory with the container
- `-p 8443:8443/tcp` -- Open TCP port 8443
- `-p 8443:8443/udp` -- Open UDP port 8443

:::info Docker note
You will still need to create a `server.toml` file in `/etc/prisma/` before the container can start. We will do that in the [next chapter](./configure-server.md).
:::

## Method 3: Download Binary Directly

If you want to download the binary manually:

```bash
# For x86_64 (most common)
curl -fsSL https://github.com/Yamimega/prisma/releases/latest/download/prisma-linux-amd64 \
  -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma

# For ARM64 (Raspberry Pi 4, Oracle Cloud free tier, etc.)
curl -fsSL https://github.com/Yamimega/prisma/releases/latest/download/prisma-linux-arm64 \
  -o /usr/local/bin/prisma && chmod +x /usr/local/bin/prisma
```

:::info How do I know which architecture I have?
Run `uname -m` on your server. If it says `x86_64`, use the amd64 binary. If it says `aarch64`, use the arm64 binary.
:::

## Method 4: Build from Source (Advanced)

If you prefer to compile Prisma yourself:

```bash
# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Clone and build
git clone https://github.com/Yamimega/prisma.git
cd prisma
cargo build --release

# Install the binary
sudo cp target/release/prisma /usr/local/bin/
```

Building from source takes a few minutes depending on your server's hardware.

## Verify Installation

After installing, verify that Prisma is working:

```bash
prisma --version
```

Expected output:
```
prisma 0.9.0
```

You can also see all available commands:

```bash
prisma --help
```

Expected output:
```
Prisma - Next-generation encrypted proxy

Usage: prisma <COMMAND>

Commands:
  server      Start the proxy server
  client      Start the proxy client
  gen-key     Generate a client ID and auth secret
  gen-cert    Generate a self-signed TLS certificate
  init        Generate example config files
  validate    Validate a config file
  console     Launch the web management console
  help        Print this message or the help of the given subcommand(s)

Options:
  -V, --version  Print version
  -h, --help     Print help
```

## Directory Structure

After installation, here is where everything lives:

```
/usr/local/bin/prisma          ← The Prisma binary (the program itself)
/etc/prisma/                   ← Config directory (you will create this)
    server.toml                ← Server configuration file
    prisma-cert.pem            ← TLS certificate
    prisma-key.pem             ← TLS private key
```

If you used `--setup`, the config files are in the current directory. Let's move them to the standard location:

```bash
sudo mkdir -p /etc/prisma
sudo mv server.toml client.toml prisma-cert.pem prisma-key.pem /etc/prisma/
sudo mv .prisma-credentials /etc/prisma/
```

## Troubleshooting Installation

### "command not found" after installing

The binary might not be in your PATH. Try running it with the full path:

```bash
/usr/local/bin/prisma --version
```

If that works, add `/usr/local/bin` to your PATH:

```bash
export PATH=$PATH:/usr/local/bin
```

### Permission denied

Make sure the binary is executable:

```bash
sudo chmod +x /usr/local/bin/prisma
```

### "curl: command not found"

Install curl first:

```bash
sudo apt install curl -y
```

### Architecture mismatch

If you see an error like "cannot execute binary file", you downloaded the wrong architecture. Check your architecture:

```bash
uname -m
```

- `x86_64` means you need the `amd64` binary
- `aarch64` means you need the `arm64` binary

## Opening Firewall Ports

Your server's firewall may block the ports Prisma needs. Open them:

```bash
# If using ufw (Ubuntu default firewall)
sudo ufw allow 8443/tcp
sudo ufw allow 8443/udp

# Verify
sudo ufw status
```

If your VPS provider has a separate "security group" or "firewall" in their web panel, make sure to open port 8443 (TCP and UDP) there as well.

:::warning Cloud provider firewalls
Many cloud providers (AWS, Google Cloud, Oracle Cloud, etc.) have their own firewall settings in the web dashboard. You must open ports in **both** the server's local firewall **and** the cloud provider's firewall.
:::

## What you learned

In this chapter, you learned:

- How to install Prisma on your server using the **one-line install script**
- Alternative methods: **Docker**, **direct download**, and **building from source**
- How to **verify** the installation works
- The **directory structure** Prisma uses
- How to **open firewall ports** so Prisma can accept connections
- How to troubleshoot common installation problems

## Next step

Prisma is installed! Now let's create the server configuration file. Head to [Configuring the Server](./configure-server.md).
