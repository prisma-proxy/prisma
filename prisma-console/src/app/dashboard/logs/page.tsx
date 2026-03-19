"use client";

import { useLogs } from "@/hooks/use-logs";
import { LogViewer } from "@/components/logs/log-viewer";
import { LogFilters } from "@/components/logs/log-filters";
import { Button } from "@/components/ui/button";
import { ExportDropdown } from "@/components/dashboard/export-dropdown";
import { useI18n } from "@/lib/i18n";
import { exportToCSV, exportToJSON } from "@/lib/export";

export default function LogsPage() {
  const { t } = useI18n();
  const { logs, setFilter, clearLogs } = useLogs();

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
      <div className="flex items-center justify-between">
        <LogFilters onFilterChange={setFilter} />
        <div className="flex items-center gap-2">
          <ExportDropdown onCSV={handleExportCSV} onJSON={handleExportJSON} />
          <Button variant="outline" size="sm" onClick={clearLogs}>
            {t("logs.clear")}
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <LogViewer logs={logs} />
      </div>
    </div>
  );
}
