---
sidebar_position: 7
---

# Installing the Client

In this chapter you will install the Prisma client on your local device.

## Choose your client

```mermaid
graph TD
    Q["What device\nare you using?"] --> D{"Desktop?"}
    Q --> M{"Mobile?"}
    Q --> H{"Headless\nserver?"}

    D -->|"Want GUI"| GUI["<b>prisma-gui</b>\nTauri desktop app\nWindows / macOS / Linux"]
    D -->|"Prefer terminal"| CLI["<b>prisma CLI</b>\nCommand-line client\nAll platforms"]

    M -->|"Android"| AND["<b>Android App</b>\nKotlin + JNI\nAndroid 7.0+"]
    M -->|"iOS"| IOS["<b>iOS App</b>\nSwift + xcframework\niOS 15.0+"]

    H --> CLI2["<b>prisma CLI</b>\nRun on NAS, Pi, etc."]

    style GUI fill:#22c55e,color:#000
    style CLI fill:#3b82f6,color:#fff
    style AND fill:#a855f7,color:#fff
    style IOS fill:#f59e0b,color:#000
    style CLI2 fill:#3b82f6,color:#fff
```

| Client | Best for | Platforms |
|--------|----------|-----------|
| **prisma-gui** | Most users -- visual interface | Windows, macOS, Linux |
| **prisma CLI** | Power users, servers, automation | Windows, macOS, Linux, FreeBSD |
| **Android App** | Android phones and tablets | Android 7.0+ |
| **iOS App** | iPhones and iPads | iOS 15.0+ |

## Option 1: prisma-gui (Desktop App)

### Windows

Download `prisma-gui-windows-x64-setup.exe` from [GitHub Releases](https://github.com/prisma-proxy/prisma/releases/latest) and run the installer.

### macOS

Download `prisma-gui-macos.dmg`, open it, and drag Prisma to Applications.

### Linux

**Ubuntu/Debian:** `sudo dpkg -i prisma-gui_2.1.4_amd64.deb`

**AppImage:** `chmod +x prisma-gui-2.1.4.AppImage && ./prisma-gui-2.1.4.AppImage`

## Option 2: prisma CLI

**Linux / macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/prisma-proxy/prisma/master/scripts/install.ps1 | iex
```

## Option 3: Android App

Download `prisma-android.apk` from [GitHub Releases](https://github.com/prisma-proxy/prisma/releases/latest). Features: all 8 transports, per-app proxy, TUN mode, subscription import, QR code.

## Option 4: iOS App

Download from [GitHub Releases](https://github.com/prisma-proxy/prisma/releases/latest) or TestFlight. Features: TUN mode via Network Extension, all transports, subscription management.

## Verify

```bash
prisma --version
# Expected: prisma 2.1.4
```

## Next step

The client is installed! Head to [Configuring the Client](./configure-client.md).
