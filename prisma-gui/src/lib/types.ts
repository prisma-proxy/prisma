export interface Profile {
  id: string;
  name: string;
  tags: string[];
  created_at: string;
  config: unknown;
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
