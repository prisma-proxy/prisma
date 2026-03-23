"use client";

import { useInbound } from "@/hooks/use-inbounds";
import { useI18n } from "@/lib/i18n";
import type { InboundClient } from "@/lib/types";

interface InboundDetailProps {
  tag: string;
}

export function InboundDetail({ tag }: InboundDetailProps) {
  const { data: inbound, isLoading, error } = useInbound(tag);
  const { t } = useI18n();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        {t("inbounds.loading")}
      </div>
    );
  }

  if (error || !inbound) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
        {error ? (error as Error).message : t("inbounds.notFound")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Inbound config summary */}
      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          {t("inbounds.configuration")}
        </h3>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t("inbounds.tag")}</dt>
          <dd className="font-medium">{inbound.tag}</dd>

          <dt className="text-muted-foreground">{t("inbounds.protocol")}</dt>
          <dd className="font-medium uppercase">{inbound.protocol}</dd>

          <dt className="text-muted-foreground">{t("inbounds.listen")}</dt>
          <dd className="font-mono text-xs">{inbound.listen}</dd>

          <dt className="text-muted-foreground">{t("inbounds.transport")}</dt>
          <dd>{inbound.transport}</dd>

          <dt className="text-muted-foreground">{t("inbounds.status")}</dt>
          <dd>
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${inbound.enabled ? "text-green-600" : "text-gray-500"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${inbound.enabled ? "bg-green-500" : "bg-gray-400"}`} />
              {inbound.enabled ? t("inbounds.enabled") : t("inbounds.disabled")}
            </span>
          </dd>

          {inbound.method && (
            <>
              <dt className="text-muted-foreground">{t("inbounds.method")}</dt>
              <dd className="font-mono text-xs">{inbound.method}</dd>
            </>
          )}

          {inbound.transport_settings.path && (
            <>
              <dt className="text-muted-foreground">{t("inbounds.path")}</dt>
              <dd className="font-mono text-xs">{inbound.transport_settings.path}</dd>
            </>
          )}

          {inbound.transport_settings.service_name && (
            <>
              <dt className="text-muted-foreground">{t("inbounds.serviceName")}</dt>
              <dd className="font-mono text-xs">{inbound.transport_settings.service_name}</dd>
            </>
          )}
        </dl>
      </div>

      {/* Client list */}
      <div className="rounded-lg border">
        <div className="border-b px-4 py-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t("inbounds.clientList")} ({inbound.clients.length})
          </h3>
        </div>

        {inbound.clients.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t("inbounds.noClients")}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {inbound.protocol !== "trojan" && (
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">ID</th>
                )}
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">{t("inbounds.email")}</th>
                {inbound.protocol === "vless" && (
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">{t("inbounds.flow")}</th>
                )}
                {inbound.protocol === "vmess" && (
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">{t("inbounds.alterId")}</th>
                )}
                {inbound.protocol === "trojan" && (
                  <th className="px-4 py-2 text-center font-medium text-muted-foreground">{t("inbounds.password")}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {inbound.clients.map((client: InboundClient, i: number) => (
                <tr key={client.id ?? client.email ?? i} className="border-b last:border-0">
                  {inbound.protocol !== "trojan" && (
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {client.id ?? "-"}
                    </td>
                  )}
                  <td className="px-4 py-2">{client.email ?? "-"}</td>
                  {inbound.protocol === "vless" && (
                    <td className="px-4 py-2 text-xs">
                      {client.flow ? (
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                          {client.flow}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                  )}
                  {inbound.protocol === "vmess" && (
                    <td className="px-4 py-2 text-right tabular-nums">{client.alter_id ?? 0}</td>
                  )}
                  {inbound.protocol === "trojan" && (
                    <td className="px-4 py-2 text-center">
                      {client.has_password ? (
                        <span className="text-green-600 text-xs font-medium">{t("inbounds.passwordSet")}</span>
                      ) : (
                        <span className="text-red-600 text-xs font-medium">{t("inbounds.passwordNotSet")}</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
