"use client";

import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import { ChangePassword } from "@/components/auth/change-password";

const ROLE_COLORS: Record<string, string> = {
  admin: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400",
  operator: "border-yellow-500/50 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  client: "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400",
};

export default function ProfilePage() {
  const { user } = useAuth();
  const { t } = useI18n();

  const role = (user?.role as string) ?? "client";
  const username = user?.username ?? "Unknown";
  const roleColor = ROLE_COLORS[role] ?? ROLE_COLORS.client;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("auth.profile")}</h1>

      {/* User info card */}
      <div className="rounded-xl border bg-card p-6 ring-1 ring-foreground/5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
            {username.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-lg font-medium text-foreground">{username}</p>
            <span
              className={`inline-block mt-1 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${roleColor}`}
            >
              {role}
            </span>
          </div>
        </div>
      </div>

      {/* Change password section */}
      <div className="rounded-xl border bg-card p-6 ring-1 ring-foreground/5 shadow-sm">
        <h2 className="mb-4 text-base font-medium">{t("auth.changePassword")}</h2>
        <div className="max-w-sm">
          <ChangePassword />
        </div>
      </div>
    </div>
  );
}
