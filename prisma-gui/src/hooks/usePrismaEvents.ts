import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { notify } from "../store/notifications";
import { useStore } from "../store";
import { useProfileMetrics } from "../store/profileMetrics";
import { useConnectionHistory } from "../store/connectionHistory";
import { useSettings } from "../store/settings";
import { api } from "../lib/commands";
import { MODE_SYSTEM_PROXY } from "../lib/types";
import type { Stats, LogEntry, SpeedTestResult, UpdateInfo } from "../lib/types";
import { useDataUsage } from "../store/dataUsage";
import { parseLogForConnection, useConnections } from "../store/connections";
import { useAnalytics } from "../store/analytics";

interface PrismaEvent {
  type: string;
  status?: string;
  version?: string;
  url?: string;
  changelog?: string;
  sha?: string;
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
          if (data.status === "connected") {
            // Only clear manualDisconnect on successful connection, not on
            // disconnect events.  Clearing it on disconnect would allow
            // useAutoReconnect to fire immediately after a manual disconnect.
            store.setManualDisconnect(false);
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
            store.setManualDisconnect(false);
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
            // Mark all active connections as closed so the user can see what
            // was connected before disconnect, then clear stale logs.
            useConnections.getState().closeAllActive();
            store.clearLogs();
            store.setConnected(false);
          }
          break;

        case "stats": {
          const s = data as unknown as Stats;
          const prevStats = store.stats;
          store.setStats(s);
          // Track peak speeds for the active profile
          const { activeProfileIdx: aidx, profiles: profs } = store;
          const activeProf = aidx !== null ? profs[aidx] : profs[0];
          if (activeProf) {
            useProfileMetrics.getState().recordPeakSpeed(activeProf.id, s.speed_down_bps, s.speed_up_bps);
          }
          // Track data usage deltas
          if (prevStats) {
            const deltaUp = Math.max(0, s.bytes_up - prevStats.bytes_up);
            const deltaDown = Math.max(0, s.bytes_down - prevStats.bytes_down);
            if (deltaUp > 0 || deltaDown > 0) {
              useDataUsage.getState().recordUsage(deltaUp, deltaDown);
              // Distribute traffic deltas to active connections for analytics.
              // If no active connections are tracked (log parsing didn't capture
              // them or they closed too quickly), attribute to "unknown" so that
              // daily totals and summary stats still accumulate.
              const activeConns = useConnections.getState().connections.filter((c) => c.status === "active");
              const analytics = useAnalytics.getState();
              if (activeConns.length > 0) {
                const perUp = Math.floor(deltaUp / activeConns.length);
                const perDown = Math.floor(deltaDown / activeConns.length);
                for (const conn of activeConns) {
                  const domain = conn.destination.replace(/:\d+$/, "");
                  analytics.addTraffic(domain, perUp, perDown, conn.rule);
                }
              } else {
                // Fallback: record unattributed traffic so totals are accurate
                analytics.addTraffic("(unattributed)", deltaUp, deltaDown);
              }
            }
          }
          break;
        }

        case "log": {
          const logMsg = data.msg ?? "";
          store.addLog({
            level: (data.level ?? "INFO") as LogEntry["level"],
            msg:   logMsg,
            time:  data.time ?? Date.now(),
          });
          parseLogForConnection(logMsg);
          break;
        }

        case "update_available":
          if (data.version) {
            const updateInfo: UpdateInfo = {
              version: data.version,
              url: data.url ?? "",
              changelog: data.changelog ?? "",
              sha: data.sha,
            };
            store.setUpdateAvailable(updateInfo);
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
          // Only reset speed test state for speed-test-specific errors
          if (data.code === "speed_test_failed") {
            store.setSpeedTestRunning(false);
          }
          notify.error(data.msg ?? `Error: ${data.code ?? "unknown"}`);
          break;
      }
    });

    return () => { unlisten.then((f) => f()); };
  }, []);
}
