"use client";

import {
  Network,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Activity,
  ShieldAlert,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkline } from "@/components/dashboard/sparkline";
import type { MetricsSnapshot } from "@/lib/types";
import { formatBytes, formatDuration } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface MetricsCardsProps {
  metrics: MetricsSnapshot | null;
  history?: MetricsSnapshot[];
}

export function MetricsCards({ metrics, history = [] }: MetricsCardsProps) {
  const { t } = useI18n();

  // Build sparkline data from history (last 30 entries)
  const recent = history.slice(-30);
  const activeConnSpark = recent.map((s) => s.active_connections);
  const totalConnSpark = recent.map((s) => s.total_connections);

  // Calculate upload/download rate from history deltas
  const upRateSpark = recent.length > 1
    ? recent.slice(1).map((s, i) => Math.max(0, s.total_bytes_up - recent[i].total_bytes_up))
    : [];
  const downRateSpark = recent.length > 1
    ? recent.slice(1).map((s, i) => Math.max(0, s.total_bytes_down - recent[i].total_bytes_down))
    : [];
  const failureSpark = recent.map((s) => s.handshake_failures);

  const items = [
    {
      label: t("metrics.activeConnections"),
      value: metrics?.active_connections ?? 0,
      icon: Network,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
      spark: activeConnSpark,
      sparkColor: "hsl(217, 91%, 60%)",
    },
    {
      label: t("metrics.totalConnections"),
      value: metrics?.total_connections ?? 0,
      icon: Activity,
      color: "text-violet-500",
      bgColor: "bg-violet-500/10",
      spark: totalConnSpark,
      sparkColor: "hsl(280, 65%, 60%)",
    },
    {
      label: t("metrics.trafficUp"),
      value: formatBytes(metrics?.total_bytes_up ?? 0),
      icon: ArrowUpRight,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
      spark: upRateSpark,
      sparkColor: "hsl(142, 71%, 45%)",
    },
    {
      label: t("metrics.trafficDown"),
      value: formatBytes(metrics?.total_bytes_down ?? 0),
      icon: ArrowDownRight,
      color: "text-sky-500",
      bgColor: "bg-sky-500/10",
      spark: downRateSpark,
      sparkColor: "hsl(200, 80%, 50%)",
    },
    {
      label: t("metrics.handshakeFailures"),
      value: metrics?.handshake_failures ?? 0,
      icon: ShieldAlert,
      color: (metrics?.handshake_failures ?? 0) > 0 ? "text-red-500" : "text-muted-foreground",
      bgColor: (metrics?.handshake_failures ?? 0) > 0 ? "bg-red-500/10" : "bg-muted",
      spark: failureSpark,
      sparkColor: "hsl(0, 72%, 51%)",
    },
    {
      label: t("metrics.uptime"),
      value: formatDuration(metrics?.uptime_secs ?? 0),
      icon: Clock,
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
      spark: [],
      sparkColor: "",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(({ label, value, icon: Icon, color, bgColor, spark, sparkColor }) => (
        <Card key={label} className="group transition-all hover:ring-2 hover:ring-primary/20">
          <CardContent className="pt-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground leading-none">
                  {label}
                </p>
                <p className="text-xl font-bold tracking-tight">{value}</p>
              </div>
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${bgColor}`}>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
            </div>
            {spark.length > 1 && (
              <div className="mt-2 -mb-1">
                <Sparkline data={spark} color={sparkColor} height={20} />
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
