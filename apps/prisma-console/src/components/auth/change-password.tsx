"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { Input } from "@/components/ui/input";

export function ChangePassword() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const passwordsMatch = newPassword === confirmPassword;
  const canSubmit =
    !loading &&
    currentPassword.trim() !== "" &&
    newPassword.trim() !== "" &&
    confirmPassword.trim() !== "" &&
    passwordsMatch;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    try {
      await api.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      toast(t("auth.passwordChanged"), "success");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      const message =
        err instanceof Error && err.message.toLowerCase().includes("unauthorized")
          ? t("auth.wrongPassword")
          : err instanceof Error
            ? err.message
            : t("common.error");
      toast(message, "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="currentPassword" className="text-sm font-medium text-foreground">
          {t("auth.currentPassword")}
        </label>
        <Input
          id="currentPassword"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          placeholder={t("auth.currentPassword")}
          className="h-10"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="newPassword" className="text-sm font-medium text-foreground">
          {t("auth.newPassword")}
        </label>
        <Input
          id="newPassword"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          placeholder={t("auth.newPassword")}
          className="h-10"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="confirmNewPassword" className="text-sm font-medium text-foreground">
          {t("auth.confirmPassword")}
        </label>
        <Input
          id="confirmNewPassword"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          placeholder={t("auth.confirmPassword")}
          className="h-10"
        />
        {confirmPassword.length > 0 && !passwordsMatch && (
          <p className="text-xs text-destructive">{t("auth.passwordMismatch")}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {loading ? t("common.saving") : t("common.save")}
      </button>
    </form>
  );
}
