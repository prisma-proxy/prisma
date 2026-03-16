import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { toast } from "sonner";
import { useStore } from "../store";
import type { Stats, LogEntry, SpeedTestResult } from "../lib/types";

interface PrismaEvent {
  type: string;
  status?: string;
  version?: string;
  level?: string;
  msg?: string;
  time?: number;
  download_mbps?: number;
  upload_mbps?: number;
  bytes_up?: number;
  bytes_down?: number;
  speed_up_bps?: number;
  speed_down_bps?: number;
  uptime_secs?: number;
  code?: string;
}

export function usePrismaEvents() {
  const {
    setConnected,
    setConnecting,
    setManualDisconnect,
    setStats,
    addLog,
    setUpdateAvailable,
    setSpeedTestResult,
    setSpeedTestRunning,
  } = useStore();

  useEffect(() => {
    const unlisten = listen<string>("prisma://event", (event) => {
      let data: PrismaEvent;
      try {
        data = JSON.parse(event.payload);
      } catch {
        return;
      }

      switch (data.type) {
        case "status_changed":
          // Any status change resets the manual-disconnect flag
          setManualDisconnect(false);
          if (data.status === "connected") {
            setConnected(true);
            toast.success("Connected");
          } else if (data.status === "connecting") {
            setConnecting(true);
          } else {
            setConnected(false);
          }
          break;

        case "stats":
          setStats(data as unknown as Stats);
          break;

        case "log":
          addLog({
            level: (data.level ?? "INFO") as LogEntry["level"],
            msg:   data.msg ?? "",
            time:  data.time ?? Date.now(),
          });
          break;

        case "update_available":
          if (data.version) {
            setUpdateAvailable(data.version);
            toast.info(`Update available: v${data.version}`);
          }
          break;

        case "speed_test_result":
          setSpeedTestResult({
            download_mbps: data.download_mbps ?? 0,
            upload_mbps:   data.upload_mbps   ?? 0,
          } as SpeedTestResult);
          break;

        case "error":
          setSpeedTestRunning(false);
          toast.error(data.msg ?? `Error: ${data.code ?? "unknown"}`);
          break;
      }
    });

    return () => { unlisten.then((f) => f()); };
  }, [setConnected, setConnecting, setManualDisconnect, setStats, addLog, setUpdateAvailable, setSpeedTestResult, setSpeedTestRunning]);
}
