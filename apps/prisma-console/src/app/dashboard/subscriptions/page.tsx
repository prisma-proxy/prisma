"use client";

import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { RedemptionCode, InviteInfo, CreateCodeRequest, CreateInviteRequest } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { useRole } from "@/components/auth/role-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SkeletonCard } from "@/components/ui/skeleton";
import { Plus, Trash2, ShieldAlert, Ticket, Link2 } from "lucide-react";

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
  });

  const createCode = useMutation({
    mutationFn: (data: CreateCodeRequest) => api.createCode(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["codes"] });
      toast(`Code created: ${data.code}`, "success");
      setShowCreateCode(false);
    },
    onError: () => toast("Failed to create code", "error"),
  });

  const deleteCode = useMutation({
    mutationFn: (id: number) => api.deleteCode(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["codes"] });
      toast("Code deleted", "success");
    },
  });

  // ── Invites ──
  const { data: invites, isLoading: invitesLoading } = useQuery({
    queryKey: ["invites"],
    queryFn: api.getInvites,
    enabled: isAdmin,
  });

  const createInvite = useMutation({
    mutationFn: (data: CreateInviteRequest) => api.createInvite(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["invites"] });
      toast(`Invite created`, "success");
      setLastInviteToken(data.token);
      setShowCreateInvite(false);
    },
    onError: () => toast("Failed to create invite", "error"),
  });

  const deleteInvite = useMutation({
    mutationFn: (id: number) => api.deleteInvite(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invites"] });
      toast("Invite deleted", "success");
    },
  });

  // ── UI state ──
  const [showCreateCode, setShowCreateCode] = React.useState(false);
  const [showCreateInvite, setShowCreateInvite] = React.useState(false);
  const [lastInviteToken, setLastInviteToken] = React.useState<string | null>(null);

  // ── Create code form state ──
  const [codeMaxUses, setCodeMaxUses] = React.useState(10);
  const [codeMaxClients, setCodeMaxClients] = React.useState(1);
  const [codeBandwidthUp, setCodeBandwidthUp] = React.useState("");
  const [codeBandwidthDown, setCodeBandwidthDown] = React.useState("");
  const [codeQuota, setCodeQuota] = React.useState("");

  // ── Create invite form state ──
  const [inviteMaxUses, setInviteMaxUses] = React.useState(10);
  const [inviteMaxClients, setInviteMaxClients] = React.useState(1);
  const [inviteDefaultRole, setInviteDefaultRole] = React.useState("client");

  const [deleteTarget, setDeleteTarget] = React.useState<{ type: "code" | "invite"; id: number } | null>(null);

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
      <h2 className="text-lg font-semibold tracking-tight">Subscriptions</h2>

      <Tabs defaultValue="codes">
        <TabsList>
          <TabsTrigger value="codes">
            <Ticket className="h-4 w-4 mr-1.5" />
            Redemption Codes
          </TabsTrigger>
          <TabsTrigger value="invites">
            <Link2 className="h-4 w-4 mr-1.5" />
            Invite Links
          </TabsTrigger>
        </TabsList>

        {/* ── Codes tab ── */}
        <TabsContent value="codes">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium">Redemption Codes</CardTitle>
              <Button size="sm" onClick={() => setShowCreateCode(true)}>
                <Plus className="h-4 w-4 mr-1" /> Create Code
              </Button>
            </CardHeader>
            <CardContent>
              {codesLoading ? (
                <SkeletonCard className="h-32" />
              ) : !codes?.length ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No redemption codes yet. Create one to get started.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">Code</th>
                        <th className="py-2 pr-4 font-medium">Usage</th>
                        <th className="py-2 pr-4 font-medium">Max Clients</th>
                        <th className="py-2 pr-4 font-medium">Bandwidth</th>
                        <th className="py-2 pr-4 font-medium">Expires</th>
                        <th className="py-2 font-medium">Actions</th>
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
                          <td className="py-2 pr-4 text-xs">{c.expires_at || "Never"}</td>
                          <td className="py-2">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setDeleteTarget({ type: "code", id: c.id })}
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
                <CardTitle className="text-sm">Create Redemption Code</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium">Max Uses</label>
                    <input
                      type="number"
                      min={1}
                      value={codeMaxUses}
                      onChange={(e) => setCodeMaxUses(parseInt(e.target.value, 10) || 1)}
                      className="w-full mt-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Max Clients per User</label>
                    <input
                      type="number"
                      min={1}
                      value={codeMaxClients}
                      onChange={(e) => setCodeMaxClients(parseInt(e.target.value, 10) || 1)}
                      className="w-full mt-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Bandwidth Up (e.g. 100mbps)</label>
                    <input
                      type="text"
                      value={codeBandwidthUp}
                      onChange={(e) => setCodeBandwidthUp(e.target.value)}
                      className="w-full mt-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Bandwidth Down (e.g. 100mbps)</label>
                    <input
                      type="text"
                      value={codeBandwidthDown}
                      onChange={(e) => setCodeBandwidthDown(e.target.value)}
                      className="w-full mt-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Quota (e.g. 100GB)</label>
                    <input
                      type="text"
                      value={codeQuota}
                      onChange={(e) => setCodeQuota(e.target.value)}
                      className="w-full mt-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                      placeholder="Optional"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <Button variant="outline" size="sm" onClick={() => setShowCreateCode(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      createCode.mutate({
                        max_uses: codeMaxUses,
                        max_clients: codeMaxClients,
                        bandwidth_up: codeBandwidthUp || undefined,
                        bandwidth_down: codeBandwidthDown || undefined,
                        quota: codeQuota || undefined,
                      })
                    }
                    disabled={createCode.isPending}
                  >
                    {createCode.isPending ? "Creating..." : "Create"}
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
              <CardTitle className="text-sm font-medium">Invite Links</CardTitle>
              <Button size="sm" onClick={() => setShowCreateInvite(true)}>
                <Plus className="h-4 w-4 mr-1" /> Create Invite
              </Button>
            </CardHeader>
            <CardContent>
              {invitesLoading ? (
                <SkeletonCard className="h-32" />
              ) : !invites?.length ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No invite links yet. Create one to share access.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">Link</th>
                        <th className="py-2 pr-4 font-medium">Usage</th>
                        <th className="py-2 pr-4 font-medium">Role</th>
                        <th className="py-2 pr-4 font-medium">Expires</th>
                        <th className="py-2 font-medium">Actions</th>
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
                          <td className="py-2 pr-4 text-xs">{inv.expires_at || "Never"}</td>
                          <td className="py-2">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setDeleteTarget({ type: "invite", id: inv.id })}
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
                  <p className="text-xs font-medium mb-1">New invite link created:</p>
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
                <CardTitle className="text-sm">Create Invite Link</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium">Max Uses</label>
                    <input
                      type="number"
                      min={1}
                      value={inviteMaxUses}
                      onChange={(e) => setInviteMaxUses(parseInt(e.target.value, 10) || 1)}
                      className="w-full mt-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Max Clients per User</label>
                    <input
                      type="number"
                      min={1}
                      value={inviteMaxClients}
                      onChange={(e) => setInviteMaxClients(parseInt(e.target.value, 10) || 1)}
                      className="w-full mt-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Default Role</label>
                    <select
                      value={inviteDefaultRole}
                      onChange={(e) => setInviteDefaultRole(e.target.value)}
                      className="w-full mt-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                    >
                      <option value="client">Client</option>
                      <option value="operator">Operator</option>
                    </select>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <Button variant="outline" size="sm" onClick={() => setShowCreateInvite(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      createInvite.mutate({
                        max_uses: inviteMaxUses,
                        max_clients: inviteMaxClients,
                        default_role: inviteDefaultRole,
                      })
                    }
                    disabled={createInvite.isPending}
                  >
                    {createInvite.isPending ? "Creating..." : "Create"}
                  </Button>
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
        title={`Delete ${deleteTarget?.type === "code" ? "Code" : "Invite"}?`}
        description={`This ${deleteTarget?.type === "code" ? "redemption code" : "invite link"} will be permanently deleted. Existing redeemed clients will not be affected.`}
        confirmLabel="Delete"
        cancelLabel={t("common.cancel")}
        variant="destructive"
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.type === "code") {
            deleteCode.mutate(deleteTarget.id);
          } else {
            deleteInvite.mutate(deleteTarget.id);
          }
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
