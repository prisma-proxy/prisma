"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { formatBytes } from "@/lib/utils";
import type { BackupInfo } from "@/lib/types";
import { RotateCcw, FileDiff, Trash2, Download } from "lucide-react";
import { api } from "@/lib/api";

interface BackupTableProps {
  backups: BackupInfo[];
  onRestore: (name: string) => void;
  onDiff: (name: string) => void;
  onDelete: (name: string) => void;
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

async function handleDownload(name: string) {
  try {
    const content = await api.getBackup(name);
    const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
    const blob = new Blob([text], { type: "application/toml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name.endsWith(".toml") ? name : `${name}.toml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    // Download failed silently
  }
}

export function BackupTable({
  backups,
  onRestore,
  onDiff,
  onDelete,
  deletingName,
}: BackupTableProps) {
  const { t } = useI18n();

  if (backups.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t("backups.noBackups")}
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("backups.name")}</TableHead>
          <TableHead>{t("backups.timestamp")}</TableHead>
          <TableHead>{t("backups.size")}</TableHead>
          <TableHead className="text-right">{t("backups.actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {backups.map((backup) => (
          <TableRow key={backup.name}>
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
  );
}
