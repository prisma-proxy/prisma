"use client";

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
import { formatBytes } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { ClientBandwidthSummaryEntry } from "@/lib/types";

interface QuotaOverviewChartProps {
  clients: ClientBandwidthSummaryEntry[];
}

export function QuotaOverviewChart({ clients }: QuotaOverviewChartProps) {
  const { t } = useI18n();

  // Only show clients with a quota set
  const withQuota = clients.filter((c) => c.quota_bytes > 0);

  if (withQuota.length === 0) return null;

  const data = withQuota.map((c) => ({
    name: c.client_name || c.client_id.slice(0, 8),
    used: c.quota_used,
    remaining: Math.max(0, c.quota_bytes - c.quota_used),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("bandwidth.quotaOverview")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
            />
            <YAxis
              tickFormatter={(v: number) => formatBytes(v)}
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
              width={80}
            />
            <Tooltip
              formatter={(value, name) => [
                formatBytes(Number(value)),
                name === "used" ? t("quota.used") : t("quota.remaining"),
              ]}
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "var(--radius)",
                fontSize: "0.875rem",
              }}
            />
            <Bar
              dataKey="used"
              stackId="quota"
              fill="hsl(217, 91%, 60%)"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="remaining"
              stackId="quota"
              fill="hsl(217, 91%, 60%)"
              fillOpacity={0.2}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
