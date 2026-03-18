"use client";

import { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { useMetricsHistory, type TimeRange } from "@/hooks/use-metrics";

const TIME_RANGES: { key: TimeRange; i18nKey: string }[] = [
  { key: "1h", i18nKey: "chart.timeRange.1h" },
  { key: "6h", i18nKey: "chart.timeRange.6h" },
  { key: "24h", i18nKey: "chart.timeRange.24h" },
  { key: "7d", i18nKey: "chart.timeRange.7d" },
];

const RESOLUTION_MAP: Record<TimeRange, "10s" | "60s"> = {
  "1h": "10s",
  "6h": "60s",
  "24h": "60s",
  "7d": "60s",
};

export function HistoricalCharts() {
  const { t } = useI18n();
  const [range, setRange] = useState<TimeRange>("1h");
  const resolution = RESOLUTION_MAP[range];

  const { data: history } = useMetricsHistory(range, resolution);

  const connectionData = useMemo(() => {
    if (!history || history.length < 1) return [];
    return history.map((s) => {
      const ts = new Date(s.timestamp);
      return {
        time: ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        connections: s.active_connections,
      };
    });
  }, [history]);

  const failureData = useMemo(() => {
    if (!history || history.length < 2) return [];
    return history.slice(1).map((s, i) => {
      const prev = history[i];
      const ts = new Date(s.timestamp);
      return {
        time: ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        failures: Math.max(0, s.handshake_failures - prev.handshake_failures),
      };
    });
  }, [history]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t("dashboard.historicalMetrics")}</h3>
        <div className="flex gap-1.5">
          {TIME_RANGES.map(({ key, i18nKey }) => (
            <Button
              key={key}
              variant={range === key ? "default" : "outline"}
              size="xs"
              onClick={() => setRange(key)}
            >
              {t(i18nKey)}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("metrics.activeConnections")}</CardTitle>
          </CardHeader>
          <CardContent>
            {connectionData.length === 0 ? (
              <p className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                {t("common.noData")}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={connectionData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" width={50} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                      fontSize: "0.75rem",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="connections"
                    stroke="hsl(217, 91%, 60%)"
                    fill="hsl(217, 91%, 60%)"
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("metrics.handshakeFailures")}</CardTitle>
          </CardHeader>
          <CardContent>
            {failureData.length === 0 ? (
              <p className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                {t("common.noData")}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={failureData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" width={50} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                      fontSize: "0.75rem",
                    }}
                  />
                  <Bar
                    dataKey="failures"
                    fill="hsl(0, 72%, 51%)"
                    fillOpacity={0.7}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
