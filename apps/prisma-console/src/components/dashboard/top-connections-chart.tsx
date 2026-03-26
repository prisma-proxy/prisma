"use client";

import { useRef, useMemo, useCallback, useState, useEffect } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  Brush,
} from "recharts";
import { Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { exportToCsv } from "@/lib/utils";
import { LINE_PALETTE, useChartColors } from "@/lib/chart-theme";
import { useConnections } from "@/hooks/use-connections";

const MAX_SNAPSHOTS = 60; // 5 minutes at 5s intervals
const TOP_N = 10;

interface DestRate {
  destination: string;
  uploadRate: number;
  downloadRate: number;
  totalRate: number;
}

interface Snapshot {
  relativeLabel: string;
  timestamp: number;
  rates: Map<string, { up: number; down: number }>;
}

interface ChartRow {
  time: string;
  [dest: string]: string | number;
}

// Tooltip style is now computed inside the component via useChartColors()

/**
 * Groups connections by destination, computes per-destination byte-rate deltas,
 * and renders a multi-line chart of the top 10 destinations by bandwidth.
 *
 * Data flow:
 * 1. `useConnections` polls every 5s
 * 2. On each poll, compute delta rates from previous snapshot
 * 3. Maintain a ring buffer of up to 60 snapshots (5 min)
 * 4. Top 10 destinations (by total rate in latest snapshot) each get a Line
 */
export function TopConnectionsChart() {
  const { t } = useI18n();
  const { axisColor, gridColor, brushStroke, brushFill, tooltipBg, tooltipBorder, tooltipText } = useChartColors();
  const axisTick = { fill: axisColor, fontSize: 10 };
  const tooltipStyle = {
    backgroundColor: tooltipBg,
    border: `1px solid ${tooltipBorder}`,
    borderRadius: "var(--radius)",
    color: tooltipText,
    fontSize: "0.75rem",
  };
  const { data: connections } = useConnections();

  // Previous snapshot for delta calculation
  const prevRef = useRef<Map<string, { up: number; down: number }> | null>(null);
  const prevTsRef = useRef<number>(0);

  // Ring buffer of snapshots
  const snapshotsRef = useRef<Snapshot[]>([]);

  // Compute rates from current connections vs previous snapshot
  const [currentRates, setCurrentRates] = useState<DestRate[]>([]);

  useEffect(() => {
    if (!connections || connections.length === 0) {
      setCurrentRates([]);
      return;
    }

    const now = Date.now();
    const dt = prevTsRef.current > 0 ? (now - prevTsRef.current) / 1000 : 0;

    // Aggregate bytes per destination
    const destBytes = new Map<string, { up: number; down: number }>();
    for (const conn of connections) {
      const dest = conn.destination ?? conn.peer_addr ?? "unknown";
      const cur = destBytes.get(dest) ?? { up: 0, down: 0 };
      cur.up += conn.bytes_up;
      cur.down += conn.bytes_down;
      destBytes.set(dest, cur);
    }

    const rates: DestRate[] = [];
    if (dt > 0 && prevRef.current) {
      const prev = prevRef.current;
      for (const [dest, cur] of destBytes) {
        const p = prev.get(dest);
        if (p) {
          const upRate = Math.max(0, (cur.up - p.up) / dt / (1024 * 1024)); // MB/s
          const downRate = Math.max(0, (cur.down - p.down) / dt / (1024 * 1024));
          rates.push({
            destination: dest,
            uploadRate: upRate,
            downloadRate: downRate,
            totalRate: upRate + downRate,
          });
        }
      }
    }

    // Store current as previous for next poll
    prevRef.current = destBytes;
    prevTsRef.current = now;

    // Add snapshot to ring buffer
    if (rates.length > 0) {
      const rateMap = new Map<string, { up: number; down: number }>();
      for (const r of rates) {
        rateMap.set(r.destination, { up: r.uploadRate, down: r.downloadRate });
      }
      const snapshots = snapshotsRef.current;
      snapshots.push({ relativeLabel: "", timestamp: now, rates: rateMap });
      if (snapshots.length > MAX_SNAPSHOTS) {
        snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS);
      }
      // Update relative labels
      const latestTs = snapshots[snapshots.length - 1].timestamp;
      for (const snap of snapshots) {
        const secsAgo = Math.round((latestTs - snap.timestamp) / 1000);
        snap.relativeLabel = secsAgo === 0 ? "now" : `${secsAgo}s`;
      }
    }

    setCurrentRates(rates.sort((a, b) => b.totalRate - a.totalRate).slice(0, TOP_N));
  }, [connections]);

  // Top destinations (from latest snapshot)
  const topDests = useMemo(() => currentRates.map((r) => r.destination), [currentRates]);

  // Build chart data from snapshot buffer
  const [chartData, setChartData] = useState<ChartRow[]>([]);

  useEffect(() => {
    const snapshots = snapshotsRef.current;
    if (snapshots.length === 0 || topDests.length === 0) {
      setChartData([]);
      return;
    }

    setChartData(
      snapshots.map((snap) => {
        const row: ChartRow = { time: snap.relativeLabel };
        for (const dest of topDests) {
          const r = snap.rates.get(dest);
          row[dest] = r ? Math.round((r.up + r.down) * 100) / 100 : 0;
        }
        return row;
      })
    );
  }, [topDests, connections]);

  const handleExportCsv = useCallback(() => {
    if (chartData.length === 0 || topDests.length === 0) return;
    const headers = ["Time", ...topDests.map((d) => `${d} (MB/s)`)];
    const rows = chartData.map((row) => [
      row.time as string,
      ...topDests.map((d) => row[d] as number),
    ]);
    exportToCsv("prisma-top-connections", headers, rows);
  }, [chartData, topDests]);

  const truncate = (s: string, max: number) =>
    s.length > max ? s.slice(0, max - 1) + "\u2026" : s;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{t("chart.topConnections")}</CardTitle>
          {chartData.length > 0 && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleExportCsv}
              title={t("chart.exportCsv")}
              className="h-6 w-6"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {chartData.length < 2 ? (
          <p className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
            {t("common.waitingForData")}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis
                dataKey="time"
                tick={axisTick}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={(v: number) => `${v.toFixed(1)}`}
                tick={axisTick}
                width={55}
                label={{
                  value: "MB/s",
                  angle: -90,
                  position: "insideLeft",
                  style: { fill: axisColor, fontSize: 10 },
                }}
              />
              <Tooltip
                formatter={(value: unknown, name: unknown) => [
                  `${Number(value).toFixed(2)} MB/s`,
                  truncate(String(name), 30),
                ]}
                contentStyle={tooltipStyle}
              />
              <Legend
                formatter={(value: string) => truncate(value, 20)}
                wrapperStyle={{ fontSize: 10 }}
              />
              {topDests.map((dest, i) => (
                <Line
                  key={dest}
                  type="monotone"
                  dataKey={dest}
                  name={dest}
                  stroke={LINE_PALETTE[i % LINE_PALETTE.length]}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                />
              ))}
              <Brush
                dataKey="time"
                height={16}
                stroke={brushStroke}
                fill={brushFill}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
