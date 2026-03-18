"use client";

import Link from "next/link";
import { UserPlus, Archive, ScrollText } from "lucide-react";
import { useMetrics } from "@/hooks/use-metrics";
import { useConnections, useDisconnect } from "@/hooks/use-connections";
import { MetricsCards } from "@/components/dashboard/metrics-cards";
import { TrafficChart } from "@/components/dashboard/traffic-chart";
import { ConnectionTable } from "@/components/dashboard/connection-table";
import { TransportPie } from "@/components/dashboard/transport-pie";
import { ConnectionHistogram } from "@/components/dashboard/connection-histogram";
import { HistoricalCharts } from "@/components/dashboard/historical-charts";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export default function OverviewPage() {
  const { t } = useI18n();
  const { current, history } = useMetrics();
  const { data: connections, isLoading: connectionsLoading } = useConnections();
  const disconnect = useDisconnect();

  return (
    <div className="space-y-6">
      <MetricsCards metrics={current} />

      {/* Quick Actions */}
      <div className="flex gap-2 flex-wrap">
        <Link href="/dashboard/clients/new/">
          <Button variant="outline" size="sm">
            <UserPlus className="h-4 w-4 mr-1" />
            {t("dashboard.createClient")}
          </Button>
        </Link>
        <Link href="/dashboard/backups/">
          <Button variant="outline" size="sm">
            <Archive className="h-4 w-4 mr-1" />
            {t("dashboard.viewBackups")}
          </Button>
        </Link>
        <Link href="/dashboard/logs/">
          <Button variant="outline" size="sm">
            <ScrollText className="h-4 w-4 mr-1" />
            {t("dashboard.viewLogs")}
          </Button>
        </Link>
      </div>

      <TrafficChart history={history} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TransportPie connections={connections ?? []} />
        <ConnectionHistogram connections={connections ?? []} />
      </div>

      <HistoricalCharts />

      {connectionsLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        </div>
      ) : (
        <ConnectionTable
          connections={connections ?? []}
          onDisconnect={(sessionId) => disconnect.mutate(sessionId)}
        />
      )}
    </div>
  );
}
