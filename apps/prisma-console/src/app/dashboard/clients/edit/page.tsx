"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useClients, useUpdateClient, useDeleteClient } from "@/hooks/use-clients";
import { useI18n } from "@/lib/i18n";
import { LoadingPlaceholder } from "@/components/ui/loading-placeholder";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ClientEditPage() {
  return (
    <Suspense fallback={<LoadingPlaceholder />}>
      <ClientEditInner />
    </Suspense>
  );
}

function ClientEditInner() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const router = useRouter();
  const { data: clients, isLoading } = useClients();
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();

  const client = clients?.find((c) => c.id === id);

  const [name, setName] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const currentName = name ?? client?.name ?? "";
  const currentEnabled = enabled ?? client?.enabled ?? true;

  if (!id) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("clients.noClientId")}</p>
        <Link href="/dashboard/clients/">
          <Button variant="outline" size="sm">
            {t("clients.backToClients")}
          </Button>
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">{t("clients.loadingClient")}</p>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("clients.clientNotFound")}</p>
        <Link href="/dashboard/clients/">
          <Button variant="outline" size="sm">
            {t("clients.backToClients")}
          </Button>
        </Link>
      </div>
    );
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    updateClient.mutate(
      { id, data: { name: currentName, enabled: currentEnabled } },
      {
        onSuccess: () => {
          setName(null);
          setEnabled(null);
        },
      }
    );
  }

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    deleteClient.mutate(id, {
      onSuccess: () => {
        router.push("/dashboard/clients/");
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/clients/">
          <Button variant="outline" size="sm">
            {t("clients.backToClients")}
          </Button>
        </Link>
        <h2 className="text-lg font-semibold">{t("clients.clientDetails")}</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("clients.editClient")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-6">
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t("clients.clientId")}</p>
              <p className="font-mono text-sm break-all">{client.id}</p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="client-name">{t("clients.name")}</Label>
              <Input
                id="client-name"
                type="text"
                placeholder={t("clients.clientNamePlaceholder")}
                value={currentName}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="client-enabled">{t("common.enabled")}</Label>
              <Switch
                id="client-enabled"
                checked={currentEnabled}
                onCheckedChange={(checked: boolean) => setEnabled(checked)}
              />
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={updateClient.isPending}>
                {updateClient.isPending ? t("common.saving") : t("clients.saveChanges")}
              </Button>

              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteClient.isPending}
              >
                {deleteClient.isPending
                  ? t("common.deleting")
                  : confirmDelete
                    ? t("clients.confirmDeleteBtn")
                    : t("clients.deleteClient")}
              </Button>

              {confirmDelete && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                >
                  {t("common.cancel")}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
