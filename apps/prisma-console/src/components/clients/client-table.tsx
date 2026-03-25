"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { useI18n } from "@/lib/i18n";
import { formatBytes } from "@/lib/utils";
import { Trash2, Share2 } from "lucide-react";
import { ClientShareDialog } from "@/components/clients/client-share-dialog";
import type { ClientInfo, ClientMetricsEntry } from "@/lib/types";

interface ClientTableProps {
  clients: ClientInfo[];
  metrics?: ClientMetricsEntry[];
  onToggle: (id: string, enabled: boolean) => void;
  /** When undefined, delete buttons are hidden (role-based restriction). */
  onDelete?: (id: string) => void;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function ClientTable({ clients, metrics = [], onToggle, onDelete }: ClientTableProps) {
  const { t } = useI18n();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [shareClientId, setShareClientId] = useState<string | null>(null);
  const [shareClientName, setShareClientName] = useState("");

  const metricsMap = new Map(metrics.map((m) => [m.client_id, m]));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === clients.length
        ? new Set()
        : new Set(clients.map((c) => c.id))
    );
  }

  function handleBatchDelete() {
    if (onDelete) {
      selected.forEach((id) => onDelete(id));
    }
    setSelected(new Set());
    setBatchConfirmOpen(false);
  }

  if (clients.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t("clients.noClients")}
      </p>
    );
  }

  const allSelected = selected.size === clients.length;

  return (
    <>
      {onDelete && selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-1">
          <span className="text-sm text-muted-foreground">
            {t("common.selectedCount", { count: selected.size })}
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setBatchConfirmOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" data-icon="inline-start" />
            {t("common.deleteSelected", { count: selected.size })}
          </Button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {onDelete && (
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="rounded"
                  aria-label="Select all"
                />
              </TableHead>
            )}
            <TableHead>{t("clients.name")}</TableHead>
            <TableHead>{t("clients.status")}</TableHead>
            <TableHead>{t("clients.activeConns")}</TableHead>
            <TableHead>{t("clients.totalConns")}</TableHead>
            <TableHead>{t("clients.traffic")}</TableHead>
            <TableHead>{t("clients.lastSeen")}</TableHead>
            <TableHead className="text-right">{t("clients.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((client) => {
            const m = metricsMap.get(client.id);
            return (
              <TableRow key={client.id} data-state={selected.has(client.id) ? "selected" : undefined}>
                {onDelete && (
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selected.has(client.id)}
                      onChange={() => toggleSelect(client.id)}
                      className="rounded"
                      aria-label={`Select ${client.name ?? client.id}`}
                    />
                  </TableCell>
                )}
                <TableCell className="font-medium">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Link
                      href={`/dashboard/clients/detail/?id=${client.id}`}
                      className="hover:underline text-primary"
                    >
                      {client.name || t("clients.unnamed")}
                    </Link>
                    {client.tags?.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">
                        {tag}
                      </Badge>
                    ))}
                    <CopyButton
                      value={client.id}
                      className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                  </div>
                </TableCell>
                <TableCell>
                  {client.enabled ? (
                    <Badge className="bg-green-500/15 text-green-700 dark:text-green-400">
                      {t("clients.active")}
                    </Badge>
                  ) : (
                    <Badge className="bg-red-500/15 text-red-700 dark:text-red-400">
                      {t("clients.disabled")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {m ? (
                    <span className={m.active_connections > 0 ? "font-medium text-green-600 dark:text-green-400" : "text-muted-foreground"}>
                      {m.active_connections}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {m ? m.connection_count : "—"}
                </TableCell>
                <TableCell className="text-xs font-mono">
                  {m ? (
                    <span title={`↑ ${m.bytes_up.toLocaleString()} bytes  ↓ ${m.bytes_down.toLocaleString()} bytes`}>
                      <span className="text-muted-foreground">↑</span>{formatBytes(m.bytes_up)}{" "}
                      <span className="text-muted-foreground">↓</span>{formatBytes(m.bytes_down)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {m?.last_seen ? (
                    <span title={new Date(m.last_seen).toISOString()}>
                      {formatRelativeTime(m.last_seen)}
                    </span>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShareClientId(client.id);
                        setShareClientName(client.name || t("clients.unnamed"));
                      }}
                    >
                      <Share2 className="h-3.5 w-3.5" data-icon="inline-start" />
                      {t("clients.share")}
                    </Button>
                    <Switch
                      checked={client.enabled}
                      onCheckedChange={(checked: boolean) =>
                        onToggle(client.id, checked)
                      }
                      size="sm"
                    />
                    {onDelete && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleteId(client.id)}
                      >
                        {t("common.delete")}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Single-item delete confirmation */}
      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title={t("common.delete")}
        description={t("clients.deleteConfirm")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="destructive"
        onConfirm={() => {
          if (deleteId && onDelete) onDelete(deleteId);
          setDeleteId(null);
        }}
      />

      {/* Batch delete confirmation */}
      <ConfirmDialog
        open={batchConfirmOpen}
        onOpenChange={(open) => { if (!open) setBatchConfirmOpen(false); }}
        title={t("common.delete")}
        description={t("clients.deleteBatchConfirm", { count: selected.size })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="destructive"
        onConfirm={handleBatchDelete}
      />

      {/* Share dialog */}
      <ClientShareDialog
        open={shareClientId !== null}
        onOpenChange={(open) => { if (!open) setShareClientId(null); }}
        clientId={shareClientId ?? ""}
        clientName={shareClientName}
      />
    </>
  );
}
