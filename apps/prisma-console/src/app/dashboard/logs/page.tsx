"use client";

import { useState, useEffect } from "react";
import { ScrollText } from "lucide-react";
import { useLogs } from "@/hooks/use-logs";
import { LogViewer } from "@/components/logs/log-viewer";
import { LogFilters } from "@/components/logs/log-filters";
import { Button } from "@/components/ui/button";
import { ExportDropdown } from "@/components/dashboard/export-dropdown";
import { EmptyState } from "@/components/ui/loading-placeholder";
import { useI18n } from "@/lib/i18n";
import { exportToCSV, exportToJSON } from "@/lib/export";

export default function LogsPage() {
  const { t } = useI18n();
  const { logs, setFilter, clearLogs, connectionStatus } = useLogs();

  // Show hint if connected but no logs after 5 seconds
  const [showNoLogsHint, setShowNoLogsHint] = useState(false);
  useEffect(() => {
    if (connectionStatus === "connected" && logs.length === 0) {
      const timer = setTimeout(() => setShowNoLogsHint(true), 5000);
      return () => clearTimeout(timer);
    }
    setShowNoLogsHint(false);
  }, [connectionStatus, logs.length]);

  const handleExportCSV = () => {
    if (logs.length === 0) return;
    const rows = logs.map((entry) => ({
      timestamp: entry.timestamp,
      level: entry.level,
      target: entry.target,
      message: entry.message,
    }));
    exportToCSV(rows, `prisma-logs-${new Date().toISOString().slice(0, 19)}`);
  };

  const handleExportJSON = () => {
    if (logs.length === 0) return;
    const entries = logs.map((entry) => ({
      timestamp: entry.timestamp,
      level: entry.level,
      target: entry.target,
      message: entry.message,
    }));
    exportToJSON(
      { exported_at: new Date().toISOString(), count: entries.length, entries },
      `prisma-logs-${new Date().toISOString().slice(0, 19)}`
    );
  };

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <LogFilters onFilterChange={setFilter} />
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`inline-block h-2 w-2 rounded-full ${
              connectionStatus === "connected" ? "bg-green-500" :
              connectionStatus === "disconnected" ? "bg-red-500" :
              "bg-yellow-500 animate-pulse"
            }`} />
            {connectionStatus === "connected" ? t("logs.wsConnected") :
             connectionStatus === "disconnected" ? t("logs.wsDisconnected") :
             connectionStatus === "reconnecting" ? t("logs.wsReconnecting") :
             t("logs.wsConnecting")}
          </span>
          {logs.length > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {logs.length.toLocaleString()} entries
            </span>
          )}
          <ExportDropdown onCSV={handleExportCSV} onJSON={handleExportJSON} />
          <Button variant="outline" size="sm" onClick={clearLogs}>
            {t("logs.clear")}
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {logs.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={t("empty.noLogs")}
            description={showNoLogsHint
              ? t("logs.noLogsHint")
              : t("empty.noLogsHint")
            }
          />
        ) : (
          <LogViewer logs={logs} />
        )}
      </div>
    </div>
  );
}
