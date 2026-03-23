"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useI18n } from "@/lib/i18n";
import { LoadingPlaceholder } from "@/components/ui/loading-placeholder";
import ClientDetailPage from "@/components/clients/client-detail";

function ClientDetailContent() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");

  if (!id) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">{t("clients.noClientId")}</p>
      </div>
    );
  }

  return <ClientDetailPage clientId={id} />;
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingPlaceholder />}>
      <ClientDetailContent />
    </Suspense>
  );
}
