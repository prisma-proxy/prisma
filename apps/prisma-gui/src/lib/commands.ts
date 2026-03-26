import { invoke } from "@tauri-apps/api/core";
import type { Profile, Stats, UpdateInfo, ImportResult, PerAppFilter, BatteryStatus } from "./types";

export type { Profile, Stats, UpdateInfo, ImportResult, PerAppFilter, BatteryStatus };

export const api = {
  connect:          (configJson: string, modes: number) =>
    invoke<void>("connect", { configJson, modes }),

  disconnect:       () =>
    invoke<void>("disconnect"),

  getStatus:        () =>
    invoke<number>("get_status"),

  getStats:         () =>
    invoke<Stats | null>("get_stats"),

  listProfiles:     () =>
    invoke<Profile[]>("list_profiles"),

  saveProfile:      (profileJson: string) =>
    invoke<void>("save_profile", { profileJson }),

  deleteProfile:    (id: string) =>
    invoke<void>("delete_profile", { id }),

  profileToQr:      (profileJson: string) =>
    invoke<string>("profile_to_qr", { profileJson }),

  profileFromQr:    (data: string) =>
    invoke<string>("profile_from_qr", { data }),

  decodeQrImage:    (path: string) =>
    invoke<string>("decode_qr_image", { path }),

  profileToUri:     (profileJson: string) =>
    invoke<string>("profile_to_uri", { profileJson }),

  profileConfigToToml: (configJson: string) =>
    invoke<string>("profile_config_to_toml", { configJson }),

  importSubscription: (url: string) =>
    invoke<ImportResult>("import_subscription", { url }),

  refreshSubscriptions: () =>
    invoke<ImportResult>("refresh_subscriptions"),

  checkUpdate:      (proxyPort?: number) =>
    invoke<UpdateInfo | null>("check_update", { proxyPort: proxyPort ?? 0 }),

  applyUpdate:      (url: string, sha: string, proxyPort?: number) =>
    invoke<void>("apply_update", { url, sha, proxyPort: proxyPort ?? 0 }),

  pingServer:       (addr: string) =>
    invoke<number>("ping_server", { addr }),

  speedTest:        (server: string, durationSecs: number) =>
    invoke<void>("speed_test", { server, durationSecs }),

  getPacUrl:        (pacPort: number = 0) =>
    invoke<string>("get_pac_url", { pacPort }),

  setSystemProxy:   (host: string, port: number) =>
    invoke<void>("set_system_proxy", { host, port }),

  clearSystemProxy: () =>
    invoke<void>("clear_system_proxy"),

  refreshTrayProfiles: () =>
    invoke<void>("refresh_tray_profiles"),

  setActiveProfileId: (id: string) =>
    invoke<void>("set_active_profile_id", { id }),

  setTrayPort: (port: number) =>
    invoke<void>("set_tray_port", { port }),

  setTrayProxyMode: (mode: number) =>
    invoke<void>("set_tray_proxy_mode", { mode }),

  getActiveProfileId: () =>
    invoke<string | null>("get_active_profile_id"),

  getProxyMode: () =>
    invoke<number>("get_proxy_mode"),

  updateTrayStats: (
    upBps: number,
    downBps: number,
    bytesUp: number,
    bytesDown: number,
    connections: number,
    profileName: string,
    uptimeSecs: number,
  ) =>
    invoke<void>("update_tray_stats", {
      upBps,
      downBps,
      bytesUp,
      bytesDown,
      connections,
      profileName,
      uptimeSecs,
    }),

  updateTrayRecent: (destinations: string[]) =>
    invoke<void>("update_tray_recent", { destinations }),

  syncTrayToggles: (autoConnect: boolean, allowLan: boolean, tunEnabled: boolean) =>
    invoke<void>("sync_tray_toggles", { autoConnect, allowLan, tunEnabled }),

  // Per-app proxy
  setPerAppFilter: (filterJson: string) =>
    invoke<void>("set_per_app_filter", { filterJson }),

  clearPerAppFilter: () =>
    invoke<void>("clear_per_app_filter"),

  getRunningApps: () =>
    invoke<string[]>("get_running_apps"),

  getPerAppFilter: () =>
    invoke<PerAppFilter | null>("get_per_app_filter"),

  checkElevation: () =>
    invoke<boolean>("check_elevation"),

  getProfilesDir: () =>
    invoke<string>("get_profiles_dir"),

  openFolder: (path: string) =>
    invoke<void>("open_folder", { path }),

  downloadFile: (url: string, destPath: string, proxyPort: number) =>
    invoke<void>("download_file", { url, destPath, proxyPort }),

  // ── Mobile commands ────────────────────────────────────────────────
  checkVpnPermission: () =>
    invoke<boolean>("check_vpn_permission"),

  requestVpnPermission: () =>
    invoke<boolean>("request_vpn_permission"),

  getNetworkType: () =>
    invoke<number>("get_network_type"),

  onNetworkChange: (networkType: number) =>
    invoke<void>("on_network_change", { networkType }),

  getBatteryStatus: () =>
    invoke<BatteryStatus>("get_battery_status"),

  onAppBackground: () =>
    invoke<void>("on_app_background"),

  onAppForeground: () =>
    invoke<void>("on_app_foreground"),

  onMemoryWarning: () =>
    invoke<void>("on_memory_warning"),

  // ── Rule providers ─────────────────────────────────────────────────
  updateRuleProvider: (id: string, name: string, url: string, behavior: string, action: string, proxyPort: number) =>
    invoke<{ id: string; rule_count: number; updated_at_epoch: number }>(
      "update_rule_provider", { id, name, url, behavior, action, proxyPort }
    ),

  listRuleProviders: () =>
    invoke<unknown[]>("list_rule_providers"),
};
