"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { useCreateRoute } from "@/hooks/use-routes";
import { RULE_TEMPLATES, type RuleTemplate } from "@/lib/rule-templates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { RuleCondition } from "@/lib/types";

function buildCondition(conditionType: string, conditionValue: string): RuleCondition {
  switch (conditionType) {
    case "DomainMatch":
      return { type: "DomainMatch", value: conditionValue };
    case "DomainExact":
      return { type: "DomainExact", value: conditionValue };
    case "DomainSuffix":
      return { type: "DomainMatch", value: `*.${conditionValue}` };
    case "DomainKeyword":
      return { type: "DomainMatch", value: `*${conditionValue}*` };
    case "IpCidr":
      return { type: "IpCidr", value: conditionValue };
    case "GeoIp":
      return { type: "IpCidr", value: `geoip:${conditionValue}` };
    case "PortRange": {
      const parts = conditionValue.split("-").map(Number);
      return { type: "PortRange", value: [parts[0] || 0, parts[1] || 0] };
    }
    default:
      return { type: "All", value: null };
  }
}

export function TemplateSelector() {
  const { t } = useI18n();
  const { toast } = useToast();
  const createRoute = useCreateRoute();
  const queryClient = useQueryClient();
  const [applyingId, setApplyingId] = useState<string | null>(null);

  async function handleApply(template: RuleTemplate) {
    setApplyingId(template.id);
    let successCount = 0;

    try {
      for (const rule of template.rules) {
        const action = rule.action === "Direct" ? "Allow"
          : rule.action === "Reject" ? "Block"
          : rule.action as "Allow" | "Block";
        await createRoute.mutateAsync({
          name: rule.name,
          priority: rule.priority,
          condition: buildCondition(rule.condition_type, rule.condition_value),
          action,
          enabled: rule.enabled,
        });
        successCount++;
      }
      await queryClient.invalidateQueries({ queryKey: ["routes"] });
      toast(t("toast.templateApplied", { count: String(successCount) }), "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to apply template";
      toast(message, "error");
    } finally {
      setApplyingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("templates.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {RULE_TEMPLATES.map((template) => {
            const Icon = template.icon;
            const isApplying = applyingId === template.id;

            return (
              <div
                key={template.id}
                className="flex min-w-[220px] flex-col gap-3 rounded-lg border p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{t(template.nameKey)}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("templates.rulesCount", { count: String(template.rules.length) })}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {t(template.descKey)}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-auto"
                  disabled={applyingId !== null}
                  onClick={() => handleApply(template)}
                >
                  {isApplying ? t("templates.applying") : t("templates.apply")}
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
