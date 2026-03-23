import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Wifi, Signal, Battery, ShieldCheck } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useBattery } from "@/hooks/useBattery";
import { api } from "@/lib/commands";
import { notify } from "@/store/notifications";

export default function MobileSection() {
  const { t } = useTranslation();
  const { label: networkLabel } = useNetworkStatus();
  const battery = useBattery();
  const [vpnPermission, setVpnPermission] = useState<boolean | null>(null);

  // Also try Rust fallback for battery if Web API unavailable
  const [rustBatteryLevel, setRustBatteryLevel] = useState(-1);
  const [rustBatteryCharging, setRustBatteryCharging] = useState(false);

  useEffect(() => {
    api.checkVpnPermission().then(setVpnPermission).catch(() => {});
    // Fallback: get battery from Rust if Web API didn't work
    if (battery.level < 0) {
      api.getBatteryStatus().then((s) => {
        setRustBatteryLevel(s.level);
        setRustBatteryCharging(s.charging);
      }).catch(() => {});
    }
  }, [battery.level]);

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

      {/* VPN permission */}
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
    </div>
  );
}
