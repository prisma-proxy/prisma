import type { LucideIcon } from "lucide-react";
import { Shield, Zap, Globe, EyeOff } from "lucide-react";

export interface ConfigPreset {
  id: string;
  nameKey: string;
  descKey: string;
  icon: LucideIcon;
  config: Record<string, unknown>;
}

export const CONFIG_PRESETS: ConfigPreset[] = [
  {
    id: "high-security",
    nameKey: "presets.highSecurity",
    descKey: "presets.highSecurityDesc",
    icon: Shield,
    config: {
      allow_transport_only_cipher: false,
      traffic_shaping_padding_mode: "random",
      padding_min: 64,
      padding_max: 256,
      anti_rtt_enabled: true,
      anti_rtt_normalization_ms: 50,
      camouflage_enabled: true,
      camouflage_tls_on_tcp: true,
    },
  },
  {
    id: "low-latency",
    nameKey: "presets.lowLatency",
    descKey: "presets.lowLatencyDesc",
    icon: Zap,
    config: {
      traffic_shaping_padding_mode: "none",
      padding_min: 0,
      padding_max: 0,
      anti_rtt_enabled: false,
      traffic_shaping_timing_jitter_ms: 0,
      traffic_shaping_coalesce_window_ms: 0,
    },
  },
  {
    id: "cdn-optimized",
    nameKey: "presets.cdnOptimized",
    descKey: "presets.cdnOptimizedDesc",
    icon: Globe,
    config: {
      cdn_enabled: true,
      cdn_padding_header: true,
      cdn_enable_sse_disguise: true,
      traffic_shaping_padding_mode: "uniform",
      padding_min: 16,
      padding_max: 128,
    },
  },
  {
    id: "privacy",
    nameKey: "presets.privacy",
    descKey: "presets.privacyDesc",
    icon: EyeOff,
    config: {
      traffic_shaping_padding_mode: "random",
      traffic_shaping_timing_jitter_ms: 20,
      traffic_shaping_chaff_interval_ms: 5000,
      traffic_shaping_coalesce_window_ms: 50,
      anti_rtt_enabled: true,
      anti_rtt_normalization_ms: 100,
      padding_min: 128,
      padding_max: 512,
      camouflage_enabled: true,
    },
  },
];
