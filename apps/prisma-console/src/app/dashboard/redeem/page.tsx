"use client";

import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SubscriptionInfo, RedeemResponse } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { SkeletonCard } from "@/components/ui/skeleton";
import { Ticket, CheckCircle2 } from "lucide-react";

export default function RedeemPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [code, setCode] = React.useState("");
  const [result, setResult] = React.useState<RedeemResponse | null>(null);

  // Subscription status
  const { data: subscriptions, isLoading: subsLoading } = useQuery({
    queryKey: ["subscription"],
    queryFn: api.getSubscription,
  });

  const redeemMutation = useMutation({
    mutationFn: (code: string) => api.redeemCode(code),
    onSuccess: (data) => {
      setResult(data);
      setCode("");
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast(t("redeem.redeemSuccess"), "success");
    },
    onError: (error: Error) => {
      let msg = t("redeem.redeemFailed");
      if (error.message.includes("Gone")) {
        msg = t("redeem.codeExpired");
      } else if (error.message.includes("Conflict")) {
        msg = t("redeem.maxRedeemed");
      } else if (error.message.includes("Not Found")) {
        msg = t("redeem.invalidCode");
      }
      toast(msg, "error");
    },
  });

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold tracking-tight">{t("redeem.title")}</h2>

      {/* Redeem form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Ticket className="h-4 w-4" />
            {t("redeem.enterCode")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={t("redeem.placeholder")}
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono tracking-wider ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.trim()) {
                  redeemMutation.mutate(code.trim());
                }
              }}
            />
            <Button
              onClick={() => redeemMutation.mutate(code.trim())}
              disabled={!code.trim() || redeemMutation.isPending}
            >
              {redeemMutation.isPending ? t("redeem.redeeming") : t("redeem.redeemButton")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Success result */}
      {result && (
        <Card className="border-green-500/50 bg-green-500/5">
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              {t("redeem.clientCreated")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("redeem.clientName")}</p>
                <p className="text-sm font-medium">{result.name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("redeem.clientId")}</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate font-mono">
                    {result.client_id}
                  </code>
                  <CopyButton value={result.client_id} />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("redeem.authSecret")}</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate font-mono">
                    {result.auth_secret_hex}
                  </code>
                  <CopyButton value={result.auth_secret_hex} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("redeem.saveCredentials")}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Subscription history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t("redeem.mySubscriptions")}</CardTitle>
        </CardHeader>
        <CardContent>
          {subsLoading ? (
            <SkeletonCard className="h-32" />
          ) : !subscriptions?.length ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {t("redeem.noSubscriptions")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">{t("redeem.code")}</th>
                    <th className="py-2 pr-4 font-medium">{t("redeem.clientIdShort")}</th>
                    <th className="py-2 pr-4 font-medium">{t("redeem.redeemed")}</th>
                    <th className="py-2 pr-4 font-medium">{t("subscriptions.bandwidth")}</th>
                    <th className="py-2 font-medium">{t("subscriptions.quota")}</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.map((sub: SubscriptionInfo, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{sub.code}</code>
                      </td>
                      <td className="py-2 pr-4">
                        <code className="text-xs font-mono">{sub.client_id.slice(0, 8)}...</code>
                      </td>
                      <td className="py-2 pr-4 text-xs">
                        {new Date(sub.redeemed_at).toLocaleDateString()}
                      </td>
                      <td className="py-2 pr-4 text-xs">
                        {sub.bandwidth_up || sub.bandwidth_down
                          ? `${sub.bandwidth_up || "-"} / ${sub.bandwidth_down || "-"}`
                          : t("subscriptions.unlimited")}
                      </td>
                      <td className="py-2 text-xs">{sub.quota || t("subscriptions.unlimited")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
