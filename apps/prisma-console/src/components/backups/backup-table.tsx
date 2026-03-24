"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { formatBytes } from "@/lib/utils";
import type { BackupInfo } from "@/lib/types";
import { RotateCcw, FileDiff, Trash2, Download } from "lucide-react";
import { api } from "@/lib/api";
import { downloadFile } from "@/lib/export";

interface BackupTableProps {
  backups: BackupInfo[];
  onRestore: (name: string) => void;
  onDiff: (name: string) => void;
  onDelete: (name: string) => void;
  onBatchDelete?: (names: string[]) => void;
  deletingName?: string | null;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function BackupTable({
  backups,
  onRestore,
  onDiff,
  onDelete,
  onBatchDelete,
  deletingName,
}: BackupTableProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);

  function toggleSelect(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === backups.length
        ? new Set()
        : new Set(backups.map((b) => b.name))
    );
  }

  function handleBatchDelete() {
    if (onBatchDelete) onBatchDelete(Array.from(selected));
    setSelected(new Set());
    setBatchConfirmOpen(false);
  }

  async function handleDownload(name: string) {
    try {
      const content = await api.getBackup(name);
      const filename = name.endsWith(".toml") ? name : `${name}.toml`;
      downloadFile(content, filename, "application/toml");
    } catch {
      toast(t("toast.downloadError"), "error");
    }
  }

  if (backups.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t("backups.noBackups")}
      </p>
    );
  }

  const allSelected = selected.size === backups.length;

  return (
    <>
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-1">
          <span className="text-sm text-muted-foreground">
            {t("common.selectedCount", { count: selected.size })}
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setBatchConfirmOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" data-icon="inline-start" />
            {t("common.deleteSelected", { count: selected.size })}
          </Button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="rounded"
                aria-label="Select all"
              />
            </TableHead>
            <TableHead>{t("backups.name")}</TableHead>
            <TableHead>{t("backups.timestamp")}</TableHead>
            <TableHead>{t("backups.size")}</TableHead>
            <TableHead className="text-right">{t("backups.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {backups.map((backup) => (
            <TableRow key={backup.name} data-state={selected.has(backup.name) ? "selected" : undefined}>
              <TableCell>
                <input
                  type="checkbox"
                  checked={selected.has(backup.name)}
                  onChange={() => toggleSelect(backup.name)}
                  className="rounded"
                  aria-label={`Select ${backup.name}`}
                />
              </TableCell>
              <TableCell className="font-medium">{backup.name}</TableCell>
              <TableCell className="text-muted-foreground">
                {formatTimestamp(backup.timestamp)}
              </TableCell>
              <TableCell>{formatBytes(backup.size)}</TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDownload(backup.name)}
                  >
                    <Download className="h-3.5 w-3.5" data-icon="inline-start" />
                    {t("backups.download")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRestore(backup.name)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" data-icon="inline-start" />
                    {t("backups.restore")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onDiff(backup.name)}
                  >
                    <FileDiff className="h-3.5 w-3.5" data-icon="inline-start" />
                    {t("backups.diff")}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => onDelete(backup.name)}
                    disabled={deletingName === backup.name}
                  >
                    <Trash2 className="h-3.5 w-3.5" data-icon="inline-start" />
                    {deletingName === backup.name
                      ? t("backups.deleting")
                      : t("backups.delete")}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ConfirmDialog
        open={batchConfirmOpen}
        onOpenChange={(open) => { if (!open) setBatchConfirmOpen(false); }}
        title={t("common.delete")}
        description={t("backups.deleteBatchConfirm", { count: selected.size })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="destructive"
        onConfirm={handleBatchDelete}
      />
    </>
  );
}
