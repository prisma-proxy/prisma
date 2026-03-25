"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ForwardEditor, type ForwardFormData } from "@/components/server/forward-editor";
import { formatBytes } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import type { ForwardInfo } from "@/lib/types";
import { Plus, Pencil, Trash2, ArrowRightLeft } from "lucide-react";
import { EmptyState } from "@/components/ui/loading-placeholder";

interface ForwardsTableProps {
  forwards: ForwardInfo[];
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ForwardsTable({ forwards }: ForwardsTableProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"add" | "edit">("add");
  const [editingForward, setEditingForward] = useState<ForwardInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ForwardInfo | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: ForwardFormData) => api.createForward(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["forwards"] });
      setEditorOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ForwardFormData }) =>
      api.updateForward(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["forwards"] });
      setEditorOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteForward(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["forwards"] });
      setDeleteTarget(null);
    },
  });

  function handleAdd() {
    setEditingForward(null);
    setEditorMode("add");
    setEditorOpen(true);
  }

  function handleEdit(fwd: ForwardInfo) {
    setEditingForward(fwd);
    setEditorMode("edit");
    setEditorOpen(true);
  }

  function handleEditorSubmit(data: ForwardFormData) {
    if (editorMode === "add") {
      createMutation.mutate(data);
    } else if (editingForward) {
      updateMutation.mutate({ id: editingForward.remote_port, data });
    }
  }

  function handleDeleteConfirm() {
    if (deleteTarget) {
      deleteMutation.mutate(deleteTarget.remote_port);
    }
  }

  const editorInitialData: ForwardFormData | null = editingForward
    ? {
        name: editingForward.name,
        bind_addr: editingForward.bind_addr,
        remote_port: editingForward.remote_port,
        protocol: editingForward.protocol,
        allowed_ips: editingForward.allowed_ips,
      }
    : null;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("server.portForwards")}</CardTitle>
            <Button variant="outline" size="sm" onClick={handleAdd}>
              <Plus className="h-4 w-4" data-icon="inline-start" />
              {t("forwards.add")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {forwards.length === 0 ? (
            <EmptyState
              icon={ArrowRightLeft}
              title={t("server.noForwards")}
              description={t("empty.noForwardsHint")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("server.fwdPort")}</TableHead>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("server.fwdProtocol")}</TableHead>
                  <TableHead>{t("server.fwdBindAddr")}</TableHead>
                  <TableHead>{t("server.fwdActiveConns")}</TableHead>
                  <TableHead>{t("connections.bytesUp")}</TableHead>
                  <TableHead>{t("connections.bytesDown")}</TableHead>
                  <TableHead>{t("server.fwdRegistered")}</TableHead>
                  <TableHead className="text-right">{t("connections.action")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {forwards.map((fwd) => (
                  <TableRow key={fwd.remote_port}>
                    <TableCell className="font-mono text-xs">
                      {fwd.remote_port}
                    </TableCell>
                    <TableCell>{fwd.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{fwd.protocol}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {fwd.bind_addr}
                    </TableCell>
                    <TableCell>{fwd.active_connections}</TableCell>
                    <TableCell title={fwd.bytes_up.toLocaleString() + " bytes"}>{formatBytes(fwd.bytes_up)}</TableCell>
                    <TableCell title={fwd.bytes_down.toLocaleString() + " bytes"}>{formatBytes(fwd.bytes_down)}</TableCell>
                    <TableCell title={new Date(fwd.registered_at).toISOString()}>{formatTimestamp(fwd.registered_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(fwd)}
                          aria-label={t("forwards.edit")}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(fwd)}
                          aria-label={t("forwards.delete")}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ForwardEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSubmit={handleEditorSubmit}
        isPending={createMutation.isPending || updateMutation.isPending}
        initialData={editorInitialData}
        mode={editorMode}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("forwards.delete")}
        description={t("forwards.deleteConfirm")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="destructive"
        onConfirm={handleDeleteConfirm}
        isPending={deleteMutation.isPending}
      />
    </>
  );
}
