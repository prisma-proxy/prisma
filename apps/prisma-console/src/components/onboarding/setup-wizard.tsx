"use client";

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { useCreateClient } from "@/hooks/use-clients";
import { useCreateRoute } from "@/hooks/use-routes";
import { RULE_TEMPLATES, type RuleTemplate } from "@/lib/rule-templates";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RuleCondition } from "@/lib/types";

function buildCondition(conditionType: string, conditionValue: string): RuleCondition {
  switch (conditionType) {
    case "DomainMatch":
      return { type: "DomainMatch", value: conditionValue };
    case "DomainExact":
      return { type: "DomainExact", value: conditionValue };
    case "DomainSuffix":
      return { type: "DomainSuffix", value: conditionValue };
    case "DomainKeyword":
      return { type: "DomainKeyword", value: conditionValue };
    case "IpCidr":
      return { type: "IpCidr", value: conditionValue };
    case "GeoIp":
      return { type: "GeoIp", value: conditionValue };
    case "PortRange": {
      const parts = conditionValue.split("-").map(Number);
      return { type: "PortRange", value: [parts[0] || 0, parts[1] || 0] };
    }
    default:
      return { type: "All", value: null };
  }
}

interface SetupWizardProps {
  onDismiss: () => void;
}

type Step = "welcome" | "create-client" | "routing" | "done";

export function SetupWizard({ onDismiss }: SetupWizardProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createClient = useCreateClient();
  const createRoute = useCreateRoute();

  const [step, setStep] = useState<Step>("welcome");
  const [clientName, setClientName] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [createdClientId, setCreatedClientId] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState<string | null>(null);

  const dismiss = useCallback(() => {
    localStorage.setItem("prisma-setup-complete", "true");
    onDismiss();
  }, [onDismiss]);

  async function handleCreateClient(e: React.FormEvent) {
    e.preventDefault();
    try {
      const result = await createClient.mutateAsync(clientName || undefined);
      setCreatedClientId(result.id);
      setCreatedSecret(result.auth_secret_hex);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to create client";
      toast(message, "error");
    }
  }

  async function handleCopySecret() {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = createdSecret;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 2000);
    }
  }

  async function handleApplyTemplate(template: RuleTemplate) {
    setApplyingTemplate(template.id);
    let successCount = 0;
    try {
      for (const rule of template.rules) {
        await createRoute.mutateAsync({
          name: rule.name,
          priority: rule.priority,
          condition: buildCondition(rule.condition_type, rule.condition_value),
          action: rule.action as "Allow" | "Block" | "Direct" | "Reject",
          enabled: rule.enabled,
        });
        successCount++;
      }
      await queryClient.invalidateQueries({ queryKey: ["routes"] });
      toast(t("toast.templateApplied", { count: String(successCount) }), "success");
      setStep("done");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to apply template";
      toast(message, "error");
    } finally {
      setApplyingTemplate(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <Card className="w-full max-w-lg mx-4">
        {step === "welcome" && (
          <>
            <CardHeader className="text-center">
              <CardTitle className="text-xl">{t("onboarding.welcome")}</CardTitle>
              <CardDescription>{t("onboarding.welcomeDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Button onClick={() => setStep("create-client")}>
                {t("onboarding.getStarted")}
              </Button>
              <Button variant="ghost" onClick={dismiss}>
                {t("onboarding.skip")}
              </Button>
            </CardContent>
          </>
        )}

        {step === "create-client" && (
          <>
            <CardHeader>
              <CardTitle>{t("onboarding.createClient")}</CardTitle>
              <CardDescription>{t("onboarding.createClientDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!createdSecret ? (
                <form onSubmit={handleCreateClient} className="space-y-4">
                  <div className="grid gap-1.5">
                    <Label htmlFor="wizard-client-name">{t("onboarding.clientName")}</Label>
                    <Input
                      id="wizard-client-name"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder={t("onboarding.clientNamePlaceholder")}
                    />
                  </div>
                  <Button type="submit" disabled={createClient.isPending} className="w-full">
                    {createClient.isPending ? t("clients.creating") : t("onboarding.createBtn")}
                  </Button>
                </form>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 px-4 py-3 text-sm font-medium text-yellow-700 dark:text-yellow-400">
                    {t("onboarding.secretWarning")}
                  </div>
                  <div className="rounded-lg border p-4 space-y-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">{t("clients.clientId")}</p>
                      <p className="font-mono text-sm break-all">{createdClientId}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">{t("clients.authSecret")}</p>
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-sm break-all flex-1">{createdSecret}</p>
                        <Button variant="outline" size="sm" onClick={handleCopySecret}>
                          {secretCopied ? t("common.copied") : t("common.copy")}
                        </Button>
                      </div>
                    </div>
                  </div>
                  <Button onClick={() => setStep("routing")} className="w-full">
                    {t("onboarding.next")}
                  </Button>
                </div>
              )}
            </CardContent>
          </>
        )}

        {step === "routing" && (
          <>
            <CardHeader>
              <CardTitle>{t("onboarding.setupRouting")}</CardTitle>
              <CardDescription>{t("onboarding.setupRoutingDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                {RULE_TEMPLATES.map((template) => {
                  const Icon = template.icon;
                  const isApplying = applyingTemplate === template.id;

                  return (
                    <button
                      key={template.id}
                      type="button"
                      className="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted disabled:opacity-50"
                      disabled={applyingTemplate !== null}
                      onClick={() => handleApplyTemplate(template)}
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Icon className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{t(template.nameKey)}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {t(template.descKey)}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {isApplying
                          ? t("templates.applying")
                          : t("templates.rulesCount", { count: String(template.rules.length) })}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <Button onClick={() => setStep("done")} className="flex-1">
                  {t("onboarding.next")}
                </Button>
                <Button variant="ghost" onClick={() => setStep("done")}>
                  {t("onboarding.skip")}
                </Button>
              </div>
            </CardContent>
          </>
        )}

        {step === "done" && (
          <>
            <CardHeader className="text-center">
              <div className="flex justify-center mb-2">
                <CheckCircle2 className="h-12 w-12 text-green-500" />
              </div>
              <CardTitle className="text-xl">{t("onboarding.done")}</CardTitle>
              <CardDescription>{t("onboarding.doneDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={dismiss} className="w-full">
                {t("onboarding.goToDashboard")}
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
