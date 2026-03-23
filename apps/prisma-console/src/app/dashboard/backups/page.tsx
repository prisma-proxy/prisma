"use client";

import { useState } from "react";
import { Archive, Plus } from "lucide-react";
import { useBackups, useCreateBackup, useRestoreBackup, useDeleteBackup, useBackupDiff } from "@/hooks/use-backups";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BackupTable } from "@/components/backups/backup-table";
import { BackupCompare } from "@/components/backups/backup-compare";
import { DiffViewer } from "@/components/backups/diff-viewer";
import { RestoreDialog } from "@/components/backups/restore-dialog";
import { SkeletonTable } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/loading-placeholder";

export default function BackupsPage() {
  const { t } = useI18n();
  const { data: backups, isLoading } = useBackups();
  const createBackup = useCreateBackup();
  const restoreBackup = useRestoreBackup();
  const deleteBackup = useDeleteBackup();

  const [restoreName, setRestoreName] = useState<string | null>(null);
  const [diffName, setDiffName] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  const { data: diffData, isLoading: diffLoading } = useBackupDiff(diffName);

  const handleRestore = (name: string) => {
    setRestoreName(name);
  };

  const handleConfirmRestore = () => {
    if (restoreName) {
      restoreBackup.mutate(restoreName, {
        onSuccess: () => setRestoreName(null),
      });
    }
  };

  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null);

  const handleDelete = (name: string) => {
    setConfirmDeleteName(name);
  };

  const handleConfirmDelete = () => {
    if (confirmDeleteName) {
      setDeletingName(confirmDeleteName);
      deleteBackup.mutate(confirmDeleteName, {
        onSettled: () => {
          setDeletingName(null);
          setConfirmDeleteName(null);
        },
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("backups.title")}</h2>
        <Button
          onClick={() => createBackup.mutate()}
          disabled={createBackup.isPending}
        >
          <Plus className="h-4 w-4" data-icon="inline-start" />
          {createBackup.isPending ? t("backups.creating") : t("backups.create")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("backups.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <SkeletonTable rows={3} />
          ) : (backups?.length ?? 0) === 0 ? (
            <EmptyState
              icon={Archive}
              title={t("empty.noBackups")}
              description={t("empty.noBackupsHint")}
              action={
                <Button
                  size="sm"
                  onClick={() => createBackup.mutate()}
                  disabled={createBackup.isPending}
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  {t("backups.create")}
                </Button>
              }
            />
          ) : (
            <BackupTable
              backups={backups ?? []}
              onRestore={handleRestore}
              onDiff={(name) => setDiffName(name)}
              onDelete={handleDelete}
              deletingName={deletingName}
            />
          )}
        </CardContent>
      </Card>

      {/* Backup comparison */}
      {(backups?.length ?? 0) >= 2 && (
        <BackupCompare backups={backups ?? []} />
      )}

      {/* Restore confirmation dialog */}
      <RestoreDialog
        open={restoreName !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreName(null);
        }}
        backupName={restoreName ?? ""}
        onConfirm={handleConfirmRestore}
        isPending={restoreBackup.isPending}
      />

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

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={confirmDeleteName !== null}
        onOpenChange={(open) => { if (!open) setConfirmDeleteName(null); }}
        title={t("common.delete")}
        description={t("backups.deleteConfirm")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="destructive"
        onConfirm={handleConfirmDelete}
        isPending={deleteBackup.isPending}
      />
    </div>
  );
}
