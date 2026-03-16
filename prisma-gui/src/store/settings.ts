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
}

interface SettingsStore extends AppSettings {
  patch: (values: Partial<AppSettings>) => void;
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
      patch: (values) => set(values),
    }),
    { name: "prisma-settings" }
  )
);
