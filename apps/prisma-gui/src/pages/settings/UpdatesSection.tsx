import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useStore } from "@/store";
import { api } from "@/lib/commands";
import { notify } from "@/store/notifications";

export default function UpdatesSection() {
  const { t } = useTranslation();
  const updateAvailable = useStore((s) => s.updateAvailable);
  const updateProgress = useStore((s) => s.updateProgress);
  const setUpdateProgress = useStore((s) => s.setUpdateProgress);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

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

  return (
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
  );
}
