import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Wifi, Signal, Battery, ShieldCheck, Router, Shield } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useBattery } from "@/hooks/useBattery";
import { useSettings } from "@/store/settings";
import { api } from "@/lib/commands";
import { notify } from "@/store/notifications";

export default function MobileSection() {
  const { t } = useTranslation();
  const { label: networkLabel } = useNetworkStatus();
  const battery = useBattery();
  const { connectionMode, patch } = useSettings();
  const [vpnPermission, setVpnPermission] = useState<boolean | null>(null);

  const [rustBatteryLevel, setRustBatteryLevel] = useState(-1);
  const [rustBatteryCharging, setRustBatteryCharging] = useState(false);

  useEffect(() => {
    if (connectionMode === "vpn") {
      api.checkVpnPermission().then(setVpnPermission).catch(() => {});
    }
  }, [connectionMode]);

  useEffect(() => {
    if (battery.level < 0 && rustBatteryLevel < 0) {
      api.getBatteryStatus().then((s) => {
        setRustBatteryLevel(s.level);
        setRustBatteryCharging(s.charging);
      }).catch(() => {});
    }
  }, [battery.level, rustBatteryLevel]);

  const batteryLevel = battery.level >= 0 ? battery.level : rustBatteryLevel;
  const batteryCharging = battery.level >= 0 ? battery.charging : rustBatteryCharging;

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.mobile")}</p>

      {/* Network status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {networkLabel === "wifi" ? <Wifi size={14} /> : <Signal size={14} />}
          <div>
            <Label>{t("settings.networkType")}</Label>
            <p className="text-xs text-muted-foreground">{t(`settings.net_${networkLabel}`)}</p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground capitalize">{networkLabel}</span>
      </div>

      {/* Battery */}
      {batteryLevel >= 0 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Battery size={14} />
            <div>
              <Label>{t("settings.battery")}</Label>
              <p className="text-xs text-muted-foreground">
                {batteryCharging ? t("settings.batteryCharging") : t("settings.batteryOnBattery")}
              </p>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">{batteryLevel}%</span>
        </div>
      )}

      {/* Connection mode toggle */}
      <div className="space-y-2">
        <div>
          <Label>{t("settings.connectionMode")}</Label>
          <p className="text-xs text-muted-foreground">{t("settings.connectionModeDesc")}</p>
        </div>
        <ToggleGroup
          type="single"
          value={connectionMode}
          onValueChange={(v) => v && patch({ connectionMode: v as "proxy" | "vpn" })}
          className="justify-start"
          size="sm"
          variant="outline"
        >
          <ToggleGroupItem value="proxy" className="gap-1.5">
            <Router size={13} />
            {t("settings.modeProxy")}
          </ToggleGroupItem>
          <ToggleGroupItem value="vpn" className="gap-1.5">
            <Shield size={13} />
            {t("settings.modeVpn")}
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          {connectionMode === "proxy" ? t("settings.modeProxyDesc") : t("settings.modeVpnDesc")}
        </p>
      </div>

      {/* VPN permission — only shown in VPN mode */}
      {connectionMode === "vpn" && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} />
            <div>
              <Label>{t("settings.vpnPermission")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.vpnPermissionDesc")}</p>
            </div>
          </div>
          {vpnPermission === true ? (
            <span className="text-xs text-green-500">{t("settings.vpnGranted")}</span>
          ) : vpnPermission === false ? (
            <Button variant="outline" size="sm" onClick={async () => {
              try {
                const ok = await api.requestVpnPermission();
                setVpnPermission(ok);
              } catch (e) { notify.error(String(e)); }
            }}>
              {t("settings.vpnRequest")}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">{t("common.loading")}</span>
          )}
        </div>
      )}
    </div>
  );
}
