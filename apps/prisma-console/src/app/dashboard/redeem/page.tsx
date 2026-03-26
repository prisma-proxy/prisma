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
      toast("Code redeemed successfully!", "success");
    },
    onError: (error: Error) => {
      let msg = "Redemption failed";
      if (error.message.includes("Gone")) {
        msg = "Code expired or fully used";
      } else if (error.message.includes("Conflict")) {
        msg = "You have already redeemed the maximum clients for this code";
      } else if (error.message.includes("Not Found")) {
        msg = "Invalid code";
      }
      toast(msg, "error");
    },
  });

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold tracking-tight">Redeem Code</h2>

      {/* Redeem form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Ticket className="h-4 w-4" />
            Enter Redemption Code
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="PRISMA-XXXX-XXXX-XXXX"
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
              {redeemMutation.isPending ? "Redeeming..." : "Redeem"}
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
              Client Created Successfully
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Client Name</p>
                <p className="text-sm font-medium">{result.name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Client ID</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate font-mono">
                    {result.client_id}
                  </code>
                  <CopyButton value={result.client_id} />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Auth Secret</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate font-mono">
                    {result.auth_secret_hex}
                  </code>
                  <CopyButton value={result.auth_secret_hex} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Save these credentials. You can also find this client in the Clients page.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Subscription history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">My Subscriptions</CardTitle>
        </CardHeader>
        <CardContent>
          {subsLoading ? (
            <SkeletonCard className="h-32" />
          ) : !subscriptions?.length ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No subscriptions yet. Redeem a code to get started.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Code</th>
                    <th className="py-2 pr-4 font-medium">Client ID</th>
                    <th className="py-2 pr-4 font-medium">Redeemed</th>
                    <th className="py-2 pr-4 font-medium">Bandwidth</th>
                    <th className="py-2 font-medium">Quota</th>
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
                          : "Unlimited"}
                      </td>
                      <td className="py-2 text-xs">{sub.quota || "Unlimited"}</td>
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
