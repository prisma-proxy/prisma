"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { CHART_TOOLTIP_STYLE_SM } from "@/lib/chart-utils";
import { Download, Loader2 } from "lucide-react";

const COLORS = [
  "hsl(217, 91%, 60%)",
  "hsl(142, 71%, 45%)",
  "hsl(38, 92%, 50%)",
  "hsl(0, 84%, 60%)",
  "hsl(271, 91%, 65%)",
  "hsl(187, 85%, 43%)",
  "hsl(315, 80%, 60%)",
  "hsl(60, 100%, 45%)",
];

export function GeoIPPie() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: geo } = useQuery({
    queryKey: ["connections-geo"],
    queryFn: () => api.getConnectionGeo(),
    refetchInterval: 15000,
  });

  const [downloading, setDownloading] = useState(false);

  const total = geo?.reduce((s, e) => s + e.count, 0) ?? 0;

  async function handleDownloadAndConfigure() {
    setDownloading(true);
    try {
      await api.downloadGeoIP();
      toast(t("geoip.downloadSuccess"), "success");
      await queryClient.invalidateQueries({ queryKey: ["connections-geo"] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Download failed";
      toast(message, "error");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Connection Origins</CardTitle>
      </CardHeader>
      <CardContent>
        {!geo || geo.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-6 px-4 text-center">
            <p className="text-sm text-muted-foreground">
              {t("geoip.noData")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("geoip.noConnectionsHint")}
            </p>
            <Button
              size="sm"
              onClick={handleDownloadAndConfigure}
              disabled={downloading}
            >
              {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" data-icon="inline-start" /> : <Download className="h-3.5 w-3.5" data-icon="inline-start" />}
              {downloading ? t("geoip.downloading") : t("geoip.downloadAndConfigure")}
            </Button>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={geo}
                dataKey="count"
                nameKey="country"
                cx="50%"
                cy="50%"
                outerRadius={75}
                label={({ name, value }) =>
                  `${name} ${Math.round((Number(value) / total) * 100)}%`
                }
                labelLine={true}
              >
                {geo.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name) => [
                  `${Number(value)} connection${Number(value) !== 1 ? "s" : ""}`,
                  name,
                ]}
                contentStyle={CHART_TOOLTIP_STYLE_SM}
              />
              <Legend
                formatter={(value) => (
                  <span className="text-xs">{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
