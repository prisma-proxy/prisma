import { useEffect, useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Plus, ScanLine, MoreHorizontal, Pencil, Copy, Trash2, Download, Upload, Search, Share2, FileCode, Link, QrCode, Check, Globe, RefreshCw, Loader2, Signal, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import QrDisplay from "@/components/QrDisplay";
import ConfirmDialog from "@/components/ConfirmDialog";
import ProfileWizard from "@/components/ProfileWizard";
import { useStore } from "@/store";
import { useProfileMetrics } from "@/store/profileMetrics";
import { useConnection } from "@/hooks/useConnection";
import { notify } from "@/store/notifications";
import { api } from "@/lib/commands";
import { fmtBytes, fmtRelativeTime, fmtSpeed, fmtDuration } from "@/lib/format";
import { downloadJson, pickJsonFile } from "@/lib/utils";
import { parseProfileToWizard } from "@/lib/buildConfig";
import type { WizardState } from "@/lib/buildConfig";
import type { Profile } from "@/lib/types";

type ShareTab = "toml" | "uri" | "qr";

// Latency cache entry
interface LatencyEntry {
  ms: number | null; // null = error or untested
  loading: boolean;
  error?: string;
  timestamp: number;
}

const LATENCY_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getServerAddr(config: unknown): string | null {
  if (!config || typeof config !== "object") return null;
  const c = config as Record<string, unknown>;
  return typeof c.server_addr === "string" ? c.server_addr : null;
}

export default function Profiles() {
  const { t } = useTranslation();
  const profiles = useStore((s) => s.profiles);
  const setProfiles = useStore((s) => s.setProfiles);
  const connected = useStore((s) => s.connected);
  const connecting = useStore((s) => s.connecting);
  const activeProfileIdx = useStore((s) => s.activeProfileIdx);
  const proxyModes = useStore((s) => s.proxyModes);
  const metrics = useProfileMetrics((s) => s.metrics);
  const { connectTo, disconnect, switchTo } = useConnection();

  // Latency testing state
  const [latencyMap, setLatencyMap] = useState<Record<string, LatencyEntry>>({});
  const [testingAll, setTestingAll] = useState(false);
  const [autoSelect, setAutoSelect] = useState(() => {
    try { return localStorage.getItem("prisma-auto-select") === "true"; } catch { return false; }
  });

  // Wizard
  const [wizardOpen,   setWizardOpen]   = useState(false);
  const [editInitial,  setEditInitial]  = useState<WizardState | undefined>();
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [editingCreatedAt, setEditingCreatedAt] = useState<string>("");

  // Share dialog
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTab,  setShareTab]  = useState<ShareTab>("toml");
  const [shareToml, setShareToml] = useState("");
  const [shareUri,  setShareUri]  = useState("");
  const [shareQrSvg, setShareQrSvg] = useState("");
  const [shareName, setShareName] = useState("");
  const [shareCopied, setShareCopied] = useState(false);

  // QR import
  const [qrImportOpen, setQrImportOpen] = useState(false);
  const [qrImportText, setQrImportText] = useState("");
  const [qrImportErr,  setQrImportErr]  = useState("");

  // Subscription import
  const [subImportOpen, setSubImportOpen] = useState(false);
  const [subUrl, setSubUrl] = useState("");
  const [subImporting, setSubImporting] = useState(false);
  const [subErr, setSubErr] = useState("");
  const [subRefreshing, setSubRefreshing] = useState(false);

  // Delete confirm
  const [deleteOpen,    setDeleteOpen]    = useState(false);
  const [deletePending, setDeletePending] = useState<Profile | null>(null);

  // Search & sort
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"default" | "name" | "lastUsed" | "latency">("default");

  // Persist auto-select preference
  const toggleAutoSelect = useCallback((val: boolean) => {
    setAutoSelect(val);
    try { localStorage.setItem("prisma-auto-select", String(val)); } catch {}
  }, []);

  // Ping a single profile server
  const pingProfile = useCallback(async (profileId: string, addr: string) => {
    setLatencyMap((prev) => ({
      ...prev,
      [profileId]: { ms: null, loading: true, timestamp: Date.now() },
    }));
    try {
      const ms = await api.pingServer(addr);
      setLatencyMap((prev) => ({
        ...prev,
        [profileId]: { ms, loading: false, timestamp: Date.now() },
      }));
      return ms;
    } catch (e) {
      setLatencyMap((prev) => ({
        ...prev,
        [profileId]: { ms: null, loading: false, error: String(e), timestamp: Date.now() },
      }));
      return null;
    }
  }, []);

  // Test all profiles in parallel
  const testAllProfiles = useCallback(async () => {
    setTestingAll(true);
    const now = Date.now();
    const promises = profiles.map((p) => {
      const addr = getServerAddr(p.config);
      if (!addr) return Promise.resolve(null);
      // Skip if cached and not expired
      const cached = latencyMap[p.id];
      if (cached && !cached.loading && cached.ms != null && now - cached.timestamp < LATENCY_TTL_MS) {
        return Promise.resolve(cached.ms);
      }
      return pingProfile(p.id, addr);
    });
    await Promise.allSettled(promises);
    setTestingAll(false);
  }, [profiles, latencyMap, pingProfile]);

  const reload = () =>
    api.listProfiles()
      .then(setProfiles)
      .catch(() => notify.error(t("profiles.failedToLoad")));

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredProfiles = useMemo(() => {
    let result = [...profiles];
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) => p.name.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    if (sortBy === "name") {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "lastUsed") {
      result.sort((a, b) => {
        const ma = metrics[a.id]?.lastConnectedAt ?? "";
        const mb = metrics[b.id]?.lastConnectedAt ?? "";
        return mb.localeCompare(ma);
      });
    } else if (sortBy === "latency") {
      result.sort((a, b) => {
        const la = metrics[a.id]?.lastLatencyMs ?? 9999;
        const lb = metrics[b.id]?.lastLatencyMs ?? 9999;
        return la - lb;
      });
    }
    return result;
  }, [profiles, search, sortBy, metrics]);

  const activeProfile = activeProfileIdx !== null ? profiles[activeProfileIdx] : null;
  const hasSubscriptions = profiles.some((p) => !!p.subscription_url);

  async function handleProfileClick(p: Profile) {
    if (connecting) return;
    if (connected && activeProfile?.id === p.id) {
      disconnect();
      return;
    }

    // Auto-select: ping all and pick lowest latency
    if (autoSelect && !connected) {
      setTestingAll(true);
      const results: { profile: Profile; ms: number }[] = [];
      const promises = profiles.map(async (prof) => {
        const addr = getServerAddr(prof.config);
        if (!addr) return;
        const cached = latencyMap[prof.id];
        const now = Date.now();
        let ms: number | null = null;
        if (cached && !cached.loading && cached.ms != null && now - cached.timestamp < LATENCY_TTL_MS) {
          ms = cached.ms;
        } else {
          ms = await pingProfile(prof.id, addr);
        }
        if (ms != null) results.push({ profile: prof, ms });
      });
      await Promise.allSettled(promises);
      setTestingAll(false);

      if (results.length > 0) {
        results.sort((a, b) => a.ms - b.ms);
        const best = results[0];
        notify.success(t("profiles.autoSelectResult", { name: best.profile.name, ms: best.ms }));
        connectTo(best.profile, proxyModes);
      } else {
        // Fallback to clicked profile
        connectTo(p, proxyModes);
      }
      return;
    }

    if (connected) {
      switchTo(p, proxyModes);
    } else {
      connectTo(p, proxyModes);
    }
  }

  async function handleSave(name: string, config: Record<string, unknown>, tags: string[]) {
    const profile: Profile = {
      id: editingId ?? crypto.randomUUID(),
      name,
      tags,
      config,
      created_at: editingCreatedAt || new Date().toISOString(),
    };
    await api.saveProfile(JSON.stringify(profile));
    await reload();
    await api.refreshTrayProfiles().catch(() => {});
    notify.success(t("profiles.saved"));
    setEditInitial(undefined);
    setEditingId(null);
    setEditingCreatedAt("");
  }

  function openAdd() {
    setEditInitial(undefined);
    setEditingId(null);
    setEditingCreatedAt("");
    setWizardOpen(true);
  }

  function openEdit(p: Profile) {
    setEditInitial(parseProfileToWizard(p.name, p.config, p.tags));
    setEditingId(p.id);
    setEditingCreatedAt(p.created_at);
    setWizardOpen(true);
  }

  async function handleDuplicate(p: Profile) {
    const dup: Profile = {
      id: crypto.randomUUID(),
      name: `Copy of ${p.name}`,
      tags: [...p.tags],
      config: JSON.parse(JSON.stringify(p.config)),
      created_at: new Date().toISOString(),
    };
    try {
      await api.saveProfile(JSON.stringify(dup));
      await reload();
      notify.success(t("profiles.duplicated", { name: p.name }));
    } catch (e) {
      notify.error(String(e));
    }
  }

  async function openShareDialog(p: Profile) {
    setShareName(p.name);
    setShareToml("");
    setShareUri("");
    setShareQrSvg("");
    setShareCopied(false);
    setShareTab("toml");
    setShareOpen(true);

    // Load all three formats in parallel
    const configJson = JSON.stringify(p.config);
    const profileJson = JSON.stringify(p);
    const [tomlRes, uriRes, qrRes] = await Promise.allSettled([
      api.profileConfigToToml(configJson),
      api.profileToUri(profileJson),
      api.profileToQr(profileJson),
    ]);
    if (tomlRes.status === "fulfilled") setShareToml(tomlRes.value);
    if (uriRes.status === "fulfilled")  setShareUri(uriRes.value);
    if (qrRes.status === "fulfilled")   setShareQrSvg(qrRes.value);
  }

  async function handleCopyShare() {
    const text = shareTab === "toml" ? shareToml : shareUri;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
      notify.success(t("profiles.copiedToClipboard"));
    } catch {
      notify.error("Clipboard not available");
    }
  }

  function confirmDelete(p: Profile) {
    setDeletePending(p);
    setDeleteOpen(true);
  }

  async function handleDelete() {
    if (!deletePending) return;
    try {
      await api.deleteProfile(deletePending.id);
      await reload();
      await api.refreshTrayProfiles().catch(() => {});
      notify.success(t("profiles.deleted", { name: deletePending.name }));
    } catch (e) {
      notify.error(String(e));
    } finally {
      setDeletePending(null);
    }
  }

  async function handleQrImport() {
    setQrImportErr("");
    try {
      const json = await api.profileFromQr(qrImportText.trim());
      const parsed = JSON.parse(json);
      setQrImportOpen(false);
      setQrImportText("");
      const initial = parseProfileToWizard(parsed.name ?? "", parsed.config ?? parsed, parsed.tags);
      setEditInitial(initial);
      setWizardOpen(true);
    } catch (e) {
      setQrImportErr(String(e));
    }
  }

  function handleExportAll() {
    try {
      downloadJson(profiles, `prisma-profiles-${Date.now()}.json`);
    } catch {
      notify.error(t("profiles.exportFailed"));
    }
  }

  async function handleImportFile() {
    try {
      const arr = await pickJsonFile();
      if (!Array.isArray(arr)) throw new Error("Expected JSON array");
      let count = 0;
      for (const item of arr) {
        const p: Profile = {
          id: item.id ?? crypto.randomUUID(),
          name: item.name ?? "Imported",
          tags: item.tags ?? [],
          config: item.config ?? item,
          created_at: item.created_at ?? new Date().toISOString(),
        };
        await api.saveProfile(JSON.stringify(p));
        count++;
      }
      await reload();
      notify.success(t("profiles.importSuccess", { count }));
    } catch (e) {
      if (e instanceof Error && e.message === "No file selected") return;
      notify.error(t("profiles.importFailed") + ": " + String(e));
    }
  }

  async function handleImportSubscription() {
    if (!subUrl.trim()) return;
    setSubImporting(true);
    setSubErr("");
    try {
      const result = await api.importSubscription(subUrl.trim());
      await reload();
      await api.refreshTrayProfiles().catch(() => {});
      setSubImportOpen(false);
      setSubUrl("");
      notify.success(t("profiles.importSubSuccess", { count: result.count }));
    } catch (e) {
      setSubErr(String(e));
    } finally {
      setSubImporting(false);
    }
  }

  async function handleRefreshSubscriptions() {
    setSubRefreshing(true);
    try {
      const result = await api.refreshSubscriptions();
      await reload();
      await api.refreshTrayProfiles().catch(() => {});
      notify.success(t("profiles.refreshSubSuccess", { count: result.count }));
    } catch (e) {
      notify.error(t("profiles.refreshSubFailed") + ": " + String(e));
    } finally {
      setSubRefreshing(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 flex flex-col h-full gap-3">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-lg">{t("profiles.title")}</h1>
        <div className="flex gap-1">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 mr-1">
                  <Switch
                    checked={autoSelect}
                    onCheckedChange={toggleAutoSelect}
                    className="scale-75"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    <Zap size={12} className="inline mr-0.5" />{t("profiles.autoSelect")}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">{t("profiles.autoSelectEnabled")}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button size="sm" variant="ghost" onClick={testAllProfiles} disabled={testingAll} title={t("profiles.testAll")}>
            {testingAll ? <Loader2 size={14} className="animate-spin" /> : <Signal size={14} />}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleExportAll} title={t("profiles.exportAll")}>
            <Download size={14} />
          </Button>
          <Button size="sm" variant="ghost" onClick={handleImportFile} title={t("profiles.importFile")}>
            <Upload size={14} />
          </Button>
          {hasSubscriptions && (
            <Button size="sm" variant="ghost" onClick={handleRefreshSubscriptions} disabled={subRefreshing} title={t("profiles.refreshSub")}>
              {subRefreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setSubImportOpen(true)}>
            <Globe size={14} /> {t("profiles.importSub")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setQrImportOpen(true)}>
            <ScanLine size={14} /> {t("profiles.importQr")}
          </Button>
          <Button size="sm" onClick={openAdd}>
            <Plus /> {t("profiles.add")}
          </Button>
        </div>
      </div>

      {/* Search & sort */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("profiles.search")}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="w-28 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">{t("profiles.sortDefault")}</SelectItem>
            <SelectItem value="name">{t("profiles.sortName")}</SelectItem>
            <SelectItem value="lastUsed">{t("profiles.sortLastUsed")}</SelectItem>
            <SelectItem value="latency">{t("profiles.sortLatency")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {search && (
        <p className="text-xs text-muted-foreground">
          {t("profiles.countOf", { count: filteredProfiles.length, total: profiles.length })}
        </p>
      )}

      <ScrollArea className="flex-1 h-0">
        <div className="space-y-2 pr-2">
          {filteredProfiles.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">{t("profiles.noProfilesYet")}</p>
          )}
          {filteredProfiles.map((p) => {
            const isActive = connected && activeProfile?.id === p.id;
            const pm = metrics[p.id] ?? { lastLatencyMs: null, lastConnectedAt: null, totalBytesUp: 0, totalBytesDown: 0, connectCount: 0, totalUptimeSecs: 0, lastSessionSecs: 0, peakSpeedDownBps: 0, peakSpeedUpBps: 0 };

            return (
              <div
                key={p.id}
                onClick={() => handleProfileClick(p)}
                className={`flex items-center justify-between rounded-lg border bg-card px-4 py-3 cursor-pointer transition-colors hover:bg-accent/50 ${
                  isActive ? "border-l-4 border-l-green-500 border-green-500/30" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {isActive && (
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />
                    )}
                    <p className="font-medium text-sm truncate">{p.name}</p>
                    {isActive && (
                      <Badge variant="success" className="text-[10px] px-1.5 py-0">{t("profiles.connected")}</Badge>
                    )}
                    {/* Latency badge */}
                    {(() => {
                      const le = latencyMap[p.id];
                      if (!le) return null;
                      if (le.loading) return <Loader2 size={12} className="animate-spin text-muted-foreground shrink-0" />;
                      if (le.ms == null) return <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-gray-100 dark:bg-gray-800 text-gray-500">{t("profiles.latencyError")}</Badge>;
                      const color = le.ms < 100
                        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                        : le.ms < 300
                        ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                        : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400";
                      return <Badge variant="outline" className={`text-[10px] px-1.5 py-0 border-0 ${color}`}>{le.ms}{t("profiles.ms")}</Badge>;
                    })()}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {p.subscription_url && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5">
                        <Globe size={8} /> {t("profiles.subscription")}
                      </Badge>
                    )}
                    {p.tags.length > 0
                      ? p.tags.map((tag) => <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">{tag}</Badge>)
                      : !p.subscription_url && <span className="text-xs text-muted-foreground">&mdash;</span>
                    }
                    {p.last_updated && (
                      <span className="text-[10px] text-muted-foreground">
                        {t("profiles.lastUpdated", { time: fmtRelativeTime(p.last_updated) })}
                      </span>
                    )}
                  </div>
                  {/* Per-profile metrics */}
                  {pm.connectCount > 0 && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[10px] text-muted-foreground">
                      {pm.lastLatencyMs != null && <span>{pm.lastLatencyMs}ms</span>}
                      {pm.lastConnectedAt && <span>{fmtRelativeTime(pm.lastConnectedAt)}</span>}
                      {(pm.totalBytesUp > 0 || pm.totalBytesDown > 0) && (
                        <span>&uarr;{fmtBytes(pm.totalBytesUp)} &darr;{fmtBytes(pm.totalBytesDown)}</span>
                      )}
                      {pm.connectCount > 1 && (
                        <span>{pm.connectCount} {t("profiles.sessions")}</span>
                      )}
                      {pm.totalUptimeSecs > 0 && (
                        <span>{fmtDuration(pm.totalUptimeSecs)}</span>
                      )}
                      {pm.peakSpeedDownBps > 0 && (
                        <span>{t("profiles.peak")} &darr;{fmtSpeed(pm.peakSpeedDownBps)}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Action dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="ml-2 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onSelect={() => openEdit(p)}>
                      <Pencil size={14} className="mr-2" /> {t("profiles.edit")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleDuplicate(p)}>
                      <Copy size={14} className="mr-2" /> {t("profiles.duplicate")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => openShareDialog(p)}>
                      <Share2 size={14} className="mr-2" /> {t("profiles.share")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => confirmDelete(p)} className="text-destructive">
                      <Trash2 size={14} className="mr-2" /> {t("profiles.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Profile wizard */}
      <ProfileWizard
        open={wizardOpen}
        onOpenChange={(v) => { setWizardOpen(v); if (!v) { setEditInitial(undefined); setEditingId(null); setEditingCreatedAt(""); } }}
        initial={editInitial}
        onSave={handleSave}
      />

      {/* Share dialog */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("profiles.shareTitle", { name: shareName })}</DialogTitle>
          </DialogHeader>

          {/* Tab buttons */}
          <div className="flex gap-1 border-b pb-2">
            <Button
              size="sm"
              variant={shareTab === "toml" ? "default" : "ghost"}
              onClick={() => { setShareTab("toml"); setShareCopied(false); }}
            >
              <FileCode size={14} className="mr-1.5" /> {t("profiles.shareToml")}
            </Button>
            <Button
              size="sm"
              variant={shareTab === "uri" ? "default" : "ghost"}
              onClick={() => { setShareTab("uri"); setShareCopied(false); }}
            >
              <Link size={14} className="mr-1.5" /> {t("profiles.shareUri")}
            </Button>
            <Button
              size="sm"
              variant={shareTab === "qr" ? "default" : "ghost"}
              onClick={() => { setShareTab("qr"); setShareCopied(false); }}
            >
              <QrCode size={14} className="mr-1.5" /> {t("profiles.shareQr")}
            </Button>
          </div>

          {/* Content */}
          {shareTab === "toml" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t("profiles.shareTomlDesc")}</p>
              <Textarea
                readOnly
                rows={10}
                value={shareToml}
                className="font-mono text-xs"
                onFocus={(e) => e.target.select()}
              />
            </div>
          )}

          {shareTab === "uri" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t("profiles.shareUriDesc")}</p>
              <Textarea
                readOnly
                rows={3}
                value={shareUri}
                className="font-mono text-xs break-all"
                onFocus={(e) => e.target.select()}
              />
            </div>
          )}

          {shareTab === "qr" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t("profiles.shareQrDesc")}</p>
              {shareQrSvg ? <QrDisplay svg={shareQrSvg} /> : (
                <p className="text-xs text-muted-foreground text-center py-4">{t("common.loading")}</p>
              )}
            </div>
          )}

          {/* Copy button (for toml and uri tabs) */}
          {shareTab !== "qr" && (
            <DialogFooter>
              <Button onClick={handleCopyShare} disabled={shareTab === "toml" ? !shareToml : !shareUri}>
                {shareCopied ? <Check size={14} className="mr-1.5" /> : <Copy size={14} className="mr-1.5" />}
                {shareCopied ? t("profiles.copied") : t("profiles.copyToClipboard")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* QR import dialog */}
      <Dialog open={qrImportOpen} onOpenChange={(v) => { setQrImportOpen(v); setQrImportErr(""); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("profiles.importQrTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>{t("profiles.importQrLabel")}</Label>
            <Textarea
              rows={4}
              value={qrImportText}
              onChange={(e) => setQrImportText(e.target.value)}
              className="font-mono text-xs"
              placeholder="prisma://..."
            />
            {qrImportErr && <p className="text-xs text-destructive">{qrImportErr}</p>}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">{t("common.cancel")}</Button></DialogClose>
            <Button onClick={handleQrImport} disabled={!qrImportText.trim()}>{t("profiles.importQr")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Subscription import dialog */}
      <Dialog open={subImportOpen} onOpenChange={(v) => { setSubImportOpen(v); setSubErr(""); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("profiles.importSubTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t("profiles.importSubDesc")}</p>
            <Label>{t("profiles.importSubLabel")}</Label>
            <Input
              value={subUrl}
              onChange={(e) => setSubUrl(e.target.value)}
              placeholder={t("profiles.importSubPlaceholder")}
              className="font-mono text-xs"
            />
            {subErr && <p className="text-xs text-destructive">{subErr}</p>}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">{t("common.cancel")}</Button></DialogClose>
            <Button onClick={handleImportSubscription} disabled={!subUrl.trim() || subImporting}>
              {subImporting ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Globe size={14} className="mr-1.5" />}
              {subImporting ? t("profiles.importing") : t("profiles.importSub")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("profiles.deleteTitle")}
        message={t("profiles.deleteMessage", { name: deletePending?.name })}
        confirmLabel={t("profiles.delete")}
        onConfirm={handleDelete}
      />
    </div>
  );
}
