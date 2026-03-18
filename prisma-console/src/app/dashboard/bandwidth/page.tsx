"use client";

import { useBandwidthSummary } from "@/hooks/use-bandwidth";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BandwidthSummaryTable } from "@/components/bandwidth/bandwidth-summary-table";
import { QuotaOverviewChart } from "@/components/bandwidth/quota-overview-chart";

export default function BandwidthPage() {
  const { t } = useI18n();
  const { data: summary, isLoading } = useBandwidthSummary();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  const clients = summary?.clients ?? [];

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">{t("bandwidth.title")}</h2>

      <Card>
        <CardHeader>
          <CardTitle>{t("bandwidth.summary")}</CardTitle>
        </CardHeader>
        <CardContent>
          <BandwidthSummaryTable clients={clients} />
        </CardContent>
      </Card>

      <QuotaOverviewChart clients={clients} />
    </div>
  );
}
