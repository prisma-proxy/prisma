"use client";

import { Clock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { SpeedTestEntry } from "@/hooks/use-speed-test";

interface SpeedTestHistoryProps {
  history: SpeedTestEntry[];
  onClear: () => void;
}

export function SpeedTestHistory({ history, onClear }: SpeedTestHistoryProps) {
  const { t } = useI18n();

  function formatRelativeTime(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return t("speedTest.timeAgo.seconds", { value: seconds });
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t("speedTest.timeAgo.minutes", { value: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("speedTest.timeAgo.hours", { value: hours });
    const days = Math.floor(hours / 24);
    return t("speedTest.timeAgo.days", { value: days });
  }

  if (history.length === 0) return null;

  const recentHistory = history.slice().reverse().slice(0, 10);

  // Compute summary stats
  const avgDown =
    history.reduce((s, e) => s + e.downloadMbps, 0) / history.length;
  const avgUp =
    history.reduce((s, e) => s + e.uploadMbps, 0) / history.length;
  const bestDown = Math.max(...history.map((e) => e.downloadMbps));

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border bg-card p-2">
          <p className="text-sm font-bold">{avgDown.toFixed(1)}</p>
          <p className="text-[10px] text-muted-foreground">{t("speedTest.avgDownload")}</p>
        </div>
        <div className="rounded-lg border bg-card p-2">
          <p className="text-sm font-bold">{avgUp.toFixed(1)}</p>
          <p className="text-[10px] text-muted-foreground">{t("speedTest.avgUpload")}</p>
        </div>
        <div className="rounded-lg border bg-card p-2">
          <p className="text-sm font-bold">{bestDown.toFixed(1)}</p>
          <p className="text-[10px] text-muted-foreground">{t("speedTest.bestDownload")}</p>
        </div>
      </div>

      {/* History list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Clock size={12} /> {t("speedTest.history")}
            <span className="text-[10px]">({history.length})</span>
          </p>
          <Button size="sm" variant="ghost" onClick={onClear} className="h-6 px-2">
            <Trash2 size={12} />
          </Button>
        </div>
        <div className="space-y-1">
          {recentHistory.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center gap-2 text-xs text-muted-foreground rounded-md border bg-card px-3 py-1.5"
            >
              <span className="font-medium text-foreground">
                {"\u2193"}{entry.downloadMbps.toFixed(1)}
              </span>
              <span>
                {"\u2191"}{entry.uploadMbps.toFixed(1)}
              </span>
              <span>{entry.latencyMs}ms</span>
              <span className="text-[10px]">{entry.server}</span>
              <span className="ml-auto text-[10px]">
                {formatRelativeTime(entry.timestamp)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
