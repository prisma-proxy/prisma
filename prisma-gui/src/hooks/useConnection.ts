import { useCallback } from "react";
import { useStore } from "@/store";
import { notify } from "@/store/notifications";
import { api } from "@/lib/commands";
import { useRules } from "@/store/rules";
import { useSettings } from "@/store/settings";
import { convertGuiRulesToBackend, parsePortForwards } from "@/lib/buildConfig";
import type { Profile } from "@/lib/types";
import { MODE_SOCKS5 } from "@/lib/types";

export function useConnection() {
  const setActiveProfileIdx = useStore((s) => s.setActiveProfileIdx);
  const setManualDisconnect = useStore((s) => s.setManualDisconnect);
  const setConnectStartTime = useStore((s) => s.setConnectStartTime);
  const setConnected = useStore((s) => s.setConnected);
  const setProxyModes = useStore((s) => s.setProxyModes);

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
      const settings = useSettings.getState();

      // Ports from settings (override any saved in profile)
      config.socks5_listen_addr = `127.0.0.1:${settings.socks5Port || 1080}`;
      if (settings.httpPort && settings.httpPort > 0) {
        config.http_listen_addr = `127.0.0.1:${settings.httpPort}`;
      } else {
        delete config.http_listen_addr;
      }

      // DNS from settings
      config.dns = {
        mode: settings.dnsMode,
        upstream: settings.dnsUpstream,
        ...(settings.dnsMode === "fake" ? { fake_ip_range: settings.fakeIpRange } : {}),
      };

      // Logging from settings
      if (settings.logLevel !== "info" || settings.logFormat !== "pretty") {
        config.logging = { level: settings.logLevel, format: settings.logFormat };
      } else {
        delete config.logging;
      }

      // TUN from settings
      if (settings.tunEnabled) {
        const incl = settings.tunIncludeRoutes.split("\n").map(s => s.trim()).filter(Boolean);
        const excl = settings.tunExcludeRoutes.split("\n").map(s => s.trim()).filter(Boolean);
        config.tun = {
          enabled: true,
          device_name: settings.tunDevice || "prisma-tun0",
          mtu: settings.tunMtu || 1500,
          include_routes: incl.length > 0 ? incl : ["0.0.0.0/0"],
          exclude_routes: excl,
        };
      } else {
        delete config.tun;
      }

      // Port forwards from settings
      const pfs = parsePortForwards(settings.portForwards);
      if (pfs.length > 0) {
        config.port_forwards = pfs;
      } else {
        delete config.port_forwards;
      }

      // Merge GUI Rules page rules and geoip path from settings into routing
      const guiRules = useRules.getState().rules;
      const routing = { ...((config.routing ?? {}) as Record<string, unknown>) };
      if (guiRules.length > 0) {
        const backendRules = convertGuiRulesToBackend(guiRules);
        const existingRules = Array.isArray(routing.rules) ? routing.rules : [];
        routing.rules = [...backendRules, ...existingRules];
      }
      if (settings.routingGeoipPath && !routing.geoip_path) {
        routing.geoip_path = settings.routingGeoipPath;
      }
      // Only set routing if it has content
      if (Object.keys(routing).length > 0) {
        config.routing = routing;
      }

      await api.connect(JSON.stringify(config), modes);
      api.setActiveProfileId(profile.id).catch(() => {});
    } catch (e) {
      notify.error(String(e));
      setConnectStartTime(null);
      // Clear connecting state so the UI isn't stuck on "Connecting..."
      // when the backend rejects the connect call.
      setConnected(false);
    }
  }, [setActiveProfileIdx, setConnectStartTime, setConnected]);

  const disconnect = useCallback(async () => {
    try {
      setManualDisconnect(true);
      await api.disconnect();
    } catch (e) {
      // Even if the backend reports an error (e.g. already disconnected,
      // mutex poisoned), we should still clean up the frontend state.
      // Only log the error; do NOT return early.
      notify.error(String(e));
    } finally {
      // Always update UI — don't rely solely on the status_changed event
      // which may arrive asynchronously (or not at all if the backend was
      // already disconnected).
      setConnected(false);
      api.clearSystemProxy().catch(() => {});
      api.setActiveProfileId("").catch(() => {});
    }
  }, [setManualDisconnect, setConnected]);

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
      if (profile) {
        // Update store first so the status_changed event handler reads MODE_SOCKS5
        // and does not call api.setSystemProxy() when connected event fires.
        setProxyModes(MODE_SOCKS5);
        await connectTo(profile, MODE_SOCKS5);
      }
    }
  }, [connectTo, disconnect, setProxyModes]);

  return { connectTo, disconnect, switchTo, toggle, toggleProxyOnly };
}
