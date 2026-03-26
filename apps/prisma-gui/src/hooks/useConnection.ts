import { useCallback } from "react";
import { useStore } from "@/store";
import { notify } from "@/store/notifications";
import { api } from "@/lib/commands";
import { useRules } from "@/store/rules";
import { useRuleProviders } from "@/store/ruleProviders";
import { useSettings } from "@/store/settings";
import { mergeSettingsIntoConfig } from "@/lib/buildConfig";
import type { Profile } from "@/lib/types";
import { MODE_SOCKS5, MODE_SYSTEM_PROXY } from "@/lib/types";

export function useConnection() {
  const setActiveProfileIdx = useStore((s) => s.setActiveProfileIdx);
  const setManualDisconnect = useStore((s) => s.setManualDisconnect);
  const setConnectStartTime = useStore((s) => s.setConnectStartTime);
  const setConnected = useStore((s) => s.setConnected);
  const setProxyModes = useSettings((s) => s.setProxyModes);

  const connectTo = useCallback(async (profile: Profile, modes: number): Promise<boolean> => {
    const profiles = useStore.getState().profiles;
    const idx = profiles.findIndex((p) => p.id === profile.id);
    if (idx >= 0) setActiveProfileIdx(idx);
    setConnectStartTime(Date.now());
    try {
      const enabledProviders = useRuleProviders.getState().providers
        .filter((p) => p.enabled)
        .map((p) => ({ name: p.name, url: p.url, behavior: p.behavior, action: p.action }));
      const config = mergeSettingsIntoConfig(
        profile.config as Record<string, unknown>,
        useSettings.getState(),
        useRules.getState().rules,
        enabledProviders.length > 0 ? enabledProviders : undefined,
      );
      const routing = config.routing as { rules?: unknown[] } | undefined;
      console.log(`[connect] ${routing?.rules?.length ?? 0} routing rules, ${enabledProviders.length} providers`);

      const CONNECT_TIMEOUT = 30_000;
      await Promise.race([
        api.connect(JSON.stringify(config), modes),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Connection timed out after 30s")), CONNECT_TIMEOUT)
        ),
      ]);
      api.setActiveProfileId(profile.id).catch(() => {});
      return true;
    } catch (e) {
      notify.error(String(e));
      setConnectStartTime(null);
      // Clear connecting state so the UI isn't stuck on "Connecting..."
      // when the backend rejects the connect call.
      setConnected(false);
      return false;
    }
  }, [setActiveProfileIdx, setConnectStartTime, setConnected]);

  const disconnect = useCallback(async () => {
    try {
      setManualDisconnect(true);
      await api.disconnect();
    } catch (e) {
      notify.error(String(e));
    }
    // Don't update UI state here — the backend fires "status_changed:disconnected"
    // AFTER the client fully shuts down (services stopped, system proxy cleared).
    // usePrismaEvents handles all cleanup when that event arrives.
  }, [setManualDisconnect]);

  const switchTo = useCallback(async (profile: Profile, modes: number) => {
    setManualDisconnect(true);
    try { await api.disconnect(); } catch {}
    // Brief delay so the disconnect event propagates before we clear the
    // manualDisconnect flag — prevents useAutoReconnect from firing.
    await new Promise(r => setTimeout(r, 100));
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
      if (profile) await connectTo(profile, useSettings.getState().proxyModes);
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
      if (profile) {
        // Update store first so the status_changed event handler reads MODE_SOCKS5
        // and does not call api.setSystemProxy() when connected event fires.
        setProxyModes(MODE_SOCKS5);
        await connectTo(profile, MODE_SOCKS5);
      }
    }
  }, [connectTo, disconnect, setProxyModes]);

  const switchProxyMode = useCallback(async (oldModes: number, newModes: number) => {
    if (newModes === 0) newModes = MODE_SYSTEM_PROXY;
    const store = useStore.getState();
    if (store.connected) {
      const hadSystem = (oldModes & MODE_SYSTEM_PROXY) !== 0;
      const hasSystem = (newModes & MODE_SYSTEM_PROXY) !== 0;
      if (hadSystem && !hasSystem) {
        api.clearSystemProxy().catch(() => {});
      } else if (!hadSystem && hasSystem) {
        const httpPort = useSettings.getState().httpPort || 0;
        if (httpPort > 0) {
          api.setSystemProxy("127.0.0.1", httpPort).catch(() => {});
        }
      }
    }
    setProxyModes(newModes);
    api.setTrayProxyMode(newModes).catch(() => {});
  }, [setProxyModes]);

  return { connectTo, disconnect, switchTo, toggle, toggleProxyOnly, switchProxyMode };
}
