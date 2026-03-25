"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { KeyValue } from "@/components/ui/key-value";
import type { ConfigResponse, TlsInfoResponse } from "@/lib/types";

interface SecurityFormProps {
  config: ConfigResponse;
  tls?: TlsInfoResponse;
  onSave: (data: Record<string, unknown>) => void;
  isLoading: boolean;
  /** When true, all inputs are disabled and the save button is hidden. */
  readOnly?: boolean;
}

export function SecurityForm({ config, tls, onSave, isLoading: saving, readOnly }: SecurityFormProps) {
  const { t } = useI18n();

  const [allowTransportOnlyCipher, setAllowTransportOnlyCipher] = useState<boolean | null>(null);
  const [prismaTlsEnabled, setPrismaTlsEnabled] = useState<boolean | null>(null);
  const [prismaTlsAuthRotationHours, setPrismaTlsAuthRotationHours] = useState<number | null>(null);

  const eAllowTransportOnlyCipher = allowTransportOnlyCipher ?? config.allow_transport_only_cipher;
  const ePrismaTlsEnabled = prismaTlsEnabled ?? config.prisma_tls.enabled;
  const ePrismaTlsAuthRotationHours = prismaTlsAuthRotationHours ?? config.prisma_tls.auth_rotation_hours;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      allow_transport_only_cipher: eAllowTransportOnlyCipher,
      prisma_tls_enabled: ePrismaTlsEnabled,
      prisma_tls_auth_rotation_hours: ePrismaTlsAuthRotationHours,
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
            <Label htmlFor="transport-cipher">{t("settings.transportCipher")}</Label>
            <Switch
              id="transport-cipher"
              checked={eAllowTransportOnlyCipher}
              onCheckedChange={(v: boolean) => setAllowTransportOnlyCipher(v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="prisma-tls-enabled">{t("settings.prismaTls")}</Label>
            <Switch
              id="prisma-tls-enabled"
              checked={ePrismaTlsEnabled}
              onCheckedChange={(v: boolean) => setPrismaTlsEnabled(v)}
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
            />
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
