import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { PlayCircle, StopCircle, ArrowDown, ArrowUp, Activity, Trash2, Clock } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useStore } from "@/store";
import { notify } from "@/store/notifications";
import { useSpeedTestHistory } from "@/store/speedTestHistory";
import type { SpeedTestEntry } from "@/store/speedTestHistory";
import { fmtRelativeTime } from "@/lib/format";

interface SpeedResult {
  downloadMbps: number;
  uploadMbps: number;
  latencyMs: number;
}

const TEST_SERVERS = [
  { label: "Cloudflare", download: "https://speed.cloudflare.com/__down?bytes=26214400", upload: "https://speed.cloudflare.com/__up" },
  { label: "Fast.com (Netflix)", download: "https://api.fast.com/netflix/speedtest/v2?https=true&token=YXNkZmFzZGxmbnNkYWZoYXNkZmhrYWw%3D&urlCount=1", upload: "" },
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

async function measureDownload(
  url: string,
  durationMs: number,
  onProgress: (mbps: number) => void,
  abort: AbortSignal,
): Promise<number> {
  const start = performance.now();
  let totalBytes = 0;

  const NUM_STREAMS = 4;
  const controllers: AbortController[] = [];

  async function streamFetch() {
    while (!abort.aborted && performance.now() - start < durationMs) {
      const ctrl = new AbortController();
      controllers.push(ctrl);
      abort.addEventListener("abort", () => ctrl.abort(), { once: true });
      try {
        const resp = await fetch(url, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!resp.body) break;
        const reader = resp.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done || abort.aborted) break;
          totalBytes += value.byteLength;
          const elapsedSec = (performance.now() - start) / 1000;
          if (elapsedSec > 0) onProgress((totalBytes * 8) / (elapsedSec * 1e6));
          if (performance.now() - start >= durationMs) break;
        }
      } catch {
        if (abort.aborted) break;
      }
    }
  }

  const streams = Array.from({ length: NUM_STREAMS }, () => streamFetch());
  await Promise.allSettled(streams);
  controllers.forEach((c) => c.abort());

  const elapsedSec = (performance.now() - start) / 1000;
  return elapsedSec > 0 ? (totalBytes * 8) / (elapsedSec * 1e6) : 0;
}

async function measureUpload(
  url: string,
  durationMs: number,
  onProgress: (mbps: number) => void,
  abort: AbortSignal,
): Promise<number> {
  if (!url) return 0;
  const start = performance.now();
  let totalBytes = 0;
  const chunkSize = 1024 * 1024;
  const chunk = new Uint8Array(chunkSize);

  while (!abort.aborted && performance.now() - start < durationMs) {
    try {
      await fetch(url, {
        method: "POST",
        body: chunk,
        cache: "no-store",
        signal: abort,
      });
      totalBytes += chunkSize;
      const elapsedSec = (performance.now() - start) / 1000;
      if (elapsedSec > 0) onProgress((totalBytes * 8) / (elapsedSec * 1e6));
    } catch {
      if (abort.aborted) break;
      return 0;
    }
  }

  const elapsedSec = (performance.now() - start) / 1000;
  return elapsedSec > 0 ? (totalBytes * 8) / (elapsedSec * 1e6) : 0;
}

export default function SpeedTest() {
  const { t } = useTranslation();
  const connected = useStore((s) => s.connected);
  const history = useSpeedTestHistory((s) => s.entries);
  const addHistory = useSpeedTestHistory((s) => s.add);
  const clearHistory = useSpeedTestHistory((s) => s.clear);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SpeedResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("");
  const [liveDl, setLiveDl] = useState(0);
  const [liveUl, setLiveUl] = useState(0);
  const [duration, setDuration] = useState(10);
  const [serverIdx, setServerIdx] = useState("0");
  const abortRef = useRef<AbortController | null>(null);

  const handleRun = useCallback(async () => {
    const server = TEST_SERVERS[parseInt(serverIdx, 10)] ?? TEST_SERVERS[0];
    setRunning(true);
    setResult(null);
    setProgress(0);
    setLiveDl(0);
    setLiveUl(0);
    abortRef.current = new AbortController();
    const abort = abortRef.current.signal;
    const durationMs = duration * 1000;

    try {
      // Phase 1: Latency
      setPhase(t("speedTest.measuringLatency"));
      setProgress(5);
      const pings: number[] = [];
      for (let i = 0; i < 3 && !abort.aborted; i++) {
        pings.push(await measureLatency(server.download));
      }
      const latencyMs = pings.length > 0 ? Math.min(...pings) : 0;
      setProgress(15);

      // Phase 2: Download
      setPhase(t("speedTest.measuringDownload"));
      const downloadMbps = await measureDownload(
        server.download,
        durationMs,
        (mbps) => setLiveDl(mbps),
        abort,
      );
      setProgress(60);

      // Phase 3: Upload
      setPhase(t("speedTest.measuringUpload"));
      const uploadMbps = await measureUpload(
        server.upload,
        durationMs * 0.6,
        (mbps) => setLiveUl(mbps),
        abort,
      );
      setProgress(100);

      const res = { downloadMbps, uploadMbps, latencyMs };
      setResult(res);

      // Save to history
      addHistory({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        server: server.label,
        downloadMbps,
        uploadMbps,
        latencyMs,
        viaProxy: connected,
      });
    } catch (e) {
      if (!abort.aborted) notify.error(String(e));
    } finally {
      setRunning(false);
      setPhase("");
      abortRef.current = null;
    }
  }, [duration, serverIdx, t, connected, addHistory]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

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
            disabled={running}
          />
        </div>
      </div>

      <Button
        className="w-full"
        variant={running ? "destructive" : "default"}
        onClick={running ? handleStop : handleRun}
      >
        {running ? (
          <><StopCircle /> {t("speedTest.stop")}</>
        ) : (
          <><PlayCircle /> {t("speedTest.run")}</>
        )}
      </Button>

      {running && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{phase}</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} />
          <div className="grid grid-cols-2 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold text-green-400">{liveDl.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">↓ Mbps</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-400">{liveUl.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">↑ Mbps</p>
            </div>
          </div>
        </div>
      )}

      {result && !running && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-4 pb-4 flex flex-col items-center gap-1">
              <ArrowDown className="text-green-400" size={24} />
              <p className="text-2xl font-bold">{result.downloadMbps.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">{t("speedTest.download")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 flex flex-col items-center gap-1">
              <ArrowUp className="text-blue-400" size={24} />
              <p className="text-2xl font-bold">{result.uploadMbps.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">{t("speedTest.upload")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 flex flex-col items-center gap-1">
              <Activity className="text-yellow-400" size={24} />
              <p className="text-2xl font-bold">{result.latencyMs}</p>
              <p className="text-xs text-muted-foreground">{t("speedTest.latency")}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Summary stats from history */}
      {history.length > 0 && !running && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 text-center">
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
            <Button size="sm" variant="ghost" onClick={clearHistory} className="h-6 px-2">
              <Trash2 size={12} />
            </Button>
          </div>
          <div className="space-y-1">
            {recentHistory.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} />
            ))}
          </div>
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
