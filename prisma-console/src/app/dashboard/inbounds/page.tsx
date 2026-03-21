"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { InboundTable } from "@/components/inbounds/inbound-table";
import { InboundDetail } from "@/components/inbounds/inbound-detail";

export default function InboundsPage() {
  const { t } = useI18n();
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t("inbounds.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("inbounds.description")}</p>
      </div>

      <InboundTable onSelectTag={setSelectedTag} selectedTag={selectedTag} />

      {selectedTag && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold">{selectedTag}</h3>
            <button
              onClick={() => setSelectedTag(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t("common.close")}
            </button>
          </div>
          <InboundDetail tag={selectedTag} />
        </div>
      )}
    </div>
  );
}
