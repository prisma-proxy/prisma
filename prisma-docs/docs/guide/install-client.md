---
sidebar_position: 7
---

# Installing the Client

In this chapter, you will install the Prisma client on your local computer -- the device you use every day. Prisma offers multiple client options depending on your platform and preferences.

## Choose Your Client

Prisma has three ways to connect:

| Client | Best for | Platforms |
|--------|----------|-----------|
| **prisma-gui** (GUI app) | Most users -- point-and-click interface | Windows, macOS, Linux |
| **prisma CLI** | Power users, servers, automation | Windows, macOS, Linux, FreeBSD |
| **Mobile** | Phones and tablets | Android, iOS (via compatible apps) |

:::tip Recommendation for beginners
Use **prisma-gui** if you want a visual interface. Use the **CLI** if you are comfortable with the terminal or want to run Prisma on a headless machine.
:::

## Option 1: prisma-gui (Desktop App)

prisma-gui is a desktop application built with Tauri. It provides a visual interface for managing profiles, connecting to servers, and monitoring your connection.

### Windows

1. Go to the [GitHub Releases](https://github.com/Yamimega/prisma/releases/latest) page
2. Download `prisma-gui-windows-x64-setup.exe`
3. Double-click the downloaded file to run the installer
4. Follow the installation wizard (click Next a few times)
5. Launch prisma-gui from the Start Menu or desktop shortcut

:::info Windows SmartScreen
Windows may show a "Windows protected your PC" warning because the app is not yet signed with a commercial certificate. Click "More info" and then "Run anyway" to proceed.
:::

### macOS

1. Go to the [GitHub Releases](https://github.com/Yamimega/prisma/releases/latest) page
2. Download `prisma-gui-macos.dmg`
3. Double-click the `.dmg` file to open it
4. Drag the Prisma icon into the Applications folder
5. Open Prisma from the Applications folder

:::info macOS Gatekeeper
macOS may say the app "can't be opened because it is from an unidentified developer." To fix this:
1. Open **System Settings** > **Privacy & Security**
2. Scroll down and click **Open Anyway** next to the Prisma message
3. Or right-click the app, choose **Open**, and click **Open** in the dialog
:::

### Linux

1. Go to the [GitHub Releases](https://github.com/Yamimega/prisma/releases/latest) page
2. Download the appropriate package for your distribution:
   - `.deb` for Ubuntu/Debian
   - `.AppImage` for universal Linux

**For Ubuntu/Debian (.deb):**

```bash
sudo dpkg -i prisma-gui_0.9.0_amd64.deb
```

**For AppImage:**

```bash
chmod +x prisma-gui-0.9.0.AppImage
./prisma-gui-0.9.0.AppImage
```

## Option 2: prisma CLI

The CLI client is the same binary you installed on the server. It works on all platforms.

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.ps1 | iex
```

### Verify installation

```bash
prisma --version
```

Expected output:
```
prisma 0.9.0
```

## Option 3: Mobile

Prisma's mobile support is provided through compatible proxy apps that support SOCKS5 connections. You can run the Prisma CLI client on your home network and connect your phone to it.

### Option A: Run Prisma client on your router/home server

1. Install Prisma CLI on a device on your home network (a Raspberry Pi, NAS, or always-on computer)
2. Configure it to listen on `0.0.0.0:1080` instead of `127.0.0.1:1080`
3. Configure your phone's proxy settings to point to the device's local IP

### Option B: Use a SOCKS5-compatible app on your phone

Many proxy apps on Android and iOS support SOCKS5 connections. Configure them to connect to a Prisma CLI client running on your network.

## Verify the Client Installation

Regardless of which method you chose, let's make sure the client is ready.

### For prisma-gui

1. Open the application
2. You should see the main window with a "Profiles" section
3. The app is ready -- we will configure it in the next chapter

### For prisma CLI

Run:

```bash
prisma --help
```

You should see the command list including `client`, `server`, `gen-key`, etc.

## What you learned

In this chapter, you learned:

- The three client options: **prisma-gui** (desktop app), **CLI**, and **mobile**
- How to install **prisma-gui** on Windows, macOS, and Linux
- How to install the **CLI client** on any platform
- How to set up **mobile** access
- How to **verify** the client installation

## Next step

The client is installed! Now let's configure it to connect to your server. Head to [Configuring the Client](./configure-client.md).
