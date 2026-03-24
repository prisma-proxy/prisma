"use client";

import Link from "next/link";
import { useClients } from "@/hooks/use-clients";
import { useClientBandwidth, useUpdateClientBandwidth, useClientQuota, useUpdateClientQuota } from "@/hooks/use-bandwidth";
import { useClientMetrics, useClientMetricsHistory } from "@/hooks/use-client-metrics";
import { useConnections } from "@/hooks/use-connections";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { BandwidthCard } from "@/components/clients/bandwidth-card";
import { QuotaCard } from "@/components/clients/quota-card";
import { ClientTrafficChart } from "@/components/clients/client-traffic-chart";
import { formatBytes } from "@/lib/utils";
import { CHART_TOOLTIP_STYLE } from "@/lib/chart-utils";
import { ArrowLeft } from "lucide-react";

export default function ClientDetailPage({ clientId }: { clientId: string }) {
  const id = clientId;
  const { t } = useI18n();

  const { data: clients, isLoading: clientsLoading } = useClients();
  const { data: bandwidth } = useClientBandwidth(id);
  const { data: quota } = useClientQuota(id);
  const { data: connections } = useConnections();
  const { data: clientMetrics } = useClientMetrics(id);
  const { data: metricsHistory } = useClientMetricsHistory(id, "1h");
  const updateBandwidth = useUpdateClientBandwidth();
  const updateQuota = useUpdateClientQuota();

  const client = clients?.find((c) => c.id === id);
  const clientConnections = connections?.filter((c) => c.client_id === id) ?? [];

  if (clientsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/clients/">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" data-icon="inline-start" />
            {t("sidebar.clients")}
          </Button>
        </Link>
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">{t("clients.notFound")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/clients/">
          <Button variant="ghost" size="icon-sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">
            {client.name || t("clients.unnamed")}
          </h2>
          {client.enabled ? (
            <Badge className="bg-green-500/15 text-green-700 dark:text-green-400">
              {t("clients.active")}
            </Badge>
          ) : (
            <Badge className="bg-red-500/15 text-red-700 dark:text-red-400">
              {t("clients.disabled")}
            </Badge>
          )}
        </div>
      </div>

      <div className="text-xs font-mono text-muted-foreground">
        {t("clients.clientId")}: {client.id}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <BandwidthCard
          bandwidth={bandwidth}
          onSave={(data) => updateBandwidth.mutate({ id, data })}
          isPending={updateBandwidth.isPending}
        />
        <QuotaCard
          quota={quota}
          onSave={(data) => updateQuota.mutate({ id, data })}
          isPending={updateQuota.isPending}
        />
      </div>

      {/* Latency + connections metrics */}
      {clientMetrics && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-lg font-bold">
                {clientMetrics.latency_p50_ms != null
                  ? `${clientMetrics.latency_p50_ms.toFixed(1)} ms`
                  : "—"}
              </p>
              <p className="text-xs text-muted-foreground">Latency p50</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-lg font-bold">
                {clientMetrics.latency_p95_ms != null
                  ? `${clientMetrics.latency_p95_ms.toFixed(1)} ms`
                  : "—"}
              </p>
              <p className="text-xs text-muted-foreground">Latency p95</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-lg font-bold">
                {clientMetrics.latency_p99_ms != null
                  ? `${clientMetrics.latency_p99_ms.toFixed(1)} ms`
                  : "—"}
              </p>
              <p className="text-xs text-muted-foreground">Latency p99</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-lg font-bold">{clientMetrics.active_connections}</p>
              <p className="text-xs text-muted-foreground">
                Active / {clientMetrics.connection_count} total connections
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Traffic history chart */}
      {metricsHistory && metricsHistory.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Traffic History (1h)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={metricsHistory.map((p) => ({
                time: new Date(p.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                bytes_up: p.bytes_up,
                bytes_down: p.bytes_down,
              }))}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} className="text-muted-foreground" interval="preserveStartEnd" />
                <YAxis tickFormatter={(v: number) => formatBytes(v)} tick={{ fontSize: 10 }} className="text-muted-foreground" width={70} />
                <Tooltip
                  formatter={(value, name) => [formatBytes(Number(value)), name === "bytes_up" ? "Upload" : "Download"]}
                  contentStyle={CHART_TOOLTIP_STYLE}
                />
                <Area type="monotone" dataKey="bytes_up" name="bytes_up" stroke="hsl(217, 91%, 60%)" fill="hsl(217, 91%, 60%)" fillOpacity={0.15} strokeWidth={2} />
                <Area type="monotone" dataKey="bytes_down" name="bytes_down" stroke="hsl(142, 71%, 45%)" fill="hsl(142, 71%, 45%)" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <ClientTrafficChart
        connections={connections ?? []}
        clientId={id}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("clients.connections")}</CardTitle>
        </CardHeader>
        <CardContent>
          {clientConnections.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("connections.noConnections")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("connections.peer")}</TableHead>
                  <TableHead>{t("connections.transport")}</TableHead>
                  <TableHead>{t("connections.mode")}</TableHead>
                  <TableHead>{t("connections.bytesUp")}</TableHead>
                  <TableHead>{t("connections.bytesDown")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientConnections.map((conn) => (
                  <TableRow key={conn.session_id}>
                    <TableCell className="font-mono text-xs">
                      {conn.peer_addr}
                    </TableCell>
                    <TableCell>{conn.transport}</TableCell>
                    <TableCell>{conn.mode}</TableCell>
                    <TableCell>{formatBytes(conn.bytes_up)}</TableCell>
                    <TableCell>{formatBytes(conn.bytes_down)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
