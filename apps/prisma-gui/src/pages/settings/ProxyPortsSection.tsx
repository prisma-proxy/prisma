import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import PortInput from "@/components/PortInput";
import { useSettings } from "@/store/settings";

export default function ProxyPortsSection() {
  const { t } = useTranslation();
  const { httpPort, socks5Port, allowLan, patch } = useSettings();

  const handleHttpPort = useCallback((v: number) => {
    patch({ httpPort: v > 0 ? v : null });
  }, [patch]);

  const handleSocks5Port = useCallback((v: number) => {
    patch({ socks5Port: v });
  }, [patch]);

  return (
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
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label>{t("settings.allowLan")}</Label>
          <p className="text-xs text-muted-foreground">{t("settings.allowLanDesc")}</p>
        </div>
        <Switch checked={allowLan} onCheckedChange={(v) => patch({ allowLan: v })} />
      </div>
    </div>
  );
}
