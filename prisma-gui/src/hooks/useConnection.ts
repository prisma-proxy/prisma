import { useCallback } from "react";
import { useStore } from "@/store";
import { notify } from "@/store/notifications";
import { api } from "@/lib/commands";
import { useRules } from "@/store/rules";
import { convertGuiRulesToBackend } from "@/lib/buildConfig";
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
      // Merge GUI Rules page rules into the profile config before connecting.
      // The Rules page stores rules in a separate Zustand store with GUI-friendly
      // types (DOMAIN/GEOIP/DIRECT/REJECT). We convert them to the Rust backend
      // serde format (domain/geoip/direct/block) and prepend them to any existing
      // routing rules from the profile wizard.
      const config = { ...(profile.config as Record<string, unknown>) };
      const guiRules = useRules.getState().rules;
      if (guiRules.length > 0) {
        const backendRules = convertGuiRulesToBackend(guiRules);
        const routing = { ...((config.routing ?? {}) as Record<string, unknown>) };
        const existingRules = Array.isArray(routing.rules) ? routing.rules : [];
        routing.rules = [...backendRules, ...existingRules];

        // Ensure geoip_path is set when GEOIP rules are present.
        // Without a GeoIP database the backend cannot match GeoIP rules and
        // all such rules silently fail (traffic goes to proxy instead of direct).
        const hasGeoipRules = guiRules.some((r) => r.type === "GEOIP");
        if (hasGeoipRules && !routing.geoip_path) {
          // Use a well-known default — the Rust backend will also auto-search
          // common locations, but setting a hint here helps when the file is
          // in a non-standard location stored in the profile wizard state.
          const wizardGeoipPath = ((config.routing ?? {}) as Record<string, unknown>).geoip_path;
          if (wizardGeoipPath) {
            routing.geoip_path = wizardGeoipPath;
          }
          // If still empty, the Rust auto-detection in prisma-client will
          // search default locations (next to binary, data dirs, etc.)
        }

        config.routing = routing;
      }

      await api.connect(JSON.stringify(config), modes);
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

  const toggleProxyOnly = useCallback(async () => {
    const store = useStore.getState();
    if (store.connected) {
      await disconnect();
    } else {
      const profile = store.activeProfileIdx !== null
        ? store.profiles[store.activeProfileIdx]
        : store.profiles[0];
      if (profile) await connectTo(profile, 0x01); // MODE_SOCKS5 only, no system proxy
    }
  }, [connectTo, disconnect]);

  return { connectTo, disconnect, switchTo, toggle, toggleProxyOnly };
}
