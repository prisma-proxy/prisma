import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import StatusBadge from "@/components/StatusBadge";
import SpeedGraph from "@/components/SpeedGraph";
import { useStore } from "@/store";
import { api } from "@/lib/commands";
import { MODE_SOCKS5, MODE_SYSTEM_PROXY, MODE_TUN, MODE_PER_APP } from "@/lib/types";

function fmtBytes(n: number) {
  if (n < 1024)        return `${n} B`;
  if (n < 1048576)     return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824)  return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

function fmtUptime(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export default function Home() {
  const connected = useStore((s) => s.connected);
  const connecting = useStore((s) => s.connecting);
  const stats = useStore((s) => s.stats);
  const profiles = useStore((s) => s.profiles);
  const proxyModes = useStore((s) => s.proxyModes);
  const activeProfileIdx = useStore((s) => s.activeProfileIdx);
  const setProxyModes = useStore((s) => s.setProxyModes);
  const setActiveProfileIdx = useStore((s) => s.setActiveProfileIdx);
  const setProfiles = useStore((s) => s.setProfiles);
  const setManualDisconnect = useStore((s) => s.setManualDisconnect);

  const [busy,    setBusy]    = useState(false);
  const [loading, setLoading] = useState(true);

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
        setManualDisconnect(true);
        await api.disconnect();
      } catch (e) {
        toast.error(String(e));
        setManualDisconnect(false);
      } finally {
        setBusy(false);
      }
    } else {
      const profile = activeProfileIdx !== null ? profiles[activeProfileIdx] : profiles[0];
      if (!profile) { toast.error("No profile selected"); return; }
      try {
        setBusy(true);
        await api.connect(JSON.stringify(profile.config), proxyModes);
      } catch (e) {
        toast.error(String(e));
      } finally {
        setBusy(false);
      }
    }
  }, [connected, activeProfileIdx, profiles, proxyModes, setManualDisconnect]);

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
    setProxyModes(flags || MODE_SOCKS5);
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
            <RefreshCw size={12} className="animate-spin mr-1" /> Loading…
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="max-w-[160px] truncate">
                {activeProfile?.name ?? "No profile"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {profiles.map((p, i) => (
                <DropdownMenuItem key={p.id} onSelect={() => setActiveProfileIdx(i)}>
                  {p.name}
                </DropdownMenuItem>
              ))}
              {profiles.length === 0 && (
                <DropdownMenuItem disabled>No profiles</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Speed graph */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-medium">Speed (Mbps)</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <SpeedGraph />
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <Card className="p-3">
          <p className="text-muted-foreground text-xs">Downloaded</p>
          <p className="font-medium">{stats ? fmtBytes(stats.bytes_down) : "—"}</p>
        </Card>
        <Card className="p-3">
          <p className="text-muted-foreground text-xs">Uploaded</p>
          <p className="font-medium">{stats ? fmtBytes(stats.bytes_up) : "—"}</p>
        </Card>
        <Card className="p-3 col-span-2">
          <p className="text-muted-foreground text-xs">Uptime</p>
          <p className="font-medium font-mono">{stats ? fmtUptime(stats.uptime_secs) : "—"}</p>
        </Card>
      </div>

      {/* Proxy modes */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Proxy modes</p>
        <ToggleGroup
          type="multiple"
          value={modeValues}
          onValueChange={onModeChange}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="socks5">SOCKS5</ToggleGroupItem>
          <ToggleGroupItem value="sys">System</ToggleGroupItem>
          <ToggleGroupItem value="tun">TUN</ToggleGroupItem>
          <ToggleGroupItem value="app">Per-App</ToggleGroupItem>
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
          <><RefreshCw className="animate-spin" /> Connecting…</>
        ) : connected ? (
          <><WifiOff /> Disconnect</>
        ) : (
          <><Wifi /> Connect</>
        )}
      </Button>
    </div>
  );
}
