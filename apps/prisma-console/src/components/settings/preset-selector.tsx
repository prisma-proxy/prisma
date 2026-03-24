"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { api } from "@/lib/api";
import { CONFIG_PRESETS } from "@/lib/presets";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function PresetSelector() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const handleApply = async (presetId: string, config: Record<string, unknown>) => {
    setApplyingId(presetId);
    try {
      await api.patchConfig(config);
      queryClient.invalidateQueries({ queryKey: ["config"] });
      toast(t("toast.presetApplied"), "success");
    } catch {
      toast(t("toast.settingsError"), "error");
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">{t("presets.title")}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CONFIG_PRESETS.map((preset) => {
          const Icon = preset.icon;
          const isApplying = applyingId === preset.id;

          return (
            <Card key={preset.id} size="sm">
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium leading-snug">{t(preset.nameKey)}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                      {t(preset.descKey)}
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  className="w-full"
                  disabled={isApplying}
                  onClick={() => handleApply(preset.id, preset.config)}
                >
                  {isApplying ? t("presets.applying") : t("presets.apply")}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
