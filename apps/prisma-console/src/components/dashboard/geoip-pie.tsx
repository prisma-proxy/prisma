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
import { Download, Loader2, CheckCircle } from "lucide-react";

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

function isGeoIPConfigured(): boolean {
  try { return localStorage.getItem("prisma-geoip-configured") === "true"; } catch { return false; }
}

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
  const [configured, setConfigured] = useState(isGeoIPConfigured);

  const total = geo?.reduce((s, e) => s + e.count, 0) ?? 0;
  const hasData = geo && geo.length > 0;

  async function handleDownloadAndConfigure() {
    setDownloading(true);
    try {
      await api.downloadGeoIP();
      // Reload server config so the GeoIP matcher picks up the new file
      await api.reloadConfig().catch(() => {});
      toast(t("geoip.downloadSuccess"), "success");
      localStorage.setItem("prisma-geoip-configured", "true");
      setConfigured(true);
      // Refresh all geo-related queries
      await queryClient.invalidateQueries({ queryKey: ["connections-geo"] });
      await queryClient.invalidateQueries({ queryKey: ["connections"] });
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
        {hasData ? (
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
        ) : configured ? (
          // GeoIP is configured but no connections have geo data yet
          <div className="flex flex-col items-center justify-center gap-2 py-6 px-4 text-center">
            <CheckCircle className="h-8 w-8 text-green-500" />
            <p className="text-sm font-medium text-foreground">
              {t("geoip.configured")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("geoip.waitingForConnections")}
            </p>
          </div>
        ) : (
          // GeoIP not configured — show download button
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
        )}
      </CardContent>
    </Card>
  );
}
