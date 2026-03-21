"use client";

import { useInbounds } from "@/hooks/use-inbounds";
import { useI18n } from "@/lib/i18n";
import type { InboundSummary } from "@/lib/types";

const PROTOCOL_COLORS: Record<string, string> = {
  vmess: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  vless: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  shadowsocks: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  trojan: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

function ProtocolBadge({ protocol }: { protocol: string }) {
  const color = PROTOCOL_COLORS[protocol.toLowerCase()] ?? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${color}`}>
      {protocol.toUpperCase()}
    </span>
  );
}

function StatusDot({ enabled }: { enabled: boolean }) {
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${enabled ? "bg-green-500" : "bg-gray-400"}`} />
  );
}

interface InboundTableProps {
  onSelectTag?: (tag: string | null) => void;
  selectedTag?: string | null;
}

export function InboundTable({ onSelectTag, selectedTag }: InboundTableProps) {
  const { data: inbounds, isLoading, error } = useInbounds();
  const { t } = useI18n();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        {t("inbounds.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
        {t("inbounds.error")}: {(error as Error).message}
      </div>
    );
  }

  if (!inbounds || inbounds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-muted-foreground">
        <p className="text-sm">{t("inbounds.noInbounds")}</p>
        <p className="mt-1 text-xs">{t("inbounds.noInboundsHint")}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t("inbounds.tag")}</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t("inbounds.protocol")}</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t("inbounds.listen")}</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t("inbounds.transport")}</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">{t("inbounds.clients")}</th>
            <th className="px-4 py-3 text-center font-medium text-muted-foreground">{t("inbounds.status")}</th>
          </tr>
        </thead>
        <tbody>
          {inbounds.map((ib: InboundSummary) => {
            const isSelected = selectedTag === ib.tag;
            return (
              <tr
                key={ib.tag}
                className={`border-b last:border-0 cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-primary/5 hover:bg-primary/10"
                    : "hover:bg-muted/30"
                }`}
                onClick={() => onSelectTag?.(isSelected ? null : ib.tag)}
              >
                <td className="px-4 py-3">
                  <span className="font-medium text-primary">
                    {ib.tag}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <ProtocolBadge protocol={ib.protocol} />
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{ib.listen}</td>
                <td className="px-4 py-3 text-muted-foreground">{ib.transport}</td>
                <td className="px-4 py-3 text-right tabular-nums">{ib.client_count}</td>
                <td className="px-4 py-3 text-center">
                  <StatusDot enabled={ib.enabled} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
