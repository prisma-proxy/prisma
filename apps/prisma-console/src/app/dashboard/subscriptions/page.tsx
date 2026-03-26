"use client";

import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { RedemptionCode, InviteInfo, SubscriptionPlan, CreateCodeRequest, CreateInviteRequest } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { useRole } from "@/components/auth/role-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SkeletonCard } from "@/components/ui/skeleton";
import { Plus, Trash2, Pencil, ShieldAlert, Ticket, Link2, CreditCard } from "lucide-react";

const INPUT_CLASS =
  "w-full mt-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm";

/** Shared permissions state used by both code and invite create forms. */
interface PermissionsState {
  allowPortForwarding: boolean;
  setAllowPortForwarding: (v: boolean) => void;
  allowUdp: boolean;
  setAllowUdp: (v: boolean) => void;
  maxConnections: number;
  setMaxConnections: (v: number) => void;
  quotaPeriod: string;
  setQuotaPeriod: (v: string) => void;
  allowedDestinations: string;
  setAllowedDestinations: (v: string) => void;
  blockedDestinations: string;
  setBlockedDestinations: (v: string) => void;
}

/** Advanced permissions panel shared between code and invite create forms. */
function AdvancedPermissions({ state, t }: { state: PermissionsState; t: (k: string) => string }) {
  return (
    <details className="mt-4">
      <summary className="text-xs font-medium cursor-pointer text-muted-foreground hover:text-foreground">
        {t("subscriptions.advancedPermissions")}
      </summary>
      <div className="grid grid-cols-2 gap-4 mt-3">
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={state.allowPortForwarding} onChange={(e) => state.setAllowPortForwarding(e.target.checked)} className="rounded" />
          <label className="text-xs font-medium">{t("subscriptions.allowPortForwarding")}</label>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={state.allowUdp} onChange={(e) => state.setAllowUdp(e.target.checked)} className="rounded" />
          <label className="text-xs font-medium">{t("subscriptions.allowUdp")}</label>
        </div>
        <div>
          <label className="text-xs font-medium">{t("subscriptions.maxConnections")}</label>
          <input type="number" min={0} value={state.maxConnections} onChange={(e) => state.setMaxConnections(parseInt(e.target.value, 10) || 0)} className={INPUT_CLASS} />
        </div>
        <div>
          <label className="text-xs font-medium">{t("subscriptions.quotaPeriod")}</label>
          <select value={state.quotaPeriod} onChange={(e) => state.setQuotaPeriod(e.target.value)} className={INPUT_CLASS}>
            <option value="">{t("subscriptions.quotaPeriodNone")}</option>
            <option value="Daily">{t("subscriptions.quotaPeriodDaily")}</option>
            <option value="Weekly">{t("subscriptions.quotaPeriodWeekly")}</option>
            <option value="Monthly">{t("subscriptions.quotaPeriodMonthly")}</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium">{t("subscriptions.allowedDestinations")}</label>
          <input type="text" value={state.allowedDestinations} onChange={(e) => state.setAllowedDestinations(e.target.value)} className={INPUT_CLASS} placeholder={t("subscriptions.optional")} />
        </div>
        <div>
          <label className="text-xs font-medium">{t("subscriptions.blockedDestinations")}</label>
          <input type="text" value={state.blockedDestinations} onChange={(e) => state.setBlockedDestinations(e.target.value)} className={INPUT_CLASS} placeholder={t("subscriptions.optional")} />
        </div>
      </div>
    </details>
  );
}

export default function SubscriptionsPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { isAdmin } = useRole();
  const queryClient = useQueryClient();

  // ── Codes ──
  const { data: codes, isLoading: codesLoading } = useQuery({
    queryKey: ["codes"],
    queryFn: api.getCodes,
    enabled: isAdmin,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const createCode = useMutation({
    mutationFn: (data: CreateCodeRequest) => api.createCode(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["codes"] });
      toast(t("subscriptions.codeCreated", { code: data.code }), "success");
      setShowCreateCode(false);
    },
    onError: (error: Error) => toast(error.message || t("subscriptions.createFailed"), "error"),
  });

  const deleteCode = useMutation({
    mutationFn: (id: number) => api.deleteCode(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["codes"] });
      toast(t("subscriptions.codeDeleted"), "success");
    },
  });

  // ── Invites ──
  const { data: invites, isLoading: invitesLoading } = useQuery({
    queryKey: ["invites"],
    queryFn: api.getInvites,
    enabled: isAdmin,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const createInvite = useMutation({
    mutationFn: (data: CreateInviteRequest) => api.createInvite(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["invites"] });
      toast(t("subscriptions.inviteCreated"), "success");
      setLastInviteToken(data.token);
      setShowCreateInvite(false);
    },
    onError: (error: Error) => toast(error.message || t("subscriptions.createFailed"), "error"),
  });

  const deleteInvite = useMutation({
    mutationFn: (id: number) => api.deleteInvite(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invites"] });
      toast(t("subscriptions.inviteDeleted"), "success");
    },
  });

  // ── Plans ──
  const { data: plans, isLoading: plansLoading } = useQuery({
    queryKey: ["plans"],
    queryFn: api.getPlans,
    enabled: isAdmin,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const createPlan = useMutation({
    mutationFn: (data: Omit<SubscriptionPlan, "id" | "created_at">) => api.createPlan(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      toast(t("subscriptions.planCreated"), "success");
      setShowCreatePlan(false);
      setEditingPlan(null);
    },
    onError: (error: Error) => toast(error.message || t("subscriptions.createFailed"), "error"),
  });

  const updatePlan = useMutation({
    mutationFn: (data: Omit<SubscriptionPlan, "created_at">) => api.updatePlan(data.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      toast(t("subscriptions.planSaved"), "success");
      setShowCreatePlan(false);
      setEditingPlan(null);
    },
    onError: (error: Error) => toast(error.message || t("subscriptions.createFailed"), "error"),
  });

  const deletePlan = useMutation({
    mutationFn: (id: number) => api.deletePlan(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      toast(t("subscriptions.planDeleted"), "success");
    },
  });

  // ── UI state ──
  const [showCreateCode, setShowCreateCode] = React.useState(false);
  const [showCreateInvite, setShowCreateInvite] = React.useState(false);
  const [showCreatePlan, setShowCreatePlan] = React.useState(false);
  const [lastInviteToken, setLastInviteToken] = React.useState<string | null>(null);
  const [editingPlan, setEditingPlan] = React.useState<SubscriptionPlan | null>(null);

  // ── Create code form state ──
  const [codeMaxUses, setCodeMaxUses] = React.useState(10);
  const [codeMaxClients, setCodeMaxClients] = React.useState(1);
  const [codeBandwidthUp, setCodeBandwidthUp] = React.useState("");
  const [codeBandwidthDown, setCodeBandwidthDown] = React.useState("");
  const [codeQuota, setCodeQuota] = React.useState("");
  const [codePlanId, setCodePlanId] = React.useState<number | undefined>(undefined);
  const [codeExpiresAt, setCodeExpiresAt] = React.useState("");
  const [codeAllowPortForwarding, setCodeAllowPortForwarding] = React.useState(true);
  const [codeAllowUdp, setCodeAllowUdp] = React.useState(true);
  const [codeMaxConnections, setCodeMaxConnections] = React.useState(0);
  const [codeAllowedDestinations, setCodeAllowedDestinations] = React.useState("");
  const [codeBlockedDestinations, setCodeBlockedDestinations] = React.useState("");
  const [codeQuotaPeriod, setCodeQuotaPeriod] = React.useState("");

  // ── Create invite form state ──
  const [inviteMaxUses, setInviteMaxUses] = React.useState(10);
  const [inviteMaxClients, setInviteMaxClients] = React.useState(1);
  const [inviteDefaultRole, setInviteDefaultRole] = React.useState("client");
  const [invitePlanId, setInvitePlanId] = React.useState<number | undefined>(undefined);
  const [inviteExpiresAt, setInviteExpiresAt] = React.useState("");
  const [inviteAllowPortForwarding, setInviteAllowPortForwarding] = React.useState(true);
  const [inviteAllowUdp, setInviteAllowUdp] = React.useState(true);
  const [inviteMaxConnections, setInviteMaxConnections] = React.useState(0);
  const [inviteAllowedDestinations, setInviteAllowedDestinations] = React.useState("");
  const [inviteBlockedDestinations, setInviteBlockedDestinations] = React.useState("");
  const [inviteQuotaPeriod, setInviteQuotaPeriod] = React.useState("");

  // ── Create plan form state ──
  const [planName, setPlanName] = React.useState("");
  const [planDisplayName, setPlanDisplayName] = React.useState("");
  const [planBandwidthUp, setPlanBandwidthUp] = React.useState("");
  const [planBandwidthDown, setPlanBandwidthDown] = React.useState("");
  const [planQuota, setPlanQuota] = React.useState("");
  const [planMaxClients, setPlanMaxClients] = React.useState(1);
  const [planMaxConnections, setPlanMaxConnections] = React.useState(0);
  const [planExpiryDays, setPlanExpiryDays] = React.useState(30);
  const [planAllowPortForwarding, setPlanAllowPortForwarding] = React.useState(true);
  const [planAllowUdp, setPlanAllowUdp] = React.useState(true);
  const [planAllowedDestinations, setPlanAllowedDestinations] = React.useState("");
  const [planBlockedDestinations, setPlanBlockedDestinations] = React.useState("");
  const [planQuotaPeriod, setPlanQuotaPeriod] = React.useState("");

  const [deleteTarget, setDeleteTarget] = React.useState<{ type: "code" | "invite" | "plan"; id: number; label: string; detail: string } | null>(null);

  /** Populate plan form from an existing plan for editing */
  function startEditPlan(p: SubscriptionPlan) {
    setEditingPlan(p);
    setPlanName(p.name);
    setPlanDisplayName(p.display_name);
    setPlanBandwidthUp(p.bandwidth_up || "");
    setPlanBandwidthDown(p.bandwidth_down || "");
    setPlanQuota(p.quota || "");
    setPlanMaxClients(p.max_clients);
    setPlanMaxConnections(p.max_connections);
    setPlanExpiryDays(p.expiry_days);
    setPlanAllowPortForwarding(p.allow_port_forwarding);
    setPlanAllowUdp(p.allow_udp);
    setPlanAllowedDestinations(p.allowed_destinations);
    setPlanBlockedDestinations(p.blocked_destinations);
    setPlanQuotaPeriod(p.quota_period || "");
    setShowCreatePlan(true);
  }

  /** Reset plan form to defaults */
  function resetPlanForm() {
    setEditingPlan(null);
    setPlanName("");
    setPlanDisplayName("");
    setPlanBandwidthUp("");
    setPlanBandwidthDown("");
    setPlanQuota("");
    setPlanMaxClients(1);
    setPlanMaxConnections(0);
    setPlanExpiryDays(30);
    setPlanAllowPortForwarding(true);
    setPlanAllowUdp(true);
    setPlanAllowedDestinations("");
    setPlanBlockedDestinations("");
    setPlanQuotaPeriod("");
    setShowCreatePlan(false);
  }

  /** Build plan data object from form state (shared between create and update) */
  function buildPlanData(): Omit<SubscriptionPlan, "id" | "created_at"> {
    return {
      name: planName,
      display_name: planDisplayName,
      bandwidth_up: planBandwidthUp || null,
      bandwidth_down: planBandwidthDown || null,
      quota: planQuota || null,
      quota_period: planQuotaPeriod || null,
      max_connections: planMaxConnections,
      max_clients: planMaxClients,
      allow_port_forwarding: planAllowPortForwarding,
      allow_udp: planAllowUdp,
      allowed_destinations: planAllowedDestinations,
      blocked_destinations: planBlockedDestinations,
      expiry_days: planExpiryDays,
    };
  }

  /** Resolve the delete confirmation title based on target type */
  function deleteTitle(): string {
    if (deleteTarget?.type === "code") return t("subscriptions.deleteCode");
    if (deleteTarget?.type === "invite") return t("subscriptions.deleteInvite");
    return t("subscriptions.deletePlan");
  }

  /** Convert datetime-local value to UTC string for API */
  function toUtcString(val: string): string | undefined {
    if (!val) return undefined;
    return new Date(val).toISOString().replace("T", " ").slice(0, 19);
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldAlert className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold">{t("role.accessDenied")}</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-md">{t("role.accessDeniedDesc")}</p>
      </div>
    );
  }

  const inviteUrl = (token: string) => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/invite/${token}`;
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold tracking-tight">{t("subscriptions.title")}</h2>

      <Tabs defaultValue="codes">
        <TabsList>
          <TabsTrigger value="codes">
            <Ticket className="h-4 w-4 mr-1.5" />
            {t("subscriptions.codes")}
          </TabsTrigger>
          <TabsTrigger value="invites">
            <Link2 className="h-4 w-4 mr-1.5" />
            {t("subscriptions.invites")}
          </TabsTrigger>
          <TabsTrigger value="plans">
            <CreditCard className="h-4 w-4 mr-1.5" />
            {t("subscriptions.plans")}
          </TabsTrigger>
        </TabsList>

        {/* ── Codes tab ── */}
        <TabsContent value="codes">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium">{t("subscriptions.codes")}</CardTitle>
              <Button size="sm" onClick={() => setShowCreateCode(true)}>
                <Plus className="h-4 w-4 mr-1" /> {t("subscriptions.createCode")}
              </Button>
            </CardHeader>
            <CardContent>
              {codesLoading ? (
                <SkeletonCard className="h-32" />
              ) : !codes?.length ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  {t("subscriptions.noCodes")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">{t("subscriptions.code")}</th>
                        <th className="py-2 pr-4 font-medium">{t("subscriptions.usage")}</th>
                        <th className="py-2 pr-4 font-medium">{t("subscriptions.maxClients")}</th>
                        <th className="py-2 pr-4 font-medium">{t("subscriptions.bandwidth")}</th>
                        <th className="py-2 pr-4 font-medium">{t("subscriptions.expires")}</th>
                        <th className="py-2 font-medium">{t("subscriptions.actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {codes.map((c: RedemptionCode) => (
                        <tr key={c.id} className="border-b last:border-0">
                          <td className="py-2 pr-4">
                            <div className="flex items-center gap-1.5">
                              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{c.code}</code>
                              <CopyButton value={c.code} />
                            </div>
                          </td>
                          <td className="py-2 pr-4">{c.used_count}/{c.max_uses}</td>
                          <td className="py-2 pr-4">{c.max_clients}</td>
                          <td className="py-2 pr-4 text-xs">
                            {c.bandwidth_up || c.bandwidth_down
                              ? `${c.bandwidth_up || "-"} / ${c.bandwidth_down || "-"}`
                              : "-"}
                          </td>
                          <td className="py-2 pr-4 text-xs">{c.expires_at || t("subscriptions.never")}</td>
                          <td className="py-2">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setDeleteTarget({ type: "code", id: c.id, label: c.code, detail: `${c.used_count}/${c.max_uses} used` })}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Create code dialog */}
          {showCreateCode && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-sm">{t("subscriptions.createCode")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.maxUses")}</label>
                    <input type="number" min={1} max={10000} value={codeMaxUses} onChange={(e) => setCodeMaxUses(parseInt(e.target.value, 10) || 1)} className={INPUT_CLASS} />
                  </div>
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.maxClientsPerUser")}</label>
                    <input type="number" min={1} max={10000} value={codeMaxClients} onChange={(e) => setCodeMaxClients(parseInt(e.target.value, 10) || 1)} className={INPUT_CLASS} />
                  </div>
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.bandwidthUp")}</label>
                    <input type="text" value={codeBandwidthUp} onChange={(e) => setCodeBandwidthUp(e.target.value)} className={INPUT_CLASS} placeholder="e.g. 100mbps" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.bandwidthDown")}</label>
                    <input type="text" value={codeBandwidthDown} onChange={(e) => setCodeBandwidthDown(e.target.value)} className={INPUT_CLASS} placeholder="e.g. 100mbps" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.quota")}</label>
                    <input type="text" value={codeQuota} onChange={(e) => setCodeQuota(e.target.value)} className={INPUT_CLASS} placeholder="e.g. 10gb" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.expiresAt")}</label>
                    <input type="datetime-local" value={codeExpiresAt} onChange={(e) => setCodeExpiresAt(e.target.value)} className={INPUT_CLASS} />
                  </div>
                  {plans && plans.length > 0 && (
                    <div>
                      <label className="text-xs font-medium">{t("subscriptions.plan")}</label>
                      <select value={codePlanId ?? ""} onChange={(e) => setCodePlanId(e.target.value ? Number(e.target.value) : undefined)} className={INPUT_CLASS}>
                        <option value="">{t("subscriptions.noPlan")}</option>
                        {plans.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <AdvancedPermissions t={t} state={{
                  allowPortForwarding: codeAllowPortForwarding,
                  setAllowPortForwarding: setCodeAllowPortForwarding,
                  allowUdp: codeAllowUdp,
                  setAllowUdp: setCodeAllowUdp,
                  maxConnections: codeMaxConnections,
                  setMaxConnections: setCodeMaxConnections,
                  quotaPeriod: codeQuotaPeriod,
                  setQuotaPeriod: setCodeQuotaPeriod,
                  allowedDestinations: codeAllowedDestinations,
                  setAllowedDestinations: setCodeAllowedDestinations,
                  blockedDestinations: codeBlockedDestinations,
                  setBlockedDestinations: setCodeBlockedDestinations,
                }} />
                <div className="flex justify-end gap-2 mt-4">
                  <Button variant="outline" size="sm" onClick={() => setShowCreateCode(false)}>
                    {t("common.cancel")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => createCode.mutate({
                      max_uses: codeMaxUses,
                      max_clients: codeMaxClients,
                      bandwidth_up: codeBandwidthUp || undefined,
                      bandwidth_down: codeBandwidthDown || undefined,
                      quota: codeQuota || undefined,
                      expires_at: toUtcString(codeExpiresAt),
                      plan_id: codePlanId,
                      allow_port_forwarding: codeAllowPortForwarding,
                      allow_udp: codeAllowUdp,
                      max_connections: codeMaxConnections,
                      allowed_destinations: codeAllowedDestinations || undefined,
                      blocked_destinations: codeBlockedDestinations || undefined,
                      quota_period: codeQuotaPeriod || undefined,
                    })}
                    disabled={createCode.isPending}
                  >
                    {createCode.isPending ? t("subscriptions.creating") : t("common.create")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Invites tab ── */}
        <TabsContent value="invites">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium">{t("subscriptions.invites")}</CardTitle>
              <Button size="sm" onClick={() => setShowCreateInvite(true)}>
                <Plus className="h-4 w-4 mr-1" /> {t("subscriptions.createInvite")}
              </Button>
            </CardHeader>
            <CardContent>
              {invitesLoading ? (
                <SkeletonCard className="h-32" />
              ) : !invites?.length ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  {t("subscriptions.noInvites")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">{t("subscriptions.link")}</th>
                        <th className="py-2 pr-4 font-medium">{t("subscriptions.usage")}</th>
                        <th className="py-2 pr-4 font-medium">{t("subscriptions.role")}</th>
                        <th className="py-2 pr-4 font-medium">{t("subscriptions.expires")}</th>
                        <th className="py-2 font-medium">{t("subscriptions.actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invites.map((inv: InviteInfo) => (
                        <tr key={inv.id} className="border-b last:border-0">
                          <td className="py-2 pr-4">
                            <div className="flex items-center gap-1.5">
                              <code className="text-xs bg-muted px-1.5 py-0.5 rounded truncate max-w-[200px]">
                                {inviteUrl(inv.token)}
                              </code>
                              <CopyButton value={inviteUrl(inv.token)} />
                            </div>
                          </td>
                          <td className="py-2 pr-4">{inv.used_count}/{inv.max_uses}</td>
                          <td className="py-2 pr-4 capitalize">{inv.default_role}</td>
                          <td className="py-2 pr-4 text-xs">{inv.expires_at || t("subscriptions.never")}</td>
                          <td className="py-2">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setDeleteTarget({ type: "invite", id: inv.id, label: inv.token.slice(0, 8) + "...", detail: `${inv.used_count}/${inv.max_uses} used` })}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {lastInviteToken && (
                <div className="mt-4 p-3 rounded-md border bg-muted/50">
                  <p className="text-xs font-medium mb-1">{t("subscriptions.newInviteLink")}</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-background px-2 py-1 rounded flex-1 truncate">
                      {inviteUrl(lastInviteToken)}
                    </code>
                    <CopyButton value={inviteUrl(lastInviteToken)} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Create invite dialog */}
          {showCreateInvite && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-sm">{t("subscriptions.createInvite")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.maxUses")}</label>
                    <input type="number" min={1} max={10000} value={inviteMaxUses} onChange={(e) => setInviteMaxUses(parseInt(e.target.value, 10) || 1)} className={INPUT_CLASS} />
                  </div>
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.maxClientsPerUser")}</label>
                    <input type="number" min={1} max={10000} value={inviteMaxClients} onChange={(e) => setInviteMaxClients(parseInt(e.target.value, 10) || 1)} className={INPUT_CLASS} />
                  </div>
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.defaultRole")}</label>
                    <select value={inviteDefaultRole} onChange={(e) => setInviteDefaultRole(e.target.value)} className={INPUT_CLASS}>
                      <option value="client">{t("users.client")}</option>
                      <option value="operator">{t("users.operator")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.expiresAt")}</label>
                    <input type="datetime-local" value={inviteExpiresAt} onChange={(e) => setInviteExpiresAt(e.target.value)} className={INPUT_CLASS} />
                  </div>
                  {plans && plans.length > 0 && (
                    <div>
                      <label className="text-xs font-medium">{t("subscriptions.plan")}</label>
                      <select value={invitePlanId ?? ""} onChange={(e) => setInvitePlanId(e.target.value ? Number(e.target.value) : undefined)} className={INPUT_CLASS}>
                        <option value="">{t("subscriptions.noPlan")}</option>
                        {plans.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <AdvancedPermissions t={t} state={{
                  allowPortForwarding: inviteAllowPortForwarding,
                  setAllowPortForwarding: setInviteAllowPortForwarding,
                  allowUdp: inviteAllowUdp,
                  setAllowUdp: setInviteAllowUdp,
                  maxConnections: inviteMaxConnections,
                  setMaxConnections: setInviteMaxConnections,
                  quotaPeriod: inviteQuotaPeriod,
                  setQuotaPeriod: setInviteQuotaPeriod,
                  allowedDestinations: inviteAllowedDestinations,
                  setAllowedDestinations: setInviteAllowedDestinations,
                  blockedDestinations: inviteBlockedDestinations,
                  setBlockedDestinations: setInviteBlockedDestinations,
                }} />
                <div className="flex justify-end gap-2 mt-4">
                  <Button variant="outline" size="sm" onClick={() => setShowCreateInvite(false)}>
                    {t("common.cancel")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => createInvite.mutate({
                      max_uses: inviteMaxUses,
                      max_clients: inviteMaxClients,
                      default_role: inviteDefaultRole,
                      expires_at: toUtcString(inviteExpiresAt),
                      plan_id: invitePlanId,
                      allow_port_forwarding: inviteAllowPortForwarding,
                      allow_udp: inviteAllowUdp,
                      max_connections: inviteMaxConnections,
                      allowed_destinations: inviteAllowedDestinations || undefined,
                      blocked_destinations: inviteBlockedDestinations || undefined,
                      quota_period: inviteQuotaPeriod || undefined,
                    })}
                    disabled={createInvite.isPending}
                  >
                    {createInvite.isPending ? t("subscriptions.creating") : t("common.create")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Plans tab ── */}
        <TabsContent value="plans">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium">{t("subscriptions.plans")}</CardTitle>
              <Button size="sm" onClick={() => { resetPlanForm(); setShowCreatePlan(true); }}>
                <Plus className="h-4 w-4 mr-1" /> {t("subscriptions.createPlan")}
              </Button>
            </CardHeader>
            <CardContent>
              {plansLoading ? (
                <SkeletonCard className="h-32" />
              ) : !plans?.length ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  {t("subscriptions.noPlans")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">{t("subscriptions.planName")}</th>
                        <th className="py-2 pr-4 font-medium">{t("subscriptions.displayName")}</th>
                        <th className="py-2 pr-4 font-medium">{t("subscriptions.bandwidth")}</th>
                        <th className="py-2 pr-4 font-medium">{t("subscriptions.quota")}</th>
                        <th className="py-2 pr-4 font-medium">{t("subscriptions.maxClients")}</th>
                        <th className="py-2 pr-4 font-medium">{t("subscriptions.expiryDays")}</th>
                        <th className="py-2 font-medium">{t("subscriptions.actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plans.map((p: SubscriptionPlan) => (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-mono text-xs">{p.name}</td>
                          <td className="py-2 pr-4">{p.display_name}</td>
                          <td className="py-2 pr-4 text-xs">
                            {p.bandwidth_up || p.bandwidth_down
                              ? `${p.bandwidth_up || "-"} / ${p.bandwidth_down || "-"}`
                              : t("subscriptions.unlimited")}
                          </td>
                          <td className="py-2 pr-4 text-xs">{p.quota || t("subscriptions.unlimited")}</td>
                          <td className="py-2 pr-4">{p.max_clients}</td>
                          <td className="py-2 pr-4">{p.expiry_days === 0 ? t("subscriptions.never") : p.expiry_days}</td>
                          <td className="py-2">
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => startEditPlan(p)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => setDeleteTarget({ type: "plan", id: p.id, label: p.display_name, detail: p.name })}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Create / Edit plan dialog */}
          {showCreatePlan && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-sm">
                  {editingPlan ? t("subscriptions.editPlan") : t("subscriptions.createPlan")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.planName")}</label>
                    <input type="text" value={planName} onChange={(e) => setPlanName(e.target.value)} className={INPUT_CLASS} placeholder="e.g. basic" />
                    <p className="text-xs text-muted-foreground mt-0.5">{t("subscriptions.planNameHint")}</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.displayName")}</label>
                    <input type="text" value={planDisplayName} onChange={(e) => setPlanDisplayName(e.target.value)} className={INPUT_CLASS} placeholder="e.g. Basic" />
                    <p className="text-xs text-muted-foreground mt-0.5">{t("subscriptions.displayNameHint")}</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.bandwidthUp")}</label>
                    <input type="text" value={planBandwidthUp} onChange={(e) => setPlanBandwidthUp(e.target.value)} className={INPUT_CLASS} placeholder="e.g. 100mbps" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.bandwidthDown")}</label>
                    <input type="text" value={planBandwidthDown} onChange={(e) => setPlanBandwidthDown(e.target.value)} className={INPUT_CLASS} placeholder="e.g. 100mbps" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.quota")}</label>
                    <input type="text" value={planQuota} onChange={(e) => setPlanQuota(e.target.value)} className={INPUT_CLASS} placeholder="e.g. 10gb" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.maxClients")}</label>
                    <input type="number" min={1} max={10000} value={planMaxClients} onChange={(e) => setPlanMaxClients(parseInt(e.target.value, 10) || 1)} className={INPUT_CLASS} />
                  </div>
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.maxConnections")}</label>
                    <input type="number" min={0} value={planMaxConnections} onChange={(e) => setPlanMaxConnections(parseInt(e.target.value, 10) || 0)} className={INPUT_CLASS} />
                  </div>
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.expiryDays")}</label>
                    <input type="number" min={0} value={planExpiryDays} onChange={(e) => setPlanExpiryDays(parseInt(e.target.value, 10) || 0)} className={INPUT_CLASS} />
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={planAllowPortForwarding} onChange={(e) => setPlanAllowPortForwarding(e.target.checked)} className="rounded" />
                    <label className="text-xs font-medium">{t("subscriptions.allowPortForwarding")}</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={planAllowUdp} onChange={(e) => setPlanAllowUdp(e.target.checked)} className="rounded" />
                    <label className="text-xs font-medium">{t("subscriptions.allowUdp")}</label>
                  </div>
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.quotaPeriod")}</label>
                    <select value={planQuotaPeriod} onChange={(e) => setPlanQuotaPeriod(e.target.value)} className={INPUT_CLASS}>
                      <option value="">{t("subscriptions.quotaPeriodNone")}</option>
                      <option value="Daily">{t("subscriptions.quotaPeriodDaily")}</option>
                      <option value="Weekly">{t("subscriptions.quotaPeriodWeekly")}</option>
                      <option value="Monthly">{t("subscriptions.quotaPeriodMonthly")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium">{t("subscriptions.allowedDestinations")}</label>
                    <input type="text" value={planAllowedDestinations} onChange={(e) => setPlanAllowedDestinations(e.target.value)} className={INPUT_CLASS} placeholder={t("subscriptions.optional")} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-medium">{t("subscriptions.blockedDestinations")}</label>
                    <input type="text" value={planBlockedDestinations} onChange={(e) => setPlanBlockedDestinations(e.target.value)} className={INPUT_CLASS} placeholder={t("subscriptions.optional")} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <Button variant="outline" size="sm" onClick={() => resetPlanForm()}>
                    {t("common.cancel")}
                  </Button>
                  {editingPlan ? (
                    <Button
                      size="sm"
                      onClick={() => updatePlan.mutate({ id: editingPlan.id, ...buildPlanData() })}
                      disabled={updatePlan.isPending || !planName || !planDisplayName}
                    >
                      {updatePlan.isPending ? t("subscriptions.creating") : t("subscriptions.savePlan")}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => createPlan.mutate(buildPlanData())}
                      disabled={createPlan.isPending || !planName || !planDisplayName}
                    >
                      {createPlan.isPending ? t("subscriptions.creating") : t("common.create")}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        title={deleteTitle()}
        description={
          deleteTarget
            ? `${deleteTarget.label} (${deleteTarget.detail}) -- ${t("subscriptions.deleteConfirm")}`
            : t("subscriptions.deleteConfirm")
        }
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="destructive"
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.type === "code") {
            deleteCode.mutate(deleteTarget.id);
          } else if (deleteTarget.type === "invite") {
            deleteInvite.mutate(deleteTarget.id);
          } else {
            deletePlan.mutate(deleteTarget.id);
          }
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
