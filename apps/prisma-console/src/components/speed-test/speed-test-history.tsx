"use client";

import { useState, useEffect, useMemo } from "react";
import { Clock, Trash2 } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { CHART_TOOLTIP_STYLE_SM } from "@/lib/chart-utils";
import type { SpeedTestEntry } from "@/hooks/use-speed-test";

interface SpeedTestHistoryProps {
  history: SpeedTestEntry[];
  onClear: () => void;
}

export function SpeedTestHistory({ history, onClear }: SpeedTestHistoryProps) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(interval);
  }, []);

  function formatRelativeTime(timestamp: number): string {
    const seconds = Math.floor((now - timestamp) / 1000);
    if (seconds < 60) return t("speedTest.timeAgo.seconds", { value: seconds });
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t("speedTest.timeAgo.minutes", { value: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("speedTest.timeAgo.hours", { value: hours });
    const days = Math.floor(hours / 24);
    return t("speedTest.timeAgo.days", { value: days });
  }

  // Compute chart data from history
  const trendData = useMemo(
    () =>
      history.map((entry, i) => ({
        index: i + 1,
        download: Math.round(entry.downloadMbps * 100) / 100,
        upload: Math.round(entry.uploadMbps * 100) / 100,
      })),
    [history]
  );

  // Compute extended stats: min, max, median
  const extendedStats = useMemo(() => {
    if (history.length === 0) return null;

    const dlValues = history.map((e) => e.downloadMbps).sort((a, b) => a - b);
    const ulValues = history.map((e) => e.uploadMbps).sort((a, b) => a - b);

    const median = (arr: number[]) => {
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 !== 0 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    };

    return {
      dlMin: dlValues[0],
      dlMax: dlValues[dlValues.length - 1],
      dlMedian: median(dlValues),
      ulMin: ulValues[0],
      ulMax: ulValues[ulValues.length - 1],
      ulMedian: median(ulValues),
    };
  }, [history]);

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
      {/* Trend chart — show when 2+ entries */}
      {trendData.length >= 2 && (
        <div className="rounded-lg border bg-card p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Speed Trend
          </p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="index"
                tick={{ fontSize: 10 }}
                className="text-muted-foreground"
                label={{ value: "#", position: "insideBottomRight", offset: -4, fontSize: 10 }}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                className="text-muted-foreground"
                tickFormatter={(v: number) => `${v}`}
                width={50}
                label={{ value: "Mbps", angle: -90, position: "insideLeft", fontSize: 10 }}
              />
              <Tooltip
                formatter={(value, name) => [
                  `${Number(value).toFixed(2)} Mbps`,
                  name === "download" ? "Download" : "Upload",
                ]}
                contentStyle={CHART_TOOLTIP_STYLE_SM}
              />
              <Line
                type="monotone"
                dataKey="download"
                name="download"
                stroke="hsl(142, 71%, 45%)"
                strokeWidth={2}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="upload"
                name="upload"
                stroke="hsl(217, 91%, 60%)"
                strokeWidth={2}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

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

      {/* Extended stats: Min / Max / Median */}
      {extendedStats && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border bg-card p-2 space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground">Download (Mbps)</p>
            <div className="grid grid-cols-3 gap-1 text-center text-[10px]">
              <div>
                <p className="font-bold text-xs">{extendedStats.dlMin.toFixed(1)}</p>
                <p className="text-muted-foreground">Min</p>
              </div>
              <div>
                <p className="font-bold text-xs">{extendedStats.dlMedian.toFixed(1)}</p>
                <p className="text-muted-foreground">Median</p>
              </div>
              <div>
                <p className="font-bold text-xs">{extendedStats.dlMax.toFixed(1)}</p>
                <p className="text-muted-foreground">Max</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-2 space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground">Upload (Mbps)</p>
            <div className="grid grid-cols-3 gap-1 text-center text-[10px]">
              <div>
                <p className="font-bold text-xs">{extendedStats.ulMin.toFixed(1)}</p>
                <p className="text-muted-foreground">Min</p>
              </div>
              <div>
                <p className="font-bold text-xs">{extendedStats.ulMedian.toFixed(1)}</p>
                <p className="text-muted-foreground">Median</p>
              </div>
              <div>
                <p className="font-bold text-xs">{extendedStats.ulMax.toFixed(1)}</p>
                <p className="text-muted-foreground">Max</p>
              </div>
            </div>
          </div>
        </div>
      )}

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
              <span>{entry.latencyMs.toFixed(0)}ms</span>
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
