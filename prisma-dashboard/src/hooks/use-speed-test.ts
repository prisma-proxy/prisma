"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export interface SpeedTestEntry {
  id: string;
  timestamp: number;
  server: string;
  downloadMbps: number;
  uploadMbps: number;
  latencyMs: number;
}

export interface SpeedResult {
  downloadMbps: number;
  uploadMbps: number;
  latencyMs: number;
}

export const TEST_SERVERS = [
  {
    label: "Cloudflare",
    download: "https://speed.cloudflare.com/__down?bytes=26214400",
    upload: "https://speed.cloudflare.com/__up",
  },
];

const MAX_HISTORY = 50;
const STORAGE_KEY = "prisma-speed-test-history";

function loadHistory(): SpeedTestEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SpeedTestEntry[];
  } catch {
    return [];
  }
}

function saveHistory(entries: SpeedTestEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded — ignore
  }
}

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
  abort: AbortSignal
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
        const resp = await fetch(url, { cache: "no-store", signal: ctrl.signal });
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
  abort: AbortSignal
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

export function useSpeedTest() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SpeedResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("");
  const [liveDl, setLiveDl] = useState(0);
  const [liveUl, setLiveUl] = useState(0);
  const [history, setHistory] = useState<SpeedTestEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Load history on mount
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const run = useCallback(
    async (serverIdx: number, durationSecs: number) => {
      const server = TEST_SERVERS[serverIdx] ?? TEST_SERVERS[0];
      setRunning(true);
      setResult(null);
      setProgress(0);
      setLiveDl(0);
      setLiveUl(0);
      abortRef.current = new AbortController();
      const abort = abortRef.current.signal;
      const durationMs = durationSecs * 1000;

      try {
        // Phase 1: Latency
        setPhase("Measuring latency...");
        setProgress(5);
        const pings: number[] = [];
        for (let i = 0; i < 3 && !abort.aborted; i++) {
          pings.push(await measureLatency(server.download));
        }
        const latencyMs = pings.length > 0 ? Math.min(...pings) : 0;
        setProgress(15);

        // Phase 2: Download
        setPhase("Measuring download...");
        const downloadMbps = await measureDownload(
          server.download,
          durationMs,
          (mbps) => setLiveDl(mbps),
          abort
        );
        setProgress(60);

        // Phase 3: Upload
        setPhase("Measuring upload...");
        const uploadMbps = await measureUpload(
          server.upload,
          durationMs * 0.6,
          (mbps) => setLiveUl(mbps),
          abort
        );
        setProgress(100);

        const res = { downloadMbps, uploadMbps, latencyMs };
        setResult(res);

        // Save to history
        const entry: SpeedTestEntry = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          server: server.label,
          downloadMbps,
          uploadMbps,
          latencyMs,
        };
        setHistory((prev) => {
          const next = [...prev.slice(-(MAX_HISTORY - 1)), entry];
          saveHistory(next);
          return next;
        });
      } catch {
        // Aborted or other error
      } finally {
        setRunning(false);
        setPhase("");
        abortRef.current = null;
      }
    },
    []
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, []);

  return {
    running,
    result,
    progress,
    phase,
    liveDl,
    liveUl,
    history,
    run,
    stop,
    clearHistory,
  };
}
