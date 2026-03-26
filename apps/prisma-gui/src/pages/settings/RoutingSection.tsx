import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSettings } from "@/store/settings";
import { api } from "@/lib/commands";
import { notify } from "@/store/notifications";

const GEO_URLS = {
  geoip: "https://github.com/v2fly/geoip/releases/latest/download/geoip.dat",
  geosite: "https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat",
} as const;

export default function RoutingSection() {
  const { t } = useTranslation();
  const { routingGeoipPath, routingGeositePath, portForwards, httpPort, patch } = useSettings();
  const [geoipDownloading, setGeoipDownloading] = useState(false);
  const [geositeDownloading, setGeositeDownloading] = useState(false);

  async function handleDownloadGeoDB(kind: "geoip" | "geosite", useProxy: boolean) {
    const setLoading = kind === "geoip" ? setGeoipDownloading : setGeositeDownloading;
    const settingsKey = kind === "geoip" ? "routingGeoipPath" : "routingGeositePath";
    setLoading(true);
    try {
      const dir = await api.getProfilesDir();
      const destPath = `${dir}/${kind}.dat`;
      const proxyPort = useProxy ? (httpPort || 8080) : 0;
      await api.downloadFile(GEO_URLS[kind], destPath, proxyPort);
      patch({ [settingsKey]: destPath });
      notify.success(t("settings.downloadFileOk", { path: destPath }));
    } catch (e) {
      notify.error(t("settings.downloadFileFailed", { error: String(e) }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Routing */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.routing")}</p>
        <p className="text-xs text-muted-foreground">{t("settings.appliedOnConnect")}</p>

        {/* GeoIP */}
        <div className="space-y-1">
          <Label htmlFor="s-geoip">{t("settings.routingGeoipPath")} <span className="text-muted-foreground text-xs">({t("wizard.optional")})</span></Label>
          <div className="flex gap-2">
            <Input id="s-geoip" value={routingGeoipPath} onChange={(e) => patch({ routingGeoipPath: e.target.value })} placeholder="/path/to/geoip.dat" className="font-mono text-xs flex-1" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={geoipDownloading} className="shrink-0">
                  {geoipDownloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleDownloadGeoDB("geoip", false)}>{t("settings.downloadDirect")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownloadGeoDB("geoip", true)}>{t("settings.downloadViaProxy")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <p className="text-xs text-muted-foreground">{t("settings.routingGeoipHint")}</p>
        </div>

        {/* Geosite */}
        <div className="space-y-1">
          <Label htmlFor="s-geosite">{t("settings.routingGeositePath")} <span className="text-muted-foreground text-xs">({t("wizard.optional")})</span></Label>
          <div className="flex gap-2">
            <Input id="s-geosite" value={routingGeositePath} onChange={(e) => patch({ routingGeositePath: e.target.value })} placeholder="/path/to/geosite.dat" className="font-mono text-xs flex-1" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={geositeDownloading} className="shrink-0">
                  {geositeDownloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleDownloadGeoDB("geosite", false)}>{t("settings.downloadDirect")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownloadGeoDB("geosite", true)}>{t("settings.downloadViaProxy")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <p className="text-xs text-muted-foreground">{t("settings.routingGeositeHint")}</p>
        </div>
      </div>

      {/* Port Forwarding */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.portForwarding")}</p>
        <p className="text-xs text-muted-foreground">{t("settings.appliedOnConnect")}</p>
        <div className="space-y-1">
          <Label>{t("settings.portForwardRules")} <span className="text-muted-foreground text-xs">({t("settings.portForwardHint")})</span></Label>
          <Textarea rows={3} className="font-mono text-xs" value={portForwards} onChange={(e) => patch({ portForwards: e.target.value })} placeholder={"ssh,127.0.0.1:22,2222\nweb,127.0.0.1:8080,8080"} />
        </div>
      </div>
    </>
  );
}
