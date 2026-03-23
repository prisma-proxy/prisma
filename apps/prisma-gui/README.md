# Prisma GUI

Cross-platform desktop GUI client for [Prisma](../README.md), built with **Tauri 2** and **React 19**.

## Features

- **Connection management** — connect/disconnect via FFI, auto-reconnect, system proxy toggle
- **Server profiles** — create, edit, delete, sort, import/export (QR code, URI, clipboard, TOML)
- **Speed test** — FFI-backed speed test with real-time chart visualization (Recharts)
- **Routing rules** — view and manage client-side routing rules
- **Live logs** — filterable, virtualized log viewer with level/keyword filtering
- **System tray** — status icon (connected/connecting/off), profile switcher, speed tooltip, quick actions
- **Keyboard shortcuts** — navigate pages, toggle connection, and more
- **Notification history** — in-app toast notifications with full history panel
- **Data usage tracking** — daily/weekly/monthly bandwidth statistics, persisted locally
- **Clipboard import** — automatically detect and import `prisma://` URIs from clipboard
- **Auto-update** — check for updates and apply in-place via FFI
- **i18n** — English and Simplified Chinese

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + 1` | Home |
| `Cmd/Ctrl + 2` | Profiles |
| `Cmd/Ctrl + 3` | Rules |
| `Cmd/Ctrl + 4` | Logs |
| `Cmd/Ctrl + 5` | Speed Test |
| `Cmd/Ctrl + 6` | Settings |
| `Cmd/Ctrl + K` | Toggle connection |
| `Cmd/Ctrl + N` | Go to Profiles |

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://rustup.rs/) (stable)
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/) v2
- `prisma-ffi` must be built first: `cargo build --release -p prisma-ffi`

### Run in dev mode

```bash
npm install
npm run tauri dev
```

### Build for production

```bash
npm run tauri build
```

## Architecture

```
prisma-gui/
├── src/                    # React frontend
│   ├── pages/              # Route pages (Home, Profiles, Rules, Logs, SpeedTest, Settings)
│   ├── components/         # UI components (Sidebar, BottomNav, StatusBar, SpeedTestChart, ...)
│   ├── hooks/              # Custom hooks (useConnection, usePrismaEvents, useKeyboardShortcuts, ...)
│   ├── store/              # Zustand stores (main store, notifications, dataUsage)
│   ├── lib/                # Types, commands (Tauri invoke wrappers), utilities
│   └── i18n/               # Locale files (en.json, zh-CN.json)
├── src-tauri/              # Rust backend (Tauri)
│   ├── src/
│   │   ├── lib.rs          # App entry, FFI event bridge
│   │   ├── commands.rs     # Tauri commands (connect, profiles, speed test, update, ...)
│   │   ├── state.rs        # Shared app state
│   │   └── tray.rs         # System tray setup, status icons, profile menu
│   └── Cargo.toml
├── package.json
└── tauri.conf.json
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Tauri 2 |
| Frontend | React 19, TypeScript, Vite |
| Styling | Tailwind CSS, Radix UI primitives |
| State | Zustand (with persist middleware for data usage) |
| Charts | Recharts |
| Virtualization | @tanstack/react-virtual |
| Routing | React Router v7 |
| i18n | i18next + react-i18next |
| Backend | Rust, prisma-ffi (C FFI to prisma-core) |
