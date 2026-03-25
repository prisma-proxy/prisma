"use client";

import { useBandwidthSummary } from "@/hooks/use-bandwidth";
import { useAllClientMetrics } from "@/hooks/use-client-metrics";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BandwidthSummaryTable } from "@/components/bandwidth/bandwidth-summary-table";
import { QuotaOverviewChart } from "@/components/bandwidth/quota-overview-chart";
import { SkeletonTable, SkeletonChart, SkeletonCard } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/utils";
import { ArrowUp, ArrowDown, Users } from "lucide-react";

export default function BandwidthPage() {
  const { t } = useI18n();
  const { data: summary, isLoading } = useBandwidthSummary();
  const { data: metrics, isLoading: metricsLoading } = useAllClientMetrics();

  const clients = summary?.clients ?? [];

  const totalUp = metrics?.reduce((s, m) => s + m.bytes_up, 0) ?? 0;
  const totalDown = metrics?.reduce((s, m) => s + m.bytes_down, 0) ?? 0;
  const totalActive = metrics?.reduce((s, m) => s + m.active_connections, 0) ?? 0;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">{t("bandwidth.title")}</h2>

      {/* Metrics summary */}
      {metricsLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : metrics && metrics.length > 0 ? (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <ArrowUp className="h-5 w-5 text-blue-500" />
                <div>
                  <p className="text-lg font-bold">{formatBytes(totalUp)}</p>
                  <p className="text-xs text-muted-foreground">{t("bandwidth.totalUpload")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <ArrowDown className="h-5 w-5 text-green-500" />
                <div>
                  <p className="text-lg font-bold">{formatBytes(totalDown)}</p>
                  <p className="text-xs text-muted-foreground">{t("bandwidth.totalDownload")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-purple-500" />
                <div>
                  <p className="text-lg font-bold">{totalActive}</p>
                  <p className="text-xs text-muted-foreground">{t("metrics.activeConnections")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("bandwidth.summary")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <SkeletonTable rows={4} />
          ) : (
            <BandwidthSummaryTable clients={clients} />
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <SkeletonChart height={200} />
      ) : (
        <QuotaOverviewChart clients={clients} />
      )}
    </div>
  );
}
