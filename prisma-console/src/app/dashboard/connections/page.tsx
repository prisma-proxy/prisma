"use client";

import { useConnections, useDisconnect } from "@/hooks/use-connections";
import { ConnectionTable } from "@/components/dashboard/connection-table";
import { ExportDropdown } from "@/components/dashboard/export-dropdown";
import { useI18n } from "@/lib/i18n";
import { exportToCSV, exportToJSON } from "@/lib/export";
import { formatBytes } from "@/lib/utils";

export default function ConnectionsPage() {
  const { t } = useI18n();
  const { data: connections, isLoading } = useConnections();
  const disconnect = useDisconnect();

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("sidebar.connections")}</h2>
        <ExportDropdown onCSV={handleExportCSV} onJSON={handleExportJSON} />
      </div>

      <ConnectionTable
        connections={connections ?? []}
        onDisconnect={(sessionId) => disconnect.mutate(sessionId)}
      />
    </div>
  );
}
