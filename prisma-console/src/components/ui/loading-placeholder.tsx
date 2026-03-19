"use client";

import { useI18n } from "@/lib/i18n";

export function LoadingPlaceholder({ message }: { message?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center py-12">
      <p className="text-sm text-muted-foreground">{message ?? t("common.loading")}</p>
    </div>
  );
}
