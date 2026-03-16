import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { notify } from "../store/notifications";
import { useStore } from "../store";
import { useProfileMetrics } from "../store/profileMetrics";
import { useConnectionHistory } from "../store/connectionHistory";
import { useSettings } from "../store/settings";
import { api } from "../lib/commands";
import { MODE_SYSTEM_PROXY } from "../lib/types";
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
  useEffect(() => {
    const unlisten = listen<string>("prisma://event", (event) => {
      let data: PrismaEvent;
      try {
        data = JSON.parse(event.payload);
      } catch {
        return;
      }

      const store = useStore.getState();

      switch (data.type) {
        case "status_changed":
          store.setManualDisconnect(false);
          if (data.status === "connected") {
            store.setConnected(true);
            // Record connect latency for profile metrics
            {
              const { connectStartTime, activeProfileIdx, profiles } = store;
              if (connectStartTime) {
                const latencyMs = Date.now() - connectStartTime;
                const profile = activeProfileIdx !== null ? profiles[activeProfileIdx] : profiles[0];
                if (profile) {
                  useProfileMetrics.getState().recordConnect(profile.id, latencyMs);
                  useConnectionHistory.getState().add({
                    profileId: profile.id,
                    profileName: profile.name,
                    action: "connect",
                    timestamp: Date.now(),
                    latencyMs,
                  });
                }
                store.setConnectStartTime(null);
              }
            }
            // Set OS-level system proxy if MODE_SYSTEM_PROXY is active
            if (store.proxyModes & MODE_SYSTEM_PROXY) {
              const httpPort = useSettings.getState().httpPort;
              if (httpPort && httpPort > 0) {
                api.setSystemProxy("127.0.0.1", httpPort).catch(() => {});
              }
            }
            notify.success("Connected");
          } else if (data.status === "connecting") {
            store.setConnecting(true);
          } else {
            // Disconnected — record session bytes + uptime
            {
              const { activeProfileIdx, profiles, stats } = store;
              const profile = activeProfileIdx !== null ? profiles[activeProfileIdx] : profiles[0];
              if (profile && stats) {
                useProfileMetrics.getState().recordDisconnect(profile.id, stats.bytes_up, stats.bytes_down, stats.uptime_secs);
                useConnectionHistory.getState().add({
                  profileId: profile.id,
                  profileName: profile.name,
                  action: "disconnect",
                  timestamp: Date.now(),
                  sessionBytes: { up: stats.bytes_up, down: stats.bytes_down },
                });
              }
            }
            // Clear OS-level system proxy on disconnect
            api.clearSystemProxy().catch(() => {});
            store.setConnected(false);
          }
          break;

        case "stats": {
          const s = data as unknown as Stats;
          store.setStats(s);
          // Track peak speeds for the active profile
          const { activeProfileIdx: aidx, profiles: profs } = store;
          const activeProf = aidx !== null ? profs[aidx] : profs[0];
          if (activeProf) {
            useProfileMetrics.getState().recordPeakSpeed(activeProf.id, s.speed_down_bps, s.speed_up_bps);
          }
          break;
        }

        case "log":
          store.addLog({
            level: (data.level ?? "INFO") as LogEntry["level"],
            msg:   data.msg ?? "",
            time:  data.time ?? Date.now(),
          });
          break;

        case "update_available":
          if (data.version) {
            store.setUpdateAvailable(data.version);
            notify.info(`Update available: v${data.version}`);
          }
          break;

        case "speed_test_result":
          store.setSpeedTestResult({
            download_mbps: data.download_mbps ?? 0,
            upload_mbps:   data.upload_mbps   ?? 0,
          } as SpeedTestResult);
          break;

        case "error":
          store.setSpeedTestRunning(false);
          notify.error(data.msg ?? `Error: ${data.code ?? "unknown"}`);
          break;
      }
    });

    return () => { unlisten.then((f) => f()); };
  }, []);
}
