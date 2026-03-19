import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import { useTranslation } from "react-i18next";
import {
  RefreshCw, Download, FolderOpen, Copy, Trash2, FileDown,
  FileUp, RotateCcw, Info, Shield, Search, AppWindow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useStore } from "@/store";
import { useSettings, type AppSettings } from "@/store/settings";
import { useProfileMetrics, type ProfileMetrics } from "@/store/profileMetrics";
import { useConnectionHistory } from "@/store/connectionHistory";
import { useSpeedTestHistory } from "@/store/speedTestHistory";
import { useRules } from "@/store/rules";
import { useDataUsage } from "@/store/dataUsage";
import { useNotifications, notify } from "@/store/notifications";
import { usePerApp } from "@/store/perapp";
import { api } from "@/lib/commands";
import { downloadJson, pickJsonFile } from "@/lib/utils";

const SETTINGS_KEYS: (keyof AppSettings)[] = [
  "language", "theme", "startOnBoot", "minimizeToTray",
  "socks5Port", "httpPort", "dnsMode", "dnsUpstream", "fakeIpRange",
  "autoReconnect", "reconnectDelaySecs", "reconnectMaxAttempts",
  "logLevel", "logFormat",
  "tunEnabled", "tunDevice", "tunMtu", "tunIncludeRoutes", "tunExcludeRoutes",
  "portForwards", "routingGeoipPath",
];

// ── Port input with local state, commits on blur ─────────────────────────────

function PortInput({
  id, value, onChange, hint,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  const [draft, setDraft] = useState(String(value));

  // Sync draft when the store value changes externally (e.g. reset, import)
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = useCallback(() => {
    const n = parseInt(draft, 10);
    const clamped = Number.isNaN(n) ? 0 : Math.max(0, Math.min(65535, n));
    onChange(clamped);
    setDraft(String(clamped));
  }, [draft, onChange]);

  return (
    <div className="space-y-1">
      <Input
        id={id}
        type="number"
        min={0}
        max={65535}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function Settings() {
  const { t, i18n } = useTranslation();
  const updateAvailable = useStore((s) => s.updateAvailable);
  const updateProgress = useStore((s) => s.updateProgress);
  const setUpdateProgress = useStore((s) => s.setUpdateProgress);
  const clearLogs = useStore((s) => s.clearLogs);
  const logs = useStore((s) => s.logs);
  const {
    language, theme, startOnBoot, minimizeToTray, socks5Port, httpPort,
    dnsMode, dnsUpstream, fakeIpRange,
    autoReconnect, reconnectDelaySecs, reconnectMaxAttempts,
    logLevel, logFormat,
    tunEnabled, tunDevice, tunMtu, tunIncludeRoutes, tunExcludeRoutes,
    portForwards, routingGeoipPath,
    patch,
  } = useSettings();
  const clearHistory = useConnectionHistory((s) => s.clear);
  const historyCount = useConnectionHistory((s) => s.events.length);
  const clearNotifications = useNotifications((s) => s.clearAll);

  const perApp = usePerApp();

  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [confirmClearDataOpen, setConfirmClearDataOpen] = useState(false);
  const [platformName, setPlatformName] = useState("unknown");
  const [runningApps, setRunningApps] = useState<string[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appSearch, setAppSearch] = useState("");

  useEffect(() => {
    try { setPlatformName(osPlatform()); } catch {}
  }, []);

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
      notify.error(`Autostart: ${String(e)}`);
      patch({ startOnBoot: !enabled }); // revert
    }
  }

  function handleLanguageChange(lang: "en" | "zh-CN") {
    patch({ language: lang });
    i18n.changeLanguage(lang);
  }

  function handleThemeChange(val: "system" | "light" | "dark") {
    patch({ theme: val });
  }

  async function handleCheckUpdate() {
    try {
      setCheckingUpdate(true);
      const info = await api.checkUpdate();
      if (info) {
        useStore.getState().setUpdateAvailable(info);
        notify.info(`${t("settings.updateAvailable")}: v${info.version}`);
      } else {
        notify.success(t("settings.upToDate"));
      }
    } catch (e) {
      notify.error(String(e));
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function handleApplyUpdate() {
    if (!updateAvailable) return;
    try {
      setUpdateProgress(0);
      notify.info(t("settings.downloadingUpdate"));
      await api.applyUpdate(updateAvailable.url, updateAvailable.sha ?? "");
    } catch (e) {
      notify.error(String(e));
      setUpdateProgress(null);
    }
  }

  async function handleOpenConfigFolder() {
    try {
      const dir = await api.getProfilesDir();
      await shellOpen(dir);
    } catch (e) {
      notify.error(String(e));
    }
  }

  async function handleCopySystemInfo() {
    let plat: string;
    try { plat = osPlatform(); } catch { plat = "unknown"; }
    const info = [
      `Prisma v0.7.0`,
      `Platform: ${plat}`,
      `Language: ${language}`,
      `Theme: ${theme}`,
      `SOCKS5 port: ${socks5Port || "disabled"}`,
      `HTTP port: ${httpPort ?? "disabled"}`,
      `DNS mode: ${dnsMode}`,
      `Auto-reconnect: ${autoReconnect}`,
      `Profiles: ${useStore.getState().profiles.length}`,
      `Connection history: ${historyCount} events`,
      `Logs: ${logs.length} entries`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(info);
      notify.success(t("settings.copiedSystemInfo"));
    } catch {
      notify.error("Clipboard not available");
    }
  }

  function handleExportSettings() {
    const data = {
      version: "0.7.0",
      exportedAt: new Date().toISOString(),
      settings: {
        language, theme, startOnBoot, minimizeToTray, socks5Port, httpPort,
        dnsMode, dnsUpstream, fakeIpRange,
        autoReconnect, reconnectDelaySecs, reconnectMaxAttempts,
      },
    };
    downloadJson(data, `prisma-settings-${Date.now()}.json`);
    notify.success(t("settings.settingsExported"));
  }

  async function handleImportSettings() {
    try {
      const data = await pickJsonFile() as Record<string, unknown>;
      const s = data.settings as Record<string, unknown> | undefined;
      if (!s) throw new Error("Invalid settings file");
      const imported: Partial<AppSettings> = {};
      for (const k of SETTINGS_KEYS) {
        if (k in s) (imported as Record<string, unknown>)[k] = s[k];
      }
      patch(imported);
      if (imported.language) i18n.changeLanguage(imported.language);
      notify.success(t("settings.settingsImported"));
    } catch (e) {
      if (e instanceof Error && e.message === "No file selected") return;
      notify.error(`Import failed: ${String(e)}`);
    }
  }

  function handleResetSettings() {
    patch({
      language: "en",
      theme: "system",
      startOnBoot: false,
      minimizeToTray: true,
      socks5Port: 0,
      httpPort: 8080,
      dnsMode: "direct",
      dnsUpstream: "8.8.8.8:53",
      fakeIpRange: "198.18.0.0/15",
      autoReconnect: false,
      reconnectDelaySecs: 5,
      reconnectMaxAttempts: 5,
      logLevel: "info",
      logFormat: "pretty",
      tunEnabled: false,
      tunDevice: "prisma-tun0",
      tunMtu: 1500,
      tunIncludeRoutes: "",
      tunExcludeRoutes: "",
      portForwards: "",
      routingGeoipPath: "",
    });
    i18n.changeLanguage("en");
    notify.success(t("settings.settingsReset"));
  }

  function handleClearAllData() {
    clearHistory();
    clearNotifications();
    clearLogs();
    useProfileMetrics.setState({ metrics: {} });
    useSpeedTestHistory.getState().clear();
    useDataUsage.getState().clear();
    notify.success(t("settings.allDataCleared"));
  }

  async function handleExportFullBackup() {
    try {
      // Ensure profiles are fresh from backend
      let profiles = useStore.getState().profiles;
      if (profiles.length === 0) {
        try {
          profiles = await api.listProfiles();
          useStore.getState().setProfiles(profiles);
        } catch { /* use whatever is in store */ }
      }

      const allSettings = useSettings.getState();
      const settingsData: Record<string, unknown> = {};
      for (const k of SETTINGS_KEYS) settingsData[k] = allSettings[k];

      const backup = {
        version: "0.7.0",
        exportedAt: new Date().toISOString(),
        settings: settingsData,
        profiles,
        rules: useRules.getState().rules,
        speedTestHistory: useSpeedTestHistory.getState().entries,
        connectionHistory: useConnectionHistory.getState().events,
        profileMetrics: useProfileMetrics.getState().metrics,
        dataUsage: useDataUsage.getState().daily,
      };

      downloadJson(backup, `prisma-backup-${Date.now()}.json`);
      notify.success(t("settings.backupExported"));
    } catch (e) {
      notify.error(`Export failed: ${String(e)}`);
    }
  }

  async function handleImportFullBackup() {
    let data: Record<string, unknown>;
    try {
      data = await pickJsonFile() as Record<string, unknown>;
    } catch {
      return; // user cancelled or invalid file
    }

    if (!data || typeof data !== "object") {
      notify.error("Invalid backup file");
      return;
    }

    const errors: string[] = [];

    // Restore settings
    if (data.settings && typeof data.settings === "object") {
      try {
        const s = data.settings as Record<string, unknown>;
        const imported: Partial<AppSettings> = {};
        for (const k of SETTINGS_KEYS) {
          if (k in s) (imported as Record<string, unknown>)[k] = s[k];
        }
        patch(imported);
        if (imported.language) i18n.changeLanguage(imported.language);
      } catch { errors.push("settings"); }
    }

    // Restore profiles — delete existing, then save imported
    if (Array.isArray(data.profiles) && data.profiles.length > 0) {
      try {
        // Remove existing profiles first (parallel)
        const existing = await api.listProfiles();
        await Promise.all(existing.map((p) => api.deleteProfile(p.id).catch(() => {})));
        // Save imported profiles (parallel)
        const valid = data.profiles.filter((p: unknown) => p && typeof p === "object" && (p as Record<string, unknown>).id && (p as Record<string, unknown>).name);
        await Promise.all(valid.map((p: unknown) => api.saveProfile(JSON.stringify(p)).catch(() => {})));
        const refreshed = await api.listProfiles();
        useStore.getState().setProfiles(refreshed);
        api.refreshTrayProfiles().catch(() => {});
      } catch { errors.push("profiles"); }
    }

    // Restore rules
    if (Array.isArray(data.rules)) {
      try {
        useRules.setState({ rules: data.rules.filter((r: unknown) => r && typeof r === "object" && (r as Record<string, unknown>).id) });
      } catch { errors.push("rules"); }
    }

    // Restore speed test history
    if (Array.isArray(data.speedTestHistory)) {
      try {
        useSpeedTestHistory.setState({ entries: data.speedTestHistory });
      } catch { errors.push("speedTestHistory"); }
    }

    // Restore connection history
    if (Array.isArray(data.connectionHistory)) {
      try {
        useConnectionHistory.setState({ events: data.connectionHistory });
      } catch { errors.push("connectionHistory"); }
    }

    // Restore profile metrics
    if (data.profileMetrics && typeof data.profileMetrics === "object" && !Array.isArray(data.profileMetrics)) {
      try {
        useProfileMetrics.setState({ metrics: data.profileMetrics as Record<string, ProfileMetrics> });
      } catch { errors.push("profileMetrics"); }
    }

    // Restore data usage
    if (data.dataUsage && typeof data.dataUsage === "object" && !Array.isArray(data.dataUsage)) {
      try {
        useDataUsage.setState({ daily: data.dataUsage as Record<string, { up: number; down: number }> });
      } catch { errors.push("dataUsage"); }
    }

    if (errors.length > 0) {
      notify.warning(`Backup restored with errors: ${errors.join(", ")}`);
    } else {
      notify.success("Backup restored successfully");
    }
  }

  const handleHttpPort = useCallback((v: number) => {
    patch({ httpPort: v > 0 ? v : null });
  }, [patch]);

  const handleSocks5Port = useCallback((v: number) => {
    patch({ socks5Port: v });
  }, [patch]);

  async function fetchRunningApps() {
    try {
      setAppsLoading(true);
      const apps = await api.getRunningApps();
      setRunningApps(apps);
    } catch (e) {
      notify.error(String(e));
    } finally {
      setAppsLoading(false);
    }
  }

  async function handlePerAppToggle(enabled: boolean) {
    perApp.setEnabled(enabled);
    if (!enabled) {
      try {
        await api.clearPerAppFilter();
        notify.success(t("settings.perAppCleared"));
      } catch (e) {
        notify.error(String(e));
      }
    } else {
      // Fetch apps when enabling
      fetchRunningApps();
    }
  }

  async function handlePerAppSave() {
    try {
      const filterJson = JSON.stringify({
        mode: perApp.mode,
        apps: perApp.apps,
      });
      await api.setPerAppFilter(filterJson);
      notify.success(t("settings.perAppSaved"));
    } catch (e) {
      notify.error(t("settings.perAppError"));
    }
  }

  const filteredApps = appSearch
    ? runningApps.filter((a) => a.toLowerCase().includes(appSearch.toLowerCase()))
    : runningApps;

  return (
    <>
    <ScrollArea className="h-full">
    <div className="p-4 sm:p-6 pb-12 space-y-6 max-w-2xl">
      <h1 className="font-bold text-lg">{t("settings.title")}</h1>

      {/* Appearance */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.appearance")}</p>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>{t("settings.language")}</Label>
            <Select value={language} onValueChange={(v) => handleLanguageChange(v as "en" | "zh-CN")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="zh-CN">简体中文</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("settings.theme")}</Label>
            <Select value={theme} onValueChange={(v) => handleThemeChange(v as "system" | "light" | "dark")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t("settings.themeSystem")}</SelectItem>
                <SelectItem value="light">{t("settings.themeLight")}</SelectItem>
                <SelectItem value="dark">{t("settings.themeDark")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Separator />

      {/* General */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.general")}</p>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>{t("settings.startOnBoot")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.startOnBootDesc")}</p>
            </div>
            <Switch checked={startOnBoot} onCheckedChange={handleStartOnBoot} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>{t("settings.minimizeToTray")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.minimizeToTrayDesc")}</p>
            </div>
            <Switch checked={minimizeToTray} onCheckedChange={(v) => patch({ minimizeToTray: v })} />
          </div>
        </div>
      </div>

      <Separator />

      {/* Proxy Ports */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.proxyPorts")}</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="s-http">{t("settings.httpPort")}</Label>
            <PortInput id="s-http" value={httpPort ?? 0} onChange={handleHttpPort} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s-socks5">{t("settings.socks5Port")}</Label>
            <PortInput id="s-socks5" value={socks5Port} onChange={handleSocks5Port} hint={t("settings.socks5PortHint")} />
          </div>
        </div>
      </div>

      <Separator />

      {/* DNS */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.dns")}</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>{t("settings.dnsMode")}</Label>
            <Select value={dnsMode} onValueChange={(v) => patch({ dnsMode: v as typeof dnsMode })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">{t("settings.dnsDirect")}</SelectItem>
                <SelectItem value="tunnel">{t("settings.dnsTunnel")}</SelectItem>
                <SelectItem value="fake">{t("settings.dnsFake")}</SelectItem>
                <SelectItem value="smart">{t("settings.dnsSmart")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="s-dns">{t("settings.dnsUpstream")}</Label>
            <Input
              id="s-dns"
              value={dnsUpstream}
              onChange={(e) => patch({ dnsUpstream: e.target.value })}
              placeholder="8.8.8.8:53"
            />
          </div>
          {dnsMode === "fake" && (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="s-fakeip">{t("settings.fakeIpRange")}</Label>
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

      {/* Logging */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.logging")}</p>
        <p className="text-xs text-muted-foreground">{t("settings.appliedOnConnect")}</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>{t("settings.logLevel")}</Label>
            <Select value={logLevel} onValueChange={(v) => patch({ logLevel: v as typeof logLevel })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="trace">Trace</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warn">Warn</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("settings.logFormat")}</Label>
            <Select value={logFormat} onValueChange={(v) => patch({ logFormat: v as typeof logFormat })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pretty">Pretty</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
                <SelectItem value="compact">Compact</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Separator />

      {/* TUN Mode */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.tun")}</p>
        <p className="text-xs text-muted-foreground">{t("settings.tunDesc")}</p>
        <div className="flex items-center justify-between">
          <Label>{t("settings.tunEnable")}</Label>
          <Switch checked={tunEnabled} onCheckedChange={(v) => patch({ tunEnabled: v })} />
        </div>
        {tunEnabled && (
          <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label>{t("settings.tunDevice")}</Label>
                <Input value={tunDevice} onChange={(e) => patch({ tunDevice: e.target.value })} placeholder="prisma-tun0" />
              </div>
              <div className="w-28 space-y-1">
                <Label>{t("settings.tunMtu")}</Label>
                <Input type="number" value={tunMtu} onChange={(e) => patch({ tunMtu: parseInt(e.target.value, 10) || 1500 })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t("settings.tunIncludeRoutes")} <span className="text-muted-foreground text-xs">({t("settings.tunRouteHint")})</span></Label>
              <Textarea rows={3} className="font-mono text-xs" value={tunIncludeRoutes} onChange={(e) => patch({ tunIncludeRoutes: e.target.value })} placeholder="0.0.0.0/0" />
            </div>
            <div className="space-y-1">
              <Label>{t("settings.tunExcludeRoutes")} <span className="text-muted-foreground text-xs">({t("settings.tunRouteHint")})</span></Label>
              <Textarea rows={2} className="font-mono text-xs" value={tunExcludeRoutes} onChange={(e) => patch({ tunExcludeRoutes: e.target.value })} placeholder="192.168.0.0/16" />
            </div>
          </div>
        )}
      </div>

      <Separator />

      {/* Routing */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.routing")}</p>
        <p className="text-xs text-muted-foreground">{t("settings.appliedOnConnect")}</p>
        <div className="space-y-1">
          <Label htmlFor="s-geoip">{t("settings.routingGeoipPath")} <span className="text-muted-foreground text-xs">({t("wizard.optional")})</span></Label>
          <Input id="s-geoip" value={routingGeoipPath} onChange={(e) => patch({ routingGeoipPath: e.target.value })} placeholder="/path/to/geoip.dat" className="font-mono text-xs" />
          <p className="text-xs text-muted-foreground">{t("settings.routingGeoipHint")}</p>
        </div>
      </div>

      <Separator />

      {/* Port Forwarding */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.portForwarding")}</p>
        <p className="text-xs text-muted-foreground">{t("settings.appliedOnConnect")}</p>
        <div className="space-y-1">
          <Label>{t("settings.portForwardRules")} <span className="text-muted-foreground text-xs">({t("settings.portForwardHint")})</span></Label>
          <Textarea rows={3} className="font-mono text-xs" value={portForwards} onChange={(e) => patch({ portForwards: e.target.value })} placeholder={"ssh,127.0.0.1:22,2222\nweb,127.0.0.1:8080,8080"} />
        </div>
      </div>

      <Separator />

      {/* Per-App Proxy */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.perApp")}</p>
        <p className="text-xs text-muted-foreground">{t("settings.perAppDesc")}</p>

        <div className="flex items-center justify-between">
          <div>
            <Label>{t("settings.perAppEnable")}</Label>
          </div>
          <Switch checked={perApp.enabled} onCheckedChange={handlePerAppToggle} />
        </div>

        {perApp.enabled && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("settings.perAppMode")}</Label>
              <Select value={perApp.mode} onValueChange={(v) => perApp.setMode(v as "include" | "exclude")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="include">{t("settings.perAppInclude")}</SelectItem>
                  <SelectItem value="exclude">{t("settings.perAppExclude")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                  <Input
                    className="pl-8"
                    placeholder={t("settings.perAppSearch")}
                    value={appSearch}
                    onChange={(e) => setAppSearch(e.target.value)}
                  />
                </div>
                <Button variant="outline" size="sm" onClick={fetchRunningApps} disabled={appsLoading}>
                  <RefreshCw className={appsLoading ? "animate-spin" : ""} size={14} />
                  {t("settings.perAppRefresh")}
                </Button>
              </div>

              {appsLoading ? (
                <p className="text-xs text-muted-foreground py-2">{t("settings.perAppLoading")}</p>
              ) : filteredApps.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">{t("settings.perAppNoApps")}</p>
              ) : (
                <ScrollArea className="h-48 rounded-md border p-2">
                  <div className="space-y-1">
                    {filteredApps.map((app) => (
                      <label
                        key={app}
                        className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input accent-primary"
                          checked={perApp.apps.includes(app)}
                          onChange={() => perApp.toggleApp(app)}
                        />
                        <AppWindow size={14} className="text-muted-foreground shrink-0" />
                        <span className="truncate">{app}</span>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              )}

              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {t("settings.perAppSelected", { count: perApp.apps.length })}
                </p>
                <Button size="sm" onClick={handlePerAppSave}>
                  {t("settings.perAppSave")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <Separator />

      {/* Auto-reconnect */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.autoReconnect")}</p>
        <div className="flex items-center justify-between">
          <div>
            <Label>{t("settings.autoReconnectLabel")}</Label>
            <p className="text-xs text-muted-foreground">{t("settings.autoReconnectDesc")}</p>
          </div>
          <Switch checked={autoReconnect} onCheckedChange={(v) => patch({ autoReconnect: v })} />
        </div>
        {autoReconnect && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="s-delay">{t("settings.retryDelay")}</Label>
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
              <Label htmlFor="s-maxatt">{t("settings.maxAttempts")}</Label>
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

      {/* Data Management */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.dataManagement")}</p>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleOpenConfigFolder}>
            <FolderOpen size={14} /> {t("settings.openConfigFolder")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopySystemInfo}>
            <Copy size={14} /> {t("settings.copySystemInfo")}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleExportSettings}>
            <FileDown size={14} /> {t("settings.exportSettings")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleImportSettings}>
            <FileUp size={14} /> {t("settings.importSettings")}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleExportFullBackup}>
            <Download size={14} /> {t("settings.exportFullBackup")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleImportFullBackup}>
            <FileUp size={14} /> {t("settings.importFullBackup")}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setConfirmClearDataOpen(true)}>
            <Trash2 size={14} /> {t("settings.clearAllData")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirmResetOpen(true)}>
            <RotateCcw size={14} /> {t("settings.resetSettings")}
          </Button>
        </div>

        <div className="text-xs text-muted-foreground space-y-0.5">
          <p>{t("settings.historyEvents", { count: historyCount })}</p>
          <p>{t("settings.logEntries", { count: logs.length })}</p>
        </div>
      </div>

      <Separator />

      {/* Updates */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.updates")}</p>

        {updateAvailable && (
          <div className="rounded-lg border border-green-600/30 bg-green-600/10 p-3 text-sm">
            <p className="font-medium">v{updateAvailable.version} {t("settings.available")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t("settings.newVersionReady")}</p>
            {updateAvailable.changelog && (
              <p className="text-xs text-muted-foreground mt-1">{updateAvailable.changelog}</p>
            )}
          </div>
        )}

        {updateProgress !== null && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("settings.downloading")}</p>
            <Progress value={updateProgress} />
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={checkingUpdate} onClick={handleCheckUpdate}>
            <RefreshCw className={checkingUpdate ? "animate-spin" : ""} />
            {t("settings.checkUpdates")}
          </Button>
          {updateAvailable && updateProgress === null && (
            <Button size="sm" onClick={handleApplyUpdate}>
              <Download /> {t("settings.install")}
            </Button>
          )}
        </div>
      </div>

      <Separator />

      {/* About */}
      <div className="space-y-2 text-sm text-muted-foreground">
        <p className="text-xs font-semibold uppercase tracking-wider">{t("settings.about")}</p>
        <div className="flex items-center gap-2">
          <Shield size={14} />
          <span>Prisma v0.7.0</span>
        </div>
        <p>{t("settings.platform")}: {platformName}</p>
        <p>License: GPLv3.0</p>
        <div className="flex items-center gap-1 text-xs">
          <Info size={12} />
          <span>{t("settings.settingsStoredLocally")}</span>
        </div>
      </div>

    </div>
    </ScrollArea>

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={confirmResetOpen}
        onOpenChange={setConfirmResetOpen}
        title={t("settings.resetSettings")}
        message={t("settings.resetSettingsConfirm")}
        confirmLabel={t("settings.resetSettings")}
        onConfirm={handleResetSettings}
      />
      <ConfirmDialog
        open={confirmClearDataOpen}
        onOpenChange={setConfirmClearDataOpen}
        title={t("settings.clearAllData")}
        message={t("settings.clearAllDataConfirm")}
        confirmLabel={t("settings.clearAllData")}
        onConfirm={handleClearAllData}
      />
    </>
  );
}
