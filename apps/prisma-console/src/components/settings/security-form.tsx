"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Plus, Trash2, Shuffle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { KeyValue } from "@/components/ui/key-value";
import type { ConfigResponse, TlsInfoResponse, MaskServerEntry } from "@/lib/types";

interface SecurityFormProps {
  config: ConfigResponse;
  tls?: TlsInfoResponse;
  onSave: (data: Record<string, unknown>) => void;
  isLoading: boolean;
  /** When true, all inputs are disabled and the save button is hidden. */
  readOnly?: boolean;
}

function generateHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function SecurityForm({ config, tls, onSave, isLoading: saving, readOnly }: SecurityFormProps) {
  const { t } = useI18n();

  const [allowTransportOnlyCipher, setAllowTransportOnlyCipher] = useState<boolean | null>(null);
  const [prismaTlsEnabled, setPrismaTlsEnabled] = useState<boolean | null>(null);
  const [prismaTlsAuthRotationHours, setPrismaTlsAuthRotationHours] = useState<number | null>(null);
  const [authSecret, setAuthSecret] = useState(config.prisma_tls.auth_secret ?? "");
  const [showAuthSecret, setShowAuthSecret] = useState(false);
  const [maskServers, setMaskServers] = useState<MaskServerEntry[]>(
    config.prisma_tls.mask_servers ?? []
  );

  const eAllowTransportOnlyCipher = allowTransportOnlyCipher ?? config.allow_transport_only_cipher;
  const ePrismaTlsEnabled = prismaTlsEnabled ?? config.prisma_tls.enabled;
  const ePrismaTlsAuthRotationHours = prismaTlsAuthRotationHours ?? config.prisma_tls.auth_rotation_hours;

  function handleAddMaskServer() {
    setMaskServers([...maskServers, { addr: "", names: [""] }]);
  }

  function handleRemoveMaskServer(index: number) {
    setMaskServers(maskServers.filter((_, i) => i !== index));
  }

  function handleMaskServerChange(index: number, field: "addr" | "names", value: string) {
    const updated = [...maskServers];
    if (field === "addr") {
      updated[index] = { ...updated[index], addr: value };
    } else {
      updated[index] = { ...updated[index], names: value.split(",").map((s) => s.trim()).filter(Boolean) };
    }
    setMaskServers(updated);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      allow_transport_only_cipher: eAllowTransportOnlyCipher,
      prisma_tls_enabled: ePrismaTlsEnabled,
      prisma_tls_auth_rotation_hours: ePrismaTlsAuthRotationHours,
      prisma_tls_auth_secret: authSecret || undefined,
      prisma_tls_mask_servers: maskServers.filter((s) => s.addr.trim()),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {readOnly && (
        <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
          {t("role.readOnly")}
        </Badge>
      )}
      <fieldset disabled={readOnly} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("server.tlsInfo")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <KeyValue
            label={t("settings.tlsStatus")}
            value={
              <Badge
                className={
                  tls?.enabled
                    ? "bg-green-500/15 text-green-700 dark:text-green-400"
                    : "bg-red-500/15 text-red-700 dark:text-red-400"
                }
              >
                {tls?.enabled ? t("common.enabled") : t("common.disabled")}
              </Badge>
            }
          />
          <div>
            <p className="text-muted-foreground">{t("settings.certPath")}</p>
            <p className="font-mono text-xs mt-1">
              {tls?.cert_path ?? t("settings.notConfigured")}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("settings.keyPath")}</p>
            <p className="font-mono text-xs mt-1">
              {tls?.key_path ?? t("settings.notConfigured")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.securitySettings")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="transport-cipher">{t("settings.transportCipher")}</Label>
              <p className="text-xs text-muted-foreground mt-1">{t("settings.transportCipherDesc")}</p>
            </div>
            <Switch
              id="transport-cipher"
              checked={eAllowTransportOnlyCipher}
              onCheckedChange={setAllowTransportOnlyCipher}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="prisma-tls-enabled">{t("settings.prismaTls")}</Label>
              <p className="text-xs text-muted-foreground mt-1">{t("settings.prismaTlsDesc")}</p>
            </div>
            <Switch
              id="prisma-tls-enabled"
              checked={ePrismaTlsEnabled}
              onCheckedChange={setPrismaTlsEnabled}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="prisma-tls-rotation">{t("settings.authRotation")}</Label>
            <Input
              id="prisma-tls-rotation"
              type="number"
              value={ePrismaTlsAuthRotationHours}
              onChange={(e) => setPrismaTlsAuthRotationHours(parseInt(e.target.value, 10) || 0)}
              min={1}
              placeholder="1"
            />
            <p className="text-xs text-muted-foreground">{t("settings.authRotationDesc")}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.prismaTlsAdvanced")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-1.5">
            <Label htmlFor="auth-secret">{t("settings.authSecret")}</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="auth-secret"
                  type={showAuthSecret ? "text" : "password"}
                  value={authSecret}
                  onChange={(e) => setAuthSecret(e.target.value)}
                  placeholder={t("settings.authSecretPlaceholder")}
                  className="font-mono text-xs pr-9"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setShowAuthSecret(!showAuthSecret)}
                >
                  {showAuthSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAuthSecret(generateHex(32))}
              >
                <Shuffle className="h-3.5 w-3.5 mr-1" />
                {t("settings.generate")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("settings.authSecretDesc")}</p>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>{t("settings.maskServers")}</Label>
              <Button type="button" variant="outline" size="sm" onClick={handleAddMaskServer}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t("settings.addMaskServer")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("settings.maskServersDesc")}</p>
            {maskServers.map((server, index) => (
              <div key={index} className="flex gap-2 items-start p-3 rounded-lg bg-muted/30 border">
                <div className="flex-1 space-y-2">
                  <div className="grid gap-1">
                    <Label className="text-xs">{t("settings.maskServerAddr")}</Label>
                    <Input
                      value={server.addr}
                      onChange={(e) => handleMaskServerChange(index, "addr", e.target.value)}
                      placeholder="example.com:443"
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">{t("settings.maskServerNames")}</Label>
                    <Input
                      value={server.names.join(", ")}
                      onChange={(e) => handleMaskServerChange(index, "names", e.target.value)}
                      placeholder="example.com, www.example.com"
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="mt-6 text-destructive hover:text-destructive"
                  onClick={() => handleRemoveMaskServer(index)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {maskServers.length === 0 && (
              <p className="text-xs text-muted-foreground italic py-2">{t("settings.noMaskServers")}</p>
            )}
          </div>
        </CardContent>
      </Card>

      </fieldset>
      {!readOnly && (
        <Button type="submit" disabled={saving}>
          {saving ? t("settings.saving") : t("settings.save")}
        </Button>
      )}
    </form>
  );
}
