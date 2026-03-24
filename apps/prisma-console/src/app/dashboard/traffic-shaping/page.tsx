"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { BucketChart } from "@/components/traffic-shaping/bucket-chart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SkeletonCard } from "@/components/ui/skeleton";

const PADDING_MODES = ["none", "uniform", "random"];
const CONGESTION_MODES = ["auto", "bbr", "cubic", "none"];

export default function TrafficShapingPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: ["config"],
    queryFn: api.getConfig,
  });

  const patchConfig = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patchConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] });
      toast(t("toast.trafficShapingSaved"), "success");
    },
    onError: (error: Error) => {
      toast(error.message, "error");
    },
  });

  // Local form state — null means "use server value"
  const [paddingMode, setPaddingMode] = useState<string | null>(null);
  const [paddingMin, setPaddingMin] = useState<number | null>(null);
  const [paddingMax, setPaddingMax] = useState<number | null>(null);
  const [timingJitterMs, setTimingJitterMs] = useState<number | null>(null);
  const [chaffIntervalMs, setChaffIntervalMs] = useState<number | null>(null);
  const [coalesceWindowMs, setCoalesceWindowMs] = useState<number | null>(null);
  const [congestionMode, setCongestionMode] = useState<string | null>(null);
  const [targetBandwidth, setTargetBandwidth] = useState<string | null>(null);

  if (isLoading || !config) {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold">{t("trafficShaping.title")}</h2>
        <SkeletonCard className="h-40" />
        <SkeletonCard className="h-64" />
      </div>
    );
  }

  // Effective values: local override or server value
  const ePaddingMode = paddingMode ?? config.traffic_shaping.padding_mode;
  const ePaddingMin = paddingMin ?? config.padding.min;
  const ePaddingMax = paddingMax ?? config.padding.max;
  const eTimingJitterMs = timingJitterMs ?? config.traffic_shaping.timing_jitter_ms;
  const eChaffIntervalMs = chaffIntervalMs ?? config.traffic_shaping.chaff_interval_ms;
  const eCoalesceWindowMs = coalesceWindowMs ?? config.traffic_shaping.coalesce_window_ms;
  const eCongestionMode = congestionMode ?? config.congestion.mode;
  const eTargetBandwidth = targetBandwidth ?? config.congestion.target_bandwidth ?? "";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    patchConfig.mutate({
      traffic_shaping_padding_mode: ePaddingMode,
      padding_min: ePaddingMin,
      padding_max: ePaddingMax,
      traffic_shaping_timing_jitter_ms: eTimingJitterMs,
      traffic_shaping_chaff_interval_ms: eChaffIntervalMs,
      traffic_shaping_coalesce_window_ms: eCoalesceWindowMs,
      congestion_mode: eCongestionMode,
      congestion_target_bandwidth: eTargetBandwidth || undefined,
    });
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">{t("trafficShaping.editTitle")}</h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("trafficShaping.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {/* Padding Mode */}
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

            {/* Padding Range */}
            <div className="grid gap-1.5">
              <Label>{t("trafficShaping.paddingRange")}</Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="ts-padding-min" className="text-xs text-muted-foreground">
                    {t("trafficShaping.paddingMin")}
                  </Label>
                  <Input
                    id="ts-padding-min"
                    type="number"
                    value={ePaddingMin}
                    onChange={(e) => setPaddingMin(parseInt(e.target.value, 10) || 0)}
                    min={0}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ts-padding-max" className="text-xs text-muted-foreground">
                    {t("trafficShaping.paddingMax")}
                  </Label>
                  <Input
                    id="ts-padding-max"
                    type="number"
                    value={ePaddingMax}
                    onChange={(e) => setPaddingMax(parseInt(e.target.value, 10) || 0)}
                    min={0}
                  />
                </div>
              </div>
            </div>

            {/* Timing Jitter */}
            <div className="grid gap-1.5">
              <Label htmlFor="ts-jitter">{t("trafficShaping.timingJitter")}</Label>
              <Input
                id="ts-jitter"
                type="number"
                value={eTimingJitterMs}
                onChange={(e) => setTimingJitterMs(parseInt(e.target.value, 10) || 0)}
                min={0}
              />
            </div>

            {/* Chaff Interval */}
            <div className="grid gap-1.5">
              <Label htmlFor="ts-chaff">{t("trafficShaping.chaffInterval")}</Label>
              <Input
                id="ts-chaff"
                type="number"
                value={eChaffIntervalMs}
                onChange={(e) => setChaffIntervalMs(parseInt(e.target.value, 10) || 0)}
                min={0}
              />
              <p className="text-xs text-muted-foreground">{t("trafficShaping.chaffDisabled")}</p>
            </div>

            {/* Coalesce Window */}
            <div className="grid gap-1.5">
              <Label htmlFor="ts-coalesce">{t("trafficShaping.coalesceWindow")}</Label>
              <Input
                id="ts-coalesce"
                type="number"
                value={eCoalesceWindowMs}
                onChange={(e) => setCoalesceWindowMs(parseInt(e.target.value, 10) || 0)}
                min={0}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("trafficShaping.congestionMode")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {/* Congestion Mode */}
            <div className="grid gap-1.5">
              <Label>{t("trafficShaping.congestionMode")}</Label>
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

            {/* Target Bandwidth */}
            <div className="grid gap-1.5">
              <Label htmlFor="ts-bandwidth">{t("trafficShaping.targetBandwidth")}</Label>
              <Input
                id="ts-bandwidth"
                value={eTargetBandwidth}
                onChange={(e) => setTargetBandwidth(e.target.value)}
                placeholder={t("trafficShaping.targetBandwidthPlaceholder")}
              />
            </div>
          </CardContent>
        </Card>

        <Button type="submit" disabled={patchConfig.isPending}>
          {patchConfig.isPending ? t("common.saving") : t("common.save")}
        </Button>
      </form>

      {/* Read-only bucket sizes chart */}
      <BucketChart
        bucketSizes={config.traffic_shaping.bucket_sizes ?? []}
      />
    </div>
  );
}
