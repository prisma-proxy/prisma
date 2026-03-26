import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useSettings } from "@/store/settings";

export default function TunSection() {
  const { t } = useTranslation();
  const { tunEnabled, tunDevice, tunMtu, tunIncludeRoutes, tunExcludeRoutes, patch } = useSettings();

  return (
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
  );
}
