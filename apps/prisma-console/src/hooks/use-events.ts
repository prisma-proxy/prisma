"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createWebSocket, type WSStatus } from "@/lib/ws";

const MAX_EVENTS = 1000;

let eventIdCounter = 0;

export type EventType = "connect" | "disconnect" | "error";

export interface ConnectionEvent {
  _id: number;
  timestamp: string;
  type: EventType;
  client_name?: string;
  peer_addr: string;
  destination?: string;
  transport?: string;
  matched_rule?: string;
  duration_secs?: number;
}

type RawEvent = Omit<ConnectionEvent, "_id">;

interface EventFilter {
  type?: EventType | "all";
  search?: string;
}

export function useEvents() {
  const [allEvents, setAllEvents] = useState<ConnectionEvent[]>([]);
  const [filter, setFilter] = useState<EventFilter>({});
  const [connectionStatus, setConnectionStatus] = useState<WSStatus>("connecting");
  const wsRef = useRef<ReturnType<typeof createWebSocket> | null>(null);

  const clearEvents = useCallback(() => {
    setAllEvents([]);
  }, []);

  useEffect(() => {
    wsRef.current = createWebSocket<RawEvent>(
      "/api/ws/events",
      (raw) => {
        const event: ConnectionEvent = { ...raw, _id: ++eventIdCounter };
        setAllEvents((prev) => {
          if (prev.length >= MAX_EVENTS) {
            const trimmed = prev.slice(-(MAX_EVENTS - 1));
            trimmed.push(event);
            return trimmed;
          }
          return [...prev, event];
        });
      },
      undefined,
      setConnectionStatus,
    );

    return () => {
      wsRef.current?.close();
    };
  }, []);

  const events = useMemo(() => {
    const typeFilter = filter.type && filter.type !== "all" ? filter.type : null;
    const searchLower = filter.search?.toLowerCase() ?? "";

    if (!typeFilter && !searchLower) return allEvents;

    return allEvents.filter((event) => {
      if (typeFilter && event.type !== typeFilter) return false;
      if (searchLower) {
        const haystack = `${event.peer_addr} ${event.destination ?? ""} ${event.client_name ?? ""}`.toLowerCase();
        if (!haystack.includes(searchLower)) return false;
      }
      return true;
    });
  }, [allEvents, filter]);

  return { events, filter, setFilter, connectionStatus, clearEvents };
}
