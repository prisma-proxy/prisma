import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { appLocalDataDir } from "@tauri-apps/api/path";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import { useTranslation } from "react-i18next";
import {
  RefreshCw, Download, FolderOpen, Copy, Trash2, FileDown,
  FileUp, RotateCcw, Info, Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useStore } from "@/store";
import { useSettings, type AppSettings } from "@/store/settings";
import { useProfileMetrics } from "@/store/profileMetrics";
import { useConnectionHistory } from "@/store/connectionHistory";
import { useNotifications, notify } from "@/store/notifications";
import { api } from "@/lib/commands";

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
    autoReconnect, reconnectDelaySecs, reconnectMaxAttempts, patch,
  } = useSettings();
  const clearHistory = useConnectionHistory((s) => s.clear);
  const historyCount = useConnectionHistory((s) => s.events.length);
  const clearNotifications = useNotifications((s) => s.clearAll);

  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [confirmClearDataOpen, setConfirmClearDataOpen] = useState(false);
  const [platformName, setPlatformName] = useState("unknown");

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
    } catch (e) {
      notify.error(String(e));
      setUpdateProgress(null);
    }
  }

  async function handleOpenConfigFolder() {
    try {
      const dir = await appLocalDataDir();
      await shellOpen(dir);
    } catch (e) {
      notify.error(String(e));
    }
  }

  async function handleCopySystemInfo() {
    let plat: string;
    try { plat = osPlatform(); } catch { plat = "unknown"; }
    const info = [
      `Prisma v0.6.2`,
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
      version: "0.6.2",
      exportedAt: new Date().toISOString(),
      settings: {
        language, theme, startOnBoot, minimizeToTray, socks5Port, httpPort,
        dnsMode, dnsUpstream, fakeIpRange,
        autoReconnect, reconnectDelaySecs, reconnectMaxAttempts,
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prisma-settings-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify.success(t("settings.settingsExported"));
  }

  function handleImportSettings() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const s = data.settings;
        if (!s) throw new Error("Invalid settings file");
        const validKeys: (keyof AppSettings)[] = [
          "language", "theme", "startOnBoot", "minimizeToTray",
          "socks5Port", "httpPort", "dnsMode", "dnsUpstream", "fakeIpRange",
          "autoReconnect", "reconnectDelaySecs", "reconnectMaxAttempts",
        ];
        const imported: Partial<AppSettings> = {};
        for (const k of validKeys) {
          if (k in s) (imported as Record<string, unknown>)[k] = s[k];
        }
        patch(imported);
        if (imported.language) i18n.changeLanguage(imported.language);
        notify.success(t("settings.settingsImported"));
      } catch (e) {
        notify.error(`Import failed: ${String(e)}`);
      }
    };
    input.click();
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
    });
    i18n.changeLanguage("en");
    notify.success(t("settings.settingsReset"));
  }

  function handleClearAllData() {
    clearHistory();
    clearNotifications();
    clearLogs();
    // Clear profile metrics
    useProfileMetrics.setState({ metrics: {} });
    notify.success(t("settings.allDataCleared"));
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-2xl">
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
          <div className="space-y-1">
            <Label htmlFor="s-socks5">{t("settings.socks5Port")}</Label>
            <Input
              id="s-socks5"
              type="number"
              min={0}
              max={65535}
              value={socks5Port}
              onChange={(e) => patch({ socks5Port: parseInt(e.target.value, 10) || 0 })}
            />
            <p className="text-xs text-muted-foreground">{t("settings.socks5PortHint")}</p>
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
            <p className="font-medium">v{updateAvailable} {t("settings.available")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t("settings.newVersionReady")}</p>
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
          <span>Prisma v0.6.2</span>
        </div>
        <p>{t("settings.platform")}: {platformName}</p>
        <p>License: GPLv3.0</p>
        <div className="flex items-center gap-1 text-xs">
          <Info size={12} />
          <span>{t("settings.settingsStoredLocally")}</span>
        </div>
      </div>

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
    </div>
  );
}
