"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { ClientBandwidthSummaryEntry } from "@/lib/types";

interface BandwidthSummaryTableProps {
  clients: ClientBandwidthSummaryEntry[];
}

function formatBps(bps: number): string {
  if (bps <= 0) return "0 bps";
  const units = ["bps", "Kbps", "Mbps", "Gbps"];
  const k = 1000;
  const i = Math.min(Math.floor(Math.log(bps) / Math.log(k)), units.length - 1);
  return `${(bps / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

export function BandwidthSummaryTable({ clients }: BandwidthSummaryTableProps) {
  const { t } = useI18n();

  if (clients.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t("common.noData")}
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("clients.name")}</TableHead>
          <TableHead>{t("bandwidth.upload")}</TableHead>
          <TableHead>{t("bandwidth.download")}</TableHead>
          <TableHead>{t("quota.total")}</TableHead>
          <TableHead>{t("quota.used")}</TableHead>
          <TableHead>{t("bandwidth.usage")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {clients.map((client) => {
          const quotaPercent =
            client.quota_bytes > 0
              ? Math.round((client.quota_used / client.quota_bytes) * 100)
              : 0;
          const hasQuota = client.quota_bytes > 0;

          return (
            <TableRow key={client.client_id}>
              <TableCell className="font-medium">
                {client.client_name || client.client_id.slice(0, 8)}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {formatBps(client.upload_bps)}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {formatBps(client.download_bps)}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {hasQuota ? formatBytes(client.quota_bytes) : t("bandwidth.unlimited")}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {hasQuota ? formatBytes(client.quota_used) : "\u2014"}
              </TableCell>
              <TableCell>
                {hasQuota ? (
                  <Badge
                    className={
                      quotaPercent >= 90
                        ? "bg-red-500/15 text-red-700 dark:text-red-400"
                        : quotaPercent >= 70
                        ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
                        : "bg-green-500/15 text-green-700 dark:text-green-400"
                    }
                  >
                    {quotaPercent}%
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">\u2014</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
