import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus, Trash2, Info, Download, Upload, Layers,
  ChevronDown, ChevronRight, Check, RefreshCw, Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { useRules } from "@/store/rules";
import type { Rule } from "@/store/rules";
import { useRuleProviders, SUGGESTED_PROVIDERS } from "@/store/ruleProviders";
import type { RuleProvider, DownloadMode } from "@/store/ruleProviders";
import { useStore } from "@/store";
import { useSettings } from "@/store/settings";
import { useConnection } from "@/hooks/useConnection";
import { usePlatform } from "@/hooks/usePlatform";
import { notify } from "@/store/notifications";
import { downloadJson, pickJsonFile } from "@/lib/utils";
import {
  RULE_PRESETS, PRESET_CATEGORY_ORDER, PRESET_CATEGORY_KEYS,
} from "@/lib/rulePresets";
import type { PresetCategory, RulePreset } from "@/lib/rulePresets";
import { api } from "@/lib/commands";

const RULE_TYPES   = ["DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "IP-CIDR", "GEOIP", "GEOSITE", "FINAL"] as const;
const RULE_ACTIONS = ["PROXY", "DIRECT", "REJECT"] as const;

// ── Helpers ──────────────────────────────────────────────────────────────

/** Parse an IPv4 address string to a 32-bit unsigned number, or null if invalid */
function ipToNum(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0;
}

/** Build a set of "type|match|action" keys for all rules in a category */
function categoryRuleKeys(category: PresetCategory): Set<string> {
  const keys = new Set<string>();
  for (const preset of RULE_PRESETS) {
    if (preset.category === category) {
      for (const r of preset.rules) {
        keys.add(`${r.type}|${r.match}|${r.action}`);
      }
    }
  }
  return keys;
}

/** Check whether all rules from a preset are already present */
function isPresetFullyApplied(preset: RulePreset, currentRules: Rule[]): boolean {
  const existing = new Set(currentRules.map((r) => `${r.type}|${r.match}|${r.action}`));
  return preset.rules.every((r) => existing.has(`${r.type}|${r.match}|${r.action}`));
}

// ── Main Component ───────────────────────────────────────────────────────

export default function Rules() {
  const { t } = useTranslation();
  const { isMobile } = usePlatform();
  const rules = useRules((s) => s.rules);
  const addRule = useRules((s) => s.add);
  const addMany = useRules((s) => s.addMany);
  const replaceCategory = useRules((s) => s.replaceCategory);
  const removeRule = useRules((s) => s.remove);

  const providers = useRuleProviders((s) => s.providers);
  const addProvider = useRuleProviders((s) => s.add);
  const removeProvider = useRuleProviders((s) => s.remove);
  const toggleProvider = useRuleProviders((s) => s.toggle);
  const updateProviderStatus = useRuleProviders((s) => s.updateProviderStatus);
  const setDownloadMode = useRuleProviders((s) => s.setDownloadMode);

  const connected = useStore((s) => s.connected);
  const activeProfileIdx = useStore((s) => s.activeProfileIdx);
  const storeProfiles = useStore((s) => s.profiles);
  const proxyModes = useSettings((s) => s.proxyModes);
  const { switchTo } = useConnection();

  function reconnectIfActive() {
    if (!connected || activeProfileIdx === null) return;
    const profile = storeProfiles[activeProfileIdx];
    if (profile) switchTo(profile, proxyModes);
  }

  const [open, setOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [type, setType] = useState<Rule["type"]>("DOMAIN");
  const [match, setMatch] = useState("");
  const [action, setAction] = useState<Rule["action"]>("PROXY");

  // Preset expansion state
  const [expandedPresets, setExpandedPresets] = useState<Set<string>>(new Set());

  // Provider form state
  const [providerName, setProviderName] = useState("");
  const [providerUrl, setProviderUrl] = useState("");
  const [providerBehavior, setProviderBehavior] = useState<RuleProvider["behavior"]>("domain");
  const [providerAction, setProviderAction] = useState<RuleProvider["action"]>("PROXY");

  // Provider update state
  const [updatingProviders, setUpdatingProviders] = useState<Set<string>>(new Set());
  const [updateAllProgress, setUpdateAllProgress] = useState<{ current: number; total: number } | null>(null);

  // Rule testing state
  const [testInput, setTestInput] = useState("");
  const [testResult, setTestResult] = useState<{ matched: true; rule: Rule } | { matched: false } | null>(null);

  function handleAdd() {
    addRule({ id: crypto.randomUUID(), type, match, action });
    setMatch("");
    setOpen(false);
    reconnectIfActive();
  }

  function handleTest() {
    const input = testInput.trim().toLowerCase();
    if (!input) {
      setTestResult(null);
      return;
    }
    for (const r of rules) {
      const m = r.match.toLowerCase();
      switch (r.type) {
        case "DOMAIN":
          if (input === m) { setTestResult({ matched: true, rule: r }); return; }
          break;
        case "DOMAIN-SUFFIX":
          if (input === m || input.endsWith("." + m)) { setTestResult({ matched: true, rule: r }); return; }
          break;
        case "DOMAIN-KEYWORD":
          if (input.includes(m)) { setTestResult({ matched: true, rule: r }); return; }
          break;
        case "IP-CIDR": {
          // Basic CIDR match: parse "ip/prefix"
          const [cidrIp, prefixStr] = r.match.split("/");
          const prefix = parseInt(prefixStr, 10);
          const inputNum = ipToNum(input);
          const cidrNum = ipToNum(cidrIp);
          if (inputNum !== null && cidrNum !== null && !isNaN(prefix)) {
            const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
            if ((inputNum & mask) === (cidrNum & mask)) {
              setTestResult({ matched: true, rule: r });
              return;
            }
          }
          break;
        }
        case "GEOIP":
          // Only consider GEOIP rules when the input looks like an IP address
          if (ipToNum(input) !== null) {
            setTestResult({ matched: true, rule: { ...r, action: r.action, _runtimeOnly: true } as Rule & { _runtimeOnly?: boolean } });
            return;
          }
          break;
        case "GEOSITE":
          // GEOSITE requires database lookup — show runtime badge for domain inputs
          if (ipToNum(input) === null) {
            setTestResult({ matched: true, rule: { ...r, action: r.action, _runtimeOnly: true } as Rule & { _runtimeOnly?: boolean } });
            return;
          }
          break;
        case "FINAL":
          setTestResult({ matched: true, rule: r });
          return;
      }
    }
    setTestResult({ matched: false });
  }

  async function handleExportRules() {
    try {
      await downloadJson(rules, `prisma-rules-${Date.now()}.json`);
      notify.success(t("rules.exported"));
    } catch (e) {
      if (e instanceof Error && e.message === "No file selected") return;
      notify.error(String(e));
    }
  }

  async function handleImportRules() {
    try {
      const arr = await pickJsonFile();
      if (!Array.isArray(arr)) throw new Error("Expected JSON array");
      let count = 0;
      for (const item of arr) {
        if (item.type && item.action) {
          addRule({
            id: item.id ?? crypto.randomUUID(),
            type: item.type,
            match: item.match ?? "",
            action: item.action,
          });
          count++;
        }
      }
      notify.success(t("rules.imported", { count }));
      reconnectIfActive();
    } catch (e) {
      if (e instanceof Error && e.message === "No file selected") return;
      notify.error(`Import failed: ${String(e)}`);
    }
  }

  function togglePresetExpand(id: string) {
    setExpandedPresets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleApplyPreset(preset: RulePreset, mode: "add" | "replace") {
    let count: number;
    if (mode === "replace") {
      const keys = categoryRuleKeys(preset.category);
      count = replaceCategory(keys, preset.rules);
    } else {
      count = addMany(preset.rules);
    }
    notify.success(t("rules.presetApplied", { count, name: t(preset.nameKey) }));
    reconnectIfActive();
  }

  function handleAddProvider() {
    if (!providerName.trim() || !providerUrl.trim()) return;
    addProvider({
      name: providerName.trim(),
      url: providerUrl.trim(),
      behavior: providerBehavior,
      action: providerAction,
      enabled: true,
    });
    notify.success(t("rules.providerAdded", { name: providerName.trim() }));
    setProviderName("");
    setProviderUrl("");
    setProviderBehavior("domain");
    setProviderAction("PROXY");
    setProviderDialogOpen(false);
    reconnectIfActive();
  }

  function handleAddSuggested(suggestion: typeof SUGGESTED_PROVIDERS[number]) {
    addProvider({
      name: suggestion.name,
      url: suggestion.url,
      behavior: suggestion.behavior,
      action: suggestion.action,
      enabled: true,
    });
    notify.success(t("rules.providerAdded", { name: suggestion.name }));
    reconnectIfActive();
  }

  async function handleUpdateProvider(provider: RuleProvider) {
    setUpdatingProviders((prev) => new Set(prev).add(provider.id));
    try {
      const isConnected = useStore.getState().connected;
      const mode = provider.downloadMode || "auto";
      let httpPort = 0;
      if (mode === "proxy") {
        if (!isConnected) {
          notify.error(t("rules.proxyNotConnected"));
          return;
        }
        httpPort = useSettings.getState().httpPort || 0;
      } else if (mode === "auto") {
        httpPort = isConnected ? (useSettings.getState().httpPort || 0) : 0;
      }
      // mode === "direct" → httpPort stays 0
      const result = await api.updateRuleProvider(
        provider.id, provider.name, provider.url, provider.behavior, provider.action, httpPort
      );
      const updatedAt = new Date(result.updated_at_epoch * 1000).toISOString();
      updateProviderStatus(provider.id, result.rule_count, updatedAt);
      notify.success(t("rules.providerUpdated", { name: provider.name }));
    } catch (e) {
      notify.error(t("rules.providerUpdateFailed", { name: provider.name, error: String(e) }));
    } finally {
      setUpdatingProviders((prev) => {
        const next = new Set(prev);
        next.delete(provider.id);
        return next;
      });
    }
  }

  async function handleUpdateAllProviders() {
    const enabled = providers.filter((p) => p.enabled);
    if (enabled.length === 0) return;
    setUpdateAllProgress({ current: 0, total: enabled.length });
    for (let i = 0; i < enabled.length; i++) {
      setUpdateAllProgress({ current: i + 1, total: enabled.length });
      await handleUpdateProvider(enabled[i]);
    }
    setUpdateAllProgress(null);
  }

  // Group presets by category
  const presetsByCategory = useMemo(() => {
    const map = new Map<PresetCategory, RulePreset[]>();
    for (const preset of RULE_PRESETS) {
      const list = map.get(preset.category) ?? [];
      list.push(preset);
      map.set(preset.category, list);
    }
    return map;
  }, []);

  // Check which suggested providers are already added (by URL)
  const addedProviderUrls = useMemo(
    () => new Set(providers.map((p) => p.url)),
    [providers]
  );

  return (
    <div className="p-4 sm:p-6 flex flex-col h-full gap-3">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-lg">{t("rules.title")}</h1>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setPresetsOpen(true)} title={t("rules.presets")}>
            <Layers size={14} />
          </Button>
          <Button size="sm" variant="ghost" onClick={handleExportRules} title={t("rules.export")}>
            <Download size={14} />
          </Button>
          <Button size="sm" variant="ghost" onClick={handleImportRules} title={t("rules.import")}>
            <Upload size={14} />
          </Button>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus /> {t("rules.addRule")}
          </Button>
        </div>
      </div>

      <Alert className="border-blue-600/30 bg-blue-600/10">
        <Info size={14} className="text-blue-400" />
        <AlertDescription className="text-blue-300 text-xs">
          {t("rules.persistNote")}
        </AlertDescription>
      </Alert>

      {/* Test Rule */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">{t("rules.testInput")}</Label>
              <Input
                placeholder="example.com or 8.8.8.8"
                value={testInput}
                onChange={(e) => { setTestInput(e.target.value); setTestResult(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleTest(); }}
                className="h-8 text-sm"
              />
            </div>
            <Button size="sm" onClick={handleTest} disabled={!testInput.trim()}>
              {t("rules.test")}
            </Button>
          </div>
          {testResult && (
            <div className="mt-2 text-sm">
              {testResult.matched ? (
                <p>
                  {t("rules.testResult")}:{" "}
                  <Badge variant="outline" className="text-xs mx-1">{testResult.rule.type}</Badge>
                  {testResult.rule.match && (
                    <span className="text-xs text-muted-foreground font-mono mr-1">{testResult.rule.match}</span>
                  )}
                  {"_runtimeOnly" in testResult.rule && (testResult.rule as Rule & { _runtimeOnly?: boolean })._runtimeOnly ? (
                    <Badge variant="outline" className="text-xs border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      {t("rules.testedAtRuntime")}
                    </Badge>
                  ) : (
                    <Badge
                      variant={
                        testResult.rule.action === "PROXY" ? "success" :
                        testResult.rule.action === "REJECT" ? "destructive" : "secondary"
                      }
                      className="text-xs"
                    >
                      {testResult.rule.action}
                    </Badge>
                  )}
                </p>
              ) : (
                <p className="text-muted-foreground">{t("rules.noMatch")}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="rules" className="flex-1 flex flex-col h-0">
        <TabsList className="w-fit">
          <TabsTrigger value="rules">{t("rules.title")}</TabsTrigger>
          <TabsTrigger value="providers">{t("rules.providers")}</TabsTrigger>
        </TabsList>

        {/* ── Rules Tab ──────────────────────────────────────────── */}
        <TabsContent value="rules" className="flex-1 h-0">
          <ScrollArea className="h-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("rules.type")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("rules.match")}</TableHead>
                  <TableHead>{t("rules.action")}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={isMobile ? 3 : 4} className="text-center text-muted-foreground py-8">
                      {t("rules.noRules")}
                    </TableCell>
                  </TableRow>
                )}
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.type}</TableCell>
                    <TableCell className="text-sm hidden sm:table-cell">{r.match || "\u2014"}</TableCell>
                    <TableCell className="text-xs sm:text-sm">
                      <span className={
                        r.action === "PROXY"  ? "text-green-400" :
                        r.action === "REJECT" ? "text-red-400"   : "text-muted-foreground"
                      }>
                        {r.action}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => { removeRule(r.id); reconnectIfActive(); }}>
                        <Trash2 size={14} className="text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </TabsContent>

        {/* ── Providers Tab ──────────────────────────────────────── */}
        <TabsContent value="providers" className="flex-1 h-0">
          <ScrollArea className="h-full">
            <div className="space-y-3 pb-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {t("rules.providersDesc")}
                </p>
                <div className="flex gap-1">
                  {providers.some((p) => p.enabled) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleUpdateAllProviders}
                      disabled={updateAllProgress !== null}
                    >
                      <RefreshCw size={14} className={updateAllProgress !== null ? "animate-spin" : ""} />
                      {updateAllProgress !== null
                        ? t("rules.updatingProgress", { current: updateAllProgress.current, total: updateAllProgress.total })
                        : t("rules.updateAll")
                      }
                    </Button>
                  )}
                  <Button size="sm" onClick={() => setProviderDialogOpen(true)}>
                    <Plus size={14} /> {t("rules.addProvider")}
                  </Button>
                </div>
              </div>

              {providers.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  {t("rules.noProviders")}
                </div>
              )}

              {providers.map((provider) => (
                <div
                  key={provider.id}
                  className="flex items-center justify-between rounded-md border p-3 gap-3"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Switch
                      checked={provider.enabled}
                      onCheckedChange={() => { toggleProvider(provider.id); reconnectIfActive(); }}
                      aria-label={t("rules.toggleProvider")}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{provider.name}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {provider.behavior}
                        </Badge>
                        <Badge
                          variant={
                            provider.action === "PROXY" ? "success" :
                            provider.action === "REJECT" ? "destructive" : "secondary"
                          }
                          className="text-[10px] shrink-0"
                        >
                          {provider.action}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{provider.url}</div>
                      {provider.lastUpdated && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {t("rules.providerLastUpdated", {
                            time: new Date(provider.lastUpdated).toLocaleString(),
                          })}
                          {provider.ruleCount > 0 && ` \u00b7 ${t("rules.providerRuleCount", { count: provider.ruleCount })}`}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Select
                      value={provider.downloadMode || "auto"}
                      onValueChange={(v) => setDownloadMode(provider.id, v as DownloadMode)}
                    >
                      <SelectTrigger className="h-7 w-[72px] text-[10px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">{t("rules.downloadAuto")}</SelectItem>
                        <SelectItem value="direct">{t("rules.downloadDirect")}</SelectItem>
                        <SelectItem value="proxy">{t("rules.downloadProxy")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleUpdateProvider(provider)}
                      disabled={updatingProviders.has(provider.id)}
                      title={t("rules.updateProvider")}
                    >
                      <RefreshCw
                        size={14}
                        className={updatingProviders.has(provider.id) ? "animate-spin" : ""}
                      />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => { removeProvider(provider.id); reconnectIfActive(); }}
                      title={t("rules.removeProvider")}
                    >
                      <Trash2 size={14} className="text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}

              {/* Suggested providers */}
              {SUGGESTED_PROVIDERS.some((s) => !addedProviderUrls.has(s.url)) && (
                <div className="pt-2">
                  <h3 className="text-xs font-medium text-muted-foreground mb-2">
                    {t("rules.suggestedProviders")}
                  </h3>
                  <div className="space-y-2">
                    {SUGGESTED_PROVIDERS.filter((s) => !addedProviderUrls.has(s.url)).map((suggestion) => (
                      <div
                        key={suggestion.url}
                        className="flex items-center justify-between rounded-md border border-dashed p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Globe size={12} className="text-muted-foreground shrink-0" />
                            <span className="text-sm truncate">{suggestion.name}</span>
                            <Badge variant="outline" className="text-[10px] shrink-0">
                              {suggestion.behavior}
                            </Badge>
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                            {suggestion.url}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAddSuggested(suggestion)}
                          className="shrink-0 ml-2"
                        >
                          <Plus size={12} /> {t("rules.addProvider")}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* ── Add Rule Dialog ────────────────────────────────────── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("rules.addRule")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("rules.type")}</Label>
              <Select value={type} onValueChange={(v) => setType(v as Rule["type"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RULE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("rules.match")}</Label>
              <Input value={match} onChange={(e) => setMatch(e.target.value)} placeholder={t("rules.matchPlaceholder")} />
            </div>
            <div className="space-y-1">
              <Label>{t("rules.action")}</Label>
              <Select value={action} onValueChange={(v) => setAction(v as Rule["action"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RULE_ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">{t("common.cancel")}</Button></DialogClose>
            <Button onClick={handleAdd}>{t("rules.addRule")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Presets Dialog ─────────────────────────────────────── */}
      <Dialog open={presetsOpen} onOpenChange={setPresetsOpen}>
        <DialogContent className="max-w-lg max-h-[80vh]">
          <DialogHeader><DialogTitle>{t("rules.presets")}</DialogTitle></DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-2">
            <div className="space-y-4">
              {PRESET_CATEGORY_ORDER.map((category) => {
                const presets = presetsByCategory.get(category);
                if (!presets || presets.length === 0) return null;

                return (
                  <div key={category}>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      {t(PRESET_CATEGORY_KEYS[category])}
                    </h3>
                    <div className="space-y-2">
                      {presets.map((preset) => {
                        const isExpanded = expandedPresets.has(preset.id);
                        const isApplied = isPresetFullyApplied(preset, rules);

                        return (
                          <div key={preset.id} className="rounded-md border">
                            <div className="flex items-center justify-between p-3">
                              <button
                                type="button"
                                className="flex items-center gap-2 text-left flex-1 min-w-0"
                                onClick={() => togglePresetExpand(preset.id)}
                                aria-expanded={isExpanded}
                                aria-label={t(preset.nameKey)}
                              >
                                {isExpanded
                                  ? <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                                  : <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                                }
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm">{t(preset.nameKey)}</span>
                                    <Badge variant="outline" className="text-[10px]">
                                      {t("rules.ruleCount", { count: preset.rules.length })}
                                    </Badge>
                                    {isApplied && (
                                      <Check size={14} className="text-green-500 shrink-0" />
                                    )}
                                  </div>
                                  <div className="text-xs text-muted-foreground">{t(preset.descKey)}</div>
                                </div>
                              </button>
                              <div className="flex gap-1 shrink-0 ml-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleApplyPreset(preset, "add")}
                                  title={t("rules.applyModeAdd")}
                                >
                                  {t("rules.applyAdd")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => handleApplyPreset(preset, "replace")}
                                  title={t("rules.applyModeReplace")}
                                >
                                  {t("rules.applyReplace")}
                                </Button>
                              </div>
                            </div>

                            {/* Expanded rule preview */}
                            {isExpanded && (
                              <div className="border-t px-3 py-2 bg-muted/30">
                                <div className="space-y-0.5 max-h-40 overflow-y-auto">
                                  {preset.rules.map((r, i) => (
                                    <div key={i} className="flex items-center gap-2 text-xs font-mono">
                                      <span className="text-muted-foreground w-28 shrink-0">{r.type}</span>
                                      <span className="truncate flex-1">{r.match || "\u2014"}</span>
                                      <span className={
                                        r.action === "PROXY"  ? "text-green-400" :
                                        r.action === "REJECT" ? "text-red-400"   : "text-muted-foreground"
                                      }>
                                        {r.action}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* ── Add Provider Dialog ────────────────────────────────── */}
      <Dialog open={providerDialogOpen} onOpenChange={setProviderDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("rules.addProvider")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("rules.providerName")}</Label>
              <Input
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                placeholder={t("rules.providerNamePlaceholder")}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("rules.providerUrl")}</Label>
              <Input
                value={providerUrl}
                onChange={(e) => setProviderUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div className="space-y-1">
              <Label>{t("rules.providerBehavior")}</Label>
              <Select value={providerBehavior} onValueChange={(v) => setProviderBehavior(v as RuleProvider["behavior"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="domain">{t("rules.behaviorDomain")}</SelectItem>
                  <SelectItem value="ipcidr">{t("rules.behaviorIpCidr")}</SelectItem>
                  <SelectItem value="classical">{t("rules.behaviorClassical")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("rules.action")}</Label>
              <Select value={providerAction} onValueChange={(v) => setProviderAction(v as RuleProvider["action"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RULE_ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">{t("common.cancel")}</Button></DialogClose>
            <Button onClick={handleAddProvider} disabled={!providerName.trim() || !providerUrl.trim()}>
              {t("rules.addProvider")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
