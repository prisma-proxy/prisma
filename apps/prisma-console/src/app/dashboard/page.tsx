"use client";

import { useState, useEffect, useMemo, type ReactNode } from "react";
import Link from "next/link";
import {
  UserPlus,
  Archive,
  ScrollText,
  Settings,
  Pencil,
  RotateCcw,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
} from "lucide-react";
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
import { useDashboardStore } from "@/lib/dashboard-store";
import { useRole } from "@/components/auth/role-guard";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import type { SubscriptionInfo } from "@/lib/types";

/** Widget wrapper that adds edit-mode controls */
function WidgetWrapper({
  id,
  index,
  total,
  children,
}: {
  id: string;
  index: number;
  total: number;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const editMode = useDashboardStore((s) => s.editMode);
  const hiddenWidgets = useDashboardStore((s) => s.hiddenWidgets);
  const moveWidget = useDashboardStore((s) => s.moveWidget);
  const toggleWidget = useDashboardStore((s) => s.toggleWidget);

  const isHidden = hiddenWidgets.includes(id);

  if (!editMode && isHidden) return null;

  return (
    <div className={`relative ${editMode ? "ring-1 ring-dashed ring-border rounded-lg p-1" : ""} ${editMode && isHidden ? "opacity-40" : ""}`}>
      {editMode && (
        <div className="absolute -top-3 right-2 z-10 flex items-center gap-1 rounded-md bg-background border px-1 py-0.5 shadow-sm">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => moveWidget(index, Math.max(0, index - 1))}
            disabled={index === 0}
            aria-label="Move up"
            className="h-5 w-5"
          >
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => moveWidget(index, Math.min(total - 1, index + 1))}
            disabled={index === total - 1}
            aria-label="Move down"
            className="h-5 w-5"
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => toggleWidget(id)}
            aria-label={isHidden ? t("dashboard.showWidget") : t("dashboard.hideWidget")}
            className="h-5 w-5"
          >
            {isHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </Button>
        </div>
      )}
      {children}
    </div>
  );
}

/** Client-role dashboard: shows only owned clients + subscription status */
function ClientDashboard() {
  const { t } = useI18n();
  const { data: clients } = useClients();
  const { data: subscriptions } = useQuery({
    queryKey: ["subscription"],
    queryFn: api.getSubscription,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">{t("dashboard.overview")}</h1>

      {/* My Clients */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">My Clients</CardTitle>
        </CardHeader>
        <CardContent>
          {!clients?.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No clients yet. Redeem a code to get started.
            </p>
          ) : (
            <div className="space-y-2">
              {clients.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">{c.name || "Unnamed"}</span>
                    <code className="ml-2 text-xs text-muted-foreground">{c.id.slice(0, 8)}...</code>
                  </div>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${c.enabled ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-red-500/10 text-red-700 dark:text-red-400"}`}>
                    {c.enabled ? "Active" : "Disabled"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Subscription Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Subscription Status</CardTitle>
        </CardHeader>
        <CardContent>
          {!subscriptions?.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No active subscriptions.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Code</th>
                    <th className="py-2 pr-4 font-medium">Client</th>
                    <th className="py-2 pr-4 font-medium">Quota</th>
                    <th className="py-2 font-medium">Redeemed</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.map((sub: SubscriptionInfo, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4"><code className="text-xs">{sub.code}</code></td>
                      <td className="py-2 pr-4 text-xs font-mono">{sub.client_id.slice(0, 8)}...</td>
                      <td className="py-2 pr-4 text-xs">{sub.quota || "Unlimited"}</td>
                      <td className="py-2 text-xs">{new Date(sub.redeemed_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="flex gap-2 flex-wrap">
        <Link href="/dashboard/redeem/">
          <Button variant="outline" size="sm">
            Redeem Code
          </Button>
        </Link>
        <Link href="/dashboard/clients/">
          <Button variant="outline" size="sm">
            My Clients
          </Button>
        </Link>
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const { t } = useI18n();
  const { role } = useRole();
  const { current, history, connected, loading } = useMetricsContext();
  const { data: connections, isLoading: connectionsLoading } = useConnections();
  const disconnect = useDisconnect();
  const { data: clients } = useClients();

  const widgetOrder = useDashboardStore((s) => s.widgetOrder);
  const hiddenWidgets = useDashboardStore((s) => s.hiddenWidgets);
  const editMode = useDashboardStore((s) => s.editMode);
  const setEditMode = useDashboardStore((s) => s.setEditMode);
  const resetLayout = useDashboardStore((s) => s.resetLayout);

  const [wizardDismissed, setWizardDismissed] = useState(false);

  // Sync from localStorage after mount
  useEffect(() => {
    if (localStorage.getItem("prisma-setup-complete") === "true") {
      setWizardDismissed(true);
    }
  }, []);

  const showWizard = !wizardDismissed && clients !== undefined && clients.length === 0;

  /** Build a map of widget ID -> JSX for ordered rendering */
  const widgetMap = useMemo(() => {
    const map: Record<string, ReactNode> = {};

    map["health"] = (
      <>
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
      </>
    );

    map["metrics"] = (
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
    );

    map["traffic-chart"] = (
      <>
        {history.length === 0 ? (
          <SkeletonChart />
        ) : (
          <TrafficChart history={history.slice(-61)} />
        )}
      </>
    );

    map["transport-pie"] = (
      <div className="grid gap-6 lg:grid-cols-2">
        <TransportPie connections={connections ?? []} />
        <ConnectionHistogram connections={connections ?? []} />
      </div>
    );

    map["geoip"] = (
      <div className="grid gap-6 lg:grid-cols-2">
        <GeoIPPie />
        <HistoricalCharts />
      </div>
    );

    map["connection-map"] = <ConnectionMap />;

    map["prometheus"] = (
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
    );

    map["connections"] = (
      <>
        {connectionsLoading ? (
          <SkeletonTable rows={5} />
        ) : (
          <ConnectionTable
            connections={connections ?? []}
            onDisconnect={(sessionId) => disconnect.mutate(sessionId)}
          />
        )}
      </>
    );

    return map;
  }, [current, history, connections, connectionsLoading, disconnect, t]);

  // Client-role users get a simplified dashboard
  if (role === "client") {
    return <ClientDashboard />;
  }

  // Visible widget IDs in order (for indexing in edit mode)
  const visibleOrder = editMode
    ? widgetOrder
    : widgetOrder.filter((id) => !hiddenWidgets.includes(id));

  if (showWizard) {
    return <SetupWizard onDismiss={() => setWizardDismissed(true)} />;
  }

  return (
    <div className="space-y-6">
      {/* Page header with edit controls */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t("dashboard.overview")}</h1>
        <div className="flex items-center gap-2">
          {editMode && (
            <Button variant="outline" size="sm" onClick={resetLayout}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              {t("dashboard.resetLayout")}
            </Button>
          )}
          <Button
            variant={editMode ? "default" : "outline"}
            size="sm"
            onClick={() => setEditMode(!editMode)}
          >
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            {t("dashboard.editLayout")}
          </Button>
        </div>
      </div>

      {/* Connection error banner */}
      {!connected && !current && !loading && (
        <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-400">
          {t("dashboard.connectionError")}
        </div>
      )}

      {/* Render widgets in customizable order */}
      {visibleOrder.map((widgetId, index) => {
        const content = widgetMap[widgetId];
        if (!content) return null;
        return (
          <WidgetWrapper
            key={widgetId}
            id={widgetId}
            index={index}
            total={visibleOrder.length}
          >
            {content}
          </WidgetWrapper>
        );
      })}
    </div>
  );
}
