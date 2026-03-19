"use client";

import Link from "next/link";
import { useClients, useUpdateClient, useDeleteClient } from "@/hooks/use-clients";
import { useI18n } from "@/lib/i18n";
import { ClientTable } from "@/components/clients/client-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
          <Button>{t("clients.addClient")}</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("sidebar.clients")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">{t("clients.loadingClients")}</p>
            </div>
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
