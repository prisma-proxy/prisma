"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { KeyValue } from "@/components/ui/key-value";
import type { ConfigResponse } from "@/lib/types";

interface CamouflageFormProps {
  config: ConfigResponse;
  onSave: (data: Record<string, unknown>) => void;
  isLoading: boolean;
}

export function CamouflageForm({ config, onSave, isLoading: saving }: CamouflageFormProps) {
  const { t } = useI18n();

  // Editable camouflage fields
  const [camouflageEnabled, setCamouflageEnabled] = useState<boolean | null>(null);
  const [tlsOnTcp, setTlsOnTcp] = useState<boolean | null>(null);
  const [fallbackAddr, setFallbackAddr] = useState<string | null>(null);
  // Editable CDN fields
  const [cdnEnabled, setCdnEnabled] = useState<boolean | null>(null);
  const [cdnListenAddr, setCdnListenAddr] = useState<string | null>(null);
  const [cdnExposeManagementApi, setCdnExposeManagementApi] = useState<boolean | null>(null);
  const [cdnPaddingHeader, setCdnPaddingHeader] = useState<boolean | null>(null);
  const [cdnEnableSseDisguise, setCdnEnableSseDisguise] = useState<boolean | null>(null);

  const effectiveCamouflageEnabled = camouflageEnabled ?? config.camouflage.enabled;
  const effectiveTlsOnTcp = tlsOnTcp ?? config.camouflage.tls_on_tcp;
  const effectiveFallbackAddr = fallbackAddr ?? config.camouflage.fallback_addr ?? "";
  const effectiveCdnEnabled = cdnEnabled ?? config.cdn.enabled;
  const effectiveCdnListenAddr = cdnListenAddr ?? config.cdn.listen_addr;
  const effectiveCdnExposeManagementApi = cdnExposeManagementApi ?? config.cdn.expose_management_api;
  const effectiveCdnPaddingHeader = cdnPaddingHeader ?? config.cdn.padding_header;
  const effectiveCdnEnableSseDisguise = cdnEnableSseDisguise ?? config.cdn.enable_sse_disguise;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      camouflage_enabled: effectiveCamouflageEnabled,
      camouflage_tls_on_tcp: effectiveTlsOnTcp,
      camouflage_fallback_addr: effectiveFallbackAddr || undefined,
      cdn_enabled: effectiveCdnEnabled,
      cdn_listen_addr: effectiveCdnListenAddr,
      cdn_expose_management_api: effectiveCdnExposeManagementApi,
      cdn_padding_header: effectiveCdnPaddingHeader,
      cdn_enable_sse_disguise: effectiveCdnEnableSseDisguise,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.camouflage")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <Label htmlFor="camouflage-enabled">{t("settings.status")}</Label>
            <Switch
              id="camouflage-enabled"
              checked={effectiveCamouflageEnabled}
              onCheckedChange={(v: boolean) => setCamouflageEnabled(v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="tls-on-tcp">{t("settings.tlsOnTcp")}</Label>
            <Switch
              id="tls-on-tcp"
              checked={effectiveTlsOnTcp}
              onCheckedChange={(v: boolean) => setTlsOnTcp(v)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fallback-addr">{t("settings.fallbackAddr")}</Label>
            <Input
              id="fallback-addr"
              value={effectiveFallbackAddr}
              onChange={(e) => setFallbackAddr(e.target.value)}
              placeholder="e.g. 127.0.0.1:8080"
            />
          </div>
          <KeyValue
            label="ALPN"
            value={
              <span className="font-mono text-xs">
                {config.camouflage.alpn_protocols?.join(", ") || "\u2014"}
              </span>
            }
          />
          <KeyValue
            label={t("settings.camouflageSalamander")}
            value={
              <span className="font-mono text-xs">
                {config.camouflage.salamander_password ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "\u2014"}
              </span>
            }
          />
          <KeyValue
            label={t("settings.camouflageH3")}
            value={
              <span className="font-mono text-xs">
                {config.camouflage.h3_cover_site || "\u2014"}
              </span>
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>CDN</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <Label htmlFor="cdn-enabled">{t("settings.cdnEnabled")}</Label>
            <Switch
              id="cdn-enabled"
              checked={effectiveCdnEnabled}
              onCheckedChange={(v: boolean) => setCdnEnabled(v)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cdn-listen-addr">{t("settings.cdnListenAddr")}</Label>
            <Input
              id="cdn-listen-addr"
              value={effectiveCdnListenAddr}
              onChange={(e) => setCdnListenAddr(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="cdn-expose-mgmt">{t("settings.exposeManagementApi")}</Label>
            <Switch
              id="cdn-expose-mgmt"
              checked={effectiveCdnExposeManagementApi}
              onCheckedChange={(v: boolean) => setCdnExposeManagementApi(v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="cdn-padding-header">{t("settings.paddingHeader")}</Label>
            <Switch
              id="cdn-padding-header"
              checked={effectiveCdnPaddingHeader}
              onCheckedChange={(v: boolean) => setCdnPaddingHeader(v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="cdn-sse-disguise">{t("settings.sseDisguise")}</Label>
            <Switch
              id="cdn-sse-disguise"
              checked={effectiveCdnEnableSseDisguise}
              onCheckedChange={(v: boolean) => setCdnEnableSseDisguise(v)}
            />
          </div>
          {([
            [t("settings.cdnWsPath"),        config.cdn.ws_tunnel_path],
            [t("settings.cdnGrpcPath"),      config.cdn.grpc_tunnel_path],
            [t("settings.cdnXhttpUpload"),   config.cdn.xhttp_upload_path],
            [t("settings.cdnXhttpDownload"), config.cdn.xhttp_download_path],
            [t("settings.cdnXhttpStream"),   config.cdn.xhttp_stream_path],
            [t("settings.cdnCoverSite"),     config.cdn.cover_upstream],
          ] as const).map(([label, val]) => (
            <KeyValue
              key={label}
              label={label}
              value={<span className="font-mono text-xs">{val || "\u2014"}</span>}
            />
          ))}
          <KeyValue
            label={t("settings.cdnXporta")}
            value={config.cdn.xporta_enabled ? t("settings.yes") : t("settings.no")}
          />
        </CardContent>
      </Card>

      <Button type="submit" disabled={saving}>
        {saving ? t("settings.saving") : t("settings.save")}
      </Button>
    </form>
  );
}
