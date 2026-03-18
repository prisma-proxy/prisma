import { useCallback } from "react";
import { useStore } from "@/store";
import { notify } from "@/store/notifications";
import { api } from "@/lib/commands";
import type { Profile } from "@/lib/types";

export function useConnection() {
  const setActiveProfileIdx = useStore((s) => s.setActiveProfileIdx);
  const setManualDisconnect = useStore((s) => s.setManualDisconnect);
  const setConnectStartTime = useStore((s) => s.setConnectStartTime);

  const connectTo = useCallback(async (profile: Profile, modes: number) => {
    const profiles = useStore.getState().profiles;
    const idx = profiles.findIndex((p) => p.id === profile.id);
    if (idx >= 0) setActiveProfileIdx(idx);
    setConnectStartTime(Date.now());
    try {
      await api.connect(JSON.stringify(profile.config), modes);
      api.setActiveProfileId(profile.id).catch(() => {});
    } catch (e) {
      notify.error(String(e));
      setConnectStartTime(null);
    }
  }, [setActiveProfileIdx, setConnectStartTime]);

  const disconnect = useCallback(async () => {
    try {
      setManualDisconnect(true);
      await api.disconnect();
      api.setActiveProfileId("").catch(() => {});
    } catch (e) {
      notify.error(String(e));
      setManualDisconnect(false);
    }
  }, [setManualDisconnect]);

  const switchTo = useCallback(async (profile: Profile, modes: number) => {
    try {
      setManualDisconnect(true);
      await api.disconnect();
    } catch {
      // Continue even if disconnect fails
    }
    setManualDisconnect(false);
    await connectTo(profile, modes);
  }, [connectTo, setManualDisconnect]);

  const toggle = useCallback(async () => {
    const store = useStore.getState();
    if (store.connected) {
      await disconnect();
    } else {
      const profile = store.activeProfileIdx !== null
        ? store.profiles[store.activeProfileIdx]
        : store.profiles[0];
      if (profile) await connectTo(profile, store.proxyModes);
    }
  }, [connectTo, disconnect]);

  return { connectTo, disconnect, switchTo, toggle };
}
