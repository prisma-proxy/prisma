import { create } from "zustand";
import { persist } from "zustand/middleware";

interface DailyUsage {
  up: number;
  down: number;
}

interface DataUsageStore {
  daily: Record<string, DailyUsage>;
  recordUsage: (bytesUp: number, bytesDown: number) => void;
  clear: () => void;
  getToday: () => DailyUsage;
  getWeek: () => DailyUsage;
  getMonth: () => DailyUsage;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoKey(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function sumRange(daily: Record<string, DailyUsage>, days: number): DailyUsage {
  let up = 0;
  let down = 0;
  for (let i = 0; i < days; i++) {
    const key = daysAgoKey(i);
    const entry = daily[key];
    if (entry) {
      up += entry.up;
      down += entry.down;
    }
  }
  return { up, down };
}

/** Remove entries older than 90 days. */
function pruneOldEntries(daily: Record<string, DailyUsage>): Record<string, DailyUsage> {
  const cutoff = daysAgoKey(90);
  const pruned: Record<string, DailyUsage> = {};
  for (const [k, v] of Object.entries(daily)) {
    if (k >= cutoff) pruned[k] = v;
  }
  return pruned;
}

// Batch pending deltas to avoid per-second persist writes.
let pendingUp = 0;
let pendingDown = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushPending() {
  flushTimer = null;
  if (pendingUp === 0 && pendingDown === 0) return;
  const up = pendingUp;
  const down = pendingDown;
  pendingUp = 0;
  pendingDown = 0;
  useDataUsage.setState((state) => {
    const key = todayKey();
    const prev = state.daily[key] ?? { up: 0, down: 0 };
    return {
      daily: { ...state.daily, [key]: { up: prev.up + up, down: prev.down + down } },
    };
  });
}

export const useDataUsage = create<DataUsageStore>()(
  persist(
    (set, get) => ({
      daily: {},

      recordUsage: (bytesUp, bytesDown) => {
        pendingUp += bytesUp;
        pendingDown += bytesDown;
        if (!flushTimer) {
          flushTimer = setTimeout(flushPending, 10_000); // flush every 10s
        }
      },

      clear: () => set({ daily: {} }),

      getToday: () => {
        const key = todayKey();
        return get().daily[key] ?? { up: 0, down: 0 };
      },

      getWeek: () => sumRange(get().daily, 7),

      getMonth: () => sumRange(get().daily, 30),
    }),
    {
      name: "prisma-data-usage",
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.daily = pruneOldEntries(state.daily);
        }
      },
    }
  )
);
