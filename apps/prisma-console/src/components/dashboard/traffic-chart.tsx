"use client";

import { useMemo, useState, useCallback } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Brush,
} from "recharts";
import { Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { MetricsSnapshot } from "@/lib/types";
import { formatBytes, exportToCsv } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import {
  CHART_THEME,
  CHART_AXIS_TICK,
  TIME_RANGES,
  RESOLUTION_MAP,
  formatXAxis,
  tickInterval,
} from "@/lib/chart-theme";
import { useMetricsHistory, computeRateMbps, type TimeRange } from "@/hooks/use-metrics";

interface TrafficChartProps {
  history: MetricsSnapshot[];
}

interface ChartDataPoint {
  timestamp: string;
  time: string;
  bytes_up: number;
  bytes_down: number;
}

interface MbpsDataPoint {
  timestamp: string;
  time: string;
  uploadMbps: number;
  downloadMbps: number;
}

const TOOLTIP_STYLE = {
  backgroundColor: CHART_THEME.tooltip.bg,
  border: `1px solid ${CHART_THEME.tooltip.border}`,
  borderRadius: "var(--radius)",
  color: CHART_THEME.tooltip.text,
  fontSize: "0.875rem",
};

export function TrafficChart({ history }: TrafficChartProps) {
  const { t } = useI18n();
  const [selectedRange, setSelectedRange] = useState<TimeRange | null>(null);
  const [showMbps, setShowMbps] = useState(false);

  const resolution = selectedRange ? RESOLUTION_MAP[selectedRange] : "10s";
  const { data: historicalData } = useMetricsHistory(
    selectedRange ?? "1h",
    resolution as never,
  );

  const activeHistory = selectedRange && historicalData ? historicalData : history;
  const activeRange: TimeRange | "live" = selectedRange ?? "live";

  const data = useMemo<ChartDataPoint[]>(() => {
    if (activeHistory.length < 2) return [];

    const points: ChartDataPoint[] = [];
    for (let i = 1; i < activeHistory.length; i++) {
      const prev = activeHistory[i - 1];
      const curr = activeHistory[i];
      const bytesUpDiff = Math.max(0, curr.total_bytes_up - prev.total_bytes_up);
      const bytesDownDiff = Math.max(0, curr.total_bytes_down - prev.total_bytes_down);
      const ts = curr.timestamp;
      const time = formatXAxis(ts, activeRange);
      points.push({ timestamp: ts, time, bytes_up: bytesUpDiff, bytes_down: bytesDownDiff });
    }
    return points;
  }, [activeHistory, activeRange]);

  const mbpsData = useMemo<MbpsDataPoint[]>(() => {
    if (!showMbps || activeHistory.length < 2) return [];
    const rates = computeRateMbps(activeHistory);
    return rates.map((r) => ({
      timestamp: r.timestamp,
      time: formatXAxis(r.timestamp, activeRange),
      uploadMbps: Math.round(r.uploadMbps * 100) / 100,
      downloadMbps: Math.round(r.downloadMbps * 100) / 100,
    }));
  }, [activeHistory, showMbps, activeRange]);

  const handleExportCsv = useCallback(() => {
    if (showMbps && mbpsData.length > 0) {
      exportToCsv(
        "prisma-traffic-mbps",
        ["Timestamp", "Upload (Mbps)", "Download (Mbps)"],
        mbpsData.map((d) => [d.timestamp, d.uploadMbps, d.downloadMbps]),
      );
    } else if (data.length > 0) {
      exportToCsv(
        "prisma-traffic-bytes",
        ["Timestamp", "Bytes Up", "Bytes Down"],
        data.map((d) => [d.timestamp, d.bytes_up, d.bytes_down]),
      );
    }
  }, [showMbps, mbpsData, data]);

  const interval = tickInterval(activeRange);
  const chartData = showMbps ? mbpsData : data;
  const hasData = chartData.length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{t("dashboard.realtimeTraffic")}</CardTitle>
          <div className="flex items-center gap-1 flex-wrap">
            <Button
              variant={selectedRange === null ? "default" : "outline"}
              size="xs"
              onClick={() => setSelectedRange(null)}
            >
              {t("common.live")}
            </Button>
            {TIME_RANGES.map(({ key, i18nKey }) => (
              <Button
                key={key}
                variant={selectedRange === key ? "default" : "outline"}
                size="xs"
                onClick={() => setSelectedRange(key)}
              >
                {t(i18nKey)}
              </Button>
            ))}
            <div className="ml-1 h-4 w-px bg-border" />
            <Button
              variant={showMbps ? "default" : "outline"}
              size="xs"
              onClick={() => setShowMbps((prev) => !prev)}
            >
              {t("chart.mbps")}
            </Button>
            {hasData && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleExportCsv}
                title={t("chart.exportCsv")}
                className="h-6 w-6 ml-0.5"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
            {t("common.waitingForData")}
          </p>
        ) : showMbps ? (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={mbpsData}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis
                dataKey="time"
                tick={CHART_AXIS_TICK}
                interval={interval}
              />
              <YAxis
                tickFormatter={(value: number) => `${value} Mbps`}
                tick={CHART_AXIS_TICK}
                width={90}
              />
              <Tooltip
                formatter={(value, name) => [
                  `${Number(value).toFixed(2)} Mbps`,
                  name === "uploadMbps" ? t("common.upload") : t("common.download"),
                ]}
                labelFormatter={(label) => String(label)}
                contentStyle={TOOLTIP_STYLE}
              />
              <Area
                type="monotone"
                dataKey="uploadMbps"
                name="uploadMbps"
                stroke={CHART_THEME.upload}
                fill={CHART_THEME.upload}
                fillOpacity={0.15}
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="downloadMbps"
                name="downloadMbps"
                stroke={CHART_THEME.download}
                fill={CHART_THEME.download}
                fillOpacity={0.15}
                strokeWidth={2}
              />
              <Brush
                dataKey="time"
                height={20}
                stroke={CHART_THEME.brush.stroke}
                fill={CHART_THEME.brush.fill}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis
                dataKey="time"
                tick={CHART_AXIS_TICK}
                interval={interval}
              />
              <YAxis
                tickFormatter={(value: number) => formatBytes(value)}
                tick={CHART_AXIS_TICK}
                width={80}
              />
              <Tooltip
                formatter={(value, name) => [
                  formatBytes(Number(value)),
                  name === "bytes_up" ? t("common.upload") : t("common.download"),
                ]}
                labelFormatter={(label) => String(label)}
                contentStyle={TOOLTIP_STYLE}
              />
              <Area
                type="monotone"
                dataKey="bytes_up"
                name="bytes_up"
                stroke={CHART_THEME.upload}
                fill={CHART_THEME.upload}
                fillOpacity={0.15}
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="bytes_down"
                name="bytes_down"
                stroke={CHART_THEME.download}
                fill={CHART_THEME.download}
                fillOpacity={0.15}
                strokeWidth={2}
              />
              <Brush
                dataKey="time"
                height={20}
                stroke={CHART_THEME.brush.stroke}
                fill={CHART_THEME.brush.fill}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
