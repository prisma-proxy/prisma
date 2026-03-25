import { useEffect, useState } from "react";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import { useTranslation } from "react-i18next";
import { Shield, Info } from "lucide-react";

export default function AboutSection() {
  const { t } = useTranslation();
  const [platformName, setPlatformName] = useState("unknown");

  useEffect(() => {
    try { setPlatformName(osPlatform()); } catch {}
  }, []);

  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p className="text-xs font-semibold uppercase tracking-wider">{t("settings.about")}</p>
      <div className="flex items-center gap-2">
        <Shield size={14} />
        <span>Prisma v{__APP_VERSION__}</span>
      </div>
      <p>{t("settings.platform")}: {platformName}</p>
      <p>License: GPLv3.0</p>
      <div className="flex items-center gap-1 text-xs">
        <Info size={12} />
        <span>{t("settings.settingsStoredLocally")}</span>
      </div>
    </div>
  );
}
