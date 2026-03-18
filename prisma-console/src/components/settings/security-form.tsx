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

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

interface SecurityFormProps {
  onSave?: (data: Record<string, unknown>) => void;
  isLoading?: boolean;
}

export function SecurityForm({ onSave, isLoading: saving }: SecurityFormProps) {
  const { t } = useI18n();
  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ["config"],
    queryFn: api.getConfig,
  });

  const { data: tls, isLoading: tlsLoading } = useQuery({
    queryKey: ["tls"],
    queryFn: api.getTlsInfo,
  });

  const [allowTransportOnlyCipher, setAllowTransportOnlyCipher] = useState<boolean | null>(null);
  const [prismaTlsEnabled, setPrismaTlsEnabled] = useState<boolean | null>(null);
  const [prismaTlsAuthRotationHours, setPrismaTlsAuthRotationHours] = useState<number | null>(null);

  if (configLoading || tlsLoading || !config) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  const eAllowTransportOnlyCipher = allowTransportOnlyCipher ?? config.allow_transport_only_cipher;
  const ePrismaTlsEnabled = prismaTlsEnabled ?? config.prisma_tls.enabled;
  const ePrismaTlsAuthRotationHours = prismaTlsAuthRotationHours ?? config.prisma_tls.auth_rotation_hours;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!onSave) return;
    onSave({
      allow_transport_only_cipher: eAllowTransportOnlyCipher,
      prisma_tls_enabled: ePrismaTlsEnabled,
      prisma_tls_auth_rotation_hours: ePrismaTlsAuthRotationHours,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("server.tlsInfo")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <KeyValue
            label="TLS Status"
            value={
              <Badge
                className={
                  tls?.enabled
                    ? "bg-green-500/15 text-green-700 dark:text-green-400"
                    : "bg-red-500/15 text-red-700 dark:text-red-400"
                }
              >
                {tls?.enabled ? "Enabled" : "Disabled"}
              </Badge>
            }
          />
          <div>
            <p className="text-muted-foreground">Certificate Path</p>
            <p className="font-mono text-xs mt-1">
              {tls?.cert_path ?? "Not configured"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Key Path</p>
            <p className="font-mono text-xs mt-1">
              {tls?.key_path ?? "Not configured"}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Security Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {onSave ? (
            <>
              <div className="flex items-center justify-between">
                <Label htmlFor="transport-cipher">Transport-Only Cipher</Label>
                <Switch
                  id="transport-cipher"
                  checked={eAllowTransportOnlyCipher}
                  onCheckedChange={(v: boolean) => setAllowTransportOnlyCipher(v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="prisma-tls-enabled">PrismaTLS</Label>
                <Switch
                  id="prisma-tls-enabled"
                  checked={ePrismaTlsEnabled}
                  onCheckedChange={(v: boolean) => setPrismaTlsEnabled(v)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="prisma-tls-rotation">Auth Rotation (hours)</Label>
                <Input
                  id="prisma-tls-rotation"
                  type="number"
                  value={ePrismaTlsAuthRotationHours}
                  onChange={(e) => setPrismaTlsAuthRotationHours(parseInt(e.target.value, 10) || 0)}
                  min={1}
                />
              </div>
            </>
          ) : (
            <>
              <KeyValue
                label="Transport-Only Cipher"
                value={
                  <Badge
                    className={
                      config.allow_transport_only_cipher
                        ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
                        : "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400"
                    }
                  >
                    {config.allow_transport_only_cipher ? "Allowed" : "Disallowed"}
                  </Badge>
                }
              />
              <KeyValue
                label="PrismaTLS"
                value={
                  <Badge
                    className={
                      config.prisma_tls.enabled
                        ? "bg-green-500/15 text-green-700 dark:text-green-400"
                        : "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400"
                    }
                  >
                    {config.prisma_tls.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                }
              />
            </>
          )}
          <KeyValue
            label="Protocol Version"
            value={<span className="font-mono text-xs">{config.protocol_version || "\u2014"}</span>}
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
