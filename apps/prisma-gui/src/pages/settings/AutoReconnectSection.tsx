import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/store/settings";

export default function AutoReconnectSection() {
  const { t } = useTranslation();
  const { autoReconnect, reconnectDelaySecs, reconnectMaxAttempts, patch } = useSettings();

  return (
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
  );
}
