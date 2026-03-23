"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { formatDuration } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TlsInfo } from "@/components/settings/tls-info";
import { ForwardsTable } from "@/components/server/forwards-table";
import { SkeletonCard } from "@/components/ui/skeleton";

export default function ServersPage() {
  const { t } = useI18n();

  const { data: health, isLoading: healthLoading, error: healthError } = useQuery({
    queryKey: ["health"],
    queryFn: api.getHealth,
    refetchInterval: 10000,
  });

  const { data: config, isLoading: configLoading, error: configError } = useQuery({
    queryKey: ["config"],
    queryFn: api.getConfig,
  });

  const { data: tls, isLoading: tlsLoading } = useQuery({
    queryKey: ["tls"],
    queryFn: api.getTlsInfo,
  });

  const { data: forwards } = useQuery({
    queryKey: ["forwards"],
    queryFn: api.getForwards,
    refetchInterval: 5000,
  });

  if (healthLoading || configLoading || tlsLoading) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonCard className="h-48" />
        <SkeletonCard />
      </div>
    );
  }

  if (healthError || configError) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-sm text-destructive">
              {t("common.error")}: {(healthError ?? configError)?.message ?? t("common.noData")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {health && (
        <Card>
          <CardHeader>
            <CardTitle>{t("server.health")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{t("server.status")}:</span>
              <Badge className="bg-green-500/15 text-green-700 dark:text-green-400">
                {health.status}
              </Badge>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("server.version")}</p>
              <p className="text-sm font-mono">{health.version}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("server.uptime")}</p>
              <p className="text-sm font-mono">{formatDuration(health.uptime_secs)}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {config && (
        <Card>
          <CardHeader>
            <CardTitle>{t("server.configuration")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: t("settings.listenAddr"),       value: config.listen_addr },
              { label: t("settings.quicListenAddr"),   value: config.quic_listen_addr },
              { label: t("settings.protocolVersion"),  value: config.protocol_version },
              { label: t("settings.dnsUpstream"),      value: config.dns_upstream },
              { label: t("settings.maxConnections"),   value: config.performance.max_connections },
              { label: t("settings.connectionTimeout"), value: `${config.performance.connection_timeout_secs}s` },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-sm font-mono">{value}</p>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{t("settings.portForwarding")}:</span>
              <Badge
                className={
                  config.port_forwarding.enabled
                    ? "bg-green-500/15 text-green-700 dark:text-green-400"
                    : "bg-red-500/15 text-red-700 dark:text-red-400"
                }
              >
                {config.port_forwarding.enabled ? t("common.enabled") : t("common.disabled")}
              </Badge>
            </div>
            {config.port_forwarding.enabled && (
              <div>
                <p className="text-sm text-muted-foreground">{t("settings.portForwardingRange")}</p>
                <p className="text-sm font-mono">
                  {config.port_forwarding.port_range_start}--{config.port_forwarding.port_range_end}
                </p>
              </div>
            )}
            {/* Camouflage */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{t("settings.camouflage")}:</span>
              <Badge
                className={
                  config.camouflage.enabled
                    ? "bg-green-500/15 text-green-700 dark:text-green-400"
                    : "bg-muted text-muted-foreground"
                }
              >
                {config.camouflage.enabled ? t("common.enabled") : t("common.disabled")}
              </Badge>
            </div>
            {config.camouflage.enabled && config.camouflage.fallback_addr && (
              <div>
                <p className="text-sm text-muted-foreground">{t("settings.fallbackAddr")}</p>
                <p className="text-sm font-mono">{config.camouflage.fallback_addr}</p>
              </div>
            )}
            {/* CDN */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{t("settings.cdnEnabled")}:</span>
              <Badge
                className={
                  config.cdn.enabled
                    ? "bg-green-500/15 text-green-700 dark:text-green-400"
                    : "bg-muted text-muted-foreground"
                }
              >
                {config.cdn.enabled ? t("common.enabled") : t("common.disabled")}
              </Badge>
            </div>
            {/* Routing rules */}
            <div>
              <p className="text-sm text-muted-foreground">{t("server.routingRulesCount")}</p>
              <p className="text-sm font-mono">{config.routing_rules_count}</p>
            </div>
            {[
              { label: t("settings.loggingLevel"),  value: config.logging_level },
              { label: t("settings.loggingFormat"), value: config.logging_format },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-sm font-mono">{value}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {tls && <TlsInfo tls={tls} />}

      <ForwardsTable forwards={forwards ?? []} />
    </div>
  );
}
