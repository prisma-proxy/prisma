---
sidebar_position: 7
---

# 安装客户端 (Client)

在本章中，你将在你的本地电脑上安装 Prisma 客户端 (Client)——也就是你每天使用的设备。Prisma 提供多种客户端选项，你可以根据平台和偏好来选择。

## 选择你的客户端 (Client)

Prisma 有三种连接方式：

| 客户端 (Client) | 最适合 | 支持平台 |
|-------|-------|---------|
| **prisma-gui**（图形界面应用） | 大多数用户——可视化操作界面 | Windows、macOS、Linux |
| **prisma CLI**（命令行） | 高级用户、服务器、自动化 | Windows、macOS、Linux、FreeBSD |
| **移动端** | 手机和平板 | Android、iOS（通过兼容应用） |

:::tip 新手推荐
如果你想要可视化界面，使用 **prisma-gui**。如果你熟悉终端或者想在无图形界面的机器上运行 Prisma，使用 **CLI**。
:::

## 选项一：prisma-gui（桌面应用）

prisma-gui 是一个使用 Tauri 构建的桌面应用程序。它提供了用于管理配置文件 (Profile)、连接服务器和监控连接状态的可视化界面。

### Windows

1. 前往 [GitHub Releases](https://github.com/Yamimega/prisma/releases/latest) 页面
2. 下载 `prisma-gui-windows-x64-setup.exe`
3. 双击下载的文件运行安装程序
4. 按照安装向导操作（点击几次"下一步"）
5. 从开始菜单或桌面快捷方式启动 prisma-gui

:::info Windows SmartScreen
Windows 可能会显示"Windows 已保护你的电脑"的警告，因为该应用尚未使用商业证书签名。点击"更多信息"，然后点击"仍要运行"即可继续。
:::

### macOS

1. 前往 [GitHub Releases](https://github.com/Yamimega/prisma/releases/latest) 页面
2. 下载 `prisma-gui-macos.dmg`
3. 双击 `.dmg` 文件打开
4. 将 Prisma 图标拖入"应用程序"文件夹
5. 从"应用程序"文件夹打开 Prisma

:::info macOS Gatekeeper
macOS 可能会提示"无法打开，因为它来自身份不明的开发者"。解决方法：
1. 打开**系统设置** > **隐私与安全性**
2. 向下滚动，点击 Prisma 消息旁边的**仍然打开**
3. 或者右键点击应用，选择**打开**，然后在对话框中点击**打开**
:::

### Linux

1. 前往 [GitHub Releases](https://github.com/Yamimega/prisma/releases/latest) 页面
2. 下载适合你发行版的安装包：
   - `.deb` 用于 Ubuntu/Debian
   - `.AppImage` 用于通用 Linux

**Ubuntu/Debian（.deb）：**

```bash
sudo dpkg -i prisma-gui_0.6.3_amd64.deb
```

**AppImage：**

```bash
chmod +x prisma-gui-0.6.3.AppImage
./prisma-gui-0.6.3.AppImage
```

## 选项二：prisma CLI

CLI 客户端与你安装在服务器上的是同一个二进制文件。它在所有平台上都能使用。

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.sh | bash
```

### Windows（PowerShell）

```powershell
irm https://raw.githubusercontent.com/Yamimega/prisma/master/scripts/install.ps1 | iex
```

### 验证安装

```bash
prisma --version
```

预期输出：
```
prisma 0.6.3
```

## 选项三：移动端

Prisma 的移动端支持是通过支持 SOCKS5 连接的兼容代理 (Proxy) 应用提供的。你可以在家庭网络中运行 Prisma CLI 客户端，然后将手机连接到它。

### 方案 A：在路由器/家庭服务器上运行 Prisma 客户端

1. 在你家庭网络中的一台设备上安装 Prisma CLI（如树莓派、NAS 或常开的电脑）
2. 将监听地址配置为 `0.0.0.0:1080` 而不是 `127.0.0.1:1080`
3. 将手机的代理 (Proxy) 设置指向该设备的内网 IP

### 方案 B：在手机上使用支持 SOCKS5 的应用

Android 和 iOS 上有很多代理 (Proxy) 应用支持 SOCKS5 连接。配置它们连接到你网络中运行的 Prisma CLI 客户端即可。

## 验证客户端 (Client) 安装

无论你选择了哪种方法，让我们确认客户端已经准备就绪。

### prisma-gui

1. 打开应用程序
2. 你应该看到主窗口中有一个"配置文件"区域
3. 应用已准备就绪——我们将在下一章中进行配置

### prisma CLI

运行：

```bash
prisma --help
```

你应该看到包含 `client`、`server`、`gen-key` 等的命令列表。

## 你学到了什么

在本章中，你学到了：

- 三种客户端选项：**prisma-gui**（桌面应用）、**CLI** 和**移动端**
- 如何在 Windows、macOS 和 Linux 上安装 **prisma-gui**
- 如何在任何平台上安装 **CLI 客户端**
- 如何设置**移动端**访问
- 如何**验证**客户端安装

## 下一步

客户端已安装完成！现在让我们配置它来连接你的服务器。前往[配置客户端](./configure-client.md)。
