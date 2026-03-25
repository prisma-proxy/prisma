"use client";

import { useRef, useCallback } from "react";
import Link from "next/link";
import { Users, UserPlus, Download, Upload } from "lucide-react";
import { useClients, useUpdateClient, useDeleteClient } from "@/hooks/use-clients";
import { useAllClientMetrics } from "@/hooks/use-client-metrics";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { useRole } from "@/components/auth/role-guard";
import { api } from "@/lib/api";
import { exportToJSON } from "@/lib/export";
import { ClientTable } from "@/components/clients/client-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonTable } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/loading-placeholder";

export default function ClientsPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { isAdmin } = useRole();
  const { data: clients, isLoading } = useClients();
  const { data: metrics } = useAllClientMetrics();
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(async () => {
    try {
      const allClients = await api.getClients();
      const payload = {
        version: "2.3.0",
        exportedAt: new Date().toISOString(),
        clients: allClients,
      };
      exportToJSON(payload, `prisma-clients-${new Date().toISOString().slice(0, 10)}`);
      toast(t("clients.exportSuccess"), "success");
    } catch {
      toast(t("common.error"), "error");
    }
  }, [t, toast]);

  const handleImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const importClients = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.clients)
            ? parsed.clients
            : [];

        const results = await Promise.allSettled(
          importClients.map((client: { name?: string }) =>
            api.createClient(client.name ?? undefined)
          )
        );
        const successCount = results.filter((r) => r.status === "fulfilled").length;

        toast(
          t("clients.importSuccess", { count: successCount }),
          "success"
        );
      } catch {
        toast(t("common.error"), "error");
      } finally {
        // Reset file input so the same file can be selected again
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [t, toast]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("clients.registeredClients")}</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1.5" />
            {t("clients.export")}
          </Button>
          {isAdmin && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-1.5" />
                {t("clients.import")}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleImport}
              />
              <Link href="/dashboard/clients/new/">
                <Button>
                  <UserPlus className="h-4 w-4 mr-1.5" />
                  {t("clients.addClient")}
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("sidebar.clients")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <SkeletonTable rows={4} />
          ) : (clients?.length ?? 0) === 0 ? (
            <EmptyState
              icon={Users}
              title={t("empty.noClients")}
              description={t("empty.noClientsHint")}
              action={
                isAdmin ? (
                  <Link href="/dashboard/clients/new/">
                    <Button size="sm">
                      <UserPlus className="h-4 w-4 mr-1.5" />
                      {t("clients.addClient")}
                    </Button>
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <ClientTable
              clients={clients ?? []}
              metrics={metrics ?? []}
              onToggle={(id, enabled) =>
                updateClient.mutate({ id, data: { enabled } })
              }
              onDelete={isAdmin ? (id) => deleteClient.mutate(id) : undefined}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
