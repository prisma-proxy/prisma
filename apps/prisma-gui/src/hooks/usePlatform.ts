import { useEffect, useState } from "react";

type PlatformName = "windows" | "macos" | "linux" | "ios" | "android" | "unknown";

export function usePlatform() {
  const [platform, setPlatform] = useState<PlatformName>("unknown");

  useEffect(() => {
    // Dynamically import to avoid SSR issues and handle missing Tauri runtime
    import("@tauri-apps/plugin-os")
      .then(({ platform: getPlatform }) => getPlatform())
      .then((p) => setPlatform(p as PlatformName))
      .catch(() => {
        // Fallback: detect mobile by screen width when running in browser
        const w = window.innerWidth;
        setPlatform(w < 600 ? "android" : "windows");
      });
  }, []);

  const isMobile  = platform === "ios" || platform === "android";
  const isDesktop = !isMobile && platform !== "unknown";

  return { platform, isMobile, isDesktop };
}
