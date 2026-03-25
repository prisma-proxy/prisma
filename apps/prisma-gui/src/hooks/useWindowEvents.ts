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

  // Handle tray "Connect/Disconnect" toggle
  useEffect(() => {
    const unlisten = listen("tray://connect-toggle", () => { toggle(); });
    return () => { unlisten.then((f) => f()); };
  }, [toggle]);

  // Handle tray "Copy Proxy Address"
  useEffect(() => {
    const unlisten = listen("tray://copy-proxy-address", async () => {
      const socks5Port = useSettings.getState().socks5Port;
      const httpPort = useSettings.getState().httpPort;
      const host = useSettings.getState().allowLan ? "0.0.0.0" : "127.0.0.1";
      const lines: string[] = [];
      if (socks5Port > 0) lines.push(`socks5://${host}:${socks5Port}`);
      if (httpPort && httpPort > 0) lines.push(`http://${host}:${httpPort}`);
      const text = lines.join("\n") || `${host}:${socks5Port || 1080}`;
      try {
        await writeText(text);
        notify.success(`${i18n.t("profiles.copiedToClipboard")}: ${text.replace("\n", ", ")}`);
      } catch {
        notify.error(i18n.t("notifications.error"));
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Handle tray "Copy Terminal Proxy"
  useEffect(() => {
    const unlisten = listen("tray://copy-terminal-proxy", async () => {
      const httpPort = useSettings.getState().httpPort;
      if (!httpPort || httpPort <= 0) {
        notify.warning(i18n.t("tray.httpPortNotSet"));
        return;
      }
      const host = useSettings.getState().allowLan ? "0.0.0.0" : "127.0.0.1";
      const isWin = navigator.userAgent.includes("Windows");
      const cmd = isWin
        ? `set http_proxy=http://${host}:${httpPort} && set https_proxy=http://${host}:${httpPort}`
        : `export http_proxy=http://${host}:${httpPort}; export https_proxy=http://${host}:${httpPort}`;
      try {
        await writeText(cmd);
        notify.success(i18n.t("tray.copiedTerminalProxy"));
      } catch {
        notify.error(i18n.t("notifications.error"));
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

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
}
