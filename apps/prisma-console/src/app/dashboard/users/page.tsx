"use client";

import React, { useState, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { useRole } from "@/components/auth/role-guard";
import { useUsers, useCreateUser, useUpdateUser, useDeleteUser } from "@/hooks/use-users";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SkeletonTable } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/loading-placeholder";
import { ShieldAlert, UserPlus, Users, Pencil, Trash2 } from "lucide-react";
import type { UserInfo } from "@/lib/types";

const ROLES = ["admin", "operator", "client"] as const;
type Role = (typeof ROLES)[number];

const ROLE_BADGE_CLASS: Record<Role, string> = {
  admin: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  operator: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  client: "bg-green-500/15 text-green-700 dark:text-green-400",
};

export default function UsersPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { isAdmin } = useRole();
  const { data: users, isLoading } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();

  // Add user dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("client");

  // Edit role state
  const [editUser, setEditUser] = useState<UserInfo | null>(null);
  const [editRole, setEditRole] = useState<Role>("client");

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handleCreate = useCallback(() => {
    if (!newUsername.trim() || !newPassword.trim()) return;
    createUser.mutate(
      { username: newUsername.trim(), password: newPassword, role: newRole },
      {
        onSuccess: () => {
          toast(t("users.created"), "success");
          setAddOpen(false);
          setNewUsername("");
          setNewPassword("");
          setNewRole("client");
        },
        onError: (err: Error) => {
          toast(err.message, "error");
        },
      }
    );
  }, [newUsername, newPassword, newRole, createUser, toast, t]);

  const handleUpdateRole = useCallback(() => {
    if (!editUser) return;
    updateUser.mutate(
      { username: editUser.username, data: { role: editRole } },
      {
        onSuccess: () => {
          toast(t("users.updated"), "success");
          setEditUser(null);
        },
        onError: (err: Error) => {
          toast(err.message, "error");
        },
      }
    );
  }, [editUser, editRole, updateUser, toast, t]);

  const handleToggleEnabled = useCallback(
    (username: string, enabled: boolean) => {
      updateUser.mutate(
        { username, data: { enabled } },
        {
          onSuccess: () => {
            toast(t("users.updated"), "success");
          },
          onError: (err: Error) => {
            toast(err.message, "error");
          },
        }
      );
    },
    [updateUser, toast, t]
  );

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    deleteUser.mutate(deleteTarget, {
      onSuccess: () => {
        toast(t("users.deleted"), "success");
        setDeleteTarget(null);
      },
      onError: (err: Error) => {
        toast(err.message, "error");
      },
    });
  }, [deleteTarget, deleteUser, toast, t]);

  // Access denied for non-admins
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldAlert className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold">{t("role.accessDenied")}</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-md">
          {t("role.accessDeniedDesc")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">
          {t("users.title")}
        </h2>
        <Button onClick={() => setAddOpen(true)}>
          <UserPlus className="h-4 w-4 mr-1.5" />
          {t("users.addUser")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("users.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <SkeletonTable rows={4} />
          ) : !users || users.length === 0 ? (
            <EmptyState
              icon={Users}
              title={t("users.noUsers")}
              description={t("users.noUsersHint")}
              action={
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <UserPlus className="h-4 w-4 mr-1.5" />
                  {t("users.addUser")}
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("users.username")}</TableHead>
                  <TableHead>{t("users.role")}</TableHead>
                  <TableHead>{t("users.status")}</TableHead>
                  <TableHead className="text-right">
                    {t("users.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.username}>
                    <TableCell className="font-medium">
                      {user.username}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          ROLE_BADGE_CLASS[user.role as Role] ??
                          ROLE_BADGE_CLASS.client
                        }
                      >
                        {t(`users.${user.role}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={user.enabled}
                        onCheckedChange={(checked: boolean) =>
                          handleToggleEnabled(user.username, checked)
                        }
                        size="sm"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditUser(user);
                            setEditRole(user.role as Role);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" data-icon="inline-start" />
                          {t("users.editRole")}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setDeleteTarget(user.username)}
                        >
                          <Trash2 className="h-3.5 w-3.5" data-icon="inline-start" />
                          {t("common.delete")}
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

      {/* Add User Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("users.addUser")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="new-username">{t("users.username")}</Label>
              <Input
                id="new-username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder={t("users.username")}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="new-password">{t("users.password")}</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t("users.password")}
                autoComplete="new-password"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("users.role")}</Label>
              <Select
                value={newRole}
                onValueChange={(v) => v && setNewRole(v as Role)}
              >
                <SelectTrigger className="w-full">
                  <span className="flex flex-1 text-left">
                    {t(`users.${newRole}`)}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`users.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddOpen(false)}
              disabled={createUser.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                createUser.isPending ||
                !newUsername.trim() ||
                !newPassword.trim()
              }
            >
              {createUser.isPending ? "..." : t("users.addUser")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Role Dialog */}
      <Dialog
        open={editUser !== null}
        onOpenChange={(open) => {
          if (!open) setEditUser(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("users.editRole")} — {editUser?.username}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-1.5">
              <Label>{t("users.role")}</Label>
              <Select
                value={editRole}
                onValueChange={(v) => v && setEditRole(v as Role)}
              >
                <SelectTrigger className="w-full">
                  <span className="flex flex-1 text-left">
                    {t(`users.${editRole}`)}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`users.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditUser(null)}
              disabled={updateUser.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleUpdateRole}
              disabled={updateUser.isPending}
            >
              {updateUser.isPending ? "..." : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t("users.deleteUser")}
        description={t("users.deleteConfirm", {
          username: deleteTarget ?? "",
        })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="destructive"
        onConfirm={handleDelete}
        isPending={deleteUser.isPending}
      />
    </div>
  );
}
