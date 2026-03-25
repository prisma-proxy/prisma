"use client";

import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { ConfigForm } from "@/components/settings/config-form";
import { CamouflageForm } from "@/components/settings/camouflage-form";
import { TrafficForm } from "@/components/settings/traffic-form";
import { SecurityForm } from "@/components/settings/security-form";
import { AlertsForm } from "@/components/settings/alerts-form";
import { ConfigDiffDialog } from "@/components/settings/config-diff-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SkeletonCard } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RefreshCw, Download, Upload } from "lucide-react";
import { exportToJSON } from "@/lib/export";
import { PresetSelector } from "@/components/settings/preset-selector";

export default function SettingsPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reloading, setReloading] = React.useState(false);

  // Config diff dialog state
  const [diffOpen, setDiffOpen] = React.useState(false);
  const [pendingOriginal, setPendingOriginal] = React.useState<Record<string, unknown>>({});
  const [pendingUpdate, setPendingUpdate] = React.useState<Record<string, unknown>>({});

  const handleReload = async () => {
    setReloading(true);
    try {
      await api.reloadConfig();
      queryClient.invalidateQueries({ queryKey: ["config"] });
      toast(t("toast.reloadSuccess"), "success");
    } catch {
      toast(t("toast.reloadFailed"), "error");
    } finally {
      setReloading(false);
    }
  };

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ["config"],
    queryFn: api.getConfig,
  });

  const { data: tls } = useQuery({
    queryKey: ["tls"],
    queryFn: api.getTlsInfo,
    staleTime: 60_000,
  });

  const patchConfig = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patchConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] });
      toast(t("toast.settingsSaved"), "success");
      setDiffOpen(false);
    },
    onError: (error: Error) => {
      toast(error.message, "error");
    },
  });

  /** Build a flat snapshot of the current config for the keys being changed */
  const buildOriginalSnapshot = React.useCallback(
    (updatedKeys: Record<string, unknown>): Record<string, unknown> => {
      if (!config) return {};
      // Build a flat map from the current config for only the keys in the update
      const flat: Record<string, unknown> = {
        listen_addr: config.listen_addr,
        quic_listen_addr: config.quic_listen_addr,
        dns_upstream: config.dns_upstream,
        logging_level: config.logging_level,
        logging_format: config.logging_format,
        max_connections: config.performance.max_connections,
        connection_timeout_secs: config.performance.connection_timeout_secs,
        port_forwarding_enabled: config.port_forwarding.enabled,
        port_forwarding_port_range_start: config.port_forwarding.port_range_start,
        port_forwarding_port_range_end: config.port_forwarding.port_range_end,
        auto_backup_interval_mins: config.auto_backup_interval_mins,
        management_api_enabled: config.management_api?.enabled,
        camouflage_enabled: config.camouflage.enabled,
        camouflage_tls_on_tcp: config.camouflage.tls_on_tcp,
        camouflage_fallback_addr: config.camouflage.fallback_addr,
        cdn_enabled: config.cdn.enabled,
        cdn_listen_addr: config.cdn.listen_addr,
        cdn_expose_management_api: config.cdn.expose_management_api,
        cdn_padding_header: config.cdn.padding_header,
        cdn_enable_sse_disguise: config.cdn.enable_sse_disguise,
        traffic_shaping_padding_mode: config.traffic_shaping.padding_mode,
        traffic_shaping_timing_jitter_ms: config.traffic_shaping.timing_jitter_ms,
        traffic_shaping_chaff_interval_ms: config.traffic_shaping.chaff_interval_ms,
        traffic_shaping_coalesce_window_ms: config.traffic_shaping.coalesce_window_ms,
        congestion_mode: config.congestion.mode,
        congestion_target_bandwidth: config.congestion.target_bandwidth,
        port_hopping_enabled: config.port_hopping.enabled,
        port_hopping_base_port: config.port_hopping.base_port,
        port_hopping_range: config.port_hopping.range,
        port_hopping_interval_secs: config.port_hopping.interval_secs,
        port_hopping_grace_period_secs: config.port_hopping.grace_period_secs,
        anti_rtt_enabled: config.anti_rtt.enabled,
        anti_rtt_normalization_ms: config.anti_rtt.normalization_ms,
        allow_transport_only_cipher: config.allow_transport_only_cipher,
        prisma_tls_enabled: config.prisma_tls.enabled,
        prisma_tls_mask_server_count: config.prisma_tls.mask_server_count,
        prisma_tls_auth_rotation_hours: config.prisma_tls.auth_rotation_hours,
        padding_min: config.padding.min,
        padding_max: config.padding.max,
      };
      // Only keep keys that appear in the update
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(updatedKeys)) {
        result[key] = flat[key];
      }
      return result;
    },
    [config],
  );

  /** Show the diff dialog before saving */
  const handleSaveWithDiff = React.useCallback(
    (data: Record<string, unknown>) => {
      const original = buildOriginalSnapshot(data);
      setPendingOriginal(original);
      setPendingUpdate(data);
      setDiffOpen(true);
    },
    [buildOriginalSnapshot],
  );

  const handleConfirmSave = React.useCallback(() => {
    patchConfig.mutate(pendingUpdate);
  }, [patchConfig, pendingUpdate]);

  // Config export/import
  const importFileRef = React.useRef<HTMLInputElement>(null);
  const [importConfirmOpen, setImportConfirmOpen] = React.useState(false);
  const [importData, setImportData] = React.useState<Record<string, unknown> | null>(null);
  const [importing, setImporting] = React.useState(false);

  const handleExportConfig = React.useCallback(async () => {
    try {
      const currentConfig = await api.getConfig();
      exportToJSON(currentConfig, `prisma-config-${new Date().toISOString().slice(0, 10)}`);
      toast(t("settings.exportSuccess"), "success");
    } catch {
      toast(t("common.error"), "error");
    }
  }, [t, toast]);

  const handleImportFileChange = React.useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        setImportData(parsed as Record<string, unknown>);
        setImportConfirmOpen(true);
      } catch {
        toast(t("common.error"), "error");
      } finally {
        if (importFileRef.current) {
          importFileRef.current.value = "";
        }
      }
    },
    [t, toast]
  );

  const handleConfirmImport = React.useCallback(async () => {
    if (!importData) return;
    setImporting(true);
    try {
      await api.patchConfig(importData);
      queryClient.invalidateQueries({ queryKey: ["config"] });
      toast(t("settings.importSuccess"), "success");
      setImportConfirmOpen(false);
      setImportData(null);
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setImporting(false);
    }
  }, [importData, queryClient, t, toast]);

  if (configLoading) {
    return (
      <div className="space-y-6">
        <SkeletonCard className="h-12" />
        <SkeletonCard className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">{t("sidebar.settings")}</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportConfig}>
            <Download className="h-3.5 w-3.5" />
            {t("settings.exportConfig")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => importFileRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            {t("settings.importConfig")}
          </Button>
          <input
            ref={importFileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFileChange}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleReload}
            disabled={reloading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${reloading ? "animate-spin" : ""}`} />
            {reloading ? t("settings.reloading") : t("settings.reloadConfig")}
          </Button>
        </div>
      </div>

      <PresetSelector />

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">{t("settings.general")}</TabsTrigger>
          <TabsTrigger value="camouflage">{t("settings.camouflage")}</TabsTrigger>
          <TabsTrigger value="traffic">{t("settings.traffic")}</TabsTrigger>
          <TabsTrigger value="security">{t("settings.security")}</TabsTrigger>
          <TabsTrigger value="alerts">{t("settings.alerts")}</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.general")}</CardTitle>
            </CardHeader>
            <CardContent>
              {config && (
                <ConfigForm
                  key={`${config.logging_level}-${config.logging_format}-${config.performance.max_connections}-${config.port_forwarding.enabled}`}
                  config={config}
                  onSave={handleSaveWithDiff}
                  isLoading={patchConfig.isPending}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="camouflage">
          {config && (
            <CamouflageForm
              key={`camo-${config.camouflage.enabled}-${config.cdn.enabled}`}
              config={config}
              onSave={handleSaveWithDiff}
              isLoading={patchConfig.isPending}
            />
          )}
        </TabsContent>

        <TabsContent value="traffic">
          {config && (
            <TrafficForm
              key={`traffic-${config.traffic_shaping.padding_mode}-${config.port_hopping.enabled}`}
              config={config}
              onSave={handleSaveWithDiff}
              isLoading={patchConfig.isPending}
            />
          )}
        </TabsContent>

        <TabsContent value="security">
          {config && (
            <SecurityForm
              key={`security-${config.allow_transport_only_cipher}-${config.prisma_tls.enabled}`}
              config={config}
              tls={tls}
              onSave={handleSaveWithDiff}
              isLoading={patchConfig.isPending}
            />
          )}
        </TabsContent>

        <TabsContent value="alerts">
          <AlertsForm />
        </TabsContent>
      </Tabs>

      <ConfigDiffDialog
        open={diffOpen}
        onOpenChange={setDiffOpen}
        original={pendingOriginal}
        updated={pendingUpdate}
        onConfirm={handleConfirmSave}
        isPending={patchConfig.isPending}
      />

      <ConfirmDialog
        open={importConfirmOpen}
        onOpenChange={setImportConfirmOpen}
        title={t("settings.importConfirmTitle")}
        description={t("settings.importConfirmDescription")}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        variant="destructive"
        onConfirm={handleConfirmImport}
        isPending={importing}
      />
    </div>
  );
}
