"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { ConfigResponse } from "@/lib/types";

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

interface CamouflageFormProps {
  onSave?: (data: Record<string, unknown>) => void;
  isLoading?: boolean;
}

export function CamouflageForm({ onSave, isLoading: saving }: CamouflageFormProps) {
  const { t } = useI18n();
  const { data: config, isLoading } = useQuery({
    queryKey: ["config"],
    queryFn: api.getConfig,
  });

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

  if (isLoading || !config) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

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
    if (!onSave) return;
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
          {onSave ? (
            <>
              <div className="flex items-center justify-between">
                <Label htmlFor="camouflage-enabled">Status</Label>
                <Switch
                  id="camouflage-enabled"
                  checked={effectiveCamouflageEnabled}
                  onCheckedChange={(v: boolean) => setCamouflageEnabled(v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="tls-on-tcp">TLS on TCP</Label>
                <Switch
                  id="tls-on-tcp"
                  checked={effectiveTlsOnTcp}
                  onCheckedChange={(v: boolean) => setTlsOnTcp(v)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="fallback-addr">Fallback Address</Label>
                <Input
                  id="fallback-addr"
                  value={effectiveFallbackAddr}
                  onChange={(e) => setFallbackAddr(e.target.value)}
                  placeholder="e.g. 127.0.0.1:8080"
                />
              </div>
            </>
          ) : (
            <>
              <KeyValue
                label="Status"
                value={
                  <Badge
                    className={
                      config.camouflage.enabled
                        ? "bg-green-500/15 text-green-700 dark:text-green-400"
                        : "bg-red-500/15 text-red-700 dark:text-red-400"
                    }
                  >
                    {config.camouflage.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                }
              />
              <KeyValue
                label="TLS on TCP"
                value={config.camouflage.tls_on_tcp ? "Yes" : "No"}
              />
              <KeyValue
                label="Fallback Address"
                value={
                  <span className="font-mono text-xs">
                    {config.camouflage.fallback_addr || "\u2014"}
                  </span>
                }
              />
            </>
          )}
          <KeyValue
            label="ALPN"
            value={
              <span className="font-mono text-xs">
                {config.camouflage.alpn_protocols?.join(", ") || "\u2014"}
              </span>
            }
          />
          <KeyValue
            label="Salamander Password"
            value={
              <span className="font-mono text-xs">
                {config.camouflage.salamander_password ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "\u2014"}
              </span>
            }
          />
          <KeyValue
            label="HTTP/3 Cover Site"
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
          {onSave ? (
            <>
              <div className="flex items-center justify-between">
                <Label htmlFor="cdn-enabled">CDN Enabled</Label>
                <Switch
                  id="cdn-enabled"
                  checked={effectiveCdnEnabled}
                  onCheckedChange={(v: boolean) => setCdnEnabled(v)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cdn-listen-addr">CDN Listen Address</Label>
                <Input
                  id="cdn-listen-addr"
                  value={effectiveCdnListenAddr}
                  onChange={(e) => setCdnListenAddr(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="cdn-expose-mgmt">Expose Management API</Label>
                <Switch
                  id="cdn-expose-mgmt"
                  checked={effectiveCdnExposeManagementApi}
                  onCheckedChange={(v: boolean) => setCdnExposeManagementApi(v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="cdn-padding-header">Padding Header</Label>
                <Switch
                  id="cdn-padding-header"
                  checked={effectiveCdnPaddingHeader}
                  onCheckedChange={(v: boolean) => setCdnPaddingHeader(v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="cdn-sse-disguise">SSE Disguise</Label>
                <Switch
                  id="cdn-sse-disguise"
                  checked={effectiveCdnEnableSseDisguise}
                  onCheckedChange={(v: boolean) => setCdnEnableSseDisguise(v)}
                />
              </div>
            </>
          ) : (
            <KeyValue
              label="CDN Enabled"
              value={
                <Badge
                  className={
                    config.cdn.enabled
                      ? "bg-green-500/15 text-green-700 dark:text-green-400"
                      : "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400"
                  }
                >
                  {config.cdn.enabled ? "Enabled" : "Disabled"}
                </Badge>
              }
            />
          )}
          <KeyValue
            label="WebSocket Path"
            value={<span className="font-mono text-xs">{config.cdn.ws_tunnel_path || "\u2014"}</span>}
          />
          <KeyValue
            label="gRPC Path"
            value={<span className="font-mono text-xs">{config.cdn.grpc_tunnel_path || "\u2014"}</span>}
          />
          <KeyValue
            label="XHTTP Upload Path"
            value={<span className="font-mono text-xs">{config.cdn.xhttp_upload_path || "\u2014"}</span>}
          />
          <KeyValue
            label="XHTTP Download Path"
            value={<span className="font-mono text-xs">{config.cdn.xhttp_download_path || "\u2014"}</span>}
          />
          <KeyValue
            label="XHTTP Stream Path"
            value={<span className="font-mono text-xs">{config.cdn.xhttp_stream_path || "\u2014"}</span>}
          />
          <KeyValue
            label="Cover Site"
            value={<span className="font-mono text-xs">{config.cdn.cover_upstream || "\u2014"}</span>}
          />
          <KeyValue
            label="XPorta Enabled"
            value={config.cdn.xporta_enabled ? "Yes" : "No"}
          />
        </CardContent>
      </Card>

      {onSave && (
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      )}
    </form>
  );
}
