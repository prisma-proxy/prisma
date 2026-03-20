"use client";

import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { LogEntryWithId } from "@/hooks/use-logs";

interface LogViewerProps {
  logs: LogEntryWithId[];
}

const levelColors: Record<string, string> = {
  ERROR: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  WARN: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  INFO: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  DEBUG: "bg-gray-500/15 text-gray-700 dark:text-gray-400 border-gray-500/30",
  TRACE: "bg-gray-500/10 text-gray-500 dark:text-gray-500 border-gray-500/20",
};

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

const ROW_HEIGHT = 26;

export function LogViewer({ logs }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  const virtualizer = useVirtualizer({
    count: logs.length,
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
    if (shouldAutoScroll.current && logs.length > 0) {
      virtualizer.scrollToIndex(logs.length - 1, { align: "end" });
    }
  }, [logs.length, virtualizer]);

  if (logs.length === 0) {
    return null;
  }

  return (
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
          const entry = logs[virtualRow.index];
          const colorClass =
            levelColors[entry.level] ?? levelColors.DEBUG;
          return (
            <div
              key={entry._id}
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
              <span className="shrink-0 tabular-nums text-muted-foreground/70 select-none">
                {formatTimestamp(entry.timestamp)}
              </span>
              <span
                className={`inline-flex shrink-0 items-center justify-center rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none ${colorClass}`}
              >
                {entry.level}
              </span>
              <span className="shrink-0 text-muted-foreground/50 max-w-[120px] truncate">
                {entry.target}
              </span>
              <span className="min-w-0 break-all text-foreground/90">{entry.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
