import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "../store";
import { useSettings } from "../store/settings";
import { api } from "../lib/commands";

const STATUS_CONNECTING = 1;
const STATUS_CONNECTED = 2;

export async function syncStatus() {
  try {
    const status = await api.getStatus();
    const store = useStore.getState();

    if (status === STATUS_CONNECTED && !store.connected) {
      store.setConnected(true);

      // Restore proxy mode from backend
      try {
        const mode = await api.getProxyMode();
        useSettings.getState().setProxyModes(mode);
        api.setTrayProxyMode(mode).catch(() => {});
      } catch { /* ignore */ }

      // Restore active profile index
      try {
        const activeId = await api.getActiveProfileId();
        const profiles = await api.listProfiles();
        if (Array.isArray(profiles)) {
          useStore.getState().setProfiles(profiles);
          if (activeId) {
            const idx = profiles.findIndex((p: { id: string }) => p.id === activeId);
            if (idx >= 0) useStore.getState().setActiveProfileIdx(idx);
          }
        }
      } catch { /* ignore */ }

      // Fetch current stats
      try {
        const stats = await api.getStats();
        if (stats) useStore.getState().setStats(stats);
      } catch { /* ignore */ }
    } else if (status === STATUS_CONNECTING && !store.connecting) {
      store.setConnecting(true);
    } else if (status === 0 && store.connected) {
      store.setConnected(false);
    }
  } catch (e) {
    console.warn("[useStatusSync] Failed to sync status:", e);
  }
}

export function useStatusSync() {
  useEffect(() => {
    syncStatus();

    // Re-sync when app regains focus (covers macOS background/resume).
    // Debounce to avoid spamming backend on rapid tab switches.
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    function debouncedSync() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(syncStatus, 300);
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        debouncedSync();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);

    // Tauri desktop window focus listener — visibilitychange does not fire
    // when a desktop window is minimized/restored or loses/gains focus.
    let unlistenFocus: (() => void) | null = null;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) {
          debouncedSync();
        }
      })
      .then((fn) => {
        unlistenFocus = fn;
      });

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (debounceTimer) clearTimeout(debounceTimer);
      if (unlistenFocus) unlistenFocus();
    };
  }, []);
}
