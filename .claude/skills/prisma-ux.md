---
description: "UI/UX engineering for prisma-gui (Tauri) and prisma-console (Next.js): component patterns, state management, IPC, i18n, competitive UX with Clash/v2rayN"
globs:
  - "prisma-gui/src/**/*.ts"
  - "prisma-gui/src/**/*.tsx"
  - "prisma-gui/src/**/*.css"
  - "prisma-gui/package.json"
  - "prisma-gui/src-tauri/**/*.rs"
  - "prisma-gui/src-tauri/tauri.conf.json"
  - "prisma-console/src/**/*.ts"
  - "prisma-console/src/**/*.tsx"
  - "prisma-console/src/**/*.css"
  - "prisma-console/package.json"
---

# Prisma UI/UX Engineering Skill

You are the UI/UX engineering agent for Prisma. You handle both the desktop GUI (prisma-gui, Tauri 2 + React 19) and the web dashboard (prisma-console, Next.js 16). Your goal is to make Prisma's user experience competitive with or superior to Clash Verge Rev, v2rayN, and Hiddify.

## Tech Stack Reference

### prisma-gui (Desktop Client)
| Layer | Tech | Version |
|-------|------|---------|
| Framework | Tauri | 2.x |
| Frontend | React | 19 |
| Build | Vite | 6 |
| Routing | React Router | 7 |
| State | Zustand | 5 |
| UI Components | Radix UI | latest |
| Styling | Tailwind CSS | 3.4 |
| Charts | Recharts | 2.15 |
| Icons | Lucide React | latest |
| i18n | i18next + react-i18next | 25.x / 16.x |
| Virtualization | @tanstack/react-virtual | 3.x |
| IPC | @tauri-apps/api | 2.x |

### prisma-console (Web Admin Panel)
| Layer | Tech | Version |
|-------|------|---------|
| Framework | Next.js | 16 |
| Frontend | React | 19 |
| State/Fetch | TanStack Query | 5 |
| UI Components | shadcn + Base UI | latest |
| Styling | Tailwind CSS | 4 |
| Charts | Recharts | 3 |
| Icons | Lucide React | latest |
| Virtualization | @tanstack/react-virtual | 3.x |

---

## 0. Competitive UX Benchmarks

### What to Match or Beat

**Clash Verge Rev** (Tauri + React — same stack!):
- [x] Profile management (import URL, file, QR)
- [x] Real-time traffic stats (bandwidth chart)
- [x] Rule-based routing with visual editor
- [ ] Clash API compatibility (for ecosystem tools)
- [x] System tray with quick actions
- [x] Dark/light theme
- [x] Log viewer with filters (virtualized, level/keyword filter)
- [x] Speed test (with history)
- [ ] Connections list with real-time data
- [ ] Proxy group selector with latency test

**v2rayN** (C# WPF):
- [x] Server/profile management
- [x] Subscription import
- [ ] Routing settings UI
- [x] System proxy toggle
- [ ] PAC mode
- [x] Speed test history
- [ ] Server latency testing (ping all)
- [ ] Multi-server load balancing UI

**Hiddify** (Flutter):
- [ ] One-click setup (minimal configuration)
- [x] QR code scanning
- [ ] Auto-select best server
- [ ] Beautiful onboarding flow
- [ ] Cross-platform consistent UI

### Differentiators We Can Leverage
- **Tauri 2** — smaller binary, better native integration than Electron
- **Rust backend** — direct FFI to proxy core, no separate process needed
- **Integrated speed test** — protocol-level speed test, more accurate than HTTP-based
- **Built-in dashboard** — admin panel included, not a separate tool
- **Modern React 19** — concurrent rendering, transitions for smooth UX

---

## 1. prisma-gui Development Patterns

### Project Structure
```
prisma-gui/
├── src/
│   ├── pages/              # 6 route pages
│   │   ├── Home.tsx        # Connection status, speed graph, proxy modes, history
│   │   ├── Profiles.tsx    # Profile CRUD, search/sort, import/export QR/URI/JSON
│   │   ├── Rules.tsx       # Routing rules (DOMAIN/IP-CIDR/GEOIP/FINAL)
│   │   ├── Logs.tsx        # Virtualized log viewer, level/keyword filter
│   │   ├── SpeedTest.tsx   # Speed test with history chart
│   │   └── Settings.tsx    # Language, theme, ports, DNS, backup/restore
│   ├── components/
│   │   ├── ui/             # Radix UI wrappers (shadcn-style)
│   │   ├── wizard/         # 5-step profile creation wizard
│   │   ├── Sidebar.tsx     # Collapsible nav (localStorage state)
│   │   ├── BottomNav.tsx   # Mobile tab navigation
│   │   ├── StatusBar.tsx   # Live stats (↑↓ speed, transferred, uptime)
│   │   ├── SpeedGraph.tsx  # Recharts line chart (60-sample rolling)
│   │   ├── ProfileWizard.tsx # Multi-step form (Connection→Auth→Transport→Routing→Review)
│   │   ├── QrDisplay.tsx   # QR code SVG renderer
│   │   └── NotificationHistory.tsx
│   ├── hooks/
│   │   ├── usePrismaEvents.ts     # FFI events (status, stats, logs, updates)
│   │   ├── useConnection.ts       # Connect/disconnect wrapper
│   │   ├── useAutoReconnect.ts    # Auto-reconnect with delay/attempts
│   │   ├── useKeyboardShortcuts.ts # Cmd+1-6 nav, K toggle, N profiles
│   │   ├── useClipboardImport.ts  # Auto-detect prisma:// URIs
│   │   └── usePlatform.ts         # Platform detection
│   ├── store/
│   │   ├── index.ts               # Main store (connection, stats, profiles, logs)
│   │   ├── settings.ts            # AppSettings (persisted)
│   │   ├── notifications.ts       # Toast queue (max 50)
│   │   ├── profileMetrics.ts      # Per-profile stats (persisted)
│   │   ├── connectionHistory.ts   # Connect events (max 200, persisted)
│   │   ├── speedTestHistory.ts    # Speed test results (max 50, persisted)
│   │   ├── rules.ts               # Routing rules (persisted)
│   │   └── dataUsage.ts           # Daily usage tracking (90-day, persisted)
│   ├── lib/
│   │   ├── commands.ts      # Tauri invoke wrappers
│   │   ├── types.ts         # TypeScript interfaces
│   │   ├── buildConfig.ts   # Profile wizard → ClientConfig builder
│   │   ├── format.ts        # fmtBytes, fmtSpeed, fmtUptime, fmtRelativeTime
│   │   ├── utils.ts         # downloadJson, pickJsonFile, cn
│   │   └── constants.ts     # MODE_* flags, STATUS_* constants
│   ├── contexts/ThemeProvider.tsx  # Dark/light/system
│   └── i18n/                # en.json (~400 keys), zh-CN.json
├── src-tauri/
│   ├── src/
│   │   ├── main.rs         # Tauri entry + window management
│   │   ├── lib.rs          # FFI event callback bridge
│   │   ├── commands.rs     # Tauri command handlers
│   │   ├── state.rs        # AppState (tray handle, active profile)
│   │   └── tray.rs         # System tray setup, status icons, profile menu
│   └── tauri.conf.json     # Window config (820x640), plugins
└── package.json
```

### State Management (Zustand 5)

```typescript
// Pattern: Create focused stores, not one mega-store
// src/store/connectionStore.ts
import { create } from 'zustand';

interface ConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  profile: Profile | null;
  connect: (profile: Profile) => Promise<void>;
  disconnect: () => Promise<void>;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  status: 'disconnected',
  profile: null,
  connect: async (profile) => {
    set({ status: 'connecting', profile });
    try {
      await invoke('connect', { profile });
      set({ status: 'connected' });
    } catch (e) {
      set({ status: 'error' });
    }
  },
  disconnect: async () => {
    await invoke('disconnect');
    set({ status: 'disconnected', profile: null });
  },
}));

// For non-reactive reads (e.g., in event handlers):
const status = useConnectionStore.getState().status;
```

### IPC Patterns (Tauri Commands)

```typescript
// Frontend: invoke Tauri command
import { invoke } from '@tauri-apps/api/core';

// Type-safe invoke wrapper
async function connect(profile: Profile): Promise<ConnectionResult> {
  return invoke<ConnectionResult>('connect', { profile });
}

// Listen to events from Rust
import { listen } from '@tauri-apps/api/event';

useEffect(() => {
  const unlisten = listen<StatsPayload>('stats-update', (event) => {
    setStats(event.payload);
  });
  return () => { unlisten.then(fn => fn()); };
}, []);
```

```rust
// Backend: Tauri command handler (src-tauri/src/lib.rs)
#[tauri::command]
async fn connect(profile: Profile) -> Result<ConnectionResult, String> {
    // Call prisma-ffi functions
    Ok(result)
}
```

### Performance Patterns

```typescript
// 1. Virtualize long lists (connections, logs)
import { useVirtualizer } from '@tanstack/react-virtual';

// 2. Memoize expensive computations
const sortedConnections = useMemo(
  () => connections.sort((a, b) => b.bytesTotal - a.bytesTotal),
  [connections]
);

// 3. Debounce search/filter inputs
const [query, setQuery] = useState('');
const debouncedQuery = useDeferredValue(query); // React 19

// 4. Parallel IPC calls
const [status, metrics] = await Promise.all([
  invoke('get_status'),
  invoke('get_metrics'),
]);

// 5. Use getState() for non-reactive reads in callbacks
const handleClick = () => {
  const { status } = useConnectionStore.getState();
  if (status === 'connected') { /* ... */ }
};
```

### i18n Patterns

```typescript
// src/i18n/index.ts — already configured with i18next + react-i18next
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();
  return <h1>{t('dashboard.title')}</h1>;
}

// When adding new strings:
// 1. Add key to src/i18n/locales/en.json
// 2. Add translation to src/i18n/locales/zh.json
// 3. Use t('key') in components — NEVER hardcode user-visible strings
```

---

## 2. prisma-console Development Patterns

### Project Structure
```
prisma-console/
├── src/
│   ├── app/
│   │   ├── layout.tsx                # Root layout
│   │   ├── page.tsx                  # Redirects to /dashboard/
│   │   ├── login/page.tsx            # Token login
│   │   └── dashboard/
│   │       ├── page.tsx              # Overview (metrics cards, charts)
│   │       ├── servers/page.tsx      # Server/listener management
│   │       ├── clients/              # Client CRUD + detail views
│   │       ├── bandwidth/page.tsx    # Bandwidth monitoring & quotas
│   │       ├── system/page.tsx       # System info & resources
│   │       ├── logs/page.tsx         # Real-time log viewer (WebSocket)
│   │       ├── routing/page.tsx      # Routing rules management
│   │       ├── speed-test/page.tsx   # Speed test runner & history
│   │       ├── traffic-shaping/page.tsx
│   │       ├── backups/page.tsx      # Config backup/restore/diff
│   │       └── settings/page.tsx     # Security, TLS, alerts, config
│   ├── components/
│   │   ├── ui/           # shadcn/ui (20+ components)
│   │   ├── layout/       # sidebar, header, command-palette
│   │   ├── dashboard/    # metrics cards, traffic charts, histograms
│   │   ├── clients/      # client table/form/detail/bandwidth/quota
│   │   ├── settings/     # security/TLS/alerts/traffic-shaping forms
│   │   └── [feature]/    # feature-specific components
│   ├── hooks/            # TanStack Query hooks (~20 hooks)
│   └── lib/
│       ├── api.ts        # Full REST API client (30+ endpoints)
│       └── utils.ts      # Formatting, auth helpers
└── package.json
```

**Auth flow**: Bearer token → stored in localStorage → auto-clear on 401 → redirect to login
**Real-time**: WebSocket for metrics (1s) and logs (filtered server-side)
**Static export**: `output: "export"` — can be served by prisma server itself

### Data Fetching (TanStack Query)

```typescript
// Pattern: API hooks with TanStack Query
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Fetch with auto-refresh
export function useMetrics() {
  return useQuery({
    queryKey: ['metrics'],
    queryFn: () => fetch('/api/metrics').then(r => r.json()),
    refetchInterval: 2000, // real-time updates
  });
}

// Mutation with cache invalidation
export function useDisconnectClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) =>
      fetch(`/api/connections/${clientId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}
```

### WebSocket for Real-Time Data

```typescript
// For metrics and logs, use WebSocket endpoints from prisma-mgmt
// /api/ws/metrics — real-time metrics stream
// /api/ws/logs — real-time log stream

function useWebSocketMetrics() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    const ws = new WebSocket(`wss://${mgmtUrl}/api/ws/metrics`);
    ws.onmessage = (event) => {
      setMetrics(JSON.parse(event.data));
    };
    return () => ws.close();
  }, [mgmtUrl]);

  return metrics;
}
```

---

## 3. Component Design Guidelines

### Design System
- **Consistency** — use shadcn/ui patterns for both GUI and dashboard where possible
- **Dark mode first** — proxy users typically prefer dark themes
- **Density** — compact information density (like Clash Verge), not sparse layouts
- **Responsive** — dashboard must work on mobile; GUI has fixed window sizes
- **Animations** — subtle, functional animations (Tailwind animate / Framer Motion)

### Key UI Patterns for Proxy Clients

**Connection Status**
```
┌──────────────────────────────────┐
│ ● Connected  |  Server: tokyo-1  │
│ ↑ 12.3 MB/s  |  ↓ 45.6 MB/s    │
│ Latency: 23ms | Uptime: 2h 15m   │
└──────────────────────────────────┘
```

**Profile Card**
```
┌──────────────────────────────────┐
│ 🇯🇵 Tokyo Server                 │
│ QUIC v2 · ChaCha20 · 23ms       │
│ [Connect]  [Edit]  [Speed Test]  │
└──────────────────────────────────┘
```

**Traffic Chart** — real-time line chart (Recharts) showing upload/download bandwidth over time

**Connection List** — virtualized table showing all active connections with destination, bytes, duration, rule matched

---

## 4. Feature Implementation Recipes

### Recipe: Add a New Settings Page (GUI)
1. Create page component in `prisma-gui/src/pages/MySettings.tsx`
2. Add route in `App.tsx`
3. Add navigation item in sidebar/menu
4. Add i18n keys to both `en.json` and `zh.json`
5. Use Zustand store for local state, Tauri commands for persistence
6. Follow existing settings page patterns for form layout

### Recipe: Add a Dashboard Widget
1. Create component in `prisma-console/src/components/MyWidget.tsx`
2. Create TanStack Query hook in `src/hooks/useMyData.ts`
3. Add to relevant page layout
4. Style with Tailwind, use shadcn/ui patterns for cards/tables

### Recipe: Add Tauri IPC Command
1. Add Rust command in `prisma-gui/src-tauri/src/lib.rs`:
   ```rust
   #[tauri::command]
   async fn my_command(arg: String) -> Result<MyResponse, String> { ... }
   ```
2. Register in Tauri builder: `.invoke_handler(tauri::generate_handler![my_command, ...])`
3. Call from frontend: `await invoke<MyResponse>('my_command', { arg: 'value' })`

### Recipe: Add Real-Time Data Stream
1. **Server side:** Add broadcast channel in `ServerState`
2. **Management API:** Add WebSocket endpoint in `prisma-mgmt/src/router.rs`
3. **Dashboard:** Connect via WebSocket hook
4. **GUI:** Listen via Tauri event system (Rust backend polls mgmt API)

---

## 5. Accessibility & Usability

- **Keyboard navigation** — all interactive elements focusable, Tab order logical
- **System tray** — essential actions (connect/disconnect, switch profile) accessible from tray
- **Notifications** — OS-native notifications for connection status changes
- **Keyboard shortcuts** — global shortcuts for common actions (already has hook)
- **Error states** — always show actionable error messages, not technical stack traces
- **Loading states** — skeleton loaders for async data, not blank screens
- **Empty states** — helpful prompts when no data (e.g., "No profiles yet. Import one?")

---

## 6. Testing Frontend

### prisma-gui
```bash
cd prisma-gui && npm run build   # Type-check + build validation
```

### prisma-console
```bash
cd prisma-console && npm run lint   # ESLint
cd prisma-console && npm run build  # Full build
```

### Manual Testing Checklist
- [ ] All pages render without errors
- [ ] Dark/light theme switching works
- [ ] Language switching (EN/CN) works
- [ ] Connect/disconnect flow works
- [ ] Real-time stats update correctly
- [ ] System tray menu works
- [ ] Keyboard shortcuts work
- [ ] Window resize doesn't break layout
