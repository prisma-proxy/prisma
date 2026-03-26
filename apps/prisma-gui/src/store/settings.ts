import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AppSettings {
  language: "en" | "zh-CN";
  theme: "system" | "light" | "dark";
  startOnBoot: boolean;
  minimizeToTray: boolean;
  socks5Port: number;
  httpPort: number | null;
  dnsMode: "direct" | "fake" | "smart" | "tunnel";
  dnsUpstream: string;
  fakeIpRange: string;
  autoReconnect: boolean;
  reconnectDelaySecs: number;
  reconnectMaxAttempts: number;
  logLevel: "trace" | "debug" | "info" | "warn" | "error";
  logFormat: "pretty" | "json" | "compact";
  tunEnabled: boolean;
  tunDevice: string;
  tunMtu: number;
  tunIncludeRoutes: string;  // newline-separated CIDRs
  tunExcludeRoutes: string;  // newline-separated CIDRs
  portForwards: string;      // "name,local_addr,remote_port" per line
  routingGeoipPath: string;
  routingGeositePath: string;
  allowLan: boolean;
  connectionPoolEnabled: boolean;
  connectionMode: "proxy" | "vpn";
  splitTunnelProxy: string[];   // domains/apps routed through proxy
  splitTunnelDirect: string[];  // domains/apps that bypass proxy
  proxyModes: number;           // bitmask: SOCKS5=0x01, SYSTEM_PROXY=0x02, TUN=0x04, PER_APP=0x08
}

interface SettingsStore extends AppSettings {
  patch: (values: Partial<AppSettings>) => void;
  setProxyModes: (v: number) => void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      language: "en",
      theme: "system",
      startOnBoot: false,
      minimizeToTray: true,
      socks5Port: 0,
      httpPort: 8080,
      dnsMode: "direct",
      dnsUpstream: "8.8.8.8:53",
      fakeIpRange: "198.18.0.0/15",
      autoReconnect: false,
      reconnectDelaySecs: 5,
      reconnectMaxAttempts: 5,
      logLevel: "info",
      logFormat: "pretty",
      tunEnabled: false,
      tunDevice: "prisma-tun0",
      tunMtu: 1500,
      tunIncludeRoutes: "",
      tunExcludeRoutes: "",
      portForwards: "",
      routingGeoipPath: "",
      routingGeositePath: "",
      allowLan: false,
      connectionPoolEnabled: false,
      connectionMode: "proxy",
      splitTunnelProxy: [],
      splitTunnelDirect: [],
      proxyModes: 0x02, // System proxy by default
      patch: (values) => {
        const clamped = { ...values };
        if (clamped.socks5Port !== undefined) {
          clamped.socks5Port = Math.max(0, Math.min(65535, clamped.socks5Port));
        }
        if (clamped.httpPort !== undefined && clamped.httpPort !== null) {
          clamped.httpPort = Math.max(1, Math.min(65535, clamped.httpPort));
        }
        set(clamped);
      },
      setProxyModes: (v) => set({ proxyModes: v }),
    }),
    { name: "prisma-settings" }
  )
);
