import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SpeedTestEntry {
  id: string;
  timestamp: number;
  server: string;
  downloadMbps: number;
  uploadMbps: number;
  latencyMs: number;
  viaProxy: boolean;
}

interface SpeedTestHistoryStore {
  entries: SpeedTestEntry[];
  add: (entry: SpeedTestEntry) => void;
  clear: () => void;
}

const MAX_ENTRIES = 50;

export const useSpeedTestHistory = create<SpeedTestHistoryStore>()(
  persist(
    (set) => ({
      entries: [],

      add: (entry) =>
        set((state) => ({
          entries: [...state.entries.slice(-(MAX_ENTRIES - 1)), entry],
        })),

      clear: () => set({ entries: [] }),
    }),
    { name: "prisma-speed-test-history" }
  )
);
