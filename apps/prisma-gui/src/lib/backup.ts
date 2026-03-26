import { useSettings, type AppSettings } from "@/store/settings";
import { useStore } from "@/store";
import { useRules } from "@/store/rules";
import { useRuleProviders } from "@/store/ruleProviders";
import { useSpeedTestHistory } from "@/store/speedTestHistory";
import { useConnectionHistory } from "@/store/connectionHistory";
import { useProfileMetrics, type ProfileMetrics } from "@/store/profileMetrics";
import { useDataUsage } from "@/store/dataUsage";
import { notify } from "@/store/notifications";
import { api } from "@/lib/commands";
import { downloadJson, pickJsonFile } from "@/lib/utils";
import type { TFunction } from "i18next";

export const SETTINGS_KEYS: (keyof AppSettings)[] = [
  "language", "theme", "startOnBoot", "minimizeToTray",
  "socks5Port", "httpPort", "dnsMode", "dnsUpstream", "fakeIpRange",
  "autoReconnect", "reconnectDelaySecs", "reconnectMaxAttempts",
  "logLevel", "logFormat",
  "tunEnabled", "tunDevice", "tunMtu", "tunIncludeRoutes", "tunExcludeRoutes",
  "portForwards", "routingGeoipPath", "routingGeositePath",
  "connectionPoolEnabled",
];

export async function exportSettings(t: TFunction) {
  const allSettings = useSettings.getState();
  const data: Record<string, unknown> = {};
  for (const k of SETTINGS_KEYS) data[k] = allSettings[k];
  const payload = {
    version: __APP_VERSION__,
    exportedAt: new Date().toISOString(),
    settings: data,
  };
  await downloadJson(payload, `prisma-settings-${Date.now()}.json`);
  notify.success(t("settings.settingsExported"));
}

export async function importSettings(
  t: TFunction,
  patch: (v: Partial<AppSettings>) => void,
  changeLanguage: (lang: string) => void,
) {
  const data = await pickJsonFile() as Record<string, unknown>;
  const s = data.settings as Record<string, unknown> | undefined;
  if (!s) throw new Error("Invalid settings file");
  const imported: Partial<AppSettings> = {};
  for (const k of SETTINGS_KEYS) {
    if (k in s) (imported as Record<string, unknown>)[k] = s[k];
  }
  patch(imported);
  if (imported.language) changeLanguage(imported.language);
  notify.success(t("settings.settingsImported"));
}

export function resetSettings(
  patch: (v: Partial<AppSettings>) => void,
  changeLanguage: (lang: string) => void,
  t: TFunction,
) {
  patch({
    language: "en",
    theme: "system",
    startOnBoot: false,
    minimizeToTray: true,
    socks5Port: 0,
    httpPort: 8080,
    dnsMode: "direct",
    dnsUpstream: "8.8.8.8:53",
    fakeIpRange: "198.18.0.0/15",
    autoReconnect: false,
    reconnectDelaySecs: 5,
    reconnectMaxAttempts: 5,
    logLevel: "info",
    logFormat: "pretty",
    tunEnabled: false,
    tunDevice: "prisma-tun0",
    tunMtu: 1500,
    tunIncludeRoutes: "",
    tunExcludeRoutes: "",
    portForwards: "",
    routingGeoipPath: "",
    routingGeositePath: "",
    connectionPoolEnabled: true,
  });
  changeLanguage("en");
  notify.success(t("settings.settingsReset"));
}

export function clearAllData(
  t: TFunction,
  clearHistory: () => void,
  clearNotifications: () => void,
  clearLogs: () => void,
) {
  clearHistory();
  clearNotifications();
  clearLogs();
  useProfileMetrics.setState({ metrics: {} });
  useSpeedTestHistory.getState().clear();
  useDataUsage.getState().clear();
  notify.success(t("settings.allDataCleared"));
}

export async function exportFullBackup(t: TFunction) {
  let profiles = useStore.getState().profiles;
  if (profiles.length === 0) {
    try {
      profiles = await api.listProfiles();
      useStore.getState().setProfiles(profiles);
    } catch { /* use whatever is in store */ }
  }

  const allSettings = useSettings.getState();
  const settingsData: Record<string, unknown> = {};
  for (const k of SETTINGS_KEYS) settingsData[k] = allSettings[k];

  const backup = {
    version: __APP_VERSION__,
    exportedAt: new Date().toISOString(),
    settings: settingsData,
    profiles,
    rules: useRules.getState().rules,
    ruleProviders: useRuleProviders.getState().providers,
    speedTestHistory: useSpeedTestHistory.getState().entries,
    connectionHistory: useConnectionHistory.getState().events,
    profileMetrics: useProfileMetrics.getState().metrics,
    dataUsage: useDataUsage.getState().daily,
  };

  await downloadJson(backup, `prisma-backup-${Date.now()}.json`);
  notify.success(t("settings.backupExported"));
}

export async function importFullBackup(
  t: TFunction,
  patch: (v: Partial<AppSettings>) => void,
  changeLanguage: (lang: string) => void,
) {
  let data: Record<string, unknown>;
  try {
    data = await pickJsonFile() as Record<string, unknown>;
  } catch {
    return; // user cancelled or invalid file
  }

  if (!data || typeof data !== "object") {
    notify.error(t("notifications.error"));
    return;
  }

  const errors: string[] = [];

  // Restore settings
  if (data.settings && typeof data.settings === "object") {
    try {
      const s = data.settings as Record<string, unknown>;
      const imported: Partial<AppSettings> = {};
      for (const k of SETTINGS_KEYS) {
        if (k in s) (imported as Record<string, unknown>)[k] = s[k];
      }
      patch(imported);
      if (imported.language) changeLanguage(imported.language);
    } catch { errors.push("settings"); }
  }

  // Restore profiles
  if (Array.isArray(data.profiles) && data.profiles.length > 0) {
    try {
      const existing = await api.listProfiles();
      await Promise.all(existing.map((p) => api.deleteProfile(p.id).catch(() => {})));
      const valid = data.profiles.filter((p: unknown) => p && typeof p === "object" && (p as Record<string, unknown>).id && (p as Record<string, unknown>).name);
      await Promise.all(valid.map((p: unknown) => api.saveProfile(JSON.stringify(p)).catch(() => {})));
      const refreshed = await api.listProfiles();
      useStore.getState().setProfiles(refreshed);
      api.refreshTrayProfiles().catch(() => {});
    } catch { errors.push("profiles"); }
  }

  // Restore rules
  if (Array.isArray(data.rules)) {
    try {
      useRules.setState({ rules: data.rules.filter((r: unknown) => r && typeof r === "object" && (r as Record<string, unknown>).id) });
    } catch { errors.push("rules"); }
  }

  // Restore rule providers
  if (Array.isArray(data.ruleProviders)) {
    try {
      useRuleProviders.setState({ providers: data.ruleProviders.filter((p: unknown) => p && typeof p === "object" && (p as Record<string, unknown>).id) });
    } catch { errors.push("ruleProviders"); }
  }

  // Restore speed test history
  if (Array.isArray(data.speedTestHistory)) {
    try {
      useSpeedTestHistory.setState({ entries: data.speedTestHistory });
    } catch { errors.push("speedTestHistory"); }
  }

  // Restore connection history
  if (Array.isArray(data.connectionHistory)) {
    try {
      useConnectionHistory.setState({ events: data.connectionHistory });
    } catch { errors.push("connectionHistory"); }
  }

  // Restore profile metrics
  if (data.profileMetrics && typeof data.profileMetrics === "object" && !Array.isArray(data.profileMetrics)) {
    try {
      useProfileMetrics.setState({ metrics: data.profileMetrics as Record<string, ProfileMetrics> });
    } catch { errors.push("profileMetrics"); }
  }

  // Restore data usage
  if (data.dataUsage && typeof data.dataUsage === "object" && !Array.isArray(data.dataUsage)) {
    try {
      useDataUsage.setState({ daily: data.dataUsage as Record<string, { up: number; down: number }> });
    } catch { errors.push("dataUsage"); }
  }

  if (errors.length > 0) {
    notify.warning(t("settings.backupImported", { count: 8 - errors.length }));
  } else {
    notify.success(t("settings.backupImported", { count: 8 - errors.length }));
  }
}

/** Export a console-compatible config JSON containing settings, rules, and rule providers. */
export async function exportConsoleConfig(t: TFunction) {
  const allSettings = useSettings.getState();
  const settingsData: Record<string, unknown> = {};
  for (const k of SETTINGS_KEYS) settingsData[k] = allSettings[k];

  const payload = {
    version: __APP_VERSION__,
    exportedAt: new Date().toISOString(),
    settings: settingsData,
    rules: useRules.getState().rules,
    ruleProviders: useRuleProviders.getState().providers,
  };

  await downloadJson(payload, `prisma-config-${Date.now()}.json`);
  notify.success(t("settings.configExported"));
}

/** Import a console-compatible config JSON containing settings, rules, and/or rule providers. */
export async function importConsoleConfig(
  t: TFunction,
  patch: (v: Partial<AppSettings>) => void,
  changeLanguage: (lang: string) => void,
) {
  let data: Record<string, unknown>;
  try {
    data = await pickJsonFile() as Record<string, unknown>;
  } catch {
    return;
  }

  if (!data || typeof data !== "object") {
    notify.error(t("notifications.error"));
    return;
  }

  const errors: string[] = [];

  // Restore settings
  if (data.settings && typeof data.settings === "object") {
    try {
      const s = data.settings as Record<string, unknown>;
      const imported: Partial<AppSettings> = {};
      for (const k of SETTINGS_KEYS) {
        if (k in s) (imported as Record<string, unknown>)[k] = s[k];
      }
      patch(imported);
      if (imported.language) changeLanguage(imported.language);
    } catch { errors.push("settings"); }
  }

  // Restore rules
  if (Array.isArray(data.rules)) {
    try {
      useRules.setState({ rules: data.rules.filter((r: unknown) => r && typeof r === "object" && (r as Record<string, unknown>).id) });
    } catch { errors.push("rules"); }
  }

  // Restore rule providers
  if (Array.isArray(data.ruleProviders)) {
    try {
      useRuleProviders.setState({ providers: data.ruleProviders.filter((p: unknown) => p && typeof p === "object" && (p as Record<string, unknown>).id) });
    } catch { errors.push("ruleProviders"); }
  }

  if (errors.length > 0) {
    notify.warning(t("settings.configImported"));
  } else {
    notify.success(t("settings.configImported"));
  }
}
