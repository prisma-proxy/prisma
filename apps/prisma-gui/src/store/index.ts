import { create } from "zustand";
import type { Stats, Profile, LogEntry, SpeedTestResult, UpdateInfo } from "../lib/types";

interface PrismaStore {
  // Connection
  connected: boolean;
  connecting: boolean;
  activeProfileIdx: number | null;
  activeProfileJson: string;
  manualDisconnect: boolean;
  connectStartTime: number | null;

  // Stats
  stats: Stats | null;
  speedSamplesUp: number[];
  speedSamplesDown: number[];

  // Data
  profiles: Profile[];
  logs: LogEntry[];

  // Update
  updateAvailable: UpdateInfo | null;
  updateProgress: number | null;
  updatePhase: "downloading" | "installing" | "done" | null;

  // Speed test
  speedTestRunning: boolean;
  speedTestResult: SpeedTestResult | null;

  // Setters
  setConnected: (v: boolean) => void;
  setConnecting: (v: boolean) => void;
  setActiveProfileIdx: (idx: number | null) => void;
  setActiveProfileJson: (json: string) => void;
  setManualDisconnect: (v: boolean) => void;
  setConnectStartTime: (t: number | null) => void;
  setStats: (s: Stats) => void;
  setProfiles: (p: Profile[]) => void;
  addLog: (entry: LogEntry) => void;
  addLogs: (entries: LogEntry[]) => void;
  clearLogs: () => void;
  setUpdateAvailable: (info: UpdateInfo | null) => void;
  setUpdateProgress: (p: number | null) => void;
  setUpdatePhase: (phase: "downloading" | "installing" | "done" | null) => void;
  setSpeedTestRunning: (v: boolean) => void;
  setSpeedTestResult: (r: SpeedTestResult | null) => void;
}

const MAX_SPEED_SAMPLES = 60;
const MAX_LOGS = 500;

export const useStore = create<PrismaStore>((set) => ({
  connected: false,
  connecting: false,
  activeProfileIdx: null,
  activeProfileJson: "",
  manualDisconnect: false,
  connectStartTime: null,

  stats: null,
  speedSamplesUp: [],
  speedSamplesDown: [],

  profiles: [],
  logs: [],

  updateAvailable: null,
  updateProgress: null,
  updatePhase: null,

  speedTestRunning: false,
  speedTestResult: null,

  setConnected:  (v) => set({ connected: v, connecting: false }),
  setConnecting: (v) => set({ connecting: v }),
  setActiveProfileIdx:  (idx)  => set({ activeProfileIdx: idx }),
  setActiveProfileJson: (json) => set({ activeProfileJson: json }),
  setManualDisconnect:  (v)    => set({ manualDisconnect: v }),
  setConnectStartTime:  (t)    => set({ connectStartTime: t }),

  setStats: (s) =>
    set((state) => {
      const up = state.speedSamplesUp.length >= MAX_SPEED_SAMPLES
        ? state.speedSamplesUp.slice(1)
        : [...state.speedSamplesUp];
      up.push(s.speed_up_bps / 1e6);
      const down = state.speedSamplesDown.length >= MAX_SPEED_SAMPLES
        ? state.speedSamplesDown.slice(1)
        : [...state.speedSamplesDown];
      down.push(s.speed_down_bps / 1e6);
      return { stats: s, speedSamplesUp: up, speedSamplesDown: down };
    }),

  setProfiles: (p) => set({ profiles: p }),

  addLog: (entry) =>
    set((state) => {
      const logs = state.logs.length >= MAX_LOGS
        ? state.logs.slice(1)
        : [...state.logs];
      logs.push(entry);
      return { logs };
    }),

  addLogs: (entries) =>
    set((state) => {
      if (entries.length === 0) return state;
      const trim = Math.max(0, state.logs.length + entries.length - MAX_LOGS);
      const logs = trim > 0 ? state.logs.slice(trim) : [...state.logs];
      logs.push(...entries);
      return { logs };
    }),

  clearLogs: () => set({ logs: [] }),

  setUpdateAvailable: (info) => set({ updateAvailable: info }),
  setUpdateProgress:  (p)       => set({ updateProgress: p }),
  setUpdatePhase:     (phase)   => set({ updatePhase: phase }),

  setSpeedTestRunning: (v) => set({ speedTestRunning: v }),
  setSpeedTestResult:  (r) => set({ speedTestResult: r, speedTestRunning: false }),
}));
