"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { LogEntry } from "@/lib/types";
import { createWebSocket } from "@/lib/ws";

const MAX_LOGS = 10000;

let logIdCounter = 0;

export interface LogEntryWithId extends LogEntry {
  _id: number;
}

export function useLogs() {
  const [logs, setLogs] = useState<LogEntryWithId[]>([]);
  const wsRef = useRef<ReturnType<typeof createWebSocket> | null>(null);

  const setFilter = useCallback((filter: { level?: string; target?: string }) => {
    wsRef.current?.send(filter);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  useEffect(() => {
    wsRef.current = createWebSocket<LogEntry>(
      "/api/ws/logs",
      (entry) => {
        const entryWithId: LogEntryWithId = { ...entry, _id: ++logIdCounter };
        setLogs((prev) => {
          if (prev.length >= MAX_LOGS) {
            // Trim from front, append to end — single slice instead of spread + slice
            const trimmed = prev.slice(-(MAX_LOGS - 1));
            trimmed.push(entryWithId);
            return trimmed;
          }
          return [...prev, entryWithId];
        });
      }
    );

    return () => {
      wsRef.current?.close();
    };
  }, []);

  return { logs, setFilter, clearLogs };
}
