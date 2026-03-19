import { useEffect, useState, useCallback } from "react";
import { usePlatform } from "./usePlatform";
import { api } from "@/lib/commands";
import { NET_DISCONNECTED, NET_WIFI, NET_CELLULAR, NET_ETHERNET } from "@/lib/types";

export type NetworkLabel = "disconnected" | "wifi" | "cellular" | "ethernet" | "unknown";

function networkLabel(code: number): NetworkLabel {
  switch (code) {
    case NET_DISCONNECTED: return "disconnected";
    case NET_WIFI:         return "wifi";
    case NET_CELLULAR:     return "cellular";
    case NET_ETHERNET:     return "ethernet";
    default:               return "unknown";
  }
}

/**
 * Exposes current network type on mobile.
 * On desktop, returns "ethernet" as a sensible default.
 * Polls every 10 seconds when visible, stops when hidden.
 */
export function useNetworkStatus() {
  const { isMobile } = usePlatform();
  const [networkType, setNetworkType] = useState<number>(NET_ETHERNET);
  const [label, setLabel] = useState<NetworkLabel>("ethernet");

  const refresh = useCallback(() => {
    api.getNetworkType()
      .then((net) => {
        setNetworkType(net);
        setLabel(networkLabel(net));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isMobile) return;

    // Initial fetch
    refresh();

    // Poll every 10 seconds
    const interval = setInterval(refresh, 10_000);

    // Also refresh on visibility change (foreground resume)
    function onVisibility() {
      if (!document.hidden) refresh();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isMobile, refresh]);

  return { networkType, label, isOnline: networkType !== NET_DISCONNECTED, refresh };
}
