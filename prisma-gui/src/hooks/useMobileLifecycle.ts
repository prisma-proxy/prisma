import { useEffect, useRef } from "react";
import { usePlatform } from "./usePlatform";
import { api } from "@/lib/commands";

/**
 * Handles mobile app lifecycle events:
 * - Notifies the backend when the app goes to background/foreground
 * - Listens for visibility changes (Page Visibility API)
 * - Polls network type on foreground resume
 *
 * On desktop this hook is a no-op.
 */
export function useMobileLifecycle() {
  const { isMobile } = usePlatform();
  const wasHidden = useRef(false);

  useEffect(() => {
    if (!isMobile) return;

    function handleVisibilityChange() {
      if (document.hidden) {
        wasHidden.current = true;
        api.onAppBackground().catch(() => {});
      } else if (wasHidden.current) {
        wasHidden.current = false;
        api.onAppForeground().catch(() => {});
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isMobile]);
}
