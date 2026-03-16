import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettings } from "../store/settings";

export function useWindowEvents() {
  const minimizeToTray = useSettings((s) => s.minimizeToTray);

  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested((event) => {
      if (minimizeToTray) {
        event.preventDefault();
        win.hide();
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, [minimizeToTray]);
}
