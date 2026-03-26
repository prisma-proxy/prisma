"use client";

import { useState, useMemo } from "react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import {
  CHART_THEME,
  TIME_RANGES,
  RESOLUTION_MAP,
  formatXAxis,
  tickInterval,
  useChartColors,
} from "@/lib/chart-theme";
import { useMetricsHistory, type TimeRange } from "@/hooks/use-metrics";

export function HistoricalCharts() {
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
  const [range, setRange] = useState<TimeRange>("1h");
  const resolution = RESOLUTION_MAP[range];

  const { data: history } = useMetricsHistory(range, resolution as never);

  const connectionData = useMemo(() => {
    if (!history || history.length < 1) return [];
    return history.map((s) => ({
      time: formatXAxis(s.timestamp, range),
      connections: s.active_connections,
    }));
  }, [history, range]);

  const interval = tickInterval(range);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t("dashboard.historicalMetrics")}</h3>
        <div className="flex gap-1 flex-wrap">
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
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis
                  dataKey="time"
                  tick={axisTick}
                  interval={interval}
                />
                <YAxis
                  tick={axisTick}
                  width={50}
                />
                <Tooltip contentStyle={tooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="connections"
                  stroke={CHART_THEME.upload}
                  fill={CHART_THEME.upload}
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
                <Brush
                  dataKey="time"
                  height={16}
                  stroke={brushStroke}
                  fill={brushFill}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
