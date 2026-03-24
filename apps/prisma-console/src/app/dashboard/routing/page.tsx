"use client";

import { useState } from "react";
import { Route as RouteIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { useRoutes, useCreateRoute, useUpdateRoute, useDeleteRoute } from "@/hooks/use-routes";
import { RuleList } from "@/components/routing/rule-list";
import { RuleEditor } from "@/components/routing/rule-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonTable } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/loading-placeholder";
import type { RoutingRule } from "@/lib/types";

export default function RoutingPage() {
  const { t } = useI18n();
  const { toast } = useToast();

  const { data: routes, isLoading } = useRoutes();
  const createRoute = useCreateRoute();
  const updateRoute = useUpdateRoute();
  const deleteRoute = useDeleteRoute();

  const [editingRule, setEditingRule] = useState<RoutingRule | null>(null);

  function handleToggle(id: string, enabled: boolean) {
    const rule = routes?.find((r) => r.id === id);
    if (!rule) return;
    const { name, priority, condition, action } = rule;
    updateRoute.mutate(
      { id, data: { name, priority, condition, action, enabled } },
      {
        onSuccess: () => toast(t("toast.ruleSaved"), "success"),
        onError: (error: Error) => toast(error.message, "error"),
      }
    );
  }

  async function handleCreate(rule: Omit<RoutingRule, "id">) {
    await createRoute.mutateAsync(rule);
    toast(t("toast.ruleCreated"), "success");
  }

  async function handleEdit(rule: Omit<RoutingRule, "id">) {
    if (!editingRule) return;
    await updateRoute.mutateAsync({ id: editingRule.id, data: rule });
    toast(t("toast.ruleSaved"), "success");
  }

  function handleDelete(id: string) {
    deleteRoute.mutate(id, {
      onSuccess: () => toast(t("toast.ruleDeleted"), "success"),
      onError: (error: Error) => toast(error.message, "error"),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("routing.routingRules")}</h2>
        <RuleEditor
          onSubmit={editingRule ? handleEdit : handleCreate}
          isLoading={editingRule ? updateRoute.isPending : createRoute.isPending}
          editingRule={editingRule}
          onOpenChange={(open) => { if (!open) setEditingRule(null); }}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("routing.rules")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <SkeletonTable rows={4} />
          ) : (routes?.length ?? 0) === 0 ? (
            <EmptyState
              icon={RouteIcon}
              title={t("empty.noRules")}
              description={t("empty.noRulesHint")}
            />
          ) : (
            <RuleList
              rules={routes ?? []}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onEdit={(rule) => setEditingRule(rule)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
