import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Download } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore } from "@/store";
import { useSettings } from "@/store/settings";
import { api } from "@/lib/commands";
import { notify } from "@/store/notifications";

type UpdateDownloadMode = "auto" | "direct" | "proxy";

/** Replace `**text**` with <strong>text</strong> */
function renderInlineBold(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part,
  );
}

export default function UpdatesSection() {
  const { t } = useTranslation();
  const updateAvailable = useStore((s) => s.updateAvailable);
  const updateProgress = useStore((s) => s.updateProgress);
  const updatePhase = useStore((s) => s.updatePhase);
  const setUpdateProgress = useStore((s) => s.setUpdateProgress);
  const setUpdatePhase = useStore((s) => s.setUpdatePhase);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloadMode, setDownloadMode] = useState<UpdateDownloadMode>("auto");

  function resolveProxyPort(): number {
    const isConnected = useStore.getState().connected;
    const httpPort = useSettings.getState().httpPort || 0;
    switch (downloadMode) {
      case "proxy":
        return httpPort;
      case "direct":
        return 0;
      default: // auto
        return isConnected ? httpPort : 0;
    }
  }

  // Listen for update-progress events from the Tauri backend
  useEffect(() => {
    const unlisten = listen<{ phase: string }>("update-progress", (event) => {
      const phase = event.payload.phase;
      if (phase === "downloading" || phase === "installing" || phase === "done") {
        setUpdatePhase(phase);
      }
      if (phase === "done") {
        setUpdateProgress(null);
        notify.success(t("settings.updateInstalled"));
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setUpdatePhase, setUpdateProgress, t]);

  async function handleCheckUpdate() {
    try {
      setCheckingUpdate(true);
      const info = await api.checkUpdate(resolveProxyPort());
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
      setUpdatePhase("downloading");
      await api.applyUpdate(updateAvailable.url, updateAvailable.sha ?? "", resolveProxyPort());
    } catch (e) {
      notify.error(String(e));
      setUpdateProgress(null);
      setUpdatePhase(null);
    }
  }

  const phaseLabel =
    updatePhase === "downloading"
      ? t("settings.downloadingUpdate")
      : updatePhase === "installing"
        ? t("settings.installingUpdate")
        : updatePhase === "done"
          ? t("settings.updateInstalled")
          : null;

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.updates")}</p>

      {updateAvailable && (
        <div className="rounded-lg border border-green-600/30 bg-green-600/10 p-3 text-sm">
          <p className="font-medium">v{updateAvailable.version} {t("settings.available")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t("settings.newVersionReady")}</p>
          {updateAvailable.changelog && (
            <div className="text-xs text-muted-foreground mt-2 space-y-1 max-h-48 overflow-y-auto rounded border border-border/50 p-2">
              {updateAvailable.changelog.split("\n").map((line, i) => {
                if (line.startsWith("## "))
                  return <h4 key={i} className="font-semibold text-foreground mt-2">{renderInlineBold(line.slice(3))}</h4>;
                if (line.startsWith("### "))
                  return <h5 key={i} className="font-medium text-foreground mt-1">{renderInlineBold(line.slice(4))}</h5>;
                if (line.startsWith("- "))
                  return <li key={i} className="ml-4 list-disc">{renderInlineBold(line.slice(2))}</li>;
                if (line.trim() === "") return null;
                return <p key={i}>{renderInlineBold(line)}</p>;
              })}
            </div>
          )}
        </div>
      )}

      {phaseLabel && updatePhase !== "done" && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{phaseLabel}</p>
          {updateProgress !== null && <Progress value={updateProgress} />}
        </div>
      )}

      {updatePhase === "done" && (
        <div className="rounded-lg border border-blue-600/30 bg-blue-600/10 p-3 text-sm">
          <p className="font-medium">{t("settings.updateInstalled")}</p>
        </div>
      )}

      <div className="flex gap-2 items-center">
        <Button variant="outline" size="sm" disabled={checkingUpdate} onClick={handleCheckUpdate}>
          <RefreshCw className={checkingUpdate ? "animate-spin" : ""} />
          {t("settings.checkUpdates")}
        </Button>
        {updateAvailable && updateProgress === null && updatePhase !== "done" && (
          <Button size="sm" onClick={handleApplyUpdate}>
            <Download /> {t("settings.install")}
          </Button>
        )}
        <Select value={downloadMode} onValueChange={(v) => setDownloadMode(v as UpdateDownloadMode)}>
          <SelectTrigger className="w-[80px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t("rules.downloadAuto")}</SelectItem>
            <SelectItem value="direct">{t("rules.downloadDirect")}</SelectItem>
            <SelectItem value="proxy">{t("rules.downloadProxy")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
