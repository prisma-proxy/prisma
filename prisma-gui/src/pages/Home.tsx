import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Wifi, WifiOff, RefreshCw, Clock, ArrowUpDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import StatusBadge from "@/components/StatusBadge";
import SpeedGraph from "@/components/SpeedGraph";
import { useStore } from "@/store";
import { useConnection } from "@/hooks/useConnection";
import { useConnectionHistory } from "@/store/connectionHistory";
import { fmtBytes, fmtRelativeTime } from "@/lib/format";
import { api } from "@/lib/commands";
import { MODE_SOCKS5, MODE_SYSTEM_PROXY, MODE_TUN, MODE_PER_APP } from "@/lib/types";

export default function Home() {
  const { t } = useTranslation();
  const connected = useStore((s) => s.connected);
  const connecting = useStore((s) => s.connecting);
  const profiles = useStore((s) => s.profiles);
  const proxyModes = useStore((s) => s.proxyModes);
  const activeProfileIdx = useStore((s) => s.activeProfileIdx);
  const setProxyModes = useStore((s) => s.setProxyModes);
  const setActiveProfileIdx = useStore((s) => s.setActiveProfileIdx);
  const setProfiles = useStore((s) => s.setProfiles);

  const { connectTo, disconnect } = useConnection();
  const events = useConnectionHistory((s) => s.events);
  const recentEvents = events.slice(-10).reverse();

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    api.listProfiles()
      .then((p) => setProfiles(p))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [setProfiles]);

  const handleConnect = useCallback(async () => {
    if (connected) {
      try {
        setBusy(true);
        await disconnect();
      } finally {
        setBusy(false);
      }
    } else {
      const profile = activeProfileIdx !== null ? profiles[activeProfileIdx] : profiles[0];
      if (!profile) return;
      try {
        setBusy(true);
        await connectTo(profile, proxyModes);
      } finally {
        setBusy(false);
      }
    }
  }, [connected, activeProfileIdx, profiles, proxyModes, connectTo, disconnect]);

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
    setProxyModes(flags || MODE_SYSTEM_PROXY);
  }, [setProxyModes]);

  const activeProfile = activeProfileIdx !== null ? profiles[activeProfileIdx] : profiles[0];

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Prisma</h1>
          <StatusBadge />
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
          <ToggleGroupItem value="socks5">SOCKS5</ToggleGroupItem>
          <ToggleGroupItem value="sys">{t("home.modeSystem")}</ToggleGroupItem>
          <ToggleGroupItem value="tun">TUN</ToggleGroupItem>
          <ToggleGroupItem value="app">{t("home.modePerApp")}</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Connect/Disconnect */}
      <Button
        className="w-full"
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
  );
}
