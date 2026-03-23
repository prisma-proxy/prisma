"use client";

import { Route as RouteIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useRoutes, useCreateRoute, useUpdateRoute, useDeleteRoute } from "@/hooks/use-routes";
import { RuleList } from "@/components/routing/rule-list";
import { RuleEditor } from "@/components/routing/rule-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonTable } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/loading-placeholder";

export default function RoutingPage() {
  const { t } = useI18n();

  const { data: routes, isLoading } = useRoutes();
  const createRoute = useCreateRoute();
  const updateRoute = useUpdateRoute();
  const deleteRoute = useDeleteRoute();

  function handleToggle(id: string, enabled: boolean) {
    const rule = routes?.find((r) => r.id === id);
    if (!rule) return;
    const { name, priority, condition, action } = rule;
    updateRoute.mutate({ id, data: { name, priority, condition, action, enabled } });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("routing.routingRules")}</h2>
        <RuleEditor
          onSubmit={async (rule) => { await createRoute.mutateAsync(rule); }}
          isLoading={createRoute.isPending}
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
              onDelete={(id) => deleteRoute.mutate(id)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
