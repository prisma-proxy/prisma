"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { AclRule } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Trash2, Plus, ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/loading-placeholder";

interface ClientAclEditorProps {
  clientId: string;
}

export function ClientAclEditor({ clientId }: ClientAclEditorProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const { data: rules, isLoading, error } = useQuery({
    queryKey: ["acls", clientId],
    queryFn: () => api.getClientAcls(clientId),
  });

  const updateMutation = useMutation({
    mutationFn: (newRules: AclRule[]) =>
      api.updateClientAcls(clientId, newRules),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acls", clientId] });
    },
  });

  const [localRules, setLocalRules] = useState<AclRule[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [newDestination, setNewDestination] = useState("");
  const [newPorts, setNewPorts] = useState("");
  const [newAction, setNewAction] = useState<"allow" | "deny">("allow");

  // Use local rules if user has made edits, otherwise use server data
  const displayRules = localRules ?? rules ?? [];

  function handleAddRule() {
    if (!newDestination.trim()) return;
    const rule: AclRule = {
      destination: newDestination.trim(),
      ports: newPorts.trim(),
      action: newAction,
    };
    const updated = [...displayRules, rule];
    setLocalRules(updated);
    setNewDestination("");
    setNewPorts("");
    setNewAction("allow");
    setShowForm(false);
  }

  function handleDeleteRule(index: number) {
    const updated = displayRules.filter((_, i) => i !== index);
    setLocalRules(updated);
  }

  function handleSave() {
    updateMutation.mutate(displayRules, {
      onSuccess: () => setLocalRules(null),
    });
  }

  const hasChanges = localRules !== null;

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive">
        {t("common.error")}: {(error as Error).message}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {displayRules.length === 0 && !showForm ? (
        <EmptyState
          icon={ShieldCheck}
          title={t("acl.noRules")}
          description={t("empty.noAclRulesHint")}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("acl.destination")}</TableHead>
              <TableHead>{t("acl.ports")}</TableHead>
              <TableHead>{t("acl.action")}</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayRules.map((rule, i) => (
              <TableRow key={`${rule.destination}-${rule.ports}-${i}`}>
                <TableCell className="font-mono text-xs">
                  {rule.destination}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {rule.ports || "*"}
                </TableCell>
                <TableCell>
                  <span
                    className={
                      rule.action === "allow"
                        ? "text-green-700 dark:text-green-400"
                        : "text-red-700 dark:text-red-400"
                    }
                  >
                    {rule.action === "allow" ? t("acl.allow") : t("acl.deny")}
                  </span>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteRule(i)}
                    aria-label={t("common.delete")}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {showForm && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3 bg-muted/30">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {t("acl.destination")}
            </label>
            <Input
              value={newDestination}
              onChange={(e) => setNewDestination(e.target.value)}
              placeholder={t("acl.destinationPlaceholder")}
              className="w-52"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {t("acl.ports")}
            </label>
            <Input
              value={newPorts}
              onChange={(e) => setNewPorts(e.target.value)}
              placeholder={t("acl.portsPlaceholder")}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              {t("acl.action")}
            </label>
            <Select
              value={newAction}
              onValueChange={(v) => v && setNewAction(v as "allow" | "deny")}
            >
              <SelectTrigger className="w-[100px]">
                <span className="flex flex-1 text-left">
                  {newAction === "allow" ? t("acl.allow") : t("acl.deny")}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="allow">{t("acl.allow")}</SelectItem>
                <SelectItem value="deny">{t("acl.deny")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAddRule} disabled={!newDestination.trim()}>
              {t("acl.addRule")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowForm(false)}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        {!showForm && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowForm(true)}
          >
            <Plus className="h-4 w-4" data-icon="inline-start" />
            {t("acl.addRule")}
          </Button>
        )}
        {hasChanges && (
          <Button
            size="sm"
            onClick={handleSave}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? t("acl.saving") : t("acl.save")}
          </Button>
        )}
      </div>
    </div>
  );
}
