import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/store/settings";

export default function PerformanceSection() {
  const { t } = useTranslation();
  const { connectionPoolEnabled, patch } = useSettings();

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.performance")}</p>
      <div className="flex items-center justify-between">
        <div>
          <Label>{t("settings.connectionPool")}</Label>
          <p className="text-xs text-muted-foreground">{t("settings.connectionPoolDesc")}</p>
        </div>
        <Switch checked={connectionPoolEnabled} onCheckedChange={(v) => patch({ connectionPoolEnabled: v })} />
      </div>
    </div>
  );
}
