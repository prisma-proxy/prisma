"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { formatDuration } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TlsInfo } from "@/components/settings/tls-info";
import { ForwardsTable } from "@/components/server/forwards-table";

export default function ServersPage() {
  const { t } = useI18n();

  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ["health"],
    queryFn: api.getHealth,
    refetchInterval: 10000,
  });

  const { data: config, isLoading: configLoading } = useQuery({
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
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">{t("server.loadingInfo")}</p>
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
            <div>
              <p className="text-sm text-muted-foreground">{t("settings.listenAddr")}</p>
              <p className="text-sm font-mono">{config.listen_addr}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("settings.quicListenAddr")}</p>
              <p className="text-sm font-mono">{config.quic_listen_addr}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("settings.maxConnections")}</p>
              <p className="text-sm font-mono">{config.performance.max_connections}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("settings.connectionTimeout")}</p>
              <p className="text-sm font-mono">{config.performance.connection_timeout_secs}s</p>
            </div>
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
                  {config.port_forwarding.port_range_start}–{config.port_forwarding.port_range_end}
                </p>
              </div>
            )}
            <div>
              <p className="text-sm text-muted-foreground">{t("settings.loggingLevel")}</p>
              <p className="text-sm font-mono">{config.logging_level}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("settings.loggingFormat")}</p>
              <p className="text-sm font-mono">{config.logging_format}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {tls && <TlsInfo tls={tls} />}

      <ForwardsTable forwards={forwards ?? []} />
    </div>
  );
}
