import { useEffect, useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Globe,
  Plus,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useStore } from "@/store";
import { notify } from "@/store/notifications";
import { api } from "@/lib/commands";
import { fmtRelativeTime } from "@/lib/format";
import type { Profile, SubscriptionInfo } from "@/lib/types";

export default function Subscriptions() {
  const { t } = useTranslation();
  const profiles = useStore((s) => s.profiles);
  const setProfiles = useStore((s) => s.setProfiles);

  const [addOpen, setAddOpen] = useState(false);
  const [subUrl, setSubUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState("");
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshingUrl, setRefreshingUrl] = useState<string | null>(null);
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePendingUrl, setDeletePendingUrl] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editUrl, setEditUrl] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editInterval, setEditInterval] = useState(24);
  const [subMeta, setSubMeta] = useState<Record<string, { name: string; intervalHours: number }>>({});

  const reload = useCallback(
    () =>
      api
        .listProfiles()
        .then(setProfiles)
        .catch(() => notify.error(t("profiles.failedToLoad"))),
    [setProfiles, t]
  );

  useEffect(() => {
    reload();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Group profiles by subscription URL
  const subscriptions = useMemo<SubscriptionInfo[]>(() => {
    const map = new Map<string, Profile[]>();
    for (const p of profiles) {
      if (p.subscription_url) {
        const existing = map.get(p.subscription_url) ?? [];
        existing.push(p);
        map.set(p.subscription_url, existing);
      }
    }

    return Array.from(map.entries()).map(([url, profs]) => ({
      url,
      profileCount: profs.length,
      lastUpdated: profs.reduce((latest, p) => {
        if (p.last_updated && (!latest || p.last_updated > latest))
          return p.last_updated;
        return latest;
      }, null as string | null),
      profiles: profs,
    }));
  }, [profiles]);

  const toggleExpanded = (url: string) => {
    setExpandedSubs((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  async function handleAddSubscription() {
    if (!subUrl.trim()) return;
    setImporting(true);
    setImportErr("");
    try {
      const result = await api.importSubscription(subUrl.trim());
      await reload();
      await api.refreshTrayProfiles().catch(() => {});
      setAddOpen(false);
      setSubUrl("");
      notify.success(
        t("subscriptions.importSuccess", { count: result.count })
      );
    } catch (e) {
      setImportErr(String(e));
    } finally {
      setImporting(false);
    }
  }

  async function handleRefreshAll() {
    setRefreshingAll(true);
    try {
      const result = await api.refreshSubscriptions();
      await reload();
      await api.refreshTrayProfiles().catch(() => {});
      notify.success(
        t("subscriptions.refreshSuccess", { count: result.count })
      );
    } catch (e) {
      notify.error(
        t("subscriptions.refreshFailed") + ": " + String(e)
      );
    } finally {
      setRefreshingAll(false);
    }
  }

  async function handleRefreshOne(url: string) {
    setRefreshingUrl(url);
    try {
      const result = await api.importSubscription(url);
      await reload();
      await api.refreshTrayProfiles().catch(() => {});
      notify.success(
        t("subscriptions.refreshSuccess", { count: result.count })
      );
    } catch (e) {
      notify.error(String(e));
    } finally {
      setRefreshingUrl(null);
    }
  }

  function confirmDeleteSubscription(url: string) {
    setDeletePendingUrl(url);
    setDeleteOpen(true);
  }

  async function handleDeleteSubscription() {
    if (!deletePendingUrl) return;
    const toDelete = profiles.filter(
      (p) => p.subscription_url === deletePendingUrl
    );
    try {
      await Promise.all(
        toDelete.map((p) => api.deleteProfile(p.id).catch(() => {}))
      );
      await reload();
      await api.refreshTrayProfiles().catch(() => {});
      notify.success(
        t("subscriptions.deleted", { count: toDelete.length })
      );
    } catch (e) {
      notify.error(String(e));
    } finally {
      setDeletePendingUrl(null);
    }
  }

  function openEditDialog(url: string) {
    const meta = subMeta[url];
    setEditUrl(url);
    setEditName(meta?.name ?? url.replace(/^https?:\/\//, "").split("/")[0]);
    setEditInterval(meta?.intervalHours ?? 24);
    setEditOpen(true);
  }

  function handleSaveEdit() {
    if (!editUrl) return;
    setSubMeta((prev) => ({
      ...prev,
      [editUrl]: { name: editName, intervalHours: editInterval },
    }));
    setEditOpen(false);
    notify.success(t("subscriptions.editSaved"));
  }

  return (
    <div className="p-4 sm:p-6 flex flex-col h-full gap-3">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-lg">{t("subscriptions.title")}</h1>
        <div className="flex gap-1">
          {subscriptions.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRefreshAll}
              disabled={refreshingAll}
              title={t("subscriptions.refreshAll")}
            >
              {refreshingAll ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
            </Button>
          )}
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> {t("subscriptions.add")}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2">
        <Card>
          <CardContent className="py-2 px-3 text-center">
            <p className="text-lg font-bold">{subscriptions.length}</p>
            <p className="text-[10px] text-muted-foreground">
              {t("subscriptions.totalSubs")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-2 px-3 text-center">
            <p className="text-lg font-bold">
              {subscriptions.reduce((s, sub) => s + sub.profileCount, 0)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {t("subscriptions.totalServers")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-2 px-3 text-center">
            <p className="text-lg font-bold text-green-400">
              {profiles.filter((p) => !p.subscription_url).length}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {t("subscriptions.manualProfiles")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Subscription list */}
      <ScrollArea className="flex-1 h-0">
        <div className="space-y-2 pr-2">
          {subscriptions.length === 0 && (
            <div className="text-center py-12">
              <Globe
                size={40}
                className="mx-auto text-muted-foreground mb-3 opacity-50"
              />
              <p className="text-sm text-muted-foreground">
                {t("subscriptions.noSubscriptions")}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("subscriptions.noSubscriptionsDesc")}
              </p>
            </div>
          )}

          {subscriptions.map((sub) => {
            const isExpanded = expandedSubs.has(sub.url);
            const isRefreshing = refreshingUrl === sub.url;

            return (
              <Card key={sub.url} className="overflow-hidden">
                <div
                  className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => toggleExpanded(sub.url)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isExpanded ? (
                      <ChevronDown size={14} className="shrink-0" />
                    ) : (
                      <ChevronRight size={14} className="shrink-0" />
                    )}
                    <Globe size={14} className="shrink-0 text-blue-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate font-mono">
                        {subMeta[sub.url]?.name ?? sub.url.replace(/^https?:\/\//, "").split("/")[0]}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0"
                        >
                          {sub.profileCount}{" "}
                          {t("subscriptions.servers")}
                        </Badge>
                        {sub.lastUpdated && (
                          <span className="text-[10px] text-muted-foreground">
                            {t("subscriptions.updated", {
                              time: fmtRelativeTime(sub.lastUpdated),
                            })}
                          </span>
                        )}
                        {subMeta[sub.url]?.intervalHours && (
                          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                            <Clock size={10} />
                            {t("subscriptions.autoUpdateInterval", { hours: subMeta[sub.url].intervalHours })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div
                    className="flex gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => openEditDialog(sub.url)}
                      title={t("subscriptions.edit")}
                    >
                      <Pencil size={12} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={isRefreshing}
                      onClick={() => handleRefreshOne(sub.url)}
                      title={t("subscriptions.refresh")}
                    >
                      {isRefreshing ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <RefreshCw size={12} />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      onClick={() => confirmDeleteSubscription(sub.url)}
                      title={t("subscriptions.delete")}
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>

                {/* Expanded server list */}
                {isExpanded && (
                  <div className="border-t">
                    <div className="px-4 py-1 text-[10px] text-muted-foreground font-mono truncate bg-muted/30">
                      {sub.url}
                    </div>
                    <div className="divide-y">
                      {sub.profiles.map((p) => {
                        const config = p.config as Record<string, unknown>;
                        const addr =
                          typeof config.server_addr === "string"
                            ? config.server_addr
                            : "unknown";
                        return (
                          <div
                            key={p.id}
                            className="flex items-center justify-between px-4 py-2 text-sm"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate">{p.name}</p>
                              <p className="text-[10px] text-muted-foreground font-mono truncate">
                                {addr}
                              </p>
                            </div>
                            <div className="flex gap-1">
                              {p.tags.map((tag) => (
                                <Badge
                                  key={tag}
                                  variant="outline"
                                  className="text-[10px] px-1 py-0"
                                >
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </ScrollArea>

      {/* Add subscription dialog */}
      <Dialog
        open={addOpen}
        onOpenChange={(v) => {
          setAddOpen(v);
          setImportErr("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("subscriptions.addTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t("subscriptions.addDesc")}
            </p>
            <Label>{t("subscriptions.urlLabel")}</Label>
            <Input
              value={subUrl}
              onChange={(e) => setSubUrl(e.target.value)}
              placeholder={t("subscriptions.urlPlaceholder")}
              className="font-mono text-xs"
            />
            {importErr && (
              <p className="text-xs text-destructive">{importErr}</p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t("common.cancel")}</Button>
            </DialogClose>
            <Button
              onClick={handleAddSubscription}
              disabled={!subUrl.trim() || importing}
            >
              {importing ? (
                <Loader2 size={14} className="mr-1.5 animate-spin" />
              ) : (
                <Globe size={14} className="mr-1.5" />
              )}
              {importing
                ? t("subscriptions.importing")
                : t("subscriptions.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit subscription dialog */}
      <Dialog
        open={editOpen}
        onOpenChange={setEditOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("subscriptions.editTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("subscriptions.editName")}</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={t("subscriptions.editNamePlaceholder")}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("subscriptions.editInterval")}</Label>
              <Input
                type="number"
                min={0}
                max={720}
                value={editInterval}
                onChange={(e) => setEditInterval(parseInt(e.target.value, 10) || 0)}
              />
              <p className="text-xs text-muted-foreground">{t("subscriptions.editIntervalHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t("common.cancel")}</Button>
            </DialogClose>
            <Button onClick={handleSaveEdit}>
              {t("subscriptions.editSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("subscriptions.deleteTitle")}
        message={t("subscriptions.deleteMessage")}
        confirmLabel={t("subscriptions.deleteConfirm")}
        onConfirm={handleDeleteSubscription}
      />
    </div>
  );
}
