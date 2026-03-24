"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { UserPlus, Archive, ScrollText, Settings } from "lucide-react";
import { useMetricsContext } from "@/contexts/metrics-context";
import { useConnections, useDisconnect } from "@/hooks/use-connections";
import { useClients } from "@/hooks/use-clients";
import { MetricsCards } from "@/components/dashboard/metrics-cards";
import { TrafficChart } from "@/components/dashboard/traffic-chart";
import { ConnectionTable } from "@/components/dashboard/connection-table";
import { TransportPie } from "@/components/dashboard/transport-pie";
import { ConnectionHistogram } from "@/components/dashboard/connection-histogram";
import { HistoricalCharts } from "@/components/dashboard/historical-charts";
import { SetupWizard } from "@/components/onboarding/setup-wizard";
import { Button } from "@/components/ui/button";
import { SkeletonMetrics, SkeletonChart, SkeletonTable } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";

export default function OverviewPage() {
  const { t } = useI18n();
  const { current, history, connected } = useMetricsContext();
  const { data: connections, isLoading: connectionsLoading } = useConnections();
  const disconnect = useDisconnect();
  const { data: clients } = useClients();

  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    const setupComplete = localStorage.getItem("prisma-setup-complete") === "true";
    if (!setupComplete && clients !== undefined && clients.length === 0) {
      setShowWizard(true);
    }
  }, [clients]);

  if (showWizard) {
    return <SetupWizard onDismiss={() => setShowWizard(false)} />;
  }

  return (
    <div className="space-y-6">
      {/* Connection error banner */}
      {!connected && !current && (
        <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-400">
          {t("dashboard.connectionError")}
        </div>
      )}

      {/* Metrics cards with sparklines */}
      {!current ? (
        <SkeletonMetrics />
      ) : (
        <MetricsCards metrics={current} history={history} />
      )}

      {/* Quick Actions */}
      <div className="flex gap-2 flex-wrap">
        <Link href="/dashboard/clients/new/">
          <Button variant="outline" size="sm">
            <UserPlus className="h-4 w-4 mr-1.5" />
            {t("dashboard.createClient")}
          </Button>
        </Link>
        <Link href="/dashboard/backups/">
          <Button variant="outline" size="sm">
            <Archive className="h-4 w-4 mr-1.5" />
            {t("dashboard.viewBackups")}
          </Button>
        </Link>
        <Link href="/dashboard/logs/">
          <Button variant="outline" size="sm">
            <ScrollText className="h-4 w-4 mr-1.5" />
            {t("dashboard.viewLogs")}
          </Button>
        </Link>
        <Link href="/dashboard/settings/">
          <Button variant="outline" size="sm">
            <Settings className="h-4 w-4 mr-1.5" />
            {t("sidebar.settings")}
          </Button>
        </Link>
      </div>

      {/* Traffic chart */}
      {history.length === 0 ? (
        <SkeletonChart />
      ) : (
        <TrafficChart history={history} />
      )}

      {/* Distribution charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <TransportPie connections={connections ?? []} />
        <ConnectionHistogram connections={connections ?? []} />
      </div>

      <HistoricalCharts />

      {/* Connections table */}
      {connectionsLoading ? (
        <SkeletonTable rows={5} />
      ) : (
        <ConnectionTable
          connections={connections ?? []}
          onDisconnect={(sessionId) => disconnect.mutate(sessionId)}
        />
      )}
    </div>
  );
}
