"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MetricsSnapshot } from "@/lib/types";
import { createWebSocket } from "@/lib/ws";
import { api } from "@/lib/api";

const MAX_HISTORY = 120; // 2 minutes at 1s intervals

interface MetricsState {
  current: MetricsSnapshot | null;
  history: MetricsSnapshot[];
}

export function useMetrics() {
  const [state, setState] = useState<MetricsState>({ current: null, history: [] });
  const wsRef = useRef<ReturnType<typeof createWebSocket> | null>(null);

  useEffect(() => {
    wsRef.current = createWebSocket<MetricsSnapshot>(
      "/api/ws/metrics",
      (snapshot) => {
        setState((prev) => {
          const history = [...prev.history.slice(-(MAX_HISTORY - 1)), snapshot];
          return { current: snapshot, history };
        });
      }
    );

    return () => {
      wsRef.current?.close();
    };
  }, []);

  return state;
}

export type TimeRange = "1h" | "3h" | "6h" | "12h" | "24h" | "3d" | "7d" | "14d" | "30d";
export type Resolution = "1s" | "10s" | "30s" | "60s" | "120s" | "300s" | "900s" | "1800s" | "3600s" | "7200s";

export function useMetricsHistory(period: TimeRange = "1h", resolution: Resolution = "10s") {
  return useQuery({
    queryKey: ["metrics-history", period, resolution],
    queryFn: () => api.getMetricsHistory(period, resolution),
    refetchInterval: 30000,
  });
}

export function computeRateMbps(snapshots: MetricsSnapshot[]) {
  if (snapshots.length < 2) return [];
  return snapshots.slice(1).map((s, i) => {
    const prev = snapshots[i];
    const dt = (new Date(s.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;
    if (dt <= 0) return { timestamp: s.timestamp, uploadMbps: 0, downloadMbps: 0 };
    const uploadMbps = ((s.total_bytes_up - prev.total_bytes_up) * 8) / (dt * 1_000_000);
    const downloadMbps = ((s.total_bytes_down - prev.total_bytes_down) * 8) / (dt * 1_000_000);
    return { timestamp: s.timestamp, uploadMbps, downloadMbps };
  });
}
