import { invoke } from "@tauri-apps/api/core";
import type { Profile, Stats, UpdateInfo } from "./types";

export type { Profile, Stats, UpdateInfo };

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

  profileToUri:     (profileJson: string) =>
    invoke<string>("profile_to_uri", { profileJson }),

  profileConfigToToml: (configJson: string) =>
    invoke<string>("profile_config_to_toml", { configJson }),

  checkUpdate:      () =>
    invoke<UpdateInfo | null>("check_update"),

  applyUpdate:      (url: string, sha: string) =>
    invoke<void>("apply_update", { url, sha }),

  speedTest:        (server: string, durationSecs: number) =>
    invoke<void>("speed_test", { server, durationSecs }),

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
};
