"use client";

import { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { CHART_TOOLTIP_STYLE } from "@/lib/chart-utils";
import type { ConnectionInfo } from "@/lib/types";

interface ConnectionHistogramProps {
  connections: ConnectionInfo[];
}

const BUCKETS = [
  { label: "<1m", maxSecs: 60 },
  { label: "1-5m", maxSecs: 300 },
  { label: "5-30m", maxSecs: 1800 },
  { label: "30m-1h", maxSecs: 3600 },
  { label: "1h+", maxSecs: Infinity },
];

export function ConnectionHistogram({ connections }: ConnectionHistogramProps) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(interval);
  }, []);

  const data = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const bucket of BUCKETS) {
      counts[bucket.label] = 0;
    }

    for (const conn of connections) {
      const connectedAt = new Date(conn.connected_at).getTime();
      const durationSecs = (now - connectedAt) / 1000;

      for (const bucket of BUCKETS) {
        if (durationSecs < bucket.maxSecs || bucket.maxSecs === Infinity) {
          counts[bucket.label]++;
          break;
        }
      }
    }

    return BUCKETS.map((bucket) => ({
      name: bucket.label,
      count: counts[bucket.label],
    }));
  }, [connections, now]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("chart.connectionDuration")}</CardTitle>
      </CardHeader>
      <CardContent>
        {connections.length === 0 ? (
          <p className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
            {t("common.noData")}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
              />
              <YAxis
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
                allowDecimals={false}
              />
              <Tooltip
                formatter={(value) => [Number(value), t("connections.title")]}
                contentStyle={CHART_TOOLTIP_STYLE}
              />
              <Bar
                dataKey="count"
                fill="hsl(217, 91%, 60%)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
