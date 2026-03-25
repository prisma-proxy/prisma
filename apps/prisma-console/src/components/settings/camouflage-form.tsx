"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import type { ConfigResponse } from "@/lib/types";

interface CamouflageFormProps {
  config: ConfigResponse;
  onSave: (data: Record<string, unknown>) => void;
  isLoading: boolean;
}

export function CamouflageForm({ config, onSave, isLoading: saving }: CamouflageFormProps) {
  const { t } = useI18n();

  // Camouflage
  const [camouflageEnabled, setCamouflageEnabled] = useState(config.camouflage.enabled);
  const [tlsOnTcp, setTlsOnTcp] = useState(config.camouflage.tls_on_tcp);
  const [fallbackAddr, setFallbackAddr] = useState(config.camouflage.fallback_addr ?? "");
  const [alpnProtocols, setAlpnProtocols] = useState(config.camouflage.alpn_protocols?.join(", ") ?? "h2, http/1.1");
  const [salamanderPassword, setSalamanderPassword] = useState(config.camouflage.salamander_password ?? "");
  const [h3CoverSite, setH3CoverSite] = useState(config.camouflage.h3_cover_site ?? "");
  const [h3StaticDir, setH3StaticDir] = useState(config.camouflage.h3_static_dir ?? "");

  // CDN
  const [cdnEnabled, setCdnEnabled] = useState(config.cdn.enabled);
  const [cdnListenAddr, setCdnListenAddr] = useState(config.cdn.listen_addr);
  const [cdnExposeManagementApi, setCdnExposeManagementApi] = useState(config.cdn.expose_management_api);
  const [cdnPaddingHeader, setCdnPaddingHeader] = useState(config.cdn.padding_header);
  const [cdnEnableSseDisguise, setCdnEnableSseDisguise] = useState(config.cdn.enable_sse_disguise);
  const [cdnWsPath, setCdnWsPath] = useState(config.cdn.ws_tunnel_path);
  const [cdnGrpcPath, setCdnGrpcPath] = useState(config.cdn.grpc_tunnel_path);
  const [cdnXhttpUpload, setCdnXhttpUpload] = useState(config.cdn.xhttp_upload_path);
  const [cdnXhttpDownload, setCdnXhttpDownload] = useState(config.cdn.xhttp_download_path);
  const [cdnXhttpStream, setCdnXhttpStream] = useState(config.cdn.xhttp_stream_path);
  const [cdnCoverUpstream, setCdnCoverUpstream] = useState(config.cdn.cover_upstream ?? "");

  // XPorta
  const [xportaEnabled, setXportaEnabled] = useState(config.cdn.xporta_enabled);
  const xportaConfig = (config.cdn as unknown as Record<string, unknown>).xporta_config as Record<string, unknown> | undefined;
  const [xportaSessionPath, setXportaSessionPath] = useState(String(xportaConfig?.session_path ?? "/api/auth"));
  const [xportaEncoding, setXportaEncoding] = useState(String(xportaConfig?.encoding ?? "json"));
  const [xportaSessionTimeout, setXportaSessionTimeout] = useState(Number(xportaConfig?.session_timeout_secs ?? 300));
  const [xportaMaxSessions, setXportaMaxSessions] = useState(Number(xportaConfig?.max_sessions_per_client ?? 8));
  const [xportaCookieName, setXportaCookieName] = useState(String(xportaConfig?.cookie_name ?? "_sess"));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      // Camouflage
      camouflage_enabled: camouflageEnabled,
      camouflage_tls_on_tcp: tlsOnTcp,
      camouflage_fallback_addr: fallbackAddr || undefined,
      camouflage_alpn_protocols: alpnProtocols.split(",").map((s) => s.trim()).filter(Boolean),
      camouflage_salamander_password: salamanderPassword || undefined,
      camouflage_h3_cover_site: h3CoverSite || undefined,
      camouflage_h3_static_dir: h3StaticDir || undefined,
      // CDN
      cdn_enabled: cdnEnabled,
      cdn_listen_addr: cdnListenAddr,
      cdn_expose_management_api: cdnExposeManagementApi,
      cdn_padding_header: cdnPaddingHeader,
      cdn_enable_sse_disguise: cdnEnableSseDisguise,
      cdn_ws_tunnel_path: cdnWsPath,
      cdn_grpc_tunnel_path: cdnGrpcPath,
      cdn_xhttp_upload_path: cdnXhttpUpload,
      cdn_xhttp_download_path: cdnXhttpDownload,
      cdn_xhttp_stream_path: cdnXhttpStream,
      cdn_cover_upstream: cdnCoverUpstream || undefined,
      // XPorta
      xporta_enabled: xportaEnabled,
      xporta_session_path: xportaSessionPath,
      xporta_encoding: xportaEncoding,
      xporta_session_timeout_secs: xportaSessionTimeout,
      xporta_max_sessions_per_client: xportaMaxSessions,
      xporta_cookie_name: xportaCookieName,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Camouflage */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.camouflage")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <Label>{t("settings.status")}</Label>
            <Switch checked={camouflageEnabled} onCheckedChange={(v: boolean) => setCamouflageEnabled(v)} />
          </div>
          <div className="flex items-center justify-between">
            <Label>{t("settings.tlsOnTcp")}</Label>
            <Switch checked={tlsOnTcp} onCheckedChange={(v: boolean) => setTlsOnTcp(v)} />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("settings.fallbackAddr")}</Label>
            <Input value={fallbackAddr} onChange={(e) => setFallbackAddr(e.target.value)} placeholder="127.0.0.1:8080" />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("settings.alpnProtocols")}</Label>
            <Input value={alpnProtocols} onChange={(e) => setAlpnProtocols(e.target.value)} placeholder="h2, http/1.1" className="font-mono text-xs" />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("settings.camouflageSalamander")}</Label>
            <Input value={salamanderPassword} onChange={(e) => setSalamanderPassword(e.target.value)} placeholder={t("settings.notConfigured")} type="password" className="font-mono text-xs" />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("settings.camouflageH3")}</Label>
            <Input value={h3CoverSite} onChange={(e) => setH3CoverSite(e.target.value)} placeholder="https://example.com" />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("settings.h3StaticDir")}</Label>
            <Input value={h3StaticDir} onChange={(e) => setH3StaticDir(e.target.value)} placeholder="/var/www/html" />
          </div>
        </CardContent>
      </Card>

      {/* CDN */}
      <Card>
        <CardHeader>
          <CardTitle>CDN</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <Label>{t("settings.cdnEnabled")}</Label>
            <Switch checked={cdnEnabled} onCheckedChange={(v: boolean) => setCdnEnabled(v)} />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("settings.cdnListenAddr")}</Label>
            <Input value={cdnListenAddr} onChange={(e) => setCdnListenAddr(e.target.value)} />
          </div>
          <div className="flex items-center justify-between">
            <Label>{t("settings.exposeManagementApi")}</Label>
            <Switch checked={cdnExposeManagementApi} onCheckedChange={(v: boolean) => setCdnExposeManagementApi(v)} />
          </div>
          <div className="flex items-center justify-between">
            <Label>{t("settings.paddingHeader")}</Label>
            <Switch checked={cdnPaddingHeader} onCheckedChange={(v: boolean) => setCdnPaddingHeader(v)} />
          </div>
          <div className="flex items-center justify-between">
            <Label>{t("settings.sseDisguise")}</Label>
            <Switch checked={cdnEnableSseDisguise} onCheckedChange={(v: boolean) => setCdnEnableSseDisguise(v)} />
          </div>

          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-2">{t("settings.cdnPaths")}</h4>
          <div className="grid gap-1.5">
            <Label className="text-xs">{t("settings.cdnWsPath")}</Label>
            <Input value={cdnWsPath} onChange={(e) => setCdnWsPath(e.target.value)} className="font-mono text-xs" />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">{t("settings.cdnGrpcPath")}</Label>
            <Input value={cdnGrpcPath} onChange={(e) => setCdnGrpcPath(e.target.value)} className="font-mono text-xs" />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("settings.cdnXhttpUpload")}</Label>
              <Input value={cdnXhttpUpload} onChange={(e) => setCdnXhttpUpload(e.target.value)} className="font-mono text-xs" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("settings.cdnXhttpDownload")}</Label>
              <Input value={cdnXhttpDownload} onChange={(e) => setCdnXhttpDownload(e.target.value)} className="font-mono text-xs" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("settings.cdnXhttpStream")}</Label>
              <Input value={cdnXhttpStream} onChange={(e) => setCdnXhttpStream(e.target.value)} className="font-mono text-xs" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">{t("settings.cdnCoverSite")}</Label>
            <Input value={cdnCoverUpstream} onChange={(e) => setCdnCoverUpstream(e.target.value)} placeholder="https://example.com" className="font-mono text-xs" />
          </div>
        </CardContent>
      </Card>

      {/* XPorta */}
      <Card>
        <CardHeader>
          <CardTitle>XPorta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <Label>{t("settings.status")}</Label>
            <Switch checked={xportaEnabled} onCheckedChange={(v: boolean) => setXportaEnabled(v)} />
          </div>
          {xportaEnabled && (
            <div className="space-y-3 p-3 rounded-lg bg-muted/30 border">
              <div className="grid gap-1.5">
                <Label className="text-xs">{t("settings.xportaSessionPath")}</Label>
                <Input value={xportaSessionPath} onChange={(e) => setXportaSessionPath(e.target.value)} className="font-mono text-xs" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">{t("settings.xportaEncoding")}</Label>
                <Select value={xportaEncoding} onValueChange={(v) => v && setXportaEncoding(v)}>
                  <SelectTrigger className="w-full">
                    <span className="flex flex-1 text-left">{xportaEncoding}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="binary">Binary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label className="text-xs">{t("settings.xportaSessionTimeout")}</Label>
                  <Input type="number" min={1} value={xportaSessionTimeout} onChange={(e) => setXportaSessionTimeout(parseInt(e.target.value, 10) || 300)} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">{t("settings.xportaMaxSessions")}</Label>
                  <Input type="number" min={1} value={xportaMaxSessions} onChange={(e) => setXportaMaxSessions(parseInt(e.target.value, 10) || 8)} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">{t("settings.xportaCookieName")}</Label>
                <Input value={xportaCookieName} onChange={(e) => setXportaCookieName(e.target.value)} className="font-mono text-xs" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Button type="submit" disabled={saving}>
        {saving ? t("settings.saving") : t("settings.save")}
      </Button>
    </form>
  );
}
