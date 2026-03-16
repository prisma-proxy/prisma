import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Plus, ScanLine, MoreHorizontal, Pencil, Copy, QrCode, Trash2, Download, Upload, Search, Share2 } from "lucide-react";
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
import QrDisplay from "@/components/QrDisplay";
import ConfirmDialog from "@/components/ConfirmDialog";
import ProfileWizard from "@/components/ProfileWizard";
import { useStore } from "@/store";
import { useProfileMetrics } from "@/store/profileMetrics";
import { useConnection } from "@/hooks/useConnection";
import { notify } from "@/store/notifications";
import { api } from "@/lib/commands";
import { fmtBytes, fmtRelativeTime } from "@/lib/format";
import { parseProfileToWizard } from "@/lib/buildConfig";
import type { WizardState } from "@/lib/buildConfig";
import type { Profile } from "@/lib/types";

export default function Profiles() {
  const { t } = useTranslation();
  const profiles = useStore((s) => s.profiles);
  const setProfiles = useStore((s) => s.setProfiles);
  const connected = useStore((s) => s.connected);
  const connecting = useStore((s) => s.connecting);
  const activeProfileIdx = useStore((s) => s.activeProfileIdx);
  const proxyModes = useStore((s) => s.proxyModes);
  const metricsStore = useProfileMetrics();
  const { connectTo, disconnect, switchTo } = useConnection();

  // Wizard
  const [wizardOpen,   setWizardOpen]   = useState(false);
  const [editInitial,  setEditInitial]  = useState<WizardState | undefined>();
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [editingCreatedAt, setEditingCreatedAt] = useState<string>("");

  // QR export
  const [qrOpen, setQrOpen] = useState(false);
  const [qrSvg,  setQrSvg]  = useState("");

  // QR import
  const [qrImportOpen, setQrImportOpen] = useState(false);
  const [qrImportText, setQrImportText] = useState("");
  const [qrImportErr,  setQrImportErr]  = useState("");

  // Delete confirm
  const [deleteOpen,    setDeleteOpen]    = useState(false);
  const [deletePending, setDeletePending] = useState<Profile | null>(null);

  // Search
  const [search, setSearch] = useState("");

  const reload = () =>
    api.listProfiles()
      .then(setProfiles)
      .catch(() => notify.error(t("profiles.failedToLoad")));

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredProfiles = useMemo(() => {
    if (!search.trim()) return profiles;
    const q = search.toLowerCase();
    return profiles.filter(
      (p) => p.name.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [profiles, search]);

  const activeProfile = activeProfileIdx !== null ? profiles[activeProfileIdx] : null;

  function handleProfileClick(p: Profile) {
    if (connecting) return;
    if (connected && activeProfile?.id === p.id) {
      disconnect();
    } else if (connected) {
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

  async function handleQr(p: Profile) {
    try {
      const svg = await api.profileToQr(JSON.stringify(p));
      setQrSvg(svg);
      setQrOpen(true);
    } catch (e) {
      notify.error(String(e));
    }
  }

  async function handleShare(p: Profile) {
    try {
      const shareData = JSON.stringify({ name: p.name, tags: p.tags, config: p.config }, null, 2);
      await navigator.clipboard.writeText(shareData);
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
      const blob = new Blob([JSON.stringify(profiles, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `prisma-profiles-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify.error(t("profiles.exportFailed"));
    }
  }

  function handleImportFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const arr = JSON.parse(text);
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
        notify.error(t("profiles.importFailed") + ": " + String(e));
      }
    };
    input.click();
  }

  return (
    <div className="p-4 sm:p-6 flex flex-col h-full gap-3">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-lg">{t("profiles.title")}</h1>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={handleExportAll} title={t("profiles.exportAll")}>
            <Download size={14} />
          </Button>
          <Button size="sm" variant="ghost" onClick={handleImportFile} title={t("profiles.importFile")}>
            <Upload size={14} />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setQrImportOpen(true)}>
            <ScanLine size={14} /> {t("profiles.importQr")}
          </Button>
          <Button size="sm" onClick={openAdd}>
            <Plus /> {t("profiles.add")}
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("profiles.search")}
          className="pl-8 h-8 text-sm"
        />
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
            const metrics = metricsStore.getMetrics(p.id);

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
                  </div>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {p.tags.length > 0
                      ? p.tags.map((tag) => <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">{tag}</Badge>)
                      : <span className="text-xs text-muted-foreground">—</span>
                    }
                  </div>
                  {/* Per-profile metrics */}
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                    {metrics.lastLatencyMs != null && <span>{metrics.lastLatencyMs}ms</span>}
                    {metrics.lastConnectedAt && <span>{fmtRelativeTime(metrics.lastConnectedAt)}</span>}
                    {(metrics.totalBytesUp > 0 || metrics.totalBytesDown > 0) && (
                      <span>↑{fmtBytes(metrics.totalBytesUp)} ↓{fmtBytes(metrics.totalBytesDown)}</span>
                    )}
                  </div>
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
                    <DropdownMenuItem onSelect={() => handleShare(p)}>
                      <Share2 size={14} className="mr-2" /> {t("profiles.share")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleQr(p)}>
                      <QrCode size={14} className="mr-2" /> {t("profiles.qrCode")}
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

      {/* QR export dialog */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>{t("profiles.qrCode")}</DialogTitle></DialogHeader>
          {qrSvg && <QrDisplay svg={qrSvg} />}
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
              placeholder="prisma://…"
            />
            {qrImportErr && <p className="text-xs text-destructive">{qrImportErr}</p>}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">{t("common.cancel")}</Button></DialogClose>
            <Button onClick={handleQrImport} disabled={!qrImportText.trim()}>{t("profiles.importQr")}</Button>
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
