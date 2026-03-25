"use client";

import { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { ArrowUp, ArrowDown, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n";
import { formatBytes } from "@/lib/utils";
import { CHART_TOOLTIP_STYLE } from "@/lib/chart-utils";
import { exportToCSV } from "@/lib/export";
import { useMetricsHistory, type TimeRange, type Resolution } from "@/hooks/use-metrics";
import { useAllClientMetrics } from "@/hooks/use-client-metrics";
import { useConnections } from "@/hooks/use-connections";
import { SkeletonChart, SkeletonTable, SkeletonCard } from "@/components/ui/skeleton";

// --- Constants ---

const PERIOD_OPTIONS: { key: TimeRange; i18nKey: string }[] = [
  { key: "1h", i18nKey: "chart.timeRange.1h" },
  { key: "6h", i18nKey: "chart.timeRange.6h" },
  { key: "24h", i18nKey: "chart.timeRange.24h" },
  { key: "7d", i18nKey: "chart.timeRange.7d" },
];

const RESOLUTION_MAP: Record<TimeRange, Resolution> = {
  "1h": "10s",
  "6h": "60s",
  "24h": "60s",
  "7d": "60s",
};

const PIE_COLORS = [
  "hsl(217, 91%, 60%)",
  "hsl(142, 71%, 45%)",
  "hsl(38, 92%, 50%)",
  "hsl(0, 72%, 51%)",
  "hsl(280, 65%, 60%)",
  "hsl(190, 80%, 45%)",
  "hsl(330, 70%, 55%)",
  "hsl(60, 80%, 45%)",
];

const BAR_COLORS = [
  "hsl(217, 91%, 60%)",
  "hsl(142, 71%, 45%)",
  "hsl(38, 92%, 50%)",
  "hsl(280, 65%, 60%)",
  "hsl(0, 72%, 51%)",
  "hsl(190, 80%, 45%)",
  "hsl(330, 70%, 55%)",
  "hsl(60, 80%, 45%)",
  "hsl(200, 75%, 55%)",
  "hsl(160, 60%, 50%)",
];

// --- Sort types for client ranking ---

type ClientSortKey =
  | "rank"
  | "name"
  | "upload"
  | "download"
  | "total"
  | "connections"
  | "latency";
type SortDir = "asc" | "desc";

function SortIndicator({
  col,
  sortKey,
  sortDir,
}: {
  col: ClientSortKey;
  sortKey: ClientSortKey;
  sortDir: SortDir;
}) {
  if (sortKey !== col) return null;
  return sortDir === "asc" ? (
    <ArrowUp className="inline h-3 w-3 ml-1" />
  ) : (
    <ArrowDown className="inline h-3 w-3 ml-1" />
  );
}

// --- Main Page Component ---

export default function AnalyticsPage() {
  const { t } = useI18n();
  const [period, setPeriod] = useState<TimeRange>("24h");
  const resolution = RESOLUTION_MAP[period];

  const { data: metricsHistory, isLoading: metricsLoading } = useMetricsHistory(period, resolution);
  const { data: clientMetrics, isLoading: clientMetricsLoading } = useAllClientMetrics();
  const { data: connections, isLoading: connectionsLoading } = useConnections();

  // =============================================
  // Section 1: Traffic Over Time
  // =============================================

  const trafficData = useMemo(() => {
    if (!metricsHistory || metricsHistory.length < 2) return [];
    return metricsHistory.slice(1).map((curr, i) => {
      const prev = metricsHistory[i];
      const ts = new Date(curr.timestamp);
      return {
        time: ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        upload: Math.max(0, curr.total_bytes_up - prev.total_bytes_up),
        download: Math.max(0, curr.total_bytes_down - prev.total_bytes_down),
      };
    });
  }, [metricsHistory]);

  // =============================================
  // Section 2: Peak Stats & Records
  // =============================================

  const peakStats = useMemo(() => {
    if (!metricsHistory || metricsHistory.length === 0) {
      return {
        peakConnections: 0,
        peakBandwidth: 0,
        totalTransferred: 0,
        busiestClient: null as { name: string; total: number } | null,
      };
    }

    let peakConns = 0;
    let peakBw = 0;

    for (let i = 0; i < metricsHistory.length; i++) {
      const s = metricsHistory[i];
      if (s.active_connections > peakConns) {
        peakConns = s.active_connections;
      }
      if (i > 0) {
        const prev = metricsHistory[i - 1];
        const delta =
          Math.max(0, s.total_bytes_up - prev.total_bytes_up) +
          Math.max(0, s.total_bytes_down - prev.total_bytes_down);
        if (delta > peakBw) {
          peakBw = delta;
        }
      }
    }

    const latest = metricsHistory[metricsHistory.length - 1];
    const totalTransferred = latest.total_bytes_up + latest.total_bytes_down;

    let busiestClient: { name: string; total: number } | null = null;
    if (clientMetrics && clientMetrics.length > 0) {
      let maxTotal = 0;
      for (const cm of clientMetrics) {
        const total = cm.bytes_up + cm.bytes_down;
        if (total > maxTotal) {
          maxTotal = total;
          busiestClient = {
            name: cm.client_name ?? cm.client_id.slice(0, 8),
            total: maxTotal,
          };
        }
      }
    }

    return { peakConnections: peakConns, peakBandwidth: peakBw, totalTransferred, busiestClient };
  }, [metricsHistory, clientMetrics]);

  // =============================================
  // Section 3: Client Ranking Table
  // =============================================

  const [clientSort, setClientSort] = useState<ClientSortKey>("total");
  const [clientSortDir, setClientSortDir] = useState<SortDir>("desc");

  const rankedClients = useMemo(() => {
    if (!clientMetrics || clientMetrics.length === 0) return [];

    const withTotal = clientMetrics.map((cm) => ({
      ...cm,
      total: cm.bytes_up + cm.bytes_down,
      avgLatency: cm.latency_p50_ms ?? 0,
    }));

    withTotal.sort((a, b) => {
      let cmp = 0;
      switch (clientSort) {
        case "rank":
        case "total":
          cmp = a.total - b.total;
          break;
        case "name":
          cmp = (a.client_name ?? "").localeCompare(b.client_name ?? "");
          break;
        case "upload":
          cmp = a.bytes_up - b.bytes_up;
          break;
        case "download":
          cmp = a.bytes_down - b.bytes_down;
          break;
        case "connections":
          cmp = a.active_connections - b.active_connections;
          break;
        case "latency":
          cmp = a.avgLatency - b.avgLatency;
          break;
      }
      return clientSortDir === "asc" ? cmp : -cmp;
    });

    return withTotal;
  }, [clientMetrics, clientSort, clientSortDir]);

  function handleClientSort(key: ClientSortKey) {
    if (clientSort === key) {
      setClientSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setClientSort(key);
      setClientSortDir("desc");
    }
  }

  function handleExportCSV() {
    if (rankedClients.length === 0) return;
    const rows = rankedClients.map((c, i) => ({
      Rank: i + 1,
      Client: c.client_name ?? c.client_id,
      Upload: c.bytes_up,
      Download: c.bytes_down,
      Total: c.total,
      Connections: c.active_connections,
      "Avg Latency (ms)": c.avgLatency,
    }));
    exportToCSV(rows, "prisma-client-ranking");
  }

  // =============================================
  // Section 4: Connection Analytics
  // =============================================

  const transportDistribution = useMemo(() => {
    if (!connections || connections.length === 0) return [];
    const counts = new Map<string, number>();
    for (const conn of connections) {
      const transport = conn.transport || "unknown";
      counts.set(transport, (counts.get(transport) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [connections]);

  const ruleBreakdown = useMemo(() => {
    if (!connections || connections.length === 0) return [];
    const counts = new Map<string, number>();
    for (const conn of connections) {
      const rule = conn.matched_rule ?? "No Rule";
      counts.set(rule, (counts.get(rule) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [connections]);

  // =============================================
  // Render
  // =============================================

  const isLoading = metricsLoading && clientMetricsLoading && connectionsLoading;

  const hasData =
    (metricsHistory && metricsHistory.length > 0) ||
    (clientMetrics && clientMetrics.length > 0) ||
    (connections && connections.length > 0);

  return (
    <div className="space-y-6">
      {/* Header with period selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("analytics.title")}</h2>
        <div className="flex items-center gap-1.5">
          {PERIOD_OPTIONS.map(({ key, i18nKey }) => (
            <Button
              key={key}
              variant={period === key ? "default" : "outline"}
              size="xs"
              onClick={() => setPeriod(key)}
            >
              {t(i18nKey)}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <SkeletonChart height={300} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
          <SkeletonTable rows={5} />
        </div>
      ) : !hasData ? (
        <Card>
          <CardContent>
            <p className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
              {t("analytics.noData")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Section 1: Traffic Over Time */}
          <Card>
            <CardHeader>
              <CardTitle>{t("analytics.trafficOverTime")}</CardTitle>
            </CardHeader>
            <CardContent>
              {trafficData.length === 0 ? (
                <p className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
                  {t("common.waitingForData")}
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={trafficData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 12 }}
                      className="text-muted-foreground"
                    />
                    <YAxis
                      tickFormatter={(value: number) => formatBytes(value)}
                      tick={{ fontSize: 12 }}
                      className="text-muted-foreground"
                      width={80}
                    />
                    <Tooltip
                      formatter={(value, name) => [
                        formatBytes(Number(value)),
                        name === "upload" ? t("common.upload") : t("common.download"),
                      ]}
                      labelFormatter={(label) => String(label)}
                      contentStyle={CHART_TOOLTIP_STYLE}
                    />
                    <Area
                      type="monotone"
                      dataKey="upload"
                      name="upload"
                      stroke="hsl(217, 91%, 60%)"
                      fill="hsl(217, 91%, 60%)"
                      fillOpacity={0.15}
                      strokeWidth={2}
                      stackId="traffic"
                    />
                    <Area
                      type="monotone"
                      dataKey="download"
                      name="download"
                      stroke="hsl(142, 71%, 45%)"
                      fill="hsl(142, 71%, 45%)"
                      fillOpacity={0.15}
                      strokeWidth={2}
                      stackId="traffic"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Section 2: Peak Stats & Records */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("analytics.peakConnections")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{peakStats.peakConnections.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("analytics.peakBandwidth")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatBytes(peakStats.peakBandwidth)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("analytics.totalTransferred")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatBytes(peakStats.totalTransferred)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("analytics.busiestClient")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {peakStats.busiestClient ? (
                  <div>
                    <p className="text-2xl font-bold truncate">{peakStats.busiestClient.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(peakStats.busiestClient.total)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">--</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Section 3: Client Ranking Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{t("analytics.clientRanking")}</CardTitle>
                <Button variant="outline" size="sm" onClick={handleExportCSV}>
                  <Download className="h-4 w-4 mr-1.5" />
                  {t("analytics.export")}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {rankedClients.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t("analytics.noData")}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead
                        className="w-16 cursor-pointer select-none"
                        role="button"
                        tabIndex={0}
                        onClick={() => handleClientSort("rank")}
                        onKeyDown={(e) => e.key === "Enter" && handleClientSort("rank")}
                      >
                        {t("analytics.rank")}
                        <SortIndicator sortKey={clientSort} sortDir={clientSortDir} col="rank" />
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none"
                        role="button"
                        tabIndex={0}
                        onClick={() => handleClientSort("name")}
                        onKeyDown={(e) => e.key === "Enter" && handleClientSort("name")}
                      >
                        {t("clients.name")}
                        <SortIndicator sortKey={clientSort} sortDir={clientSortDir} col="name" />
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none"
                        role="button"
                        tabIndex={0}
                        onClick={() => handleClientSort("upload")}
                        onKeyDown={(e) => e.key === "Enter" && handleClientSort("upload")}
                      >
                        {t("common.upload")}
                        <SortIndicator sortKey={clientSort} sortDir={clientSortDir} col="upload" />
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none"
                        role="button"
                        tabIndex={0}
                        onClick={() => handleClientSort("download")}
                        onKeyDown={(e) => e.key === "Enter" && handleClientSort("download")}
                      >
                        {t("common.download")}
                        <SortIndicator
                          sortKey={clientSort}
                          sortDir={clientSortDir}
                          col="download"
                        />
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none"
                        role="button"
                        tabIndex={0}
                        onClick={() => handleClientSort("total")}
                        onKeyDown={(e) => e.key === "Enter" && handleClientSort("total")}
                      >
                        {t("analytics.total")}
                        <SortIndicator sortKey={clientSort} sortDir={clientSortDir} col="total" />
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none"
                        role="button"
                        tabIndex={0}
                        onClick={() => handleClientSort("connections")}
                        onKeyDown={(e) => e.key === "Enter" && handleClientSort("connections")}
                      >
                        {t("metrics.activeConnections")}
                        <SortIndicator
                          sortKey={clientSort}
                          sortDir={clientSortDir}
                          col="connections"
                        />
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none"
                        role="button"
                        tabIndex={0}
                        onClick={() => handleClientSort("latency")}
                        onKeyDown={(e) => e.key === "Enter" && handleClientSort("latency")}
                      >
                        {t("speedTest.latency")}
                        <SortIndicator
                          sortKey={clientSort}
                          sortDir={clientSortDir}
                          col="latency"
                        />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rankedClients.map((client, index) => (
                      <TableRow key={client.client_id}>
                        <TableCell className="font-medium">{index + 1}</TableCell>
                        <TableCell className="font-medium">
                          {client.client_name ?? client.client_id.slice(0, 8)}
                        </TableCell>
                        <TableCell>{formatBytes(client.bytes_up)}</TableCell>
                        <TableCell>{formatBytes(client.bytes_down)}</TableCell>
                        <TableCell className="font-medium">{formatBytes(client.total)}</TableCell>
                        <TableCell>{client.active_connections}</TableCell>
                        <TableCell>
                          {client.avgLatency > 0 ? `${client.avgLatency.toFixed(1)} ms` : "--"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Section 4: Connection Analytics */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Transport Distribution Pie */}
            <Card>
              <CardHeader>
                <CardTitle>{t("analytics.transportDistribution")}</CardTitle>
              </CardHeader>
              <CardContent>
                {transportDistribution.length === 0 ? (
                  <p className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
                    {t("common.noData")}
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={transportDistribution}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        innerRadius={40}
                        paddingAngle={2}
                        label={({ name, value }) => `${name}: ${value}`}
                        labelLine={false}
                      >
                        {transportDistribution.map((_entry, index) => (
                          <Cell
                            key={`transport-${index}`}
                            fill={PIE_COLORS[index % PIE_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Rule Match Breakdown Bar */}
            <Card>
              <CardHeader>
                <CardTitle>{t("analytics.ruleBreakdown")}</CardTitle>
              </CardHeader>
              <CardContent>
                {ruleBreakdown.length === 0 ? (
                  <p className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
                    {t("common.noData")}
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={ruleBreakdown} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 12 }}
                        className="text-muted-foreground"
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fontSize: 11 }}
                        className="text-muted-foreground"
                        width={120}
                      />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                        {ruleBreakdown.map((_entry, index) => (
                          <Cell
                            key={`rule-${index}`}
                            fill={BAR_COLORS[index % BAR_COLORS.length]}
                            fillOpacity={0.8}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
