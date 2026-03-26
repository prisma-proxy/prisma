import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Search, RefreshCw, AppWindow, Shield, ShieldAlert, Plus, Trash2,
  Check, Globe, MessageSquare, Code, Gamepad2, Music,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { usePerApp } from "@/store/perapp";
import type { PerAppPreset } from "@/store/perapp";
import { api } from "@/lib/commands";
import { notify } from "@/store/notifications";

// ── Auto-detect categories ────────────────────────────────────────────────────

interface AppCategory {
  key: string;
  icon: typeof Globe;
  apps: string[];
}

const APP_CATEGORIES: AppCategory[] = [
  {
    key: "browsers",
    icon: Globe,
    apps: ["chrome", "firefox", "edge", "safari", "brave", "opera", "vivaldi", "chromium", "arc"],
  },
  {
    key: "messaging",
    icon: MessageSquare,
    apps: ["telegram", "discord", "whatsapp", "signal", "slack", "teams", "wechat", "line", "skype"],
  },
  {
    key: "devTools",
    icon: Code,
    apps: ["code", "terminal", "iterm", "iterm2", "ssh", "git", "docker", "node", "python", "cursor", "windsurf", "warp"],
  },
  {
    key: "gaming",
    icon: Gamepad2,
    apps: ["steam", "epic", "origin", "battle.net", "gog"],
  },
  {
    key: "streaming",
    icon: Music,
    apps: ["spotify", "vlc", "mpv", "iina"],
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

interface AppsListProps {
  loading: boolean;
  filteredApps: string[];
  hasRunningApps: boolean;
  selectedApps: string[];
  onToggle: (app: string) => void;
  t: (key: string) => string;
}

function AppsList({ loading, filteredApps, hasRunningApps, selectedApps, onToggle, t }: AppsListProps) {
  if (loading) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        {t("perApp.loading")}
      </p>
    );
  }

  if (filteredApps.length === 0 && !hasRunningApps) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        {t("perApp.noApps")}
      </p>
    );
  }

  if (filteredApps.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        {t("perApp.noMatch")}
      </p>
    );
  }

  const selectedSet = new Set(selectedApps);

  return (
    <ScrollArea className="h-64 rounded-md border">
      <div className="p-2 space-y-0.5">
        {filteredApps.map((app) => (
          <label
            key={app}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted cursor-pointer"
          >
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input accent-primary"
              checked={selectedSet.has(app)}
              onChange={() => onToggle(app)}
            />
            <AppWindow size={14} className="text-muted-foreground shrink-0" />
            <span className="truncate">{app}</span>
          </label>
        ))}
      </div>
    </ScrollArea>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PerApp() {
  const { t } = useTranslation();
  const perApp = usePerApp();

  const [runningApps, setRunningApps] = useState<string[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appSearch, setAppSearch] = useState("");
  const [isElevated, setIsElevated] = useState<boolean | null>(null);
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");

  // ── Fetch running apps ────────────────────────────────────────────────────

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

  // ── Check elevation status ────────────────────────────────────────────────

  async function checkElevationStatus() {
    try {
      const elevated = await api.checkElevation();
      setIsElevated(elevated);
    } catch {
      setIsElevated(false);
    }
  }

  // ── Toggle enable/disable ─────────────────────────────────────────────────

  async function handleToggle(enabled: boolean) {
    perApp.setEnabled(enabled);
    if (!enabled) {
      try {
        await api.clearPerAppFilter();
        notify.success(t("perApp.cleared"));
      } catch (e) {
        notify.error(String(e));
      }
    } else {
      fetchRunningApps();
      checkElevationStatus();
    }
  }

  // ── Apply filter ──────────────────────────────────────────────────────────

  async function handleApply() {
    try {
      const filterJson = JSON.stringify({
        mode: perApp.mode,
        apps: perApp.apps,
      });
      await api.setPerAppFilter(filterJson);
      notify.success(t("perApp.applied"));
    } catch {
      notify.error(t("perApp.applyError"));
    }
  }

  // ── Presets ───────────────────────────────────────────────────────────────

  function handleSavePreset() {
    if (!newPresetName.trim()) return;
    perApp.addPreset(newPresetName.trim());
    setNewPresetName("");
    setPresetDialogOpen(false);
    notify.success(t("perApp.presetSaved"));
  }

  function handleApplyPreset(preset: PerAppPreset) {
    perApp.applyPreset(preset.id);
    notify.info(t("perApp.presetApplied", { name: preset.name }));
  }

  function handleDeletePreset(id: string) {
    perApp.deletePreset(id);
  }

  // ── Add all apps from a category ──────────────────────────────────────────

  function handleAddCategory(category: AppCategory) {
    const currentApps = new Set(perApp.apps.map((a) => a.toLowerCase()));
    const newApps = category.apps.filter((a) => !currentApps.has(a));
    if (newApps.length > 0) {
      perApp.setApps([...perApp.apps, ...newApps]);
    }
  }

  // ── Filtered running apps list ────────────────────────────────────────────

  const filteredApps = useMemo(() => {
    if (!appSearch) return runningApps;
    const q = appSearch.toLowerCase();
    return runningApps.filter((a) => a.toLowerCase().includes(q));
  }, [runningApps, appSearch]);

  return (
    <ScrollArea className="h-full">
      <div className="p-4 sm:p-6 pb-12 space-y-6 max-w-2xl">
        <h1 className="font-bold text-lg">{t("perApp.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("perApp.description")}</p>

        {/* ── Section A: Status Bar ──────────────────────────────────── */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Label className="text-base font-medium">{t("perApp.enable")}</Label>
                {perApp.enabled && (
                  <Badge variant="secondary">{t("perApp.methodTun")}</Badge>
                )}
              </div>
              <Switch checked={perApp.enabled} onCheckedChange={handleToggle} />
            </div>

            {perApp.enabled && (
              <>
                <div className="flex items-center gap-4">
                  <div className="flex-1 space-y-1">
                    <Label className="text-sm">{t("perApp.mode")}</Label>
                    <Select
                      value={perApp.mode}
                      onValueChange={(v) => perApp.setMode(v as "include" | "exclude")}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="include">{t("perApp.modeInclude")}</SelectItem>
                        <SelectItem value="exclude">{t("perApp.modeExclude")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Elevation indicator */}
                {isElevated !== null && (
                  <div className="flex items-center gap-2 text-xs">
                    {isElevated ? (
                      <>
                        <Shield size={14} className="text-green-500" />
                        <span className="text-green-600 dark:text-green-400">
                          {t("perApp.elevated")}
                        </span>
                      </>
                    ) : (
                      <>
                        <ShieldAlert size={14} className="text-yellow-500" />
                        <span className="text-yellow-600 dark:text-yellow-400">
                          {t("perApp.notElevated")}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {perApp.enabled && (
          <>
            {/* ── Section B: Running Apps Browser ───────────────────── */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t("perApp.runningApps")}
              </p>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                  <Input
                    className="pl-8"
                    placeholder={t("perApp.search")}
                    value={appSearch}
                    onChange={(e) => setAppSearch(e.target.value)}
                  />
                </div>
                <Button variant="outline" size="sm" onClick={fetchRunningApps} disabled={appsLoading}>
                  <RefreshCw className={appsLoading ? "animate-spin" : ""} size={14} />
                  <span className="ml-1">{t("perApp.refresh")}</span>
                </Button>
              </div>

              <AppsList
                loading={appsLoading}
                filteredApps={filteredApps}
                hasRunningApps={runningApps.length > 0}
                selectedApps={perApp.apps}
                onToggle={perApp.toggleApp}
                t={t}
              />

              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {t("perApp.selected", { count: perApp.apps.length })}
                </p>
                <Button size="sm" onClick={handleApply}>
                  {t("perApp.apply")}
                </Button>
              </div>
            </div>

            <Separator />

            {/* ── Section C: Auto-Detect Categories ────────────────── */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t("perApp.categories")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("perApp.categoriesDesc")}
              </p>

              <div className="grid gap-2">
                {APP_CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  return (
                    <div
                      key={cat.key}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <Icon size={16} className="text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">
                            {t(`perApp.cat_${cat.key}`)}
                          </p>
                          <p className="text-xs text-muted-foreground truncate max-w-[300px]">
                            {cat.apps.join(", ")}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleAddCategory(cat)}
                      >
                        <Plus size={14} className="mr-1" />
                        {t("perApp.addAll")}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>

            <Separator />

            {/* ── Section D: Saved Presets ──────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("perApp.presets")}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setNewPresetName("");
                    setPresetDialogOpen(true);
                  }}
                  disabled={perApp.apps.length === 0}
                >
                  <Plus size={14} className="mr-1" />
                  {t("perApp.savePreset")}
                </Button>
              </div>

              {perApp.presets.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  {t("perApp.noPresets")}
                </p>
              ) : (
                <div className="grid gap-2">
                  {perApp.presets.map((preset) => (
                    <Card
                      key={preset.id}
                      className={
                        perApp.activePresetId === preset.id
                          ? "border-primary"
                          : ""
                      }
                    >
                      <CardContent className="p-3 flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium truncate">
                              {preset.name}
                            </p>
                            {perApp.activePresetId === preset.id && (
                              <Check size={14} className="text-primary shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {preset.mode === "include"
                              ? t("perApp.modeInclude")
                              : t("perApp.modeExclude")}
                            {" "}
                            ({preset.apps.length} {t("perApp.appsCount")})
                          </p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleApplyPreset(preset)}
                          >
                            {t("perApp.applyPreset")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeletePreset(preset.id)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Save Preset Dialog ──────────────────────────────────── */}
        <Dialog open={presetDialogOpen} onOpenChange={setPresetDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("perApp.savePresetTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label>{t("perApp.presetName")}</Label>
              <Input
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder={t("perApp.presetNamePlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSavePreset();
                }}
              />
              <p className="text-xs text-muted-foreground">
                {t("perApp.presetDesc", {
                  mode: perApp.mode,
                  count: perApp.apps.length,
                })}
              </p>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{t("common.cancel")}</Button>
              </DialogClose>
              <Button onClick={handleSavePreset} disabled={!newPresetName.trim()}>
                {t("perApp.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ScrollArea>
  );
}
