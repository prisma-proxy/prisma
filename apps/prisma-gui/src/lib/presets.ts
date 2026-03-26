import type { WizardState } from "./buildConfig";
import { DEFAULT_WIZARD } from "./buildConfig";

export interface ProfilePreset {
  id: string;
  /** i18n key under "wizard.presets.*" */
  labelKey: string;
  descKey: string;
  /** Partial overrides applied on top of DEFAULT_WIZARD */
  overrides: Partial<WizardState>;
}

export const PROFILE_PRESETS: ProfilePreset[] = [
  {
    id: "stealth-cloudflare",
    labelKey: "wizard.presets.stealthCloudflare",
    descKey: "wizard.presets.stealthCloudflareDesc",
    overrides: {
      transport: "xporta",
      xportaEncoding: "json",
      fingerprint: "chrome",
      trafficPaddingMode: "random",
      trafficTimingJitter: 50,
      trafficChaffInterval: 5000,
      trafficCoalesceWindow: 100,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
  },
  {
    id: "low-latency-quic",
    labelKey: "wizard.presets.lowLatencyQuic",
    descKey: "wizard.presets.lowLatencyQuicDesc",
    overrides: {
      transport: "quic",
      quicVersion: "v2",
      congestion: "bbr",
      salamanderPassword: "",
      trafficPaddingMode: "none",
      trafficTimingJitter: 0,
      trafficChaffInterval: 0,
      trafficCoalesceWindow: 0,
    },
  },
  {
    id: "max-throughput",
    labelKey: "wizard.presets.maxThroughput",
    descKey: "wizard.presets.maxThroughputDesc",
    overrides: {
      transport: "quic",
      quicVersion: "v2",
      congestion: "brutal",
      xmuxEnabled: true,
      fecEnabled: true,
      fecDataShards: 10,
      fecParityShards: 3,
    },
  },
  {
    id: "cdn-websocket",
    labelKey: "wizard.presets.cdnWebSocket",
    descKey: "wizard.presets.cdnWebSocketDesc",
    overrides: {
      transport: "ws",
      fingerprint: "chrome",
      wsUrl: "/ws",
      wsHost: "",
      wsExtraHeaders: "X-Forwarded-Proto: https",
    },
  },
  {
    id: "minimal-tcp-tls",
    labelKey: "wizard.presets.minimalTcpTls",
    descKey: "wizard.presets.minimalTcpTlsDesc",
    overrides: {
      transport: "tcp",
      tlsOnTcp: true,
      cipher: "chacha20-poly1305",
      trafficPaddingMode: "none",
      trafficTimingJitter: 0,
      trafficChaffInterval: 0,
      trafficCoalesceWindow: 0,
      xmuxEnabled: false,
      fecEnabled: false,
      portHopping: false,
    },
  },
];

/** Apply a preset on top of current state, preserving server/auth fields */
export function applyPreset(current: WizardState, preset: ProfilePreset): WizardState {
  return {
    ...DEFAULT_WIZARD,
    // Preserve user-entered identity fields
    name: current.name,
    serverHost: current.serverHost,
    serverPort: current.serverPort,
    clientId: current.clientId,
    authSecret: current.authSecret,
    prismaAuthSecret: current.prismaAuthSecret,
    serverKeyPin: current.serverKeyPin,
    tags: current.tags,
    // Apply preset overrides
    ...preset.overrides,
  };
}
