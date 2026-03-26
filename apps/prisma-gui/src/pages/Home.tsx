import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Wifi, WifiOff, RefreshCw, Clock, ArrowUpDown, ArrowDown, ArrowUp, Timer, Database, Signal, ClipboardCopy } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import StatusBadge from "@/components/StatusBadge";
import SpeedGraph from "@/components/SpeedGraph";
import { useStore } from "@/store";
import { useSettings } from "@/store/settings";
import { useRules } from "@/store/rules";
import { useConnection } from "@/hooks/useConnection";
import { useConnectionHistory } from "@/store/connectionHistory";
import { fmtBytes, fmtRelativeTime, fmtSpeed, fmtUptime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/commands";
import { notify } from "@/store/notifications";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useDataUsage } from "@/store/dataUsage";
import { syncStatus } from "@/hooks/useStatusSync";
import { MODE_SOCKS5, MODE_SYSTEM_PROXY, MODE_TUN, MODE_PER_APP } from "@/lib/types";

export default function Home() {
  const { t } = useTranslation();
  const connected = useStore((s) => s.connected);
  const connecting = useStore((s) => s.connecting);
  const stats = useStore((s) => s.stats);
  const profiles = useStore((s) => s.profiles);
  const proxyModes = useSettings((s) => s.proxyModes);
  const activeProfileIdx = useStore((s) => s.activeProfileIdx);
  const setActiveProfileIdx = useStore((s) => s.setActiveProfileIdx);
  const setProfiles = useStore((s) => s.setProfiles);

  const speedSamplesDown = useStore((s) => s.speedSamplesDown);
  const rules = useRules((s) => s.rules);
  const { toggle, switchProxyMode } = useConnection();
  const events = useConnectionHistory((s) => s.events);
  const todayUsage = useDataUsage((s) => {
    const key = new Date().toISOString().slice(0, 10);
    return s.daily[key];
  }) ?? { up: 0, down: 0 };
  const recentEvents = events.slice(-10).reverse();

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => {
    api.listProfiles()
      .then((p) => setProfiles(p))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [setProfiles]);

  // Sync connection status when Home page mounts (covers navigation back to Home)
  useEffect(() => {
    syncStatus();
  }, []);

  // Derive server address from active profile (stable string, avoids profiles array dep)
  const serverAddr = useMemo(() => {
    const profile = activeProfileIdx !== null ? profiles[activeProfileIdx] : null;
    if (!profile) return null;
    const config = profile.config as Record<string, unknown>;
    return typeof config.server_addr === "string" ? config.server_addr : null;
  }, [activeProfileIdx, profiles]);

  useEffect(() => {
    if (!connected || !serverAddr) {
      setLatency(null);
      return;
    }

    const addr = serverAddr; // capture narrowed string
    let cancelled = false;
    async function ping() {
      try {
        const ms = await api.pingServer(addr);
        if (!cancelled) setLatency(ms);
      } catch {
        if (!cancelled) setLatency(null);
      }
    }
    ping();
    const interval = setInterval(ping, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [connected, serverAddr]);

  const handleConnect = useCallback(async () => {
    setBusy(true);
    try { await toggle(); } finally { setBusy(false); }
  }, [toggle]);

  const modeValues: string[] = [];
  if (proxyModes & MODE_SOCKS5)       modeValues.push("socks5");
  if (proxyModes & MODE_SYSTEM_PROXY) modeValues.push("sys");
  if (proxyModes & MODE_TUN)          modeValues.push("tun");
  if (proxyModes & MODE_PER_APP)      modeValues.push("app");

  const onModeChange = useCallback((vals: string[]) => {
    let flags = 0;
    if (vals.includes("socks5")) flags |= MODE_SOCKS5;
    if (vals.includes("sys"))    flags |= MODE_SYSTEM_PROXY;
    if (vals.includes("tun"))    flags |= MODE_TUN;
    if (vals.includes("app"))    flags |= MODE_PER_APP;
    const newModes = flags || MODE_SYSTEM_PROXY;
    const oldModes = useSettings.getState().proxyModes;
    switchProxyMode(oldModes, newModes);
  }, [switchProxyMode]);

  const activeProfile = activeProfileIdx !== null ? profiles[activeProfileIdx] : profiles[0];
  const latencyColor = latency === null ? "text-muted-foreground" : latency < 100 ? "text-green-500" : latency < 300 ? "text-yellow-500" : "text-red-500";

  return (
    <ScrollArea className="h-full">
    <div className="p-4 sm:p-6 pb-12 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Prisma</h1>
          <div className="flex items-center gap-1.5">
            <StatusBadge />
            {rules.length > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {rules.length} {rules.length === 1 ? "rule" : "rules"}
              </Badge>
            )}
          </div>
        </div>

        {/* Profile picker */}
        {loading ? (
          <Button variant="outline" size="sm" disabled className="max-w-[160px]">
            <RefreshCw size={12} className="animate-spin mr-1" /> {t("common.loading")}
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="max-w-[160px] truncate">
                {activeProfile?.name ?? t("profiles.noProfile")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {profiles.map((p, i) => (
                <DropdownMenuItem key={p.id} onSelect={() => setActiveProfileIdx(i)}>
                  {p.name}
                </DropdownMenuItem>
              ))}
              {profiles.length === 0 && (
                <DropdownMenuItem disabled>{t("profiles.noProfiles")}</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Speed graph */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-medium">{t("home.speedGraph")}</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <SpeedGraph />
        </CardContent>
      </Card>

      {/* Session stats */}
      {connected && stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          <Card>
            <CardContent className="py-2 px-3 flex flex-col items-center">
              <ArrowDown size={14} className="text-green-400 mb-0.5" />
              <p className="text-sm font-bold">{fmtSpeed(stats.speed_down_bps)}</p>
              <p className="text-[11px] sm:text-[10px] text-muted-foreground">{t("home.download")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-2 px-3 flex flex-col items-center">
              <ArrowUp size={14} className="text-blue-400 mb-0.5" />
              <p className="text-sm font-bold">{fmtSpeed(stats.speed_up_bps)}</p>
              <p className="text-[11px] sm:text-[10px] text-muted-foreground">{t("home.upload")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-2 px-3 flex flex-col items-center">
              <Database size={14} className="text-purple-400 mb-0.5" />
              <p className="text-sm font-bold">{fmtBytes(stats.bytes_down + stats.bytes_up)}</p>
              <p className="text-[11px] sm:text-[10px] text-muted-foreground">{t("home.transferred")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-2 px-3 flex flex-col items-center">
              <Timer size={14} className="text-yellow-400 mb-0.5" />
              <p className="text-sm font-bold font-mono">{fmtUptime(stats.uptime_secs)}</p>
              <p className="text-[11px] sm:text-[10px] text-muted-foreground">{t("home.uptime")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-2 px-3 flex flex-col items-center">
              <Signal size={14} className={`mb-0.5 ${latencyColor}`} />
              <p className={`text-sm font-bold ${latencyColor}`}>
                {latency !== null ? `${latency}ms` : "—"}
              </p>
              <p className="text-[11px] sm:text-[10px] text-muted-foreground">{t("home.latency")}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Connection quality + data usage */}
      {connected && speedSamplesDown.length >= 5 && (
        <div className="flex items-center gap-3">
          <ConnectionQuality samples={speedSamplesDown} />
          {(todayUsage.up > 0 || todayUsage.down > 0) && (
            <span className="text-xs text-muted-foreground">
              {t("home.todayUsage")}: ↑{fmtBytes(todayUsage.up)} ↓{fmtBytes(todayUsage.down)}
            </span>
          )}
        </div>
      )}

      {/* Proxy modes */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{t("home.proxyModes")}</p>
        <ToggleGroup
          type="multiple"
          value={modeValues}
          onValueChange={onModeChange}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="socks5">{t("home.modeProxyOnly")}</ToggleGroupItem>
          <ToggleGroupItem value="sys">{t("home.modeSystem")}</ToggleGroupItem>
          <ToggleGroupItem value="tun">TUN</ToggleGroupItem>
          <ToggleGroupItem value="app">{t("home.modePerApp")}</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Connect/Disconnect */}
      <div className="flex gap-2">
        <Button
          className="flex-1"
          variant={connected ? "destructive" : "default"}
          disabled={busy || connecting}
          onClick={handleConnect}
        >
          {connecting ? (
            <><RefreshCw className="animate-spin" /> {t("home.connecting")}</>
          ) : connected ? (
            <><WifiOff /> {t("home.disconnect")}</>
          ) : (
            <><Wifi /> {t("home.connect")}</>
          )}
        </Button>
        {connected && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={async () => {
                    try {
                      const url = await api.getPacUrl(0);
                      await writeText(url);
                      notify.success(t("home.pacUrlCopied"));
                    } catch (e) {
                      notify.error(String(e));
                    }
                  }}
                >
                  <ClipboardCopy size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("home.copyPacUrl")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Connection history */}
      {recentEvents.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            <Clock size={12} />
            <span>{t("history.recentActivity")}</span>
            <ArrowUpDown size={10} />
          </button>
          {historyOpen && (
            <div className="space-y-1">
              {recentEvents.map((ev, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className={ev.action === "connect" ? "text-green-500" : "text-gray-500"}>
                    {ev.action === "connect" ? "●" : "○"}
                  </span>
                  <span className="font-medium text-foreground">{ev.profileName}</span>
                  <span>{ev.action === "connect" ? t("history.connected") : t("history.disconnected")}</span>
                  {ev.latencyMs != null && <span>{ev.latencyMs}ms</span>}
                  {ev.sessionBytes && (
                    <span>↑{fmtBytes(ev.sessionBytes.up)} ↓{fmtBytes(ev.sessionBytes.down)}</span>
                  )}
                  <span className="ml-auto">{fmtRelativeTime(new Date(ev.timestamp).toISOString())}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
    </ScrollArea>
  );
}

function ConnectionQuality({ samples }: { samples: number[] }) {
  const { t } = useTranslation();

  const grade = useMemo(() => {
    const recent = samples.slice(-20);
    if (recent.length < 3) return null;
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (mean === 0) return null;
    const variance = recent.reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length;
    const cv = Math.sqrt(variance) / mean;
    if (cv < 0.15) return "excellent" as const;
    if (cv < 0.35) return "good" as const;
    if (cv < 0.6)  return "fair" as const;
    return "poor" as const;
  }, [samples]);

  if (!grade) return null;

  const labels = { excellent: t("home.qualityExcellent"), good: t("home.qualityGood"), fair: t("home.qualityFair"), poor: t("home.qualityPoor") };
  const colors = { excellent: "text-green-500 border-green-500/30", good: "text-blue-400 border-blue-400/30", fair: "text-yellow-500 border-yellow-500/30", poor: "text-red-500 border-red-500/30" };

  return (
    <Badge variant="outline" className={`text-[10px] ${colors[grade]} gap-1`}>
      <Signal size={10} /> {labels[grade]}
    </Badge>
  );
}
