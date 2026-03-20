"use client";

import { Bell, AlertTriangle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useAlertConfig, useActiveAlerts } from "@/hooks/use-alerts";
import { useSystemInfo } from "@/hooks/use-system-info";
import { useBandwidthSummary } from "@/hooks/use-bandwidth";
import { useMetricsContext } from "@/contexts/metrics-context";
import { useI18n } from "@/lib/i18n";
import type { Alert } from "@/lib/alerts";

interface AlertBadgePropsExternal {
  alerts?: Alert[];
}

export function AlertBadge({ alerts: externalAlerts }: AlertBadgePropsExternal) {
  const { t } = useI18n();
  const { data: alertConfig } = useAlertConfig();
  const { data: systemInfo } = useSystemInfo();
  const { data: bandwidthSummary } = useBandwidthSummary();
  const { current: metrics } = useMetricsContext();

  const computedAlerts = useActiveAlerts(
    systemInfo,
    bandwidthSummary,
    metrics,
    alertConfig
  );

  const alerts = externalAlerts ?? computedAlerts;
  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="relative" />
        }
      >
        <Bell className="h-4 w-4" />
        {alerts.length > 0 && (
          <span
            className={`absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ${
              criticalCount > 0 ? "bg-red-500" : "bg-yellow-500"
            }`}
          >
            {alerts.length}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-80">
        <DropdownMenuLabel>
          {t("alerts.title")} ({alerts.length})
          {criticalCount > 0 && (
            <span className="ml-1 text-red-500">{criticalCount} {t("alerts.critical")}</span>
          )}
          {warningCount > 0 && (
            <span className="ml-1 text-yellow-600 dark:text-yellow-400">{warningCount} {t("alerts.warning")}</span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {alerts.length === 0 ? (
          <div className="px-1.5 py-3 text-center text-sm text-muted-foreground">
            {t("alerts.noAlerts")}
          </div>
        ) : (
          alerts.map((alert) => (
            <DropdownMenuItem key={alert.id} className="cursor-default">
              {alert.severity === "critical" ? (
                <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-500" />
              )}
              <span className="text-xs leading-tight">{alert.message}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
