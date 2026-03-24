"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { MetricsSnapshot } from "@/lib/types";
import { createWebSocket } from "@/lib/ws";
import { api } from "@/lib/api";

const MAX_HISTORY = 120; // 2 minutes at 1s intervals

interface MetricsState {
  current: MetricsSnapshot | null;
  history: MetricsSnapshot[];
  connected: boolean;
  /** True during the initial grace period (first 3s) to suppress error banner. */
  loading: boolean;
}

const MetricsContext = createContext<MetricsState | null>(null);

export function MetricsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MetricsState>({
    current: null,
    history: [],
    connected: false,
    loading: true,
  });
  const wsRef = useRef<ReturnType<typeof createWebSocket> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Grace period: suppress error banner for first 3 seconds
    const graceTimer = setTimeout(() => {
      setState((prev) => ({ ...prev, loading: false }));
    }, 3000);

    // Start REST polling immediately as a fallback safety net.
    // If the WebSocket connects, this polling is stopped.
    pollRef.current = setInterval(async () => {
      try {
        const snapshot = await api.getMetrics();
        setState((prev) => {
          const history = [...prev.history.slice(-(MAX_HISTORY - 1)), snapshot];
          return { current: snapshot, history, connected: true, loading: false };
        });
      } catch {
        // API unavailable — stay in current state
      }
    }, 2000);

    // WebSocket for real-time metrics (preferred over REST polling)
    wsRef.current = createWebSocket<MetricsSnapshot>(
      "/api/ws/metrics",
      (snapshot) => {
        // WS is working — stop REST polling
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        setState((prev) => {
          const history = [...prev.history.slice(-(MAX_HISTORY - 1)), snapshot];
          return { current: snapshot, history, connected: true, loading: false };
        });
      }
    );

    return () => {
      clearTimeout(graceTimer);
      wsRef.current?.close();
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, []);

  return (
    <MetricsContext.Provider value={state}>
      {children}
    </MetricsContext.Provider>
  );
}

export function useMetricsContext(): MetricsState {
  const ctx = useContext(MetricsContext);
  if (!ctx) throw new Error("useMetricsContext must be used within MetricsProvider");
  return ctx;
}
