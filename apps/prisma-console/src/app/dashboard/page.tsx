"use client";

import { useState } from "react";
import Link from "next/link";
import { UserPlus, Archive, ScrollText, Settings } from "lucide-react";
import { useMetricsContext } from "@/contexts/metrics-context";
import { useConnections, useDisconnect } from "@/hooks/use-connections";
import { useClients } from "@/hooks/use-clients";
import { MetricsCards } from "@/components/dashboard/metrics-cards";
import { HealthScore } from "@/components/dashboard/health-score";
import { TrafficChart } from "@/components/dashboard/traffic-chart";
import { ConnectionTable } from "@/components/dashboard/connection-table";
import { TransportPie } from "@/components/dashboard/transport-pie";
import { GeoIPPie } from "@/components/dashboard/geoip-pie";
import { ConnectionMap } from "@/components/dashboard/connection-map";
import { ConnectionHistogram } from "@/components/dashboard/connection-histogram";
import { HistoricalCharts } from "@/components/dashboard/historical-charts";
import { SetupWizard } from "@/components/onboarding/setup-wizard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { SkeletonMetrics, SkeletonChart, SkeletonTable } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";

export default function OverviewPage() {
  const { t } = useI18n();
  const { current, history, connected, loading } = useMetricsContext();
  const { data: connections, isLoading: connectionsLoading } = useConnections();
  const disconnect = useDisconnect();
  const { data: clients } = useClients();

  const [wizardDismissed, setWizardDismissed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("prisma-setup-complete") === "true"
  );

  const showWizard = !wizardDismissed && clients !== undefined && clients.length === 0;

  if (showWizard) {
    return <SetupWizard onDismiss={() => setWizardDismissed(true)} />;
  }

  return (
    <div className="space-y-6">
      {/* Connection error banner — only show after 3s grace period */}
      {!connected && !current && !loading && (
        <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-400">
          {t("dashboard.connectionError")}
        </div>
      )}

      {/* Health score + Metrics cards with sparklines */}
      {!current ? (
        <SkeletonMetrics />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr]">
            <HealthScore />
            <MetricsCards metrics={current} history={history} />
          </div>
        </div>
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

      {/* Traffic chart — live mode capped at last 60s */}
      {history.length === 0 ? (
        <SkeletonChart />
      ) : (
        <TrafficChart history={history.slice(-61)} />
      )}

      {/* Distribution charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <TransportPie connections={connections ?? []} />
        <ConnectionHistogram connections={connections ?? []} />
      </div>

      {/* GeoIP + historical */}
      <div className="grid gap-6 lg:grid-cols-2">
        <GeoIPPie />
        <HistoricalCharts />
      </div>

      {/* Connection world map */}
      <ConnectionMap />

      {/* Prometheus metrics endpoint */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t("prometheus.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-2">
            {t("prometheus.description")}
          </p>
          <div className="flex items-center gap-2">
            <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">
              {typeof window !== "undefined" ? `${window.location.origin}/api/prometheus` : "/api/prometheus"}
            </code>
            <CopyButton value={typeof window !== "undefined" ? `${window.location.origin}/api/prometheus` : "/api/prometheus"} />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {t("prometheus.hint")}
          </p>
        </CardContent>
      </Card>

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
