import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../store/settings";

export function useWindowEvents() {
  const minimizeToTray = useSettings((s) => s.minimizeToTray);

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
}
