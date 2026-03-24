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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SkeletonCard } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { PresetSelector } from "@/components/settings/preset-selector";

export default function SettingsPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reloading, setReloading] = React.useState(false);

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
    },
    onError: (error: Error) => {
      toast(error.message, "error");
    },
  });

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
                  onSave={(data) => patchConfig.mutate(data)}
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
              onSave={(data) => patchConfig.mutate(data)}
              isLoading={patchConfig.isPending}
            />
          )}
        </TabsContent>

        <TabsContent value="traffic">
          {config && (
            <TrafficForm
              key={`traffic-${config.traffic_shaping.padding_mode}-${config.port_hopping.enabled}`}
              config={config}
              onSave={(data) => patchConfig.mutate(data)}
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
              onSave={(data) => patchConfig.mutate(data)}
              isLoading={patchConfig.isPending}
            />
          )}
        </TabsContent>

        <TabsContent value="alerts">
          <AlertsForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
