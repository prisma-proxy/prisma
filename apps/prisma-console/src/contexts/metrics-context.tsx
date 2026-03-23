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

const MAX_HISTORY = 120; // 2 minutes at 1s intervals

interface MetricsState {
  current: MetricsSnapshot | null;
  history: MetricsSnapshot[];
}

const MetricsContext = createContext<MetricsState | null>(null);

export function MetricsProvider({ children }: { children: ReactNode }) {
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
