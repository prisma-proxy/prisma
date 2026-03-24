import { useEffect, useRef } from "react";
import { notify } from "../store/notifications";
import { useStore } from "../store";
import { useSettings } from "../store/settings";
import { useRules } from "../store/rules";
import { api } from "../lib/commands";
import { mergeSettingsIntoConfig } from "../lib/buildConfig";

export function useAutoReconnect() {
  const connected = useStore((s) => s.connected);
  const connecting = useStore((s) => s.connecting);
  const manualDisconnect = useStore((s) => s.manualDisconnect);
  const activeProfileIdx = useStore((s) => s.activeProfileIdx);
  const profiles = useStore((s) => s.profiles);
  const proxyModes = useStore((s) => s.proxyModes);
  const { autoReconnect, reconnectDelaySecs, reconnectMaxAttempts } = useSettings();
  const attemptsRef = useRef(0);

  // Reset counter on successful connect
  useEffect(() => {
    if (connected) attemptsRef.current = 0;
  }, [connected]);

  useEffect(() => {
    if (connected || connecting || manualDisconnect || !autoReconnect) return;
    if (reconnectMaxAttempts > 0 && attemptsRef.current >= reconnectMaxAttempts) return;

    const timer = setTimeout(async () => {
      attemptsRef.current += 1;
      const profile =
        activeProfileIdx !== null ? profiles[activeProfileIdx] : profiles[0];
      if (!profile) return;
      try {
        notify.info(`Auto-reconnecting… (attempt ${attemptsRef.current})`);
        const config = mergeSettingsIntoConfig(
          profile.config as Record<string, unknown>,
          useSettings.getState(),
          useRules.getState().rules,
        );
        useStore.getState().setConnectStartTime(Date.now());
        await api.connect(JSON.stringify(config), proxyModes);
        api.setActiveProfileId(profile.id).catch(() => {});
      } catch {
        useStore.getState().setConnectStartTime(null);
        // Next disconnect event will trigger another attempt
      }
    }, reconnectDelaySecs * 1000);

    return () => clearTimeout(timer);
  }, [
    connected, connecting, manualDisconnect, autoReconnect,
    reconnectDelaySecs, reconnectMaxAttempts,
    activeProfileIdx, profiles, proxyModes,
  ]);
}
