"use client";

import { useState, useMemo } from "react";
import { Route as RouteIcon, Search, List, LayoutGrid } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { useRoutes, useCreateRoute, useUpdateRoute, useDeleteRoute } from "@/hooks/use-routes";
import { RuleEditor, parseConditionType, parseAction } from "@/components/routing/rule-editor";
import { TemplateSelector } from "@/components/routing/template-selector";
import { RuleList } from "@/components/routing/rule-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SkeletonTable } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/loading-placeholder";
import type { RoutingRule } from "@/lib/types";

/** Test a domain/IP against the rule set and return the first matching rule. */
function testAgainstRules(query: string, rules: RoutingRule[]): RoutingRule | null {
  if (!query.trim()) return null;
  const sorted = [...rules].filter((r) => r.enabled).sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    const { type, match } = parseConditionType(rule.condition);
    const q = query.toLowerCase();
    const m = match.toLowerCase();

    switch (type) {
      case "DOMAIN":
        if (q === m) return rule;
        break;
      case "DOMAIN-SUFFIX":
        if (q === m || q.endsWith(`.${m}`)) return rule;
        break;
      case "DOMAIN-KEYWORD":
        if (q.includes(m)) return rule;
        break;
      case "IP-CIDR":
        // Simplified: exact prefix match
        if (q.startsWith(m.split("/")[0].replace(/\.\d+$/, ""))) return rule;
        break;
      case "GEOIP":
        // Cannot test GEOIP from client-side
        break;
      case "PORT-RANGE": {
        const port = parseInt(q, 10);
        if (!isNaN(port)) {
          const [a, b] = match.split("-").map(Number);
          if (port >= a && port <= b) return rule;
        }
        break;
      }
      case "FINAL":
        return rule;
    }
  }
  return null;
}

export default function RoutingPage() {
  const { t } = useI18n();
  const { toast } = useToast();

  const { data: routes, isLoading } = useRoutes();
  const createRoute = useCreateRoute();
  const updateRoute = useUpdateRoute();
  const deleteRoute = useDeleteRoute();

  const [editingRule, setEditingRule] = useState<RoutingRule | null>(null);
  const [testQuery, setTestQuery] = useState("");

  const testResult = useMemo(() => {
    if (!testQuery || !routes) return null;
    return testAgainstRules(testQuery, routes);
  }, [testQuery, routes]);

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
          key={editingRule?.id ?? "new"}
          onSubmit={editingRule ? handleEdit : handleCreate}
          isLoading={editingRule ? updateRoute.isPending : createRoute.isPending}
          editingRule={editingRule}
          onOpenChange={(open) => { if (!open) setEditingRule(null); }}
        />
      </div>

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">
            <List className="h-4 w-4" />
            {t("routing.manualRules")}
          </TabsTrigger>
          <TabsTrigger value="templates">
            <LayoutGrid className="h-4 w-4" />
            {t("routing.templates")}
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Manual Rules ── */}
        <TabsContent value="rules">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{t("routing.rules")}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {routes?.length ?? 0} {t("common.entries")}
                </span>
              </CardTitle>

              {/* Test Rule input */}
              <div className="relative mt-3">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9 font-mono text-xs"
                  placeholder={t("routing.testPlaceholder")}
                  value={testQuery}
                  onChange={(e) => setTestQuery(e.target.value)}
                />
              </div>

              {/* Test result */}
              {testQuery && (
                <div className="mt-2 rounded-md border px-3 py-2 text-sm">
                  {testResult ? (
                    <span className="text-green-600 dark:text-green-400">
                      {t("routing.testMatch", {
                        name: testResult.name,
                        action: parseAction(testResult.action),
                      })}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {t("routing.testNoMatch")}
                    </span>
                  )}
                </div>
              )}
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
        </TabsContent>

        {/* ── Tab 2: Quick Templates ── */}
        <TabsContent value="templates">
          <TemplateSelector />
        </TabsContent>
      </Tabs>
    </div>
  );
}
