"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n";
import type { ClientInfo } from "@/lib/types";

interface ClientTableProps {
  clients: ClientInfo[];
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}

export function ClientTable({ clients, onToggle, onDelete }: ClientTableProps) {
  const { t } = useI18n();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  if (clients.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t("clients.noClients")}
      </p>
    );
  }

  return (
    <>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("clients.name")}</TableHead>
          <TableHead>{t("clients.status")}</TableHead>
          <TableHead className="text-right">{t("clients.actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {clients.map((client) => (
          <TableRow key={client.id}>
            <TableCell className="font-medium">
              <Link
                href={`/dashboard/clients/detail/?id=${client.id}`}
                className="hover:underline text-primary"
              >
                {client.name || t("clients.unnamed")}
              </Link>
            </TableCell>
            <TableCell>
              {client.enabled ? (
                <Badge className="bg-green-500/15 text-green-700 dark:text-green-400">
                  {t("clients.active")}
                </Badge>
              ) : (
                <Badge className="bg-red-500/15 text-red-700 dark:text-red-400">
                  {t("clients.disabled")}
                </Badge>
              )}
            </TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-3">
                <Switch
                  checked={client.enabled}
                  onCheckedChange={(checked: boolean) =>
                    onToggle(client.id, checked)
                  }
                  size="sm"
                />
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteId(client.id)}
                >
                  {t("common.delete")}
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    <ConfirmDialog
      open={deleteId !== null}
      onOpenChange={(open) => { if (!open) setDeleteId(null); }}
      title={t("common.delete")}
      description={t("clients.deleteConfirm")}
      confirmLabel={t("common.delete")}
      cancelLabel={t("common.cancel")}
      variant="destructive"
      onConfirm={() => {
        if (deleteId) onDelete(deleteId);
        setDeleteId(null);
      }}
    />
    </>
  );
}
