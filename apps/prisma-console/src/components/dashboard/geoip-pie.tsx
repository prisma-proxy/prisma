"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { CHART_TOOLTIP_STYLE_SM } from "@/lib/chart-utils";
import { Download, Settings } from "lucide-react";

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

const GEOIP_DOWNLOAD_URL = "https://github.com/P3TERX/GeoLite.mmdb/releases";

export function GeoIPPie() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { data: geo } = useQuery({
    queryKey: ["connections-geo"],
    queryFn: () => api.getConnectionGeo(),
    refetchInterval: 15000,
  });

  const [showConfig, setShowConfig] = useState(false);
  const [geoipPath, setGeoipPath] = useState("./geoip.mmdb");
  const [saving, setSaving] = useState(false);

  const total = geo?.reduce((s, e) => s + e.count, 0) ?? 0;

  async function handleSavePath() {
    setSaving(true);
    try {
      await api.patchConfig({ geoip_path: geoipPath });
      toast(t("geoip.saved"), "success");
      setShowConfig(false);
    } catch {
      toast("Failed to save — server may not support this field", "error");
    } finally {
      setSaving(false);
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

            <div className="flex gap-2 mt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(GEOIP_DOWNLOAD_URL, "_blank")}
              >
                <Download className="h-3.5 w-3.5" data-icon="inline-start" />
                {t("geoip.download")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowConfig(!showConfig)}
              >
                <Settings className="h-3.5 w-3.5" data-icon="inline-start" />
                {t("geoip.configure")}
              </Button>
            </div>

            {showConfig && (
              <div className="w-full max-w-sm space-y-2 mt-2 p-3 rounded-lg border bg-muted/30">
                <Label className="text-xs">{t("geoip.pathLabel")}</Label>
                <div className="flex gap-2">
                  <Input
                    value={geoipPath}
                    onChange={(e) => setGeoipPath(e.target.value)}
                    placeholder={t("geoip.pathPlaceholder")}
                    className="text-xs"
                  />
                  <Button size="sm" onClick={handleSavePath} disabled={saving || !geoipPath.trim()}>
                    {t("geoip.save")}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {t("geoip.downloadHint")}
                </p>
              </div>
            )}
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
