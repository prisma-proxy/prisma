"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { useCreateRoute } from "@/hooks/use-routes";
import {
  RULE_TEMPLATES,
  TEMPLATE_CATEGORY_ORDER,
  TEMPLATE_CATEGORY_KEYS,
  type RuleTemplate,
} from "@/lib/rule-templates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { RuleCondition } from "@/lib/types";

/**
 * Map template condition types to the backend's RuleCondition enum.
 * Backend only supports: DomainMatch, DomainExact, IpCidr, PortRange, All.
 * Frontend-friendly types are converted:
 *   DomainSuffix  → DomainMatch("*.value")
 *   DomainKeyword → DomainMatch("*value*")
 *   GeoIp         → IpCidr("geoip:value")
 */
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
    case "All":
      return { type: "All", value: null };
    default:
      return { type: "DomainMatch", value: conditionValue };
  }
}

/** Map template action to backend's RuleAction (Allow | Direct | Block). */
function mapAction(action: string): "Allow" | "Direct" | "Block" {
  switch (action) {
    case "Direct": return "Direct";
    case "Reject": return "Block";
    case "Block": return "Block";
    default: return "Allow";
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
        await createRoute.mutateAsync({
          name: rule.name,
          priority: rule.priority,
          condition: buildCondition(rule.condition_type, rule.condition_value),
          action: mapAction(rule.action),
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

  // Group templates by category
  const templatesByCategory = new Map<string, RuleTemplate[]>();
  for (const tmpl of RULE_TEMPLATES) {
    const list = templatesByCategory.get(tmpl.category) ?? [];
    list.push(tmpl);
    templatesByCategory.set(tmpl.category, list);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("templates.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {TEMPLATE_CATEGORY_ORDER.map((category) => {
          const templates = templatesByCategory.get(category);
          if (!templates || templates.length === 0) return null;

          return (
            <div key={category}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {t(TEMPLATE_CATEGORY_KEYS[category])}
              </h3>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {templates.map((template) => {
                  const Icon = template.icon;
                  const isApplying = applyingId === template.id;

                  return (
                    <div
                      key={template.id}
                      className="flex min-w-[200px] max-w-[240px] flex-col gap-2.5 rounded-lg border p-3.5"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{t(template.nameKey)}</p>
                          <p className="text-[10px] text-muted-foreground">
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
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
