import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/store/settings";
import { notify } from "@/store/notifications";

export default function GeneralSection() {
  const { t } = useTranslation();
  const { startOnBoot, minimizeToTray, patch } = useSettings();

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

  return (
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
  );
}
