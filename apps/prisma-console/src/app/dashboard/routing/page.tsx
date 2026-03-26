"use client";

import { useState, useEffect, useRef } from "react";
import { Route as RouteIcon, Search, List, LayoutGrid, Download } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useRoutes, useCreateRoute, useUpdateRoute, useDeleteRoute } from "@/hooks/use-routes";
import { RuleEditor } from "@/components/routing/rule-editor";
import { TemplateSelector } from "@/components/routing/template-selector";
import { RuleList } from "@/components/routing/rule-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  const [downloadingGeoSite, setDownloadingGeoSite] = useState(false);
  const [testQuery, setTestQuery] = useState("");
  const [testResult, setTestResult] = useState<{
    matched: boolean;
    rule_name: string | null;
    action: string | null;
    condition_type: string | null;
  } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounced backend test
  useEffect(() => {
    if (!testQuery.trim()) {
      setTestResult(null);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.testRoute(testQuery.trim());
        setTestResult(res);
      } catch {
        setTestResult(null);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [testQuery]);

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

  async function handleDownloadGeoSite() {
    setDownloadingGeoSite(true);
    try {
      await api.downloadGeoSite();
      await api.reloadConfig().catch(() => {});
      toast(t("routing.geositeDownloadSuccess"), "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setDownloadingGeoSite(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("routing.routingRules")}</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadGeoSite}
            disabled={downloadingGeoSite}
          >
            <Download className="h-4 w-4" />
            {downloadingGeoSite ? t("routing.downloading") : t("routing.downloadGeoSite")}
          </Button>
        <RuleEditor
          key={editingRule?.id ?? "new"}
          onSubmit={editingRule ? handleEdit : handleCreate}
          isLoading={editingRule ? updateRoute.isPending : createRoute.isPending}
          editingRule={editingRule}
          onOpenChange={(open) => { if (!open) setEditingRule(null); }}
        />
        </div>
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
              {testQuery && testResult && (
                <div className="mt-2 flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  {testResult.matched ? (
                    <>
                      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                        testResult.action === "REJECT"
                          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          : testResult.action === "DIRECT"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                            : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      }`}>
                        {testResult.action}
                      </span>
                      <span className="text-foreground">
                        {testResult.rule_name}
                      </span>
                      {testResult.condition_type && (
                        <span className="text-xs text-muted-foreground">
                          ({testResult.condition_type})
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
                        NO MATCH
                      </span>
                      <span className="text-muted-foreground">
                        {t("routing.testNoMatch")}
                      </span>
                    </>
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
