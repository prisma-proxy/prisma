"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitCompareArrows } from "lucide-react";
import { api } from "@/lib/api";
import { computeDiff } from "@/lib/diff";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DiffViewer } from "./diff-viewer";
import { useI18n } from "@/lib/i18n";
import type { BackupInfo } from "@/lib/types";

interface BackupCompareProps {
  backups: BackupInfo[];
}

export function BackupCompare({ backups }: BackupCompareProps) {
  const { t } = useI18n();
  const [leftName, setLeftName] = useState<string>("");
  const [rightName, setRightName] = useState<string>("");
  const [showDiff, setShowDiff] = useState(false);

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

  const bothSelected = !!leftContent && !!rightContent && leftName !== rightName;

  const diff = useMemo(() => {
    if (!bothSelected) return undefined;
    const left = typeof leftContent === "string" ? leftContent : JSON.stringify(leftContent, null, 2);
    const right = typeof rightContent === "string" ? rightContent : JSON.stringify(rightContent, null, 2);
    return { changes: computeDiff(left, right) };
  }, [leftContent, rightContent, bothSelected]);

  if (backups.length < 2) return null;

  return (
    <>
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

          {bothSelected && (
            <Button variant="outline" size="sm" onClick={() => setShowDiff(true)}>
              <GitCompareArrows className="h-4 w-4" />
              {t("backups.viewDiff")}
            </Button>
          )}
        </CardContent>
      </Card>

      <DiffViewer
        open={showDiff}
        onOpenChange={setShowDiff}
        backupName={`${leftName} → ${rightName}`}
        diff={diff}
        isLoading={false}
      />
    </>
  );
}
