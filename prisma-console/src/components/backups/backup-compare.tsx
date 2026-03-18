"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import type { BackupInfo } from "@/lib/types";

interface BackupCompareProps {
  backups: BackupInfo[];
}

export function BackupCompare({ backups }: BackupCompareProps) {
  const { t } = useI18n();
  const [leftName, setLeftName] = useState<string>("");
  const [rightName, setRightName] = useState<string>("");

  const { data: leftContent } = useQuery({
    queryKey: ["backup-content", leftName],
    queryFn: () => api.getBackup(leftName),
    enabled: !!leftName,
  });

  const { data: rightContent } = useQuery({
    queryKey: ["backup-content", rightName],
    queryFn: () => api.getBackup(rightName),
    enabled: !!rightName,
  });

  if (backups.length < 2) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("backups.compare")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">{t("backups.compareLeft")}</label>
            <Select value={leftName} onValueChange={(v) => v && setLeftName(v)}>
              <SelectTrigger>
                <SelectValue placeholder={t("backups.selectBackup")} />
              </SelectTrigger>
              <SelectContent>
                {backups.map((b) => (
                  <SelectItem key={b.name} value={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">{t("backups.compareRight")}</label>
            <Select value={rightName} onValueChange={(v) => v && setRightName(v)}>
              <SelectTrigger>
                <SelectValue placeholder={t("backups.selectBackup")} />
              </SelectTrigger>
              <SelectContent>
                {backups.map((b) => (
                  <SelectItem key={b.name} value={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {leftContent && rightContent && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{leftName}</p>
              <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs font-mono">
                {typeof leftContent === "string" ? leftContent : JSON.stringify(leftContent, null, 2)}
              </pre>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{rightName}</p>
              <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs font-mono">
                {typeof rightContent === "string" ? rightContent : JSON.stringify(rightContent, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
