import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ProfileMetrics {
  lastLatencyMs: number | null;
  lastConnectedAt: string | null;
  totalBytesUp: number;
  totalBytesDown: number;
  connectCount: number;
}

interface ProfileMetricsStore {
  metrics: Record<string, ProfileMetrics>;
  recordConnect: (profileId: string, latencyMs: number) => void;
  recordDisconnect: (profileId: string, bytesUp: number, bytesDown: number) => void;
  getMetrics: (profileId: string) => ProfileMetrics;
}

const EMPTY: ProfileMetrics = {
  lastLatencyMs: null,
  lastConnectedAt: null,
  totalBytesUp: 0,
  totalBytesDown: 0,
  connectCount: 0,
};

export const useProfileMetrics = create<ProfileMetricsStore>()(
  persist(
    (set, get) => ({
      metrics: {},

      recordConnect: (profileId, latencyMs) =>
        set((state) => {
          const prev = state.metrics[profileId] ?? { ...EMPTY };
          return {
            metrics: {
              ...state.metrics,
              [profileId]: {
                ...prev,
                lastLatencyMs: latencyMs,
                lastConnectedAt: new Date().toISOString(),
                connectCount: prev.connectCount + 1,
              },
            },
          };
        }),

      recordDisconnect: (profileId, bytesUp, bytesDown) =>
        set((state) => {
          const prev = state.metrics[profileId] ?? { ...EMPTY };
          return {
            metrics: {
              ...state.metrics,
              [profileId]: {
                ...prev,
                totalBytesUp: prev.totalBytesUp + bytesUp,
                totalBytesDown: prev.totalBytesDown + bytesDown,
              },
            },
          };
        }),

      getMetrics: (profileId) => get().metrics[profileId] ?? { ...EMPTY },
    }),
    { name: "prisma-profile-metrics" }
  )
);
