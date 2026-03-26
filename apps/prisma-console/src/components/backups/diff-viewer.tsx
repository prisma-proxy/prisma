"use client";

import { useCallback, useMemo } from "react";
import { Copy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { highlightToml } from "@/lib/toml-highlight";
import { cn } from "@/lib/utils";
import type { BackupDiff } from "@/lib/types";

interface DiffViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backupName: string;
  diff: BackupDiff | undefined;
  isLoading: boolean;
}

export function DiffViewer({
  open,
  onOpenChange,
  backupName,
  diff,
  isLoading,
}: DiffViewerProps) {
  const { t } = useI18n();
  const { toast } = useToast();

  const handleCopy = useCallback(() => {
    if (!diff) return;
    const text = diff.changes
      .map((c) => {
        if (c.tag === "equal") return `  ${c.old_value ?? ""}`;
        if (c.tag === "delete") return `- ${c.old_value ?? ""}`;
        if (c.tag === "insert") return `+ ${c.new_value ?? ""}`;
        return "";
      })
      .join("\n");
    navigator.clipboard.writeText(text);
    toast(t("common.copied"), "success");
  }, [diff, toast, t]);

  const summary = useMemo(() => {
    if (!diff) return null;
    const added = diff.changes.filter((c) => c.tag === "insert").length;
    const removed = diff.changes.filter((c) => c.tag === "delete").length;
    const total = diff.changes.filter((c) => c.tag !== "equal").length;
    return { total, added, removed };
  }, [diff]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="truncate">
            {t("backups.diffTitle")}: {backupName}
          </DialogTitle>
        </DialogHeader>

        {/* Diff summary */}
        {summary && summary.total > 0 && (
          <p className="text-xs text-muted-foreground px-1">
            {summary.total} {t("backups.diffSummary")}
            {" ("}
            <span className="text-green-600 dark:text-green-400">+{summary.added} {t("backups.added")}</span>
            {", "}
            <span className="text-red-600 dark:text-red-400">-{summary.removed} {t("backups.removed")}</span>
            {")"}
          </p>
        )}

        <div className="overflow-y-auto max-h-[60vh] rounded-lg border bg-muted/20">
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : diff && diff.changes.length > 0 ? (
            <div className="font-mono text-xs leading-5">
              {diff.changes.map((change, idx) => {
                const content = change.tag === "insert" ? change.new_value ?? "" : change.old_value ?? "";
                const prefix = change.tag === "delete" ? "−" : change.tag === "insert" ? "+" : " ";

                return (
                  <div
                    key={idx}
                    className={cn(
                      "flex border-b border-border/30 last:border-b-0",
                      change.tag === "delete" && "bg-red-500/8 dark:bg-red-500/10",
                      change.tag === "insert" && "bg-green-500/8 dark:bg-green-500/10",
                    )}
                  >
                    {/* Line number gutter */}
                    <span className="w-9 shrink-0 select-none text-right pr-2 py-px text-muted-foreground/40 border-r border-border/30">
                      {idx + 1}
                    </span>
                    {/* Diff indicator */}
                    <span
                      className={cn(
                        "w-5 shrink-0 text-center py-px select-none",
                        change.tag === "delete" && "text-red-600 dark:text-red-400",
                        change.tag === "insert" && "text-green-600 dark:text-green-400",
                        change.tag === "equal" && "text-muted-foreground/30",
                      )}
                    >
                      {prefix}
                    </span>
                    {/* Content with TOML highlighting */}
                    <span className="flex-1 px-2 py-px whitespace-pre overflow-x-auto">
                      {highlightToml(content)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("common.noData")}</p>
          )}
        </div>

        <DialogFooter className="flex sm:flex-row sm:justify-between gap-2">
          {diff && diff.changes.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="h-3.5 w-3.5 mr-1.5" />
              {t("common.copy")}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
