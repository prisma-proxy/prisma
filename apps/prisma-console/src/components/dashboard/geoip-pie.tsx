"use client";

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
import { api } from "@/lib/api";
import { CHART_TOOLTIP_STYLE_SM } from "@/lib/chart-utils";

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
  const { data: geo } = useQuery({
    queryKey: ["connections-geo"],
    queryFn: () => api.getConnectionGeo(),
    refetchInterval: 15000,
  });

  const total = geo?.reduce((s, e) => s + e.count, 0) ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Connection Origins</CardTitle>
      </CardHeader>
      <CardContent>
        {!geo || geo.length === 0 ? (
          <p className="flex h-[200px] items-center justify-center text-center text-sm text-muted-foreground px-4">
            No GeoIP data —{" "}
            configure <code className="mx-1 font-mono text-xs">geoip_path</code>{" "}
            in server config or no active connections
          </p>
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
