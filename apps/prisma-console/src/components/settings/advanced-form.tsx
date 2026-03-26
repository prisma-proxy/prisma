"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import type { ConfigResponse } from "@/lib/types";

interface AdvancedFormProps {
  config: ConfigResponse;
  onSave: (data: Record<string, unknown>) => void;
  isLoading: boolean;
  /** When true, all inputs are disabled and the save button is hidden. */
  readOnly?: boolean;
}

export function AdvancedForm({ config, onSave, isLoading: saving, readOnly }: AdvancedFormProps) {
  const { t } = useI18n();

  // SSH
  const [sshEnabled, setSshEnabled] = useState(config.ssh?.enabled ?? false);
  const [sshListenAddr, setSshListenAddr] = useState(config.ssh?.listen_addr ?? "0.0.0.0:2222");

  // WireGuard
  const [wireguardEnabled, setWireguardEnabled] = useState(config.wireguard?.enabled ?? false);
  const [wireguardListenAddr, setWireguardListenAddr] = useState(config.wireguard?.listen_addr ?? "0.0.0.0:51820");

  // Fallback
  const [fallbackEnabled, setFallbackEnabled] = useState(config.fallback?.enabled ?? false);
  const [fallbackMaxFailures, setFallbackMaxFailures] = useState(config.fallback?.max_consecutive_failures ?? 5);
  const [fallbackHealthCheckInterval, setFallbackHealthCheckInterval] = useState(config.fallback?.health_check_interval ?? 30);

  // Misc
  const [configWatch, setConfigWatch] = useState(config.config_watch ?? false);
  const [shutdownDrainTimeout, setShutdownDrainTimeout] = useState(config.shutdown_drain_timeout_secs ?? 30);
  const [ticketRotationHours, setTicketRotationHours] = useState(config.ticket_rotation_hours ?? 6);
  const [publicAddress, setPublicAddress] = useState(config.public_address ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      ssh_enabled: sshEnabled,
      ssh_listen_addr: sshListenAddr,
      wireguard_enabled: wireguardEnabled,
      wireguard_listen_addr: wireguardListenAddr,
      fallback_enabled: fallbackEnabled,
      fallback_max_consecutive_failures: fallbackMaxFailures,
      fallback_health_check_interval: fallbackHealthCheckInterval,
      config_watch: configWatch,
      shutdown_drain_timeout_secs: shutdownDrainTimeout,
      ticket_rotation_hours: ticketRotationHours,
      public_address: publicAddress || undefined,
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

      {/* SSH */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.sshTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="ssh-enabled">{t("settings.status")}</Label>
              <p className="text-xs text-muted-foreground mt-1">{t("settings.sshEnabledDesc")}</p>
            </div>
            <Switch
              id="ssh-enabled"
              checked={sshEnabled}
              onCheckedChange={(v: boolean) => setSshEnabled(v)}
            />
          </div>
          {sshEnabled && (
            <div className="grid gap-1.5">
              <Label htmlFor="ssh-listen-addr">{t("settings.sshListenAddr")}</Label>
              <Input
                id="ssh-listen-addr"
                value={sshListenAddr}
                onChange={(e) => setSshListenAddr(e.target.value)}
                placeholder="0.0.0.0:2222"
              />
              <p className="text-xs text-muted-foreground">{t("settings.sshListenAddrDesc")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* WireGuard */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.wireguardTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="wireguard-enabled">{t("settings.status")}</Label>
              <p className="text-xs text-muted-foreground mt-1">{t("settings.wireguardEnabledDesc")}</p>
            </div>
            <Switch
              id="wireguard-enabled"
              checked={wireguardEnabled}
              onCheckedChange={(v: boolean) => setWireguardEnabled(v)}
            />
          </div>
          {wireguardEnabled && (
            <div className="grid gap-1.5">
              <Label htmlFor="wireguard-listen-addr">{t("settings.wireguardListenAddr")}</Label>
              <Input
                id="wireguard-listen-addr"
                value={wireguardListenAddr}
                onChange={(e) => setWireguardListenAddr(e.target.value)}
                placeholder="0.0.0.0:51820"
              />
              <p className="text-xs text-muted-foreground">{t("settings.wireguardListenAddrDesc")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fallback */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.fallbackTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="fallback-enabled">{t("settings.status")}</Label>
              <p className="text-xs text-muted-foreground mt-1">{t("settings.fallbackEnabledDesc")}</p>
            </div>
            <Switch
              id="fallback-enabled"
              checked={fallbackEnabled}
              onCheckedChange={(v: boolean) => setFallbackEnabled(v)}
            />
          </div>
          {fallbackEnabled && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="fallback-max-failures">{t("settings.fallbackMaxFailures")}</Label>
                <Input
                  id="fallback-max-failures"
                  type="number"
                  value={fallbackMaxFailures}
                  onChange={(e) => setFallbackMaxFailures(parseInt(e.target.value, 10) || 5)}
                  min={1}
                  step={1}
                  placeholder="5"
                />
                <p className="text-xs text-muted-foreground">{t("settings.fallbackMaxFailuresDesc")}</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="fallback-health-interval">{t("settings.fallbackHealthCheckInterval")}</Label>
                <Input
                  id="fallback-health-interval"
                  type="number"
                  value={fallbackHealthCheckInterval}
                  onChange={(e) => setFallbackHealthCheckInterval(parseInt(e.target.value, 10) || 30)}
                  min={1}
                  step={1}
                  placeholder="30"
                />
                <p className="text-xs text-muted-foreground">{t("settings.fallbackHealthCheckIntervalDesc")}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Miscellaneous */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.miscTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="config-watch">{t("settings.configWatch")}</Label>
              <p className="text-xs text-muted-foreground mt-1">{t("settings.configWatchDesc")}</p>
            </div>
            <Switch
              id="config-watch"
              checked={configWatch}
              onCheckedChange={(v: boolean) => setConfigWatch(v)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="shutdown-drain">{t("settings.shutdownDrainTimeout")}</Label>
            <Input
              id="shutdown-drain"
              type="number"
              value={shutdownDrainTimeout}
              onChange={(e) => setShutdownDrainTimeout(parseInt(e.target.value, 10) || 30)}
              min={0}
              step={1}
              placeholder="30"
            />
            <p className="text-xs text-muted-foreground">{t("settings.shutdownDrainTimeoutDesc")}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ticket-rotation">{t("settings.ticketRotationHours")}</Label>
            <Input
              id="ticket-rotation"
              type="number"
              value={ticketRotationHours}
              onChange={(e) => setTicketRotationHours(parseInt(e.target.value, 10) || 6)}
              min={1}
              step={1}
              placeholder="6"
            />
            <p className="text-xs text-muted-foreground">{t("settings.ticketRotationHoursDesc")}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="public-address-adv">{t("settings.publicAddress")}</Label>
            <Input
              id="public-address-adv"
              value={publicAddress}
              onChange={(e) => setPublicAddress(e.target.value)}
              placeholder="example.com:443"
            />
            <p className="text-xs text-muted-foreground">{t("settings.publicAddressDesc")}</p>
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
