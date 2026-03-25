import { useEffect } from "react";
import { useStore } from "../store";
import { api } from "../lib/commands";

const STATUS_CONNECTING = 1;
const STATUS_CONNECTED = 2;

export function useStatusSync() {
  useEffect(() => {
    let cancelled = false;

    async function syncStatus() {
      try {
        const status = await api.getStatus();
        if (cancelled) return;

        if (status === STATUS_CONNECTED) {
          useStore.getState().setConnected(true);

          // Restore proxy mode from backend
          try {
            const mode = await api.getProxyMode();
            if (!cancelled) useStore.getState().setProxyModes(mode);
          } catch { /* ignore */ }

          // Restore active profile index
          try {
            const activeId = await api.getActiveProfileId();
            const profiles = await api.listProfiles();
            if (!cancelled && Array.isArray(profiles)) {
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
            if (!cancelled && stats) useStore.getState().setStats(stats);
          } catch { /* ignore */ }
        } else if (status === STATUS_CONNECTING) {
          useStore.getState().setConnecting(true);
        }
        // STATUS_DISCONNECTED (0): store default is already false
      } catch {
        // Backend not ready or client not initialized
      }
    }

    syncStatus();
    return () => { cancelled = true; };
  }, []);
}
