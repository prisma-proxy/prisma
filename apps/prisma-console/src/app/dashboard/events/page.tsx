"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Activity } from "lucide-react";
import { useEvents, type EventType } from "@/hooks/use-events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/loading-placeholder";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 32;

const typeColors: Record<EventType, string> = {
  connect: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",
  disconnect: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  error: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
};

const typeLabelsKey: Record<EventType, string> = {
  connect: "events.connect",
  disconnect: "events.disconnect",
  error: "events.error",
};

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

export default function EventsPage() {
  const { t } = useI18n();
  const { events, filter, setFilter, connectionStatus, clearEvents } = useEvents();

  const [showNoEventsHint, setShowNoEventsHint] = useState(false);
  useEffect(() => {
    if (connectionStatus === "connected" && events.length === 0) {
      const timer = setTimeout(() => setShowNoEventsHint(true), 5000);
      return () => clearTimeout(timer);
    }
    setShowNoEventsHint(false);
  }, [connectionStatus, events.length]);

  // Virtualizer
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 30,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleScroll() {
      if (!container) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 40;
    }

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (shouldAutoScroll.current && events.length > 0) {
      virtualizer.scrollToIndex(events.length - 1, { align: "end" });
    }
  }, [events.length, virtualizer]);

  const handleTypeChange = useCallback(
    (type: EventType | "all") => {
      setFilter({ ...filter, type });
    },
    [filter, setFilter],
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFilter({ ...filter, search: e.target.value });
    },
    [filter, setFilter],
  );

  return (
    <div className="flex h-full flex-col space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Type filter */}
          <div className="flex items-center gap-1">
            {(["all", "connect", "disconnect", "error"] as const).map((type) => (
              <Button
                key={type}
                variant={(!filter.type && type === "all") || filter.type === type ? "default" : "outline"}
                size="sm"
                onClick={() => handleTypeChange(type)}
              >
                {t(`events.${type}`)}
              </Button>
            ))}
          </div>
          {/* Search */}
          <Input
            placeholder={t("common.search")}
            value={filter.search ?? ""}
            onChange={handleSearchChange}
            className="w-48 h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status" aria-live="polite">
            <span
              className={cn(
                "inline-block h-2 w-2 rounded-full",
                connectionStatus === "connected" && "bg-green-500",
                connectionStatus === "disconnected" && "bg-red-500",
                (connectionStatus === "connecting" || connectionStatus === "reconnecting") &&
                  "bg-yellow-500 animate-pulse",
              )}
              aria-hidden="true"
            />
            {connectionStatus === "connected"
              ? t("logs.wsConnected")
              : connectionStatus === "disconnected"
                ? t("logs.wsDisconnected")
                : connectionStatus === "reconnecting"
                  ? t("logs.wsReconnecting")
                  : t("logs.wsConnecting")}
          </span>
          {events.length > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {events.length.toLocaleString()} {t("common.entries")}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={clearEvents}>
            {t("events.clear")}
          </Button>
        </div>
      </div>

      {/* Event list */}
      <div className="flex-1 min-h-0">
        {events.length === 0 ? (
          <EmptyState
            icon={Activity}
            title={t("events.noEvents")}
            description={showNoEventsHint ? t("events.noEventsHint") : t("empty.noEventsHint")}
          />
        ) : (
          <div
            ref={containerRef}
            className="overflow-y-auto h-[calc(100vh-260px)] min-h-[300px] rounded-lg border bg-card p-1 font-mono text-xs"
          >
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const event = events[virtualRow.index];
                const colorClass = typeColors[event.type];
                return (
                  <div
                    key={event._id}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="flex items-center gap-2 px-2 py-0.5 rounded transition-colors hover:bg-muted/50"
                  >
                    {/* Type badge */}
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center justify-center rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none uppercase",
                        colorClass,
                      )}
                    >
                      {t(typeLabelsKey[event.type])}
                    </span>
                    {/* Timestamp */}
                    <span className="shrink-0 tabular-nums text-muted-foreground/70 select-none">
                      {formatTimestamp(event.timestamp)}
                    </span>
                    {/* Client name */}
                    {event.client_name && (
                      <span className="shrink-0 text-primary/80 max-w-[100px] truncate">
                        {event.client_name}
                      </span>
                    )}
                    {/* Peer addr */}
                    <span className="shrink-0 text-foreground/90">{event.peer_addr}</span>
                    {/* Destination */}
                    {event.destination && (
                      <span className="shrink-0 text-muted-foreground/60 max-w-[200px] truncate">
                        {event.destination}
                      </span>
                    )}
                    {/* Transport */}
                    {event.transport && (
                      <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                        {event.transport}
                      </span>
                    )}
                    {/* Duration */}
                    {event.duration_secs != null && event.type === "disconnect" && (
                      <span className="shrink-0 text-muted-foreground/50 text-[10px]">
                        {event.duration_secs.toFixed(1)}s
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
