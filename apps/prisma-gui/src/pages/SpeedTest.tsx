import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { PlayCircle, ArrowDown, ArrowUp, Activity, Trash2, Clock, Loader2, BarChart3, List } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useStore } from "@/store";
import { notify } from "@/store/notifications";
import { useSpeedTestHistory } from "@/store/speedTestHistory";
import type { SpeedTestEntry } from "@/store/speedTestHistory";
import { api } from "@/lib/commands";
import { fmtRelativeTime } from "@/lib/format";
import SpeedTestChart from "@/components/SpeedTestChart";

const TEST_SERVERS = [
  { label: "Cloudflare", pingUrl: "https://speed.cloudflare.com/__down?bytes=0" },
  { label: "Google", pingUrl: "https://www.google.com" },
];

async function measureLatency(url: string): Promise<number> {
  const start = performance.now();
  try {
    await fetch(url, { method: "HEAD", cache: "no-store", mode: "no-cors" });
  } catch {
    // no-cors will "fail" but we still measure the round-trip
  }
  return Math.round(performance.now() - start);
}

export default function SpeedTest() {
  const { t } = useTranslation();
  const connected = useStore((s) => s.connected);
  const speedTestRunning = useStore((s) => s.speedTestRunning);
  const speedTestResult = useStore((s) => s.speedTestResult);
  const setSpeedTestRunning = useStore((s) => s.setSpeedTestRunning);
  const history = useSpeedTestHistory((s) => s.entries);
  const addHistory = useSpeedTestHistory((s) => s.add);
  const clearHistory = useSpeedTestHistory((s) => s.clear);

  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [duration, setDuration] = useState(10);
  const [serverIdx, setServerIdx] = useState("0");
  const [viewMode, setViewMode] = useState<"list" | "chart">("list");
  // Track whether we're waiting for a result from the current run
  const expectingResult = useRef(false);
  const runContextRef = useRef({ serverIdx: "0", latencyMs: 0 as number | null, connected: false });

  // When FFI speed test result arrives, save to history
  useEffect(() => {
    if (!speedTestResult || !expectingResult.current) return;
    expectingResult.current = false;

    const ctx = runContextRef.current;
    const server = TEST_SERVERS[parseInt(ctx.serverIdx, 10)] ?? TEST_SERVERS[0];
    addHistory({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      server: server.label,
      downloadMbps: speedTestResult.download_mbps,
      uploadMbps: speedTestResult.upload_mbps,
      latencyMs: ctx.latencyMs ?? 0,
      viaProxy: ctx.connected,
    });
  }, [speedTestResult, addHistory]);

  const handleRun = useCallback(async () => {
    if (!connected) {
      notify.warning(t("speedTest.notConnected"));
      return;
    }

    const server = TEST_SERVERS[parseInt(serverIdx, 10)] ?? TEST_SERVERS[0];

    try {
      // Phase 1: Measure latency with browser HEAD pings
      setLatencyMs(null);
      const pings: number[] = [];
      for (let i = 0; i < 3; i++) {
        pings.push(await measureLatency(server.pingUrl));
      }
      const lat = pings.length > 0 ? Math.min(...pings) : 0;
      setLatencyMs(lat);

      // Phase 2: Kick off FFI speed test (non-blocking, result arrives via event)
      runContextRef.current = { serverIdx, latencyMs: lat, connected };
      expectingResult.current = true;
      setSpeedTestRunning(true);
      await api.speedTest(server.label.toLowerCase(), duration);
    } catch (e) {
      notify.error(String(e));
      setSpeedTestRunning(false);
    }
  }, [duration, serverIdx, t, connected, setSpeedTestRunning]);

  const handleDurationBlur = useCallback(() => {
    setDuration((d) => Math.max(5, Math.min(60, d)));
  }, []);

  const recentHistory = history.slice().reverse().slice(0, 10);

  // Compute averages from history
  const avgDown = history.length > 0
    ? history.reduce((s, e) => s + e.downloadMbps, 0) / history.length : 0;
  const avgUp = history.length > 0
    ? history.reduce((s, e) => s + e.uploadMbps, 0) / history.length : 0;
  const bestDown = history.length > 0
    ? Math.max(...history.map((e) => e.downloadMbps)) : 0;

  return (
    <ScrollArea className="h-full">
    <div className="p-4 sm:p-6 pb-12 space-y-4">
      <h1 className="font-bold text-lg">{t("speedTest.title")}</h1>

      {!connected && (
        <div className="rounded-lg border border-yellow-600/30 bg-yellow-600/10 p-3 text-sm text-yellow-500">
          {t("speedTest.notConnected")}
        </div>
      )}

      <div className="space-y-3">
        <div className="space-y-1">
          <Label>{t("speedTest.server")}</Label>
          <Select value={serverIdx} onValueChange={setServerIdx}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TEST_SERVERS.map((s, i) => (
                <SelectItem key={i} value={String(i)}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t("speedTest.duration")}</Label>
          <Input
            type="number"
            min={5}
            max={60}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            onBlur={handleDurationBlur}
            className="w-24"
            disabled={speedTestRunning}
          />
        </div>
      </div>

      <Button
        className="w-full"
        disabled={speedTestRunning || !connected}
        onClick={handleRun}
      >
        {speedTestRunning ? (
          <><Loader2 className="animate-spin" /> {t("speedTest.running")}</>
        ) : (
          <><PlayCircle /> {t("speedTest.run")}</>
        )}
      </Button>

      {speedTestRunning && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="animate-spin" size={16} />
          <span>{t("speedTest.testing")}</span>
        </div>
      )}

      {speedTestResult && !speedTestRunning && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-4 pb-4 flex flex-col items-center gap-1">
              <ArrowDown className="text-green-400" size={24} />
              <p className="text-2xl font-bold">{speedTestResult.download_mbps.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">{t("speedTest.download")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 flex flex-col items-center gap-1">
              <ArrowUp className="text-blue-400" size={24} />
              <p className="text-2xl font-bold">{speedTestResult.upload_mbps.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">{t("speedTest.upload")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 flex flex-col items-center gap-1">
              <Activity className="text-yellow-400" size={24} />
              <p className="text-2xl font-bold">{latencyMs ?? "—"}</p>
              <p className="text-xs text-muted-foreground">{t("speedTest.latency")}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Summary stats from history */}
      {history.length > 0 && !speedTestRunning && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border bg-card p-2">
              <p className="text-sm font-bold">{avgDown.toFixed(1)}</p>
              <p className="text-[10px] text-muted-foreground">{t("speedTest.avgDownload")}</p>
            </div>
            <div className="rounded-lg border bg-card p-2">
              <p className="text-sm font-bold">{avgUp.toFixed(1)}</p>
              <p className="text-[10px] text-muted-foreground">{t("speedTest.avgUpload")}</p>
            </div>
            <div className="rounded-lg border bg-card p-2">
              <p className="text-sm font-bold">{bestDown.toFixed(1)}</p>
              <p className="text-[10px] text-muted-foreground">{t("speedTest.bestDownload")}</p>
            </div>
          </div>
        </div>
      )}

      {/* Speed test history */}
      {recentHistory.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Clock size={12} /> {t("speedTest.history")}
              <span className="text-[10px]">({history.length})</span>
            </p>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={viewMode === "list" ? "default" : "ghost"}
                onClick={() => setViewMode("list")}
                className="h-6 w-6 p-0"
              >
                <List size={12} />
              </Button>
              <Button
                size="sm"
                variant={viewMode === "chart" ? "default" : "ghost"}
                onClick={() => setViewMode("chart")}
                className="h-6 w-6 p-0"
              >
                <BarChart3 size={12} />
              </Button>
              <Button size="sm" variant="ghost" onClick={clearHistory} className="h-6 px-2">
                <Trash2 size={12} />
              </Button>
            </div>
          </div>

          {viewMode === "chart" ? (
            <SpeedTestChart entries={history} />
          ) : (
            <div className="space-y-1">
              {recentHistory.map((entry) => (
                <HistoryRow key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
    </ScrollArea>
  );
}

function HistoryRow({ entry }: { entry: SpeedTestEntry }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-md border bg-card px-3 py-1.5">
      <span className={entry.viaProxy ? "text-green-400" : "text-gray-400"}>
        {entry.viaProxy ? "●" : "○"}
      </span>
      <span className="font-medium text-foreground">
        ↓{entry.downloadMbps.toFixed(1)}
      </span>
      <span>
        ↑{entry.uploadMbps.toFixed(1)}
      </span>
      <span>{entry.latencyMs}ms</span>
      <span className="text-[10px]">{entry.server}</span>
      <span className="text-[10px]">
        {entry.viaProxy ? t("speedTest.proxy") : t("speedTest.direct")}
      </span>
      <span className="ml-auto text-[10px]">
        {fmtRelativeTime(new Date(entry.timestamp).toISOString())}
      </span>
    </div>
  );
}
