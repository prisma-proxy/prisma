"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import type { ConnectionInfo } from "@/lib/types";

const MAX_EVENTS = 500;
const POLL_INTERVAL = 5000;

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

interface EventFilter {
  type?: EventType | "all";
  search?: string;
}

export function useEvents() {
  const [allEvents, setAllEvents] = useState<ConnectionEvent[]>([]);
  const [filter, setFilter] = useState<EventFilter>({});
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const prevConnectionsRef = useRef<Map<string, ConnectionInfo>>(new Map());

  const clearEvents = useCallback(() => {
    setAllEvents([]);
  }, []);

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const connections = await api.getConnections();
        if (!active) return;

        setConnectionStatus("connected");
        const currentMap = new Map(connections.map((c) => [c.session_id, c]));
        const prevMap = prevConnectionsRef.current;

        const newEvents: ConnectionEvent[] = [];

        // Detect new connections (connect events)
        for (const [id, conn] of currentMap) {
          if (!prevMap.has(id)) {
            newEvents.push({
              _id: ++eventIdCounter,
              timestamp: conn.connected_at || new Date().toISOString(),
              type: "connect",
              client_name: conn.client_name ?? undefined,
              peer_addr: conn.peer_addr,
              destination: conn.destination,
              transport: conn.transport,
              matched_rule: conn.matched_rule,
            });
          }
        }

        // Detect removed connections (disconnect events)
        for (const [id, conn] of prevMap) {
          if (!currentMap.has(id)) {
            newEvents.push({
              _id: ++eventIdCounter,
              timestamp: new Date().toISOString(),
              type: "disconnect",
              client_name: conn.client_name ?? undefined,
              peer_addr: conn.peer_addr,
              destination: conn.destination,
              transport: conn.transport,
              duration_secs: conn.duration_secs,
            });
          }
        }

        prevConnectionsRef.current = currentMap;

        if (newEvents.length > 0) {
          setAllEvents((prev) => {
            const updated = [...prev, ...newEvents];
            return updated.length > MAX_EVENTS ? updated.slice(-MAX_EVENTS) : updated;
          });
        }
      } catch {
        if (active) setConnectionStatus("disconnected");
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL);
    return () => { active = false; clearInterval(interval); };
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
