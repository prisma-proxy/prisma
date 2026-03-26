"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

interface ConfigDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  original: Record<string, unknown>;
  updated: Record<string, unknown>;
  onConfirm: () => void;
  isPending: boolean;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function getChanges(
  original: Record<string, unknown>,
  updated: Record<string, unknown>,
): Array<{ key: string; oldValue: string; newValue: string }> {
  const changes: Array<{ key: string; oldValue: string; newValue: string }> = [];
  const allKeys = new Set([...Object.keys(original), ...Object.keys(updated)]);

  for (const key of allKeys) {
    const oldVal = original[key];
    const newVal = updated[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push({
        key,
        oldValue: formatValue(oldVal),
        newValue: formatValue(newVal),
      });
    }
  }
  return changes;
}

export function ConfigDiffDialog({
  open,
  onOpenChange,
  original,
  updated,
  onConfirm,
  isPending,
}: ConfigDiffDialogProps) {
  const { t } = useI18n();
  const changes = React.useMemo(() => getChanges(original, updated), [original, updated]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{t("configDiff.title")}</DialogTitle>
        <DialogDescription>{t("configDiff.description")}</DialogDescription>

        {changes.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            {t("configDiff.noChanges")}
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto space-y-2 py-2">
            {changes.map(({ key, oldValue, newValue }) => (
              <div
                key={key}
                className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
              >
                <span className="font-medium text-foreground">{key}</span>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="inline-flex items-center rounded bg-red-500/10 px-1.5 py-0.5 text-red-700 dark:text-red-400 line-through">
                    {oldValue}
                  </span>
                  <span className="text-muted-foreground" aria-hidden>
                    &rarr;
                  </span>
                  <span className="inline-flex items-center rounded bg-green-500/10 px-1.5 py-0.5 text-green-700 dark:text-green-400">
                    {newValue}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isPending || changes.length === 0}
          >
            {isPending ? t("common.saving") : t("common.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
