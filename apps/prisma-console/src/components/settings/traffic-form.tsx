"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import type { ConfigResponse } from "@/lib/types";

const PADDING_MODES = ["none", "random", "fixed", "adaptive"];
const CONGESTION_MODES = ["auto", "bbr", "cubic", "none"];

interface TrafficFormProps {
  config: ConfigResponse;
  onSave: (data: Record<string, unknown>) => void;
  isLoading: boolean;
  /** When true, all inputs are disabled and the save button is hidden. */
  readOnly?: boolean;
}

export function TrafficForm({ config, onSave, isLoading: saving, readOnly }: TrafficFormProps) {
  const { t } = useI18n();

  // Traffic shaping
  const [paddingMode, setPaddingMode] = useState<string | null>(null);
  const [timingJitterMs, setTimingJitterMs] = useState<number | null>(null);
  const [chaffIntervalMs, setChaffIntervalMs] = useState<number | null>(null);
  const [coalesceWindowMs, setCoalesceWindowMs] = useState<number | null>(null);
  // Congestion
  const [congestionMode, setCongestionMode] = useState<string | null>(null);
  const [congestionTargetBandwidth, setCongestionTargetBandwidth] = useState<string | null>(null);
  // Anti-RTT
  const [antiRttEnabled, setAntiRttEnabled] = useState<boolean | null>(null);
  const [antiRttNormalizationMs, setAntiRttNormalizationMs] = useState<number | null>(null);
  // Padding
  const [paddingMin, setPaddingMin] = useState<number | null>(null);
  const [paddingMax, setPaddingMax] = useState<number | null>(null);
  // Port hopping
  const [portHoppingEnabled, setPortHoppingEnabled] = useState<boolean | null>(null);
  const [portHoppingBasePort, setPortHoppingBasePort] = useState<number | null>(null);
  const [portHoppingRange, setPortHoppingRange] = useState<number | null>(null);
  const [portHoppingIntervalSecs, setPortHoppingIntervalSecs] = useState<number | null>(null);
  const [portHoppingGracePeriodSecs, setPortHoppingGracePeriodSecs] = useState<number | null>(null);

  const ePaddingMode = paddingMode ?? config.traffic_shaping.padding_mode;
  const eTimingJitterMs = timingJitterMs ?? config.traffic_shaping.timing_jitter_ms;
  const eChaffIntervalMs = chaffIntervalMs ?? config.traffic_shaping.chaff_interval_ms;
  const eCoalesceWindowMs = coalesceWindowMs ?? config.traffic_shaping.coalesce_window_ms;
  const eCongestionMode = congestionMode ?? config.congestion.mode;
  const eCongestionTargetBandwidth = congestionTargetBandwidth ?? config.congestion.target_bandwidth ?? "";
  const eAntiRttEnabled = antiRttEnabled ?? config.anti_rtt.enabled;
  const eAntiRttNormalizationMs = antiRttNormalizationMs ?? config.anti_rtt.normalization_ms;
  const ePaddingMin = paddingMin ?? config.padding.min;
  const ePaddingMax = paddingMax ?? config.padding.max;
  const ePortHoppingEnabled = portHoppingEnabled ?? config.port_hopping.enabled;
  const ePortHoppingBasePort = portHoppingBasePort ?? config.port_hopping.base_port;
  const ePortHoppingRange = portHoppingRange ?? config.port_hopping.range;
  const ePortHoppingIntervalSecs = portHoppingIntervalSecs ?? config.port_hopping.interval_secs;
  const ePortHoppingGracePeriodSecs = portHoppingGracePeriodSecs ?? config.port_hopping.grace_period_secs;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      traffic_shaping_padding_mode: ePaddingMode,
      traffic_shaping_timing_jitter_ms: eTimingJitterMs,
      traffic_shaping_chaff_interval_ms: eChaffIntervalMs,
      traffic_shaping_coalesce_window_ms: eCoalesceWindowMs,
      congestion_mode: eCongestionMode,
      congestion_target_bandwidth: eCongestionTargetBandwidth || undefined,
      anti_rtt_enabled: eAntiRttEnabled,
      anti_rtt_normalization_ms: eAntiRttNormalizationMs,
      padding_min: ePaddingMin,
      padding_max: ePaddingMax,
      port_hopping_enabled: ePortHoppingEnabled,
      port_hopping_base_port: ePortHoppingBasePort,
      port_hopping_range: ePortHoppingRange,
      port_hopping_interval_secs: ePortHoppingIntervalSecs,
      port_hopping_grace_period_secs: ePortHoppingGracePeriodSecs,
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
          <CardTitle>{t("trafficShaping.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-1.5">
            <Label>{t("trafficShaping.paddingMode")}</Label>
            <Select value={ePaddingMode} onValueChange={(v) => v && setPaddingMode(v)}>
              <SelectTrigger className="w-full">
                <span className="flex flex-1 text-left">{ePaddingMode}</span>
              </SelectTrigger>
              <SelectContent>
                {PADDING_MODES.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("settings.paddingModeDesc")}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="padding-min">{t("settings.paddingMin")}</Label>
              <Input
                id="padding-min"
                type="number"
                value={ePaddingMin}
                onChange={(e) => setPaddingMin(parseInt(e.target.value, 10) || 0)}
                min={0}
                max={65535}
                step={1}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">{t("settings.paddingMinDesc")}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="padding-max">{t("settings.paddingMax")}</Label>
              <Input
                id="padding-max"
                type="number"
                value={ePaddingMax}
                onChange={(e) => setPaddingMax(parseInt(e.target.value, 10) || 0)}
                min={0}
                max={65535}
                step={1}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">{t("settings.paddingMaxDesc")}</p>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="jitter-ms">{t("trafficShaping.jitter")} (ms)</Label>
            <Input
              id="jitter-ms"
              type="number"
              value={eTimingJitterMs}
              onChange={(e) => setTimingJitterMs(parseInt(e.target.value, 10) || 0)}
              min={0}
              step={1}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">{t("settings.jitterDesc")}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="chaff-ms">{t("settings.chaffInterval")}</Label>
            <Input
              id="chaff-ms"
              type="number"
              value={eChaffIntervalMs}
              onChange={(e) => setChaffIntervalMs(parseInt(e.target.value, 10) || 0)}
              min={0}
              step={1}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">{t("settings.chaffDisableHint")}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="coalesce-ms">{t("settings.coalescingWindow")}</Label>
            <Input
              id="coalesce-ms"
              type="number"
              value={eCoalesceWindowMs}
              onChange={(e) => setCoalesceWindowMs(parseInt(e.target.value, 10) || 0)}
              min={0}
              step={1}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">{t("settings.coalescingWindowDesc")}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.congestionControl")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-1.5">
            <Label>{t("settings.congestionMode")}</Label>
            <Select value={eCongestionMode} onValueChange={(v) => v && setCongestionMode(v)}>
              <SelectTrigger className="w-full">
                <span className="flex flex-1 text-left">{eCongestionMode}</span>
              </SelectTrigger>
              <SelectContent>
                {CONGESTION_MODES.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("settings.congestionModeDesc")}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="congestion-bandwidth">{t("settings.congestionBandwidth")}</Label>
            <Input
              id="congestion-bandwidth"
              value={eCongestionTargetBandwidth}
              onChange={(e) => setCongestionTargetBandwidth(e.target.value)}
              placeholder={t("trafficShaping.targetBandwidthPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">{t("settings.congestionBandwidthDesc")}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.portHoppingTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="port-hopping-enabled">{t("settings.status")}</Label>
              <p className="text-xs text-muted-foreground mt-1">{t("settings.portHoppingDesc")}</p>
            </div>
            <Switch
              id="port-hopping-enabled"
              checked={ePortHoppingEnabled}
              onCheckedChange={setPortHoppingEnabled}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="port-hopping-base">{t("settings.basePort")}</Label>
              <Input
                id="port-hopping-base"
                type="number"
                value={ePortHoppingBasePort}
                onChange={(e) => setPortHoppingBasePort(parseInt(e.target.value, 10) || 0)}
                min={1}
                max={65535}
                step={1}
                placeholder="10000"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="port-hopping-range">{t("settings.range")}</Label>
              <Input
                id="port-hopping-range"
                type="number"
                value={ePortHoppingRange}
                onChange={(e) => setPortHoppingRange(parseInt(e.target.value, 10) || 0)}
                min={0}
                max={65535}
                step={1}
                placeholder="100"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="port-hopping-interval">{t("settings.interval")}</Label>
              <Input
                id="port-hopping-interval"
                type="number"
                value={ePortHoppingIntervalSecs}
                onChange={(e) => setPortHoppingIntervalSecs(parseInt(e.target.value, 10) || 0)}
                min={0}
                step={1}
                placeholder="30"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="port-hopping-grace">{t("settings.gracePeriod")}</Label>
              <Input
                id="port-hopping-grace"
                type="number"
                value={ePortHoppingGracePeriodSecs}
                onChange={(e) => setPortHoppingGracePeriodSecs(parseInt(e.target.value, 10) || 0)}
                min={0}
                step={1}
                placeholder="5"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.antiRttTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="anti-rtt-enabled">{t("settings.status")}</Label>
                <p className="text-xs text-muted-foreground mt-1">{t("settings.antiRttDesc")}</p>
              </div>
              <Switch
                id="anti-rtt-enabled"
                checked={eAntiRttEnabled}
                onCheckedChange={setAntiRttEnabled}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="anti-rtt-ms">{t("settings.normalization")}</Label>
              <Input
                id="anti-rtt-ms"
                type="number"
                value={eAntiRttNormalizationMs}
                onChange={(e) => setAntiRttNormalizationMs(parseInt(e.target.value, 10) || 0)}
                min={0}
                step={1}
                placeholder="100"
              />
              <p className="text-xs text-muted-foreground">{t("settings.normalizationDesc")}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      </fieldset>
      {!readOnly && (
        <Button type="submit" disabled={saving}>
          {saving ? t("settings.saving") : t("settings.save")}
        </Button>
      )}
    </form>
  );
}
