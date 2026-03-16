import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { RefreshCw, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useStore } from "@/store";
import { useSettings } from "@/store/settings";
import { api } from "@/lib/commands";

export default function Settings() {
  const updateAvailable = useStore((s) => s.updateAvailable);
  const updateProgress = useStore((s) => s.updateProgress);
  const setUpdateProgress = useStore((s) => s.setUpdateProgress);
  const { startOnBoot, minimizeToTray, socks5Port, httpPort,
          dnsMode, dnsUpstream, fakeIpRange,
          autoReconnect, reconnectDelaySecs, reconnectMaxAttempts, patch } = useSettings();
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // Sync startOnBoot with autostart plugin on mount
  useEffect(() => {
    invoke<boolean>("plugin:autostart|is_enabled")
      .then((enabled) => patch({ startOnBoot: enabled }))
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleStartOnBoot(enabled: boolean) {
    patch({ startOnBoot: enabled });
    try {
      await invoke(enabled ? "plugin:autostart|enable" : "plugin:autostart|disable");
    } catch (e) {
      toast.error(`Autostart: ${String(e)}`);
      patch({ startOnBoot: !enabled }); // revert
    }
  }

  async function handleCheckUpdate() {
    try {
      setCheckingUpdate(true);
      const info = await api.checkUpdate();
      if (info) {
        toast.info(`Update available: v${info.version}`);
      } else {
        toast.success("You're up to date!");
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function handleApplyUpdate() {
    if (!updateAvailable) return;
    try {
      setUpdateProgress(0);
      toast.info("Downloading update…");
    } catch (e) {
      toast.error(String(e));
      setUpdateProgress(null);
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-2xl">
      <h1 className="font-bold text-lg">Settings</h1>

      {/* General */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">General</p>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Start with Windows</Label>
              <p className="text-xs text-muted-foreground">Launch Prisma on startup</p>
            </div>
            <Switch checked={startOnBoot} onCheckedChange={handleStartOnBoot} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Minimize to tray</Label>
              <p className="text-xs text-muted-foreground">Keep running in the system tray</p>
            </div>
            <Switch checked={minimizeToTray} onCheckedChange={(v) => patch({ minimizeToTray: v })} />
          </div>
        </div>
      </div>

      <Separator />

      {/* Proxy Ports */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Proxy Ports</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="s-socks5">SOCKS5 port</Label>
            <Input
              id="s-socks5"
              type="number"
              min={1}
              max={65535}
              value={socks5Port}
              onChange={(e) => patch({ socks5Port: parseInt(e.target.value, 10) || 1080 })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s-http">HTTP port <span className="text-muted-foreground text-xs">(0 = disabled)</span></Label>
            <Input
              id="s-http"
              type="number"
              min={0}
              max={65535}
              value={httpPort ?? 0}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                patch({ httpPort: v > 0 ? v : null });
              }}
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* DNS */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">DNS</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>DNS mode</Label>
            <Select value={dnsMode} onValueChange={(v) => patch({ dnsMode: v as typeof dnsMode })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">Direct (system DNS)</SelectItem>
                <SelectItem value="tunnel">Tunnel (forward via proxy)</SelectItem>
                <SelectItem value="fake">Fake-IP</SelectItem>
                <SelectItem value="smart">Smart (geo-split)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="s-dns">Upstream DNS</Label>
            <Input
              id="s-dns"
              value={dnsUpstream}
              onChange={(e) => patch({ dnsUpstream: e.target.value })}
              placeholder="8.8.8.8:53"
            />
          </div>
          {dnsMode === "fake" && (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="s-fakeip">Fake-IP range</Label>
              <Input
                id="s-fakeip"
                value={fakeIpRange}
                onChange={(e) => patch({ fakeIpRange: e.target.value })}
                placeholder="198.18.0.0/15"
              />
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* Auto-reconnect */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Auto-reconnect</p>
        <div className="flex items-center justify-between">
          <div>
            <Label>Auto-reconnect on disconnect</Label>
            <p className="text-xs text-muted-foreground">Automatically reconnect when connection drops</p>
          </div>
          <Switch checked={autoReconnect} onCheckedChange={(v) => patch({ autoReconnect: v })} />
        </div>
        {autoReconnect && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="s-delay">Retry delay (seconds)</Label>
              <Input
                id="s-delay"
                type="number"
                min={1}
                max={300}
                value={reconnectDelaySecs}
                onChange={(e) => patch({ reconnectDelaySecs: parseInt(e.target.value, 10) || 5 })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="s-maxatt">Max attempts <span className="text-muted-foreground text-xs">(0 = unlimited)</span></Label>
              <Input
                id="s-maxatt"
                type="number"
                min={0}
                value={reconnectMaxAttempts}
                onChange={(e) => patch({ reconnectMaxAttempts: parseInt(e.target.value, 10) })}
              />
            </div>
          </div>
        )}
      </div>

      <Separator />

      {/* Updates */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Updates</p>

        {updateAvailable && (
          <div className="rounded-lg border border-green-600/30 bg-green-600/10 p-3 text-sm">
            <p className="font-medium">v{updateAvailable} available</p>
            <p className="text-xs text-muted-foreground mt-0.5">A new version of Prisma is ready to install.</p>
          </div>
        )}

        {updateProgress !== null && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Downloading…</p>
            <Progress value={updateProgress} />
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={checkingUpdate} onClick={handleCheckUpdate}>
            <RefreshCw className={checkingUpdate ? "animate-spin" : ""} />
            Check for Updates
          </Button>
          {updateAvailable && updateProgress === null && (
            <Button size="sm" onClick={handleApplyUpdate}>
              <Download /> Install
            </Button>
          )}
        </div>
      </div>

      <Separator />

      {/* About */}
      <div className="space-y-1 text-sm text-muted-foreground">
        <p className="text-xs font-semibold uppercase tracking-wider">About</p>
        <p>Prisma v0.6.2</p>
        <p>License: GPLv3.0</p>
      </div>
    </div>
  );
}
