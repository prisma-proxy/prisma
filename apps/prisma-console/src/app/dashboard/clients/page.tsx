"use client";

import Link from "next/link";
import { Users, UserPlus } from "lucide-react";
import { useClients, useUpdateClient, useDeleteClient } from "@/hooks/use-clients";
import { useI18n } from "@/lib/i18n";
import { ClientTable } from "@/components/clients/client-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonTable } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/loading-placeholder";

export default function ClientsPage() {
  const { t } = useI18n();
  const { data: clients, isLoading } = useClients();
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("clients.registeredClients")}</h2>
        <Link href="/dashboard/clients/new/">
          <Button>
            <UserPlus className="h-4 w-4 mr-1.5" />
            {t("clients.addClient")}
          </Button>
        </Link>
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
                <Link href="/dashboard/clients/new/">
                  <Button size="sm">
                    <UserPlus className="h-4 w-4 mr-1.5" />
                    {t("clients.addClient")}
                  </Button>
                </Link>
              }
            />
          ) : (
            <ClientTable
              clients={clients ?? []}
              onToggle={(id, enabled) =>
                updateClient.mutate({ id, data: { enabled } })
              }
              onDelete={(id) => deleteClient.mutate(id)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
