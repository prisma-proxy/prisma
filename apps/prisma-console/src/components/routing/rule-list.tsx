"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n";
import type { RoutingRule } from "@/lib/types";

interface RuleListProps {
  rules: RoutingRule[];
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (rule: RoutingRule) => void;
}

function formatCondition(rule: RoutingRule): string {
  const { condition } = rule;
  switch (condition.type) {
    case "DomainMatch":
      return `DOMAIN: ${condition.value}`;
    case "DomainExact":
      return `DOMAIN-EXACT: ${condition.value}`;
    case "DomainSuffix":
      return `DOMAIN-SUFFIX: ${condition.value}`;
    case "DomainKeyword":
      return `DOMAIN-KEYWORD: ${condition.value}`;
    case "IpCidr":
      return `IP-CIDR: ${condition.value}`;
    case "GeoIp":
      return `GEOIP: ${condition.value}`;
    case "PortRange":
      return `PORT: ${condition.value[0]}-${condition.value[1]}`;
    case "All":
      return "FINAL (All traffic)";
  }
}

/** Colored badge styles matching prisma-gui for each action type. */
function actionBadge(action: string, t: (key: string) => string) {
  switch (action) {
    case "Allow":
      return (
        <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30">
          {t("routing.actionProxy")}
        </Badge>
      );
    case "Direct":
      return (
        <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30">
          {t("routing.actionDirect")}
        </Badge>
      );
    case "Block":
      return (
        <Badge className="bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30">
          {t("routing.actionBlock")}
        </Badge>
      );
    case "Reject":
      return (
        <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30">
          {t("routing.actionReject")}
        </Badge>
      );
    default:
      return (
        <Badge className="bg-muted text-muted-foreground">
          {action}
        </Badge>
      );
  }
}

/** Condition type badge for visual clarity. */
function conditionTypeBadge(type: string) {
  const colorMap: Record<string, string> = {
    DomainMatch: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
    DomainExact: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
    DomainSuffix: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
    DomainKeyword: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
    IpCidr: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
    GeoIp: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    PortRange: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
    All: "bg-muted text-muted-foreground",
  };
  const labelMap: Record<string, string> = {
    DomainMatch: "DOMAIN",
    DomainExact: "DOMAIN-EXACT",
    DomainSuffix: "DOMAIN-SUFFIX",
    DomainKeyword: "DOMAIN-KEYWORD",
    IpCidr: "IP-CIDR",
    GeoIp: "GEOIP",
    PortRange: "PORT",
    All: "FINAL",
  };
  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-mono ${colorMap[type] ?? ""}`}>
      {labelMap[type] ?? type}
    </Badge>
  );
}

export function RuleList({ rules, onDelete, onToggle, onEdit }: RuleListProps) {
  const { t } = useI18n();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);

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
      prev.size === rules.length
        ? new Set()
        : new Set(rules.map((r) => r.id))
    );
  }

  function handleBatchDelete() {
    selected.forEach((id) => onDelete(id));
    setSelected(new Set());
    setBatchConfirmOpen(false);
  }

  if (rules.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t("routing.noRules")}
      </p>
    );
  }

  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  const allSelected = selected.size === rules.length;

  return (
    <>
      {/* Select-all / batch action toolbar */}
      <div className="flex items-center gap-3 mb-2 px-1 min-h-[32px]">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleSelectAll}
          className="rounded"
          aria-label="Select all rules"
        />
        {selected.size > 0 ? (
          <>
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
          </>
        ) : (
          <span className="text-xs text-muted-foreground">Select all</span>
        )}
      </div>

      <div className="space-y-2">
        {sorted.map((rule) => (
          <div
            key={rule.id}
            className={`flex items-center gap-4 rounded-lg border px-4 py-3 ${selected.has(rule.id) ? "bg-muted/50" : ""}`}
          >
            <input
              type="checkbox"
              checked={selected.has(rule.id)}
              onChange={() => toggleSelect(rule.id)}
              className="rounded"
              aria-label={`Select rule ${rule.name}`}
            />
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold">
              {rule.priority}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium truncate">{rule.name}</p>
                {conditionTypeBadge(rule.condition.type)}
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {formatCondition(rule)}
              </p>
            </div>
            {actionBadge(rule.action, t)}
            <Switch
              checked={rule.enabled}
              onCheckedChange={(checked: boolean) => onToggle(rule.id, checked)}
              size="sm"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(rule)}
              aria-label={t("routing.editRule")}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteId(rule.id)}
            >
              {t("common.delete")}
            </Button>
          </div>
        ))}
      </div>

      {/* Single-item delete confirmation */}
      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title={t("common.delete")}
        description={t("routing.deleteConfirm")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="destructive"
        onConfirm={() => {
          if (deleteId) onDelete(deleteId);
          setDeleteId(null);
        }}
      />

      {/* Batch delete confirmation */}
      <ConfirmDialog
        open={batchConfirmOpen}
        onOpenChange={(open) => { if (!open) setBatchConfirmOpen(false); }}
        title={t("common.delete")}
        description={t("routing.deleteBatchConfirm", { count: selected.size })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="destructive"
        onConfirm={handleBatchDelete}
      />
    </>
  );
}
