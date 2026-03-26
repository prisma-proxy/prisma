export interface Profile {
  id: string;
  name: string;
  tags: string[];
  created_at: string;
  config: unknown;
  subscription_url?: string;
  last_updated?: string;
}

export interface ImportResult {
  count: number;
  profiles: Profile[];
}

export interface Stats {
  bytes_up: number;
  bytes_down: number;
  speed_up_bps: number;
  speed_down_bps: number;
  uptime_secs: number;
}

export interface UpdateInfo {
  version: string;
  url: string;
  changelog: string;
  sha?: string;
}

export interface LogEntry {
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  msg: string;
  time: number;
}

export interface SpeedTestResult {
  download_mbps: number;
  upload_mbps: number;
}

// FFI status codes (must match prisma-ffi constants)
export const STATUS_DISCONNECTED = 0;
export const STATUS_CONNECTING   = 1;
export const STATUS_CONNECTED    = 2;
export const STATUS_ERROR        = 3;

// Proxy mode flags (must match prisma-ffi constants)
export const MODE_SOCKS5       = 0x01;
export const MODE_SYSTEM_PROXY = 0x02;
export const MODE_TUN          = 0x04;
export const MODE_PER_APP      = 0x08;

// Per-app proxy filter
export interface PerAppFilter {
  mode: "include" | "exclude";
  apps: string[];
}

// Battery status (mobile)
export interface BatteryStatus {
  level: number;    // 0-100, or -1 if unknown
  charging: boolean;
  low_power_mode: boolean;
}

// Network type constants (match prisma-ffi)
export const NET_DISCONNECTED = 0;
export const NET_WIFI         = 1;
export const NET_CELLULAR     = 2;
export const NET_ETHERNET     = 3;

// ── Subscription types ────────────────────────────────────────────────────────

export interface SubscriptionInfo {
  url: string;
  profileCount: number;
  lastUpdated: string | null;
  profiles: Profile[];
}
