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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

const PADDING_MODES = ["none", "random", "fixed", "adaptive"];
const CONGESTION_MODES = ["auto", "bbr", "cubic", "none"];

interface TrafficFormProps {
  onSave?: (data: Record<string, unknown>) => void;
  isLoading?: boolean;
}

export function TrafficForm({ onSave, isLoading: saving }: TrafficFormProps) {
  const { t } = useI18n();
  const { data: config, isLoading } = useQuery({
    queryKey: ["config"],
    queryFn: api.getConfig,
  });

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

  if (isLoading || !config) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

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
    if (!onSave) return;
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
      <Card>
        <CardHeader>
          <CardTitle>{t("trafficShaping.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {onSave ? (
            <>
              <div className="grid gap-1.5">
                <Label>{t("trafficShaping.paddingMode")}</Label>
                <Select value={ePaddingMode} onValueChange={(v) => v && setPaddingMode(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PADDING_MODES.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="padding-min">Padding Min</Label>
                  <Input
                    id="padding-min"
                    type="number"
                    value={ePaddingMin}
                    onChange={(e) => setPaddingMin(parseInt(e.target.value, 10) || 0)}
                    min={0}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="padding-max">Padding Max</Label>
                  <Input
                    id="padding-max"
                    type="number"
                    value={ePaddingMax}
                    onChange={(e) => setPaddingMax(parseInt(e.target.value, 10) || 0)}
                    min={0}
                  />
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
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="chaff-ms">Chaff Interval (ms)</Label>
                <Input
                  id="chaff-ms"
                  type="number"
                  value={eChaffIntervalMs}
                  onChange={(e) => setChaffIntervalMs(parseInt(e.target.value, 10) || 0)}
                  min={0}
                />
                <p className="text-xs text-muted-foreground">Set to 0 to disable chaff.</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="coalesce-ms">Coalescing Window (ms)</Label>
                <Input
                  id="coalesce-ms"
                  type="number"
                  value={eCoalesceWindowMs}
                  onChange={(e) => setCoalesceWindowMs(parseInt(e.target.value, 10) || 0)}
                  min={0}
                />
              </div>
            </>
          ) : (
            <>
              <KeyValue
                label={t("trafficShaping.paddingMode")}
                value={<span className="font-mono text-xs">{config.traffic_shaping.padding_mode || "\u2014"}</span>}
              />
              <KeyValue
                label="Padding Range"
                value={<span className="font-mono text-xs">{config.padding.min}\u2013{config.padding.max} bytes</span>}
              />
              <KeyValue
                label={t("trafficShaping.bucketSizes")}
                value={<span className="font-mono text-xs">{config.traffic_shaping.bucket_sizes?.join(", ") || "\u2014"}</span>}
              />
              <KeyValue
                label={t("trafficShaping.jitter")}
                value={<span className="font-mono text-xs">{config.traffic_shaping.timing_jitter_ms} ms</span>}
              />
              <KeyValue
                label={t("trafficShaping.chaff")}
                value={
                  <Badge
                    className={
                      config.traffic_shaping.chaff_interval_ms > 0
                        ? "bg-green-500/15 text-green-700 dark:text-green-400"
                        : "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400"
                    }
                  >
                    {config.traffic_shaping.chaff_interval_ms > 0 ? `${config.traffic_shaping.chaff_interval_ms}ms` : "Disabled"}
                  </Badge>
                }
              />
              <KeyValue
                label="Coalescing Window"
                value={<span className="font-mono text-xs">{config.traffic_shaping.coalesce_window_ms} ms</span>}
              />
            </>
          )}
          <KeyValue
            label={t("trafficShaping.bucketSizes")}
            value={<span className="font-mono text-xs">{config.traffic_shaping.bucket_sizes?.join(", ") || "\u2014"}</span>}
          />
          <KeyValue
            label={t("settings.dnsUpstream")}
            value={<span className="font-mono text-xs">{config.dns_upstream || "\u2014"}</span>}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Congestion Control</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {onSave ? (
            <>
              <div className="grid gap-1.5">
                <Label>{t("settings.congestionMode")}</Label>
                <Select value={eCongestionMode} onValueChange={(v) => v && setCongestionMode(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONGESTION_MODES.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="congestion-bandwidth">{t("settings.congestionBandwidth")}</Label>
                <Input
                  id="congestion-bandwidth"
                  value={eCongestionTargetBandwidth}
                  onChange={(e) => setCongestionTargetBandwidth(e.target.value)}
                  placeholder="e.g. 100mbps"
                />
              </div>
            </>
          ) : (
            <>
              <KeyValue
                label="Mode"
                value={<span className="font-mono text-xs">{config.congestion.mode || "\u2014"}</span>}
              />
              <KeyValue
                label="Target Bandwidth"
                value={<span className="font-mono text-xs">{config.congestion.target_bandwidth || "\u2014"}</span>}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Port Hopping</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {onSave ? (
            <>
              <div className="flex items-center justify-between">
                <Label htmlFor="port-hopping-enabled">Enabled</Label>
                <Switch
                  id="port-hopping-enabled"
                  checked={ePortHoppingEnabled}
                  onCheckedChange={(v: boolean) => setPortHoppingEnabled(v)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="port-hopping-base">Base Port</Label>
                  <Input
                    id="port-hopping-base"
                    type="number"
                    value={ePortHoppingBasePort}
                    onChange={(e) => setPortHoppingBasePort(parseInt(e.target.value, 10) || 0)}
                    min={0}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="port-hopping-range">Range</Label>
                  <Input
                    id="port-hopping-range"
                    type="number"
                    value={ePortHoppingRange}
                    onChange={(e) => setPortHoppingRange(parseInt(e.target.value, 10) || 0)}
                    min={0}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="port-hopping-interval">Interval (s)</Label>
                  <Input
                    id="port-hopping-interval"
                    type="number"
                    value={ePortHoppingIntervalSecs}
                    onChange={(e) => setPortHoppingIntervalSecs(parseInt(e.target.value, 10) || 0)}
                    min={0}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="port-hopping-grace">Grace Period (s)</Label>
                  <Input
                    id="port-hopping-grace"
                    type="number"
                    value={ePortHoppingGracePeriodSecs}
                    onChange={(e) => setPortHoppingGracePeriodSecs(parseInt(e.target.value, 10) || 0)}
                    min={0}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <KeyValue
                label="Status"
                value={
                  <Badge
                    className={
                      config.port_hopping.enabled
                        ? "bg-green-500/15 text-green-700 dark:text-green-400"
                        : "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400"
                    }
                  >
                    {config.port_hopping.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                }
              />
              <KeyValue
                label="Base Port"
                value={<span className="font-mono text-xs">{config.port_hopping.base_port}</span>}
              />
              <KeyValue
                label="Range"
                value={<span className="font-mono text-xs">{config.port_hopping.range}</span>}
              />
              <KeyValue
                label="Interval"
                value={<span className="font-mono text-xs">{config.port_hopping.interval_secs}s</span>}
              />
              <KeyValue
                label="Grace Period"
                value={<span className="font-mono text-xs">{config.port_hopping.grace_period_secs}s</span>}
              />
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Anti-RTT</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {onSave ? (
              <>
                <div className="flex items-center justify-between">
                  <Label htmlFor="anti-rtt-enabled">Enabled</Label>
                  <Switch
                    id="anti-rtt-enabled"
                    checked={eAntiRttEnabled}
                    onCheckedChange={(v: boolean) => setAntiRttEnabled(v)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="anti-rtt-ms">Normalization (ms)</Label>
                  <Input
                    id="anti-rtt-ms"
                    type="number"
                    value={eAntiRttNormalizationMs}
                    onChange={(e) => setAntiRttNormalizationMs(parseInt(e.target.value, 10) || 0)}
                    min={0}
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
                        config.anti_rtt.enabled
                          ? "bg-green-500/15 text-green-700 dark:text-green-400"
                          : "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400"
                      }
                    >
                      {config.anti_rtt.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  }
                />
                <KeyValue
                  label="Normalization"
                  value={<span className="font-mono text-xs">{config.anti_rtt.normalization_ms} ms</span>}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {onSave && (
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      )}
    </form>
  );
}
