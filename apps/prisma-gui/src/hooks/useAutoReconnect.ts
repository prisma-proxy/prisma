import { useEffect, useRef } from "react";
import i18n from "../i18n";
import { notify } from "../store/notifications";
import { useStore } from "../store";
import { useSettings } from "../store/settings";
import { useRules } from "../store/rules";
import { useRuleProviders } from "../store/ruleProviders";
import { api } from "../lib/commands";
import { mergeSettingsIntoConfig } from "../lib/buildConfig";

export function useAutoReconnect() {
  const connected = useStore((s) => s.connected);
  const connecting = useStore((s) => s.connecting);
  const manualDisconnect = useStore((s) => s.manualDisconnect);
  const activeProfileIdx = useStore((s) => s.activeProfileIdx);
  const profiles = useStore((s) => s.profiles);
  const proxyModes = useSettings((s) => s.proxyModes);
  const { autoReconnect, reconnectDelaySecs, reconnectMaxAttempts } = useSettings();
  const attemptsRef = useRef(0);

  // Reset counter on successful connect
  useEffect(() => {
    if (connected) attemptsRef.current = 0;
  }, [connected]);

  useEffect(() => {
    if (connected || connecting || manualDisconnect || !autoReconnect) return;
    if (reconnectMaxAttempts > 0 && attemptsRef.current >= reconnectMaxAttempts) return;

    // Exponential backoff capped at 60s
    const delay = Math.min(reconnectDelaySecs * 1000 * Math.pow(1.5, attemptsRef.current), 60_000);

    const timer = setTimeout(async () => {
      attemptsRef.current += 1;
      const profile =
        activeProfileIdx !== null ? profiles[activeProfileIdx] : profiles[0];
      if (!profile) return;
      try {
        notify.info(i18n.t("notifications.autoReconnecting", { attempt: attemptsRef.current }));
        const enabledProviders = useRuleProviders.getState().providers
          .filter((p) => p.enabled)
          .map((p) => ({ name: p.name, url: p.url, behavior: p.behavior, action: p.action }));
        const config = mergeSettingsIntoConfig(
          profile.config as Record<string, unknown>,
          useSettings.getState(),
          useRules.getState().rules,
          enabledProviders.length > 0 ? enabledProviders : undefined,
        );
        useStore.getState().setConnectStartTime(Date.now());
        await api.connect(JSON.stringify(config), proxyModes);
        api.setActiveProfileId(profile.id).catch(() => {});
      } catch {
        useStore.getState().setConnectStartTime(null);
        // Next disconnect event will trigger another attempt
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [
    connected, connecting, manualDisconnect, autoReconnect,
    reconnectDelaySecs, reconnectMaxAttempts,
    activeProfileIdx, profiles, proxyModes,
  ]);
}
