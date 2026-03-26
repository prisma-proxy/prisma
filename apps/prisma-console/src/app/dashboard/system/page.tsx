"use client";

import { useSystemInfo } from "@/hooks/use-system-info";
import { useI18n } from "@/lib/i18n";
import { SystemCards } from "@/components/system/system-cards";
import { ListenersList } from "@/components/system/listeners-list";
import { ResourceChart } from "@/components/system/resource-chart";
import { SkeletonCard } from "@/components/ui/skeleton";

export default function SystemPage() {
  const { t } = useI18n();
  const { data: info, isLoading } = useSystemInfo();

  if (isLoading || !info) {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold">{t("system.title")}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">{t("system.title")}</h2>
      <SystemCards info={info} />
      <ResourceChart />
      <ListenersList listeners={info.listeners} />
    </div>
  );
}
