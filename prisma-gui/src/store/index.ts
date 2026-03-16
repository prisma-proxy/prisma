import { create } from "zustand";
import type { Stats, Profile, LogEntry, SpeedTestResult } from "../lib/types";

interface PrismaStore {
  // Connection
  connected: boolean;
  connecting: boolean;
  proxyModes: number;
  activeProfileIdx: number | null;
  activeProfileJson: string;
  manualDisconnect: boolean;

  // Stats
  stats: Stats | null;
  speedSamplesUp: number[];
  speedSamplesDown: number[];

  // Data
  profiles: Profile[];
  logs: LogEntry[];

  // Update
  updateAvailable: string | null;
  updateProgress: number | null;

  // Speed test
  speedTestRunning: boolean;
  speedTestResult: SpeedTestResult | null;

  // Setters
  setConnected: (v: boolean) => void;
  setConnecting: (v: boolean) => void;
  setProxyModes: (v: number) => void;
  setActiveProfileIdx: (idx: number | null) => void;
  setActiveProfileJson: (json: string) => void;
  setManualDisconnect: (v: boolean) => void;
  setStats: (s: Stats) => void;
  setProfiles: (p: Profile[]) => void;
  addLog: (entry: LogEntry) => void;
  clearLogs: () => void;
  setUpdateAvailable: (version: string | null) => void;
  setUpdateProgress: (p: number | null) => void;
  setSpeedTestRunning: (v: boolean) => void;
  setSpeedTestResult: (r: SpeedTestResult | null) => void;
}

const MAX_SPEED_SAMPLES = 60;
const MAX_LOGS = 500;

export const useStore = create<PrismaStore>((set) => ({
  connected: false,
  connecting: false,
  proxyModes: 0x01, // SOCKS5 by default
  activeProfileIdx: null,
  activeProfileJson: "",
  manualDisconnect: false,

  stats: null,
  speedSamplesUp: [],
  speedSamplesDown: [],

  profiles: [],
  logs: [],

  updateAvailable: null,
  updateProgress: null,

  speedTestRunning: false,
  speedTestResult: null,

  setConnected:  (v) => set({ connected: v, connecting: false }),
  setConnecting: (v) => set({ connecting: v }),
  setProxyModes: (v) => set({ proxyModes: v }),
  setActiveProfileIdx:  (idx)  => set({ activeProfileIdx: idx }),
  setActiveProfileJson: (json) => set({ activeProfileJson: json }),
  setManualDisconnect:  (v)    => set({ manualDisconnect: v }),

  setStats: (s) =>
    set((state) => ({
      stats: s,
      speedSamplesUp: [
        ...state.speedSamplesUp.slice(-(MAX_SPEED_SAMPLES - 1)),
        s.speed_up_bps / 1e6,
      ],
      speedSamplesDown: [
        ...state.speedSamplesDown.slice(-(MAX_SPEED_SAMPLES - 1)),
        s.speed_down_bps / 1e6,
      ],
    })),

  setProfiles: (p) => set({ profiles: p }),

  addLog: (entry) =>
    set((state) => ({
      logs: [...state.logs.slice(-(MAX_LOGS - 1)), entry],
    })),

  clearLogs: () => set({ logs: [] }),

  setUpdateAvailable: (version) => set({ updateAvailable: version }),
  setUpdateProgress:  (p)       => set({ updateProgress: p }),

  setSpeedTestRunning: (v) => set({ speedTestRunning: v }),
  setSpeedTestResult:  (r) => set({ speedTestResult: r, speedTestRunning: false }),
}));
