"use client";

import { useState, useMemo } from "react";
import { History, Eye, RotateCcw } from "lucide-react";
import { useBackups, useBackupDiff, useRestoreBackup } from "@/hooks/use-backups";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { formatBytes } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DiffViewer } from "@/components/backups/diff-viewer";
import { RestoreDialog } from "@/components/backups/restore-dialog";
import type { BackupInfo } from "@/lib/types";

function formatDate(ts: string): string {
  const date = new Date(ts);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ConfigHistory() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { data: backups, isLoading } = useBackups();
  const restoreBackup = useRestoreBackup();

  const [diffName, setDiffName] = useState<string | null>(null);
  const [restoreName, setRestoreName] = useState<string | null>(null);

  const { data: diffData, isLoading: diffLoading } = useBackupDiff(diffName);

  const sortedBackups = useMemo(() => {
    if (!backups) return [];
    return [...backups].sort(
      (a: BackupInfo, b: BackupInfo) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [backups]);

  const handleConfirmRestore = () => {
    if (restoreName) {
      restoreBackup.mutate(restoreName, {
        onSuccess: () => {
          setRestoreName(null);
          toast(t("toast.backupRestored"), "success");
        },
      });
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            {t("settings.history")}
          </CardTitle>
          <CardDescription>{t("settings.historyDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : sortedBackups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("settings.noHistory")}</p>
          ) : (
            <div className="relative space-y-0">
              {/* Vertical timeline line */}
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />

              {sortedBackups.map((backup: BackupInfo, index: number) => (
                <div key={backup.name} className="relative flex gap-3 pb-4 last:pb-0">
                  {/* Timeline dot */}
                  <div className="relative z-10 mt-1.5 flex shrink-0">
                    <div
                      className={`h-3.5 w-3.5 rounded-full border-2 ${
                        index === 0
                          ? "border-primary bg-primary"
                          : "border-border bg-background"
                      }`}
                    />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{backup.name}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{formatDate(backup.timestamp)}</span>
                          <span>{formatBytes(backup.size)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setDiffName(backup.name)}
                          title={t("backups.viewDiff")}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setRestoreName(backup.name)}
                          title={t("backups.restore")}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Diff viewer dialog */}
      <DiffViewer
        open={diffName !== null}
        onOpenChange={(open) => {
          if (!open) setDiffName(null);
        }}
        backupName={diffName ?? ""}
        diff={diffData}
        isLoading={diffLoading}
      />

      {/* Restore dialog */}
      <RestoreDialog
        open={restoreName !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreName(null);
        }}
        backupName={restoreName ?? ""}
        onConfirm={handleConfirmRestore}
        isPending={restoreBackup.isPending}
      />
    </>
  );
}
