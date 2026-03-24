"use client";

import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CHART_TOOLTIP_STYLE } from "@/lib/chart-utils";
import { api } from "@/lib/api";
import { Cpu, MemoryStick } from "lucide-react";

interface DataPoint {
  time: string;
  cpu: number;
  memory: number;
}

const MAX_POINTS = 60;

export function ResourceChart() {
  const pointsRef = useRef<DataPoint[]>([]);

  const { data: info } = useQuery({
    queryKey: ["system-info-realtime"],
    queryFn: async () => {
      const data = await api.getSystemInfo();

      const now = new Date();
      const timeLabel = now.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      const cpuPercent = Math.round(data.cpu_usage * 100) / 100;
      const memPercent =
        data.memory_total_mb > 0
          ? Math.round((data.memory_used_mb / data.memory_total_mb) * 10000) / 100
          : 0;

      const point: DataPoint = {
        time: timeLabel,
        cpu: cpuPercent,
        memory: memPercent,
      };

      const next = [...pointsRef.current, point];
      if (next.length > MAX_POINTS) {
        next.splice(0, next.length - MAX_POINTS);
      }
      pointsRef.current = next;

      return { current: data, chartData: next };
    },
    refetchInterval: 2000,
  });

  const chartData = info?.chartData ?? [];
  const current = info?.current;

  const currentCpu = current ? Math.round(current.cpu_usage * 100) / 100 : 0;
  const currentMemPercent =
    current && current.memory_total_mb > 0
      ? Math.round((current.memory_used_mb / current.memory_total_mb) * 10000) / 100
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Resource Usage (Real-time)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length < 2 ? (
          <p className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
            Collecting data...
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10 }}
                className="text-muted-foreground"
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="left"
                domain={[0, 100]}
                tick={{ fontSize: 10 }}
                className="text-muted-foreground"
                tickFormatter={(v: number) => `${v}%`}
                width={45}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={[0, 100]}
                tick={{ fontSize: 10 }}
                className="text-muted-foreground"
                tickFormatter={(v: number) => `${v}%`}
                width={45}
              />
              <Tooltip
                formatter={(value, name) => [
                  `${Number(value).toFixed(1)}%`,
                  name === "cpu" ? "CPU" : "Memory",
                ]}
                labelFormatter={(label) => String(label)}
                contentStyle={CHART_TOOLTIP_STYLE}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="cpu"
                name="cpu"
                stroke="hsl(217, 91%, 60%)"
                fill="hsl(217, 91%, 60%)"
                fillOpacity={0.15}
                strokeWidth={2}
              />
              <Area
                yAxisId="right"
                type="monotone"
                dataKey="memory"
                name="memory"
                stroke="hsl(271, 91%, 65%)"
                fill="hsl(271, 91%, 65%)"
                fillOpacity={0.15}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {/* Current values */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
            <Cpu className="h-4 w-4 text-blue-500" />
            <div>
              <p className="text-sm font-bold">{currentCpu}%</p>
              <p className="text-[10px] text-muted-foreground">CPU Usage</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
            <MemoryStick className="h-4 w-4 text-purple-500" />
            <div>
              <p className="text-sm font-bold">{currentMemPercent.toFixed(1)}%</p>
              <p className="text-[10px] text-muted-foreground">
                Memory{current ? ` (${current.memory_used_mb}/${current.memory_total_mb} MB)` : ""}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
