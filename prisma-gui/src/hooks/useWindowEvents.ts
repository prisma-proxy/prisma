import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../store/settings";
import { useStore } from "../store";
import { useConnection } from "./useConnection";
import { notify } from "../store/notifications";
import { api } from "../lib/commands";

export function useWindowEvents() {
  const minimizeToTray = useSettings((s) => s.minimizeToTray);
  const socks5Port = useSettings((s) => s.socks5Port);
  const { switchTo, toggle } = useConnection();

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
      const port = useSettings.getState().socks5Port;
      const addr = `127.0.0.1:${port || 1080}`;
      try {
        await navigator.clipboard.writeText(addr);
        notify.success(`Copied: ${addr}`);
      } catch {
        notify.error("Clipboard not available");
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Handle tray profile selection
  useEffect(() => {
    const unlisten = listen<string>("tray://profile-select", (event) => {
      const profileId = event.payload;
      const store = useStore.getState();
      const profile = store.profiles.find((p) => p.id === profileId);
      if (profile) switchTo(profile, store.proxyModes);
    });
    return () => { unlisten.then((f) => f()); };
  }, [switchTo]);
}
