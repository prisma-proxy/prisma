import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import i18n from "../i18n";
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

// Throttle stats processing to at most once per animation frame.
// When the backend sends stats faster than the display can render,
// intermediate updates are dropped — only the latest matters.
let pendingStats: Stats | null = null;
let statsRafId: number | null = null;

// Throttle error notifications: at most 1 per second to prevent toast storms
// when the server crashes and many error events fire in rapid succession.
let lastErrorNotifyMs = 0;
let suppressedErrors = 0;

// Batch log entries via rAF to prevent per-log React re-renders under load.
let pendingLogs: LogEntry[] = [];
let pendingConnMsgs: string[] = [];
let logRafId: number | null = null;

// Track recent unique destinations for tray submenu (Item 6).
const MAX_RECENT = 5;
let recentDestinations: string[] = [];
let recentDirty = false;

// Throttle tray stats updates (every N stats ticks instead of every tick)
let trayUpdateCounter = 0;
const TRAY_UPDATE_EVERY = 3;

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
            if (useSettings.getState().proxyModes & MODE_SYSTEM_PROXY) {
              const httpPort = useSettings.getState().httpPort;
              if (httpPort && httpPort > 0) {
                setTimeout(() => {
                  api.setSystemProxy("127.0.0.1", httpPort).catch(() => {});
                }, 200);
              } else {
                notify.warning(i18n.t("notifications.systemProxyNoHttpPort"));
              }
            }
            // Force tray menu rebuild so Connect/Disconnect label is correct
            api.refreshTrayProfiles().catch(() => {});
            notify.success(i18n.t("notifications.connected"));
          } else if (data.status === "connecting") {
            store.setManualDisconnect(false);
            store.setConnecting(true);
          } else {
            // Cancel pending rAFs to stop processing stale data
            if (statsRafId !== null) {
              cancelAnimationFrame(statsRafId);
              statsRafId = null;
              pendingStats = null;
            }
            if (logRafId !== null) {
              cancelAnimationFrame(logRafId);
              logRafId = null;
              pendingLogs = [];
              pendingConnMsgs = [];
            }
            recentDestinations = [];
            recentDirty = false;
            trayUpdateCounter = 0;

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
            useConnections.getState().clearAll();
            store.clearLogs();
            store.setConnected(false);
            // Force tray menu rebuild so Connect/Disconnect label is correct
            api.refreshTrayProfiles().catch(() => {});
          }
          break;

        case "stats": {
          if (!store.connected) break; // Ignore stats after disconnect
          pendingStats = data as unknown as Stats;
          if (statsRafId === null) {
            statsRafId = requestAnimationFrame(() => {
              statsRafId = null;
              if (!pendingStats) return;
              const s = pendingStats;
              pendingStats = null;
              const st = useStore.getState();
              const prevStats = st.stats;
              st.setStats(s);
              // Track peak speeds for the active profile
              const { activeProfileIdx: aidx, profiles: profs } = st;
              const activeProf = aidx !== null ? profs[aidx] : profs[0];
              if (activeProf && (s.speed_down_bps > 0 || s.speed_up_bps > 0)) {
                const pm = useProfileMetrics.getState();
                const cur = pm.metrics[activeProf.id];
                if (!cur || s.speed_down_bps > cur.peakSpeedDownBps || s.speed_up_bps > cur.peakSpeedUpBps) {
                  pm.recordPeakSpeed(activeProf.id, s.speed_down_bps, s.speed_up_bps);
                }
              }
              // Track data usage deltas
              if (prevStats) {
                const deltaUp = Math.max(0, s.bytes_up - prevStats.bytes_up);
                const deltaDown = Math.max(0, s.bytes_down - prevStats.bytes_down);
                if (deltaUp > 0 || deltaDown > 0) {
                  useDataUsage.getState().recordUsage(deltaUp, deltaDown);
                  const analytics = useAnalytics.getState();
                  const activeConns = useConnections.getState().connections.filter((c) => c.status === "active");
                  if (activeConns.length > 0) {
                    const perUp = Math.floor(deltaUp / activeConns.length);
                    const perDown = Math.floor(deltaDown / activeConns.length);
                    for (const conn of activeConns) {
                      const domain = conn.destination.replace(/:\d+$/, "");
                      analytics.addTraffic(domain, perUp, perDown, conn.rule);
                    }
                  } else {
                    analytics.addTraffic("(unattributed)", deltaUp, deltaDown);
                  }
                }
              }
              // Throttle tray updates to every Nth stats tick
              trayUpdateCounter++;
              if (trayUpdateCounter >= TRAY_UPDATE_EVERY) {
                trayUpdateCounter = 0;
                const profileName = activeProf?.name ?? "";
                api.updateTrayStats(
                  s.speed_up_bps,
                  s.speed_down_bps,
                  s.bytes_up,
                  s.bytes_down,
                  useConnections.getState().activeCount,
                  profileName,
                  s.uptime_secs,
                ).catch(() => {});
              }
            });
          }
          break;
        }

        case "log": {
          if (!store.connected) break; // Ignore logs after disconnect
          const logMsg = data.msg ?? "";
          pendingLogs.push({
            level: (data.level ?? "INFO") as LogEntry["level"],
            msg:   logMsg,
            time:  data.time ?? Date.now(),
          });
          pendingConnMsgs.push(logMsg);
          if (logRafId === null) {
            logRafId = requestAnimationFrame(() => {
              logRafId = null;
              const batch = pendingLogs;
              pendingLogs = [];
              if (batch.length > 0 && useStore.getState().connected) {
                useStore.getState().addLogs(batch);
              }
              // Batch connection parsing — avoids per-log store updates
              const connBatch = pendingConnMsgs;
              pendingConnMsgs = [];
              for (const m of connBatch) {
                parseLogForConnection(m);
              }
              // Track recent destinations for tray submenu
              const conns = useConnections.getState().connections;
              if (conns.length > 0) {
                const latest = conns[conns.length - 1];
                const dest = latest.destination.replace(/:\d+$/, "");
                if (dest && !recentDestinations.includes(dest)) {
                  recentDestinations = [dest, ...recentDestinations].slice(0, MAX_RECENT);
                  recentDirty = true;
                }
              }
              if (recentDirty) {
                recentDirty = false;
                api.updateTrayRecent([...recentDestinations]).catch(() => {});
              }
            });
          }
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

        case "error": {
          // Only reset speed test state for speed-test-specific errors
          if (data.code === "speed_test_failed") {
            store.setSpeedTestRunning(false);
          }
          // Throttle error toasts to prevent GUI lag from error storms
          const now = Date.now();
          if (now - lastErrorNotifyMs >= 1000) {
            const suffix = suppressedErrors > 0 ? ` (+${suppressedErrors} more)` : "";
            notify.error((data.msg ?? `Error: ${data.code ?? "unknown"}`) + suffix);
            lastErrorNotifyMs = now;
            suppressedErrors = 0;
          } else {
            suppressedErrors++;
          }
          break;
        }
      }
    });

    return () => { unlisten.then((f) => f()); };
  }, []);
}
