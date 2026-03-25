"use client";

import { Network } from "lucide-react";
import { useConnections, useDisconnect } from "@/hooks/use-connections";
import { ConnectionTable } from "@/components/dashboard/connection-table";
import { ExportDropdown } from "@/components/dashboard/export-dropdown";
import { SkeletonTable } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/loading-placeholder";
import { useI18n } from "@/lib/i18n";
import { exportToCSV, exportToJSON } from "@/lib/export";
import { formatBytes } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

export default function ConnectionsPage() {
  const { t } = useI18n();
  const { data: connections, isLoading } = useConnections();
  const disconnect = useDisconnect();

  const totalUp = connections?.reduce((s, c) => s + c.bytes_up, 0) ?? 0;
  const totalDown = connections?.reduce((s, c) => s + c.bytes_down, 0) ?? 0;
  const activeCount = connections?.length ?? 0;

  const handleExportCSV = () => {
    if (!connections || connections.length === 0) return;
    const rows = connections.map((c) => ({
      session_id: c.session_id,
      client_id: c.client_id ?? "",
      client_name: c.client_name ?? "",
      peer_addr: c.peer_addr,
      transport: c.transport,
      mode: c.mode,
      connected_at: c.connected_at,
      bytes_up: c.bytes_up,
      bytes_down: c.bytes_down,
      bytes_up_formatted: formatBytes(c.bytes_up),
      bytes_down_formatted: formatBytes(c.bytes_down),
    }));
    exportToCSV(rows, `prisma-connections-${new Date().toISOString().slice(0, 19)}`);
  };

  const handleExportJSON = () => {
    if (!connections || connections.length === 0) return;
    exportToJSON(
      { exported_at: new Date().toISOString(), connections },
      `prisma-connections-${new Date().toISOString().slice(0, 19)}`
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("sidebar.connections")}</h2>
        {(connections?.length ?? 0) > 0 && (
          <ExportDropdown onCSV={handleExportCSV} onJSON={handleExportJSON} />
        )}
      </div>

      <div className="grid gap-4 grid-cols-3 mb-4">
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <p className="text-2xl font-bold">{activeCount}</p>
            <p className="text-xs text-muted-foreground">{t("metrics.activeConnections")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <p className="text-2xl font-bold text-blue-500">{formatBytes(totalUp)}</p>
            <p className="text-xs text-muted-foreground">{t("bandwidth.totalUpload")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <p className="text-2xl font-bold text-green-500">{formatBytes(totalDown)}</p>
            <p className="text-xs text-muted-foreground">{t("bandwidth.totalDownload")}</p>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <SkeletonTable rows={8} />
      ) : (connections?.length ?? 0) === 0 ? (
        <EmptyState
          icon={Network}
          title={t("empty.noConnections")}
          description={t("empty.noConnectionsHint")}
        />
      ) : (
        <ConnectionTable
          connections={connections ?? []}
          onDisconnect={(sessionId) => disconnect.mutate(sessionId)}
        />
      )}
    </div>
  );
}
