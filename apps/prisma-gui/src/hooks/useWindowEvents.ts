import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import i18n from "../i18n";
import { useSettings } from "../store/settings";
import { useStore } from "../store";
import { useConnection } from "./useConnection";
import { notify } from "../store/notifications";
import { api } from "../lib/commands";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useRuleProviders } from "../store/ruleProviders";

export function useWindowEvents() {
  const minimizeToTray = useSettings((s) => s.minimizeToTray);
  const socks5Port = useSettings((s) => s.socks5Port);
  const { switchTo, toggle, switchProxyMode } = useConnection();

  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested(async (event) => {
      event.preventDefault();
      if (minimizeToTray) {
        await win.hide();
      } else {
        await invoke("quit_app");
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, [minimizeToTray]);

  // Sync socks5 port to tray on init and change
  useEffect(() => {
    api.setTrayPort(socks5Port).catch(() => {});
  }, [socks5Port]);

  // Sync toggle states to tray on init
  useEffect(() => {
    const s = useSettings.getState();
    api.syncTrayToggles(s.startOnBoot, s.allowLan, s.tunEnabled).catch(() => {});
  }, []);

  // Handle tray "Connect/Disconnect" toggle
  useEffect(() => {
    const unlisten = listen("tray://connect-toggle", () => { toggle(); });
    return () => { unlisten.then((f) => f()); };
  }, [toggle]);

  // Handle tray proxy mode change
  useEffect(() => {
    const unlisten = listen<number>("tray://proxy-mode-change", (event) => {
      const newMode = event.payload;
      const currentModes = useSettings.getState().proxyModes;
      switchProxyMode(currentModes, newMode);
    });
    return () => { unlisten.then((f) => f()); };
  }, [switchProxyMode]);

  // Handle tray profile selection
  useEffect(() => {
    const unlisten = listen<string>("tray://profile-select", (event) => {
      const profileId = event.payload;
      const store = useStore.getState();
      const profile = store.profiles.find((p) => p.id === profileId);
      if (profile) switchTo(profile, useSettings.getState().proxyModes);
    });
    return () => { unlisten.then((f) => f()); };
  }, [switchTo]);

  // Stateless tray event listeners (all read latest state via getState())
  useEffect(() => {
    const unlisteners = [
      listen("tray://copy-proxy-address", async () => {
        const s = useSettings.getState();
        const host = s.allowLan ? "0.0.0.0" : "127.0.0.1";
        const lines: string[] = [];
        if (s.socks5Port > 0) lines.push(`socks5://${host}:${s.socks5Port}`);
        if (s.httpPort && s.httpPort > 0) lines.push(`http://${host}:${s.httpPort}`);
        const text = lines.join("\n") || `${host}:${s.socks5Port || 1080}`;
        try {
          await writeText(text);
          notify.success(`${i18n.t("profiles.copiedToClipboard")}: ${text.replace("\n", ", ")}`);
        } catch {
          notify.error(i18n.t("notifications.error"));
        }
      }),
      listen("tray://copy-terminal-proxy", async () => {
        const s = useSettings.getState();
        if (!s.httpPort || s.httpPort <= 0) {
          notify.warning(i18n.t("tray.httpPortNotSet"));
          return;
        }
        const host = s.allowLan ? "0.0.0.0" : "127.0.0.1";
        const isWin = navigator.userAgent.includes("Windows");
        const cmd = isWin
          ? `set http_proxy=http://${host}:${s.httpPort} && set https_proxy=http://${host}:${s.httpPort}`
          : `export http_proxy=http://${host}:${s.httpPort}; export https_proxy=http://${host}:${s.httpPort}`;
        try {
          await writeText(cmd);
          notify.success(i18n.t("tray.copiedTerminalProxy"));
        } catch {
          notify.error(i18n.t("notifications.error"));
        }
      }),
      listen("tray://check-update", async () => {
        try {
          const info = await api.checkUpdate();
          if (info && info.version) {
            useStore.getState().setUpdateAvailable(info);
            notify.info(i18n.t("tray.updateAvailable", { version: info.version }));
          } else {
            notify.success(i18n.t("tray.upToDate"));
          }
        } catch {
          notify.error(i18n.t("tray.updateCheckFailed"));
        }
      }),
      listen("tray://update-providers", async () => {
        const providers = useRuleProviders.getState().providers.filter((p) => p.enabled);
        if (providers.length === 0) {
          notify.info(i18n.t("tray.noEnabledProviders"));
          return;
        }
        let successCount = 0;
        const store = useStore.getState();
        const proxyPort = store.connected ? (useSettings.getState().httpPort || 0) : 0;
        for (const p of providers) {
          try {
            const result = await api.updateRuleProvider(
              p.id, p.name, p.url, p.behavior, p.action, proxyPort,
            );
            useRuleProviders.getState().updateProviderStatus(
              p.id, result.rule_count, new Date().toISOString(),
            );
            successCount++;
          } catch {
            // Continue updating remaining providers
          }
        }
        notify.success(i18n.t("tray.providersUpdated", { count: successCount }));
      }),
      listen<{ key: string; value: boolean }>("tray://toggle-setting", (event) => {
        const { key, value } = event.payload;
        const settings = useSettings.getState();
        switch (key) {
          case "autoConnect":
            settings.patch({ startOnBoot: value });
            break;
          case "allowLan":
            settings.patch({ allowLan: value });
            break;
          case "tunEnabled":
            settings.patch({ tunEnabled: value });
            break;
        }
      }),
    ];
    return () => { for (const u of unlisteners) u.then((f) => f()); };
  }, []);
}
