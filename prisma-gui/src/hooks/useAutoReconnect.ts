import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useStore } from "../store";
import { useSettings } from "../store/settings";
import { api } from "../lib/commands";

export function useAutoReconnect() {
  const { connected, connecting, manualDisconnect, activeProfileIdx, profiles, proxyModes } =
    useStore();
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
        toast.info(`Auto-reconnecting… (attempt ${attemptsRef.current})`);
        await api.connect(JSON.stringify(profile.config), proxyModes);
      } catch {
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
