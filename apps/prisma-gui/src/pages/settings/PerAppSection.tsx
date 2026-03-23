import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, RefreshCw, AppWindow } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePerApp } from "@/store/perapp";
import { api } from "@/lib/commands";
import { notify } from "@/store/notifications";

export default function PerAppSection() {
  const { t } = useTranslation();
  const perApp = usePerApp();
  const [runningApps, setRunningApps] = useState<string[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appSearch, setAppSearch] = useState("");

  async function fetchRunningApps() {
    try {
      setAppsLoading(true);
      const apps = await api.getRunningApps();
      setRunningApps(apps);
    } catch (e) {
      notify.error(String(e));
    } finally {
      setAppsLoading(false);
    }
  }

  async function handlePerAppToggle(enabled: boolean) {
    perApp.setEnabled(enabled);
    if (!enabled) {
      try {
        await api.clearPerAppFilter();
        notify.success(t("settings.perAppCleared"));
      } catch (e) {
        notify.error(String(e));
      }
    } else {
      fetchRunningApps();
    }
  }

  async function handlePerAppSave() {
    try {
      const filterJson = JSON.stringify({
        mode: perApp.mode,
        apps: perApp.apps,
      });
      await api.setPerAppFilter(filterJson);
      notify.success(t("settings.perAppSaved"));
    } catch {
      notify.error(t("settings.perAppError"));
    }
  }

  const filteredApps = appSearch
    ? runningApps.filter((a) => a.toLowerCase().includes(appSearch.toLowerCase()))
    : runningApps;

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.perApp")}</p>
      <p className="text-xs text-muted-foreground">{t("settings.perAppDesc")}</p>

      <div className="flex items-center justify-between">
        <div>
          <Label>{t("settings.perAppEnable")}</Label>
        </div>
        <Switch checked={perApp.enabled} onCheckedChange={handlePerAppToggle} />
      </div>

      {perApp.enabled && (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t("settings.perAppMode")}</Label>
            <Select value={perApp.mode} onValueChange={(v) => perApp.setMode(v as "include" | "exclude")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="include">{t("settings.perAppInclude")}</SelectItem>
                <SelectItem value="exclude">{t("settings.perAppExclude")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                <Input
                  className="pl-8"
                  placeholder={t("settings.perAppSearch")}
                  value={appSearch}
                  onChange={(e) => setAppSearch(e.target.value)}
                />
              </div>
              <Button variant="outline" size="sm" onClick={fetchRunningApps} disabled={appsLoading}>
                <RefreshCw className={appsLoading ? "animate-spin" : ""} size={14} />
                {t("settings.perAppRefresh")}
              </Button>
            </div>

            {appsLoading ? (
              <p className="text-xs text-muted-foreground py-2">{t("settings.perAppLoading")}</p>
            ) : filteredApps.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">{t("settings.perAppNoApps")}</p>
            ) : (
              <ScrollArea className="h-48 rounded-md border p-2">
                <div className="space-y-1">
                  {filteredApps.map((app) => (
                    <label
                      key={app}
                      className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input accent-primary"
                        checked={perApp.apps.includes(app)}
                        onChange={() => perApp.toggleApp(app)}
                      />
                      <AppWindow size={14} className="text-muted-foreground shrink-0" />
                      <span className="truncate">{app}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            )}

            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {t("settings.perAppSelected", { count: perApp.apps.length })}
              </p>
              <Button size="sm" onClick={handlePerAppSave}>
                {t("settings.perAppSave")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
