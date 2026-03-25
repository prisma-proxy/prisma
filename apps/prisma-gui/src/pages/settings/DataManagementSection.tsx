import { useState } from "react";
import { useTranslation } from "react-i18next";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import { FolderOpen, Copy, Trash2, FileDown, FileUp, RotateCcw, Download, FileOutput, FileInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useStore } from "@/store";
import { useSettings } from "@/store/settings";
import { useConnectionHistory } from "@/store/connectionHistory";
import { useNotifications, notify } from "@/store/notifications";
import { api } from "@/lib/commands";
import {
  exportSettings, importSettings, resetSettings,
  clearAllData, exportFullBackup, importFullBackup,
  exportConsoleConfig, importConsoleConfig,
} from "@/lib/backup";

export default function DataManagementSection() {
  const { t, i18n } = useTranslation();
  const { language, theme, socks5Port, httpPort, dnsMode, autoReconnect, patch } = useSettings();
  const clearHistory = useConnectionHistory((s) => s.clear);
  const historyCount = useConnectionHistory((s) => s.events.length);
  const clearNotifications = useNotifications((s) => s.clearAll);
  const clearLogs = useStore((s) => s.clearLogs);
  const logs = useStore((s) => s.logs);

  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [confirmClearDataOpen, setConfirmClearDataOpen] = useState(false);

  async function handleOpenConfigFolder() {
    try {
      const dir = await api.getProfilesDir();
      await api.openFolder(dir);
    } catch (e) {
      notify.error(String(e));
    }
  }

  async function handleCopySystemInfo() {
    let plat: string;
    try { plat = osPlatform(); } catch { plat = "unknown"; }
    const info = [
      `Prisma v${__APP_VERSION__}`,
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
      await writeText(info);
      notify.success(t("settings.copiedSystemInfo"));
    } catch {
      notify.error(t("notifications.error"));
    }
  }

  const changeLanguage = (lang: string) => i18n.changeLanguage(lang);

  return (
    <>
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
          <Button variant="outline" size="sm" onClick={() => exportSettings(t).catch((e) => notify.error(String(e)))}>
            <FileDown size={14} /> {t("settings.exportSettings")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => importSettings(t, patch, changeLanguage).catch((e) => {
            if (e instanceof Error && e.message === "No file selected") return;
            notify.error(`Import failed: ${String(e)}`);
          })}>
            <FileUp size={14} /> {t("settings.importSettings")}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => exportFullBackup(t).catch((e) => notify.error(`Export failed: ${String(e)}`))}>
            <Download size={14} /> {t("settings.exportFullBackup")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => importFullBackup(t, patch, changeLanguage)}>
            <FileUp size={14} /> {t("settings.importFullBackup")}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => exportConsoleConfig(t).catch((e) => notify.error(`Export failed: ${String(e)}`))}>
            <FileOutput size={14} /> {t("settings.exportConfig")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => importConsoleConfig(t, patch, changeLanguage)}>
            <FileInput size={14} /> {t("settings.importConfig")}
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

      <ConfirmDialog
        open={confirmResetOpen}
        onOpenChange={setConfirmResetOpen}
        title={t("settings.resetSettings")}
        message={t("settings.resetSettingsConfirm")}
        confirmLabel={t("settings.resetSettings")}
        onConfirm={() => resetSettings(patch, changeLanguage, t)}
      />
      <ConfirmDialog
        open={confirmClearDataOpen}
        onOpenChange={setConfirmClearDataOpen}
        title={t("settings.clearAllData")}
        message={t("settings.clearAllDataConfirm")}
        confirmLabel={t("settings.clearAllData")}
        onConfirm={() => clearAllData(t, clearHistory, clearNotifications, clearLogs)}
      />
    </>
  );
}
