import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ProfileMetrics {
  lastLatencyMs: number | null;
  lastConnectedAt: string | null;
  totalBytesUp: number;
  totalBytesDown: number;
  connectCount: number;
  totalUptimeSecs: number;
  lastSessionSecs: number;
  peakSpeedDownBps: number;
  peakSpeedUpBps: number;
}

interface ProfileMetricsStore {
  metrics: Record<string, ProfileMetrics>;
  recordConnect: (profileId: string, latencyMs: number) => void;
  recordDisconnect: (profileId: string, bytesUp: number, bytesDown: number, uptimeSecs: number) => void;
  recordPeakSpeed: (profileId: string, downBps: number, upBps: number) => void;
  getMetrics: (profileId: string) => ProfileMetrics;
}

const EMPTY: ProfileMetrics = {
  lastLatencyMs: null,
  lastConnectedAt: null,
  totalBytesUp: 0,
  totalBytesDown: 0,
  connectCount: 0,
  totalUptimeSecs: 0,
  lastSessionSecs: 0,
  peakSpeedDownBps: 0,
  peakSpeedUpBps: 0,
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

      recordDisconnect: (profileId, bytesUp, bytesDown, uptimeSecs) =>
        set((state) => {
          const prev = state.metrics[profileId] ?? { ...EMPTY };
          return {
            metrics: {
              ...state.metrics,
              [profileId]: {
                ...prev,
                totalBytesUp: prev.totalBytesUp + bytesUp,
                totalBytesDown: prev.totalBytesDown + bytesDown,
                totalUptimeSecs: prev.totalUptimeSecs + uptimeSecs,
                lastSessionSecs: uptimeSecs,
              },
            },
          };
        }),

      recordPeakSpeed: (profileId, downBps, upBps) =>
        set((state) => {
          const prev = state.metrics[profileId] ?? { ...EMPTY };
          const newDown = Math.max(prev.peakSpeedDownBps, downBps);
          const newUp = Math.max(prev.peakSpeedUpBps, upBps);
          if (newDown === prev.peakSpeedDownBps && newUp === prev.peakSpeedUpBps) {
            return state; // no change
          }
          return {
            metrics: {
              ...state.metrics,
              [profileId]: {
                ...prev,
                peakSpeedDownBps: newDown,
                peakSpeedUpBps: newUp,
              },
            },
          };
        }),

      getMetrics: (profileId) => get().metrics[profileId] ?? { ...EMPTY },
    }),
    { name: "prisma-profile-metrics" }
  )
);
