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
}

const MetricsContext = createContext<MetricsState | null>(null);

export function MetricsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MetricsState>({
    current: null,
    history: [],
    connected: false,
  });
  const wsRef = useRef<ReturnType<typeof createWebSocket> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let wsConnected = false;

    wsRef.current = createWebSocket<MetricsSnapshot>(
      "/api/ws/metrics",
      (snapshot) => {
        wsConnected = true;
        // Stop REST fallback polling once WebSocket is working
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        setState((prev) => {
          const history = [...prev.history.slice(-(MAX_HISTORY - 1)), snapshot];
          return { current: snapshot, history, connected: true };
        });
      },
      () => {
        // WebSocket error — start REST fallback polling if not already running
        wsConnected = false;
        setState((prev) => ({ ...prev, connected: false }));
        if (!pollRef.current) {
          pollRef.current = setInterval(async () => {
            try {
              const snapshot = await api.getMetrics();
              setState((prev) => {
                const history = [...prev.history.slice(-(MAX_HISTORY - 1)), snapshot];
                return { current: snapshot, history, connected: true };
              });
            } catch {
              // API also unavailable — stay in disconnected state
            }
          }, 2000);
        }
      }
    );

    return () => {
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
