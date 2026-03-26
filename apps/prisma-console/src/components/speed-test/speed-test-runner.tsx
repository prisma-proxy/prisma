"use client";

import { useState } from "react";
import { PlayCircle, StopCircle, ArrowDown, ArrowUp, Activity } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { TEST_SERVERS, type useSpeedTest } from "@/hooks/use-speed-test";
import { useI18n } from "@/lib/i18n";

interface SpeedTestRunnerProps {
  speedTest: ReturnType<typeof useSpeedTest>;
}

export function SpeedTestRunner({ speedTest }: SpeedTestRunnerProps) {
  const { t } = useI18n();
  const {
    running,
    result,
    progress,
    phase,
    liveDl,
    liveUl,
    run,
    stop,
  } = speedTest;

  const [duration, setDuration] = useState(10);
  const [serverIdx, setServerIdx] = useState("0");

  const handleRun = () => {
    run(parseInt(serverIdx, 10), duration);
  };

  const handleDurationBlur = () => {
    setDuration((d) => Math.max(5, Math.min(60, d)));
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t("speedTest.server")}</Label>
          <Select value={serverIdx} onValueChange={(v) => v && setServerIdx(v)}>
            <SelectTrigger>
              <span className="flex flex-1 text-left">{TEST_SERVERS[parseInt(serverIdx)]?.label}</span>
            </SelectTrigger>
            <SelectContent>
              {TEST_SERVERS.map((s, i) => (
                <SelectItem key={i} value={String(i)}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("speedTest.duration")}</Label>
          <Input
            type="number"
            min={5}
            max={60}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            onBlur={handleDurationBlur}
            className="w-full"
            disabled={running}
          />
        </div>
      </div>

      <Button
        className="w-full"
        variant={running ? "destructive" : "default"}
        onClick={running ? stop : handleRun}
      >
        {running ? (
          <>
            <StopCircle className="h-4 w-4 mr-2" />
            {t("speedTest.stop")}
          </>
        ) : (
          <>
            <PlayCircle className="h-4 w-4 mr-2" />
            {t("speedTest.run")}
          </>
        )}
      </Button>

      {running && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{phase}</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} />
          <div className="grid grid-cols-2 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold text-green-500 dark:text-green-400">
                {liveDl.toFixed(1)}
              </p>
              <p className="text-xs text-muted-foreground">{"\u2193"} {t("chart.mbps")}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-500 dark:text-blue-400">
                {liveUl.toFixed(1)}
              </p>
              <p className="text-xs text-muted-foreground">{"\u2191"} {t("chart.mbps")}</p>
            </div>
          </div>
        </div>
      )}

      {result && !running && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-4 pb-4 flex flex-col items-center gap-1">
              <ArrowDown className="text-green-500 dark:text-green-400" size={24} />
              <p className="text-2xl font-bold">{result.downloadMbps.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">{t("speedTest.download")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 flex flex-col items-center gap-1">
              <ArrowUp className="text-blue-500 dark:text-blue-400" size={24} />
              <p className="text-2xl font-bold">{result.uploadMbps.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">{t("speedTest.upload")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 flex flex-col items-center gap-1">
              <Activity className="text-yellow-500 dark:text-yellow-400" size={24} />
              <p className="text-2xl font-bold">{result.latencyMs.toFixed(0)}</p>
              <p className="text-xs text-muted-foreground">{t("speedTest.latency")}</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
