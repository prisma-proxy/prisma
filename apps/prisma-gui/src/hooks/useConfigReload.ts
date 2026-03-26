import { useEffect, useRef } from "react";
import { useStore } from "@/store";
import { useSettings } from "@/store/settings";
import { useConnection } from "@/hooks/useConnection";

/**
 * Watches connection-relevant settings and triggers a debounced reconnect
 * whenever they change while a connection is active.
 */
export function useConfigReload() {
  const { switchTo } = useConnection();
  const switchToRef = useRef(switchTo);
  useEffect(() => { switchToRef.current = switchTo; });

  const {
    socks5Port, httpPort, dnsMode, dnsUpstream, fakeIpRange,
    tunEnabled, tunDevice, tunMtu, tunIncludeRoutes, tunExcludeRoutes,
    portForwards, routingGeoipPath, routingGeositePath, connectionPoolEnabled,
    connectionMode,
  } = useSettings();

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    // Skip the initial mount — only react to changes after first render.
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const { connected, activeProfileIdx, profiles } = useStore.getState();
      const { proxyModes } = useSettings.getState();
      if (!connected || activeProfileIdx === null) return;
      const profile = profiles[activeProfileIdx];
      if (profile) switchToRef.current(profile, proxyModes);
    }, 800);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    socks5Port, httpPort, dnsMode, dnsUpstream, fakeIpRange,
    tunEnabled, tunDevice, tunMtu, tunIncludeRoutes, tunExcludeRoutes,
    portForwards, routingGeoipPath, routingGeositePath, connectionPoolEnabled,
    connectionMode,
  ]);
}
