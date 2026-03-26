import { usePlatform } from "@/hooks/usePlatform";

export function useFeatures() {
  const { isMobile, isDesktop, platform } = usePlatform();
  return {
    hasTray: isDesktop,
    hasAutostart: isDesktop,
    hasFileOpen: isDesktop,
    hasVpnPermission: isMobile,
    hasBattery: isMobile,
    hasHaptic: isMobile,
    hasSafeAreas: platform === "ios",
  };
}
