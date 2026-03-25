"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { useValidation } from "@/hooks/use-validation";
import type { ConfigResponse } from "@/lib/types";
import { LOG_LEVELS } from "@/lib/types";

interface ConfigFormProps {
  config: ConfigResponse;
  onSave: (data: Record<string, unknown>) => void;
  isLoading: boolean;
}

const loggingLevels = LOG_LEVELS.map((l) => l.toLowerCase());
const loggingFormats = ["pretty", "json"];

export function ConfigForm({ config, onSave, isLoading }: ConfigFormProps) {
  const { t } = useI18n();

  // Existing editable fields
  const [listenAddr, setListenAddr] = useState(config.listen_addr);
  const [quicListenAddr, setQuicListenAddr] = useState(config.quic_listen_addr);
  const [dnsUpstream, setDnsUpstream] = useState(config.dns_upstream ?? "");
  const [loggingLevel, setLoggingLevel] = useState(config.logging_level);
  const [loggingFormat, setLoggingFormat] = useState(config.logging_format);
  const [maxConnections, setMaxConnections] = useState(config.performance.max_connections);
  const [connectionTimeout, setConnectionTimeout] = useState(config.performance.connection_timeout_secs);
  const [portForwardingEnabled, setPortForwardingEnabled] = useState(config.port_forwarding.enabled);
  const [portRangeStart, setPortRangeStart] = useState(config.port_forwarding.port_range_start);
  const [portRangeEnd, setPortRangeEnd] = useState(config.port_forwarding.port_range_end);
  const [autoBackupInterval, setAutoBackupInterval] = useState(config.auto_backup_interval_mins ?? 0);
  const [managementApiEnabled, setManagementApiEnabled] = useState(config.management_api?.enabled ?? true);

  const listenAddrValidation = useValidation(listenAddr, ["address"]);
  const quicListenAddrValidation = useValidation(quicListenAddr, ["address"]);
  const portRangeStartValidation = useValidation(String(portRangeStart), ["port"]);
  const portRangeEndValidation = useValidation(String(portRangeEnd), ["port"]);

  const hasValidationErrors =
    !!listenAddrValidation.error ||
    !!quicListenAddrValidation.error ||
    (portForwardingEnabled &&
      (!!portRangeStartValidation.error || !!portRangeEndValidation.error));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      listen_addr: listenAddr,
      quic_listen_addr: quicListenAddr,
      dns_upstream: dnsUpstream || undefined,
      logging_level: loggingLevel,
      logging_format: loggingFormat,
      max_connections: maxConnections,
      connection_timeout_secs: connectionTimeout,
      port_forwarding_enabled: portForwardingEnabled,
      port_forwarding_port_range_start: portRangeStart,
      port_forwarding_port_range_end: portRangeEnd,
      auto_backup_interval_mins: autoBackupInterval,
      management_api_enabled: managementApiEnabled,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Network */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">
          {t("settings.network")}
        </h3>
        <div className="grid gap-1.5">
          <Label htmlFor="listen-addr">{t("settings.listenAddr")}</Label>
          <Input
            id="listen-addr"
            value={listenAddr}
            onChange={(e) => setListenAddr(e.target.value)}
            placeholder="0.0.0.0:443"
          />
          {listenAddrValidation.error && (
            <p className="text-xs text-destructive mt-1">{listenAddrValidation.error}</p>
          )}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="quic-listen-addr">{t("settings.quicListenAddr")}</Label>
          <Input
            id="quic-listen-addr"
            value={quicListenAddr}
            onChange={(e) => setQuicListenAddr(e.target.value)}
            placeholder="0.0.0.0:443"
          />
          {quicListenAddrValidation.error && (
            <p className="text-xs text-destructive mt-1">{quicListenAddrValidation.error}</p>
          )}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="dns-upstream">{t("settings.dnsUpstream")}</Label>
          <Input
            id="dns-upstream"
            value={dnsUpstream}
            onChange={(e) => setDnsUpstream(e.target.value)}
            placeholder="8.8.8.8:53"
          />
        </div>
      </div>

      {/* Logging */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">
          {t("settings.logging")}
        </h3>
        <div className="grid gap-1.5">
          <Label>{t("settings.loggingLevel")}</Label>
          <Select value={loggingLevel} onValueChange={(v) => v && setLoggingLevel(v)}>
            <SelectTrigger className="w-full">
              <span className="flex flex-1 text-left">{loggingLevel}</span>
            </SelectTrigger>
            <SelectContent>
              {loggingLevels.map((level) => (
                <SelectItem key={level} value={level}>
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>{t("settings.loggingFormat")}</Label>
          <Select value={loggingFormat} onValueChange={(v) => v && setLoggingFormat(v)}>
            <SelectTrigger className="w-full">
              <span className="flex flex-1 text-left">{loggingFormat}</span>
            </SelectTrigger>
            <SelectContent>
              {loggingFormats.map((format) => (
                <SelectItem key={format} value={format}>
                  {format}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Performance */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">
          {t("settings.performance")}
        </h3>
        <div className="grid gap-1.5">
          <Label htmlFor="max-connections">{t("settings.maxConnections")}</Label>
          <Input
            id="max-connections"
            type="number"
            value={maxConnections}
            onChange={(e) => setMaxConnections(parseInt(e.target.value, 10) || 0)}
            min={0}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="connection-timeout">
            {t("settings.connectionTimeout")}{" "}
            <span className="text-muted-foreground text-xs">({t("settings.connectionTimeoutHint")})</span>
          </Label>
          <Input
            id="connection-timeout"
            type="number"
            value={connectionTimeout}
            onChange={(e) => setConnectionTimeout(parseInt(e.target.value, 10) || 30)}
            min={1}
          />
        </div>
      </div>

      {/* Port Forwarding */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">
          {t("settings.portForwarding")}
        </h3>
        <div className="flex items-center justify-between">
          <Label htmlFor="port-forwarding">{t("settings.portForwarding")}</Label>
          <Switch
            id="port-forwarding"
            checked={portForwardingEnabled}
            onCheckedChange={(checked: boolean) => setPortForwardingEnabled(checked)}
          />
        </div>
        {portForwardingEnabled && (
          <div className="flex gap-3">
            <div className="flex-1 grid gap-1.5">
              <Label htmlFor="port-range-start" className="text-xs">{t("settings.portRangeStart")}</Label>
              <Input
                id="port-range-start"
                type="number"
                value={portRangeStart}
                onChange={(e) => setPortRangeStart(parseInt(e.target.value, 10) || 0)}
                min={1}
                max={65535}
              />
              {portRangeStartValidation.error && (
                <p className="text-xs text-destructive mt-1">{portRangeStartValidation.error}</p>
              )}
            </div>
            <div className="flex-1 grid gap-1.5">
              <Label htmlFor="port-range-end" className="text-xs">{t("settings.portRangeEnd")}</Label>
              <Input
                id="port-range-end"
                type="number"
                value={portRangeEnd}
                onChange={(e) => setPortRangeEnd(parseInt(e.target.value, 10) || 0)}
                min={1}
                max={65535}
              />
              {portRangeEndValidation.error && (
                <p className="text-xs text-destructive mt-1">{portRangeEndValidation.error}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Auto-Backup */}
      <div className="space-y-4">
        <div className="grid gap-1.5">
          <Label htmlFor="auto-backup-interval">
            {t("settings.autoBackupInterval")}{" "}
            <span className="text-muted-foreground text-xs">({t("settings.autoBackupIntervalHint")})</span>
          </Label>
          <Input
            id="auto-backup-interval"
            type="number"
            value={autoBackupInterval}
            onChange={(e) => setAutoBackupInterval(parseInt(e.target.value, 10) || 0)}
            min={0}
            placeholder="0"
          />
        </div>
      </div>

      {/* Management API */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">
          {t("settings.managementApi")}
        </h3>
        <div className="flex items-center justify-between">
          <div>
            <Label>{t("settings.managementApi")}</Label>
            <p className="text-xs text-muted-foreground">{t("settings.managementApiHint")}</p>
          </div>
          <Switch
            checked={managementApiEnabled}
            onCheckedChange={(checked: boolean) => setManagementApiEnabled(checked)}
          />
        </div>
      </div>

      <Button type="submit" disabled={isLoading || hasValidationErrors}>
        {isLoading ? t("settings.saving") : t("settings.save")}
      </Button>
    </form>
  );
}
