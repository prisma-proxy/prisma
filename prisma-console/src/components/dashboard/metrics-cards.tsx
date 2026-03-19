"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MetricsSnapshot } from "@/lib/types";
import { formatBytes, formatDuration } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface MetricsCardsProps {
  metrics: MetricsSnapshot | null;
}

export function MetricsCards({ metrics }: MetricsCardsProps) {
  const { t } = useI18n();

  const items = [
    { label: t("metrics.activeConnections"), value: metrics?.active_connections ?? 0 },
    { label: t("metrics.totalConnections"),  value: metrics?.total_connections ?? 0 },
    { label: t("metrics.trafficUp"),         value: formatBytes(metrics?.total_bytes_up ?? 0) },
    { label: t("metrics.trafficDown"),       value: formatBytes(metrics?.total_bytes_down ?? 0) },
    { label: t("metrics.handshakeFailures"), value: metrics?.handshake_failures ?? 0 },
    { label: t("metrics.uptime"),            value: formatDuration(metrics?.uptime_secs ?? 0) },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(({ label, value }) => (
        <Card key={label}>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
