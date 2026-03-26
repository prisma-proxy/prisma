"use client";

import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SkeletonCard } from "@/components/ui/skeleton";
import { Save } from "lucide-react";

export function ConsoleSettingsForm() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["console-settings"],
    queryFn: api.getSettings,
  });

  const [registrationEnabled, setRegistrationEnabled] = React.useState(true);
  const [defaultUserRole, setDefaultUserRole] = React.useState("client");
  const [sessionExpiryHours, setSessionExpiryHours] = React.useState(24);
  const [autoBackupIntervalMins, setAutoBackupIntervalMins] = React.useState(0);
  const [initialized, setInitialized] = React.useState(false);

  React.useEffect(() => {
    if (data?.settings && !initialized) {
      setRegistrationEnabled(data.settings.registration_enabled === "true");
      setDefaultUserRole(data.settings.default_user_role || "client");
      setSessionExpiryHours(parseInt(data.settings.session_expiry_hours || "24", 10));
      setAutoBackupIntervalMins(parseInt(data.settings.auto_backup_interval_mins || "0", 10));
      setInitialized(true);
    }
  }, [data, initialized]);

  const mutation = useMutation({
    mutationFn: (settings: Record<string, string>) => api.updateSettings(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["console-settings"] });
      toast(t("toast.settingsSaved"), "success");
    },
    onError: () => {
      toast(t("common.error"), "error");
    },
  });

  const handleSave = () => {
    mutation.mutate({
      registration_enabled: String(registrationEnabled),
      default_user_role: defaultUserRole,
      session_expiry_hours: String(sessionExpiryHours),
      auto_backup_interval_mins: String(autoBackupIntervalMins),
    });
  };

  if (isLoading) {
    return <SkeletonCard className="h-64" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.console") || t("consoleSettings.enableRegistration")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Registration toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{t("consoleSettings.enableRegistration")}</p>
              <p className="text-xs text-muted-foreground">
                {t("consoleSettings.enableRegistrationDesc")}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={registrationEnabled}
              onClick={() => setRegistrationEnabled(!registrationEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                registrationEnabled ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
                  registrationEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {/* Default user role */}
          <div>
            <label className="text-sm font-medium">{t("consoleSettings.defaultRole")}</label>
            <p className="text-xs text-muted-foreground mb-2">
              {t("consoleSettings.defaultRoleDesc")}
            </p>
            <select
              value={defaultUserRole}
              onChange={(e) => setDefaultUserRole(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="client">{t("users.client")}</option>
              <option value="operator">{t("users.operator")}</option>
            </select>
          </div>

          {/* Session expiry */}
          <div>
            <label className="text-sm font-medium">{t("consoleSettings.sessionExpiry")}</label>
            <p className="text-xs text-muted-foreground mb-2">
              {t("consoleSettings.sessionExpiryDesc")}
            </p>
            <input
              type="number"
              min={1}
              max={720}
              value={sessionExpiryHours}
              onChange={(e) => setSessionExpiryHours(parseInt(e.target.value, 10) || 24)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {/* Auto-backup interval */}
          <div>
            <label className="text-sm font-medium">{t("consoleSettings.backupInterval")}</label>
            <p className="text-xs text-muted-foreground mb-2">
              {t("consoleSettings.backupIntervalDesc")}
            </p>
            <input
              type="number"
              min={0}
              max={10080}
              value={autoBackupIntervalMins}
              onChange={(e) => setAutoBackupIntervalMins(parseInt(e.target.value, 10) || 0)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={mutation.isPending}>
              <Save className="h-4 w-4 mr-1.5" />
              {mutation.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
