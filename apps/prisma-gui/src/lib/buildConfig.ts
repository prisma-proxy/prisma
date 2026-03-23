// WizardState — the full shape collected across wizard steps 1–5
export interface WizardState {
  // Step 1 — Connection
  name: string;
  serverHost: string;
  serverPort: number;
  skipCertVerify: boolean;
  tlsOnTcp: boolean;
  tlsServerName: string;
  alpnProtocols: string;

  // Step 2 — Authentication
  clientId: string;
  authSecret: string;
  prismaAuthSecret: string;
  transportOnlyCipher: boolean;

  // Step 2 — Server key pinning
  serverKeyPin: string;

  // Step 3 — Transport + sub-fields
  transport: "quic" | "ws" | "grpc" | "xhttp" | "xporta" | "tcp" | "wireguard";
  cipher: string;
  fingerprint: string;
  quicVersion: string;
  sniSlicing: boolean;
  wsUrl: string;
  wsHost: string;
  wsExtraHeaders: string;
  grpcUrl: string;
  xhttpMode: string;
  xhttpUploadUrl: string;
  xhttpDownloadUrl: string;
  xhttpStreamUrl: string;
  xhttpExtraHeaders: string;
  xportaBaseUrl: string;
  xportaEncoding: string;
  xportaPollTimeout: number;
  congestion: "bbr" | "brutal" | "adaptive";
  targetBandwidth: string;
  portHopping: boolean;
  portHopBase: number;
  portHopRange: number;
  portHopInterval: number;
  portHopGracePeriod: number;
  // Salamander
  salamanderPassword: string;
  // User-Agent / Referer
  userAgent: string;
  referer: string;
  // XMUX
  xmuxEnabled: boolean;
  xmuxMaxConnsMin: number;
  xmuxMaxConnsMax: number;
  xmuxMaxConcurrencyMin: number;
  xmuxMaxConcurrencyMax: number;
  xmuxMaxLifetimeMin: number;
  xmuxMaxLifetimeMax: number;
  xmuxMaxRequestsMin: number;
  xmuxMaxRequestsMax: number;
  // Transport mode / fallback
  transportMode: string;
  fallbackOrder: string;
  // Entropy camouflage
  entropyCamouflage: boolean;
  // Traffic shaping
  trafficPaddingMode: string;
  trafficTimingJitter: number;
  trafficChaffInterval: number;
  trafficCoalesceWindow: number;
  // UDP FEC
  fecEnabled: boolean;
  fecDataShards: number;
  fecParityShards: number;
  // WireGuard
  wireguardEndpoint: string;
  wireguardKeepalive: number;
  // Client fallback strategy
  fallbackUseServerFallback: boolean;
  fallbackMaxAttempts: number;
  fallbackConnectTimeout: number;

  // Step 4
  tags: string[];
}

export const DEFAULT_WIZARD: WizardState = {
  name: "",
  serverHost: "",
  serverPort: 443,
  skipCertVerify: false,
  tlsOnTcp: false,
  tlsServerName: "",
  alpnProtocols: "h2,http/1.1",
  clientId: "",
  authSecret: "",
  prismaAuthSecret: "",
  serverKeyPin: "",
  transportOnlyCipher: false,
  transport: "quic",
  cipher: "chacha20-poly1305",
  fingerprint: "chrome",
  quicVersion: "auto",
  sniSlicing: false,
  wsUrl: "/ws",
  wsHost: "",
  wsExtraHeaders: "",
  grpcUrl: "/prisma.Proxy/Relay",
  xhttpMode: "auto",
  xhttpUploadUrl: "/up",
  xhttpDownloadUrl: "/down",
  xhttpStreamUrl: "/stream",
  xhttpExtraHeaders: "",
  xportaBaseUrl: "",
  xportaEncoding: "json",
  xportaPollTimeout: 55,
  congestion: "bbr",
  targetBandwidth: "",
  portHopping: false,
  portHopBase: 40000,
  portHopRange: 5000,
  portHopInterval: 30,
  portHopGracePeriod: 5,
  salamanderPassword: "",
  userAgent: "",
  referer: "",
  xmuxEnabled: false,
  xmuxMaxConnsMin: 1,
  xmuxMaxConnsMax: 4,
  xmuxMaxConcurrencyMin: 8,
  xmuxMaxConcurrencyMax: 16,
  xmuxMaxLifetimeMin: 300,
  xmuxMaxLifetimeMax: 600,
  xmuxMaxRequestsMin: 100,
  xmuxMaxRequestsMax: 200,
  transportMode: "auto",
  fallbackOrder: "quic-v2,prisma-tls,ws-cdn,xporta",
  entropyCamouflage: false,
  trafficPaddingMode: "none",
  trafficTimingJitter: 0,
  trafficChaffInterval: 0,
  trafficCoalesceWindow: 0,
  fecEnabled: false,
  fecDataShards: 10,
  fecParityShards: 3,
  wireguardEndpoint: "",
  wireguardKeepalive: 25,
  fallbackUseServerFallback: false,
  fallbackMaxAttempts: 3,
  fallbackConnectTimeout: 10,
  tags: [],
};

/**
 * Converts GUI routing rules (from the Rules page store) to the Rust backend
 * serde format for `prisma_core::router::Rule`.
 *
 * GUI format:  { type: "DOMAIN"|"IP-CIDR"|"GEOIP"|"FINAL", match: string, action: "PROXY"|"DIRECT"|"REJECT" }
 * Rust format: { type: "domain"|"ip-cidr"|"geoip"|"all", value: string, action: "proxy"|"direct"|"block" }
 */
export function convertGuiRulesToBackend(
  guiRules: { type: string; match: string; action: string }[]
): Record<string, unknown>[] {
  return guiRules.map((r) => {
    // Map GUI action names to Rust serde names
    let action: string;
    switch (r.action) {
      case "DIRECT":  action = "direct"; break;
      case "REJECT":  action = "block";  break;
      case "PROXY":
      default:        action = "proxy";  break;
    }

    // Map GUI type names to Rust serde tag values
    switch (r.type) {
      case "DOMAIN":
        return { type: "domain", value: r.match, action };
      case "DOMAIN-SUFFIX":
        return { type: "domain-suffix", value: r.match, action };
      case "DOMAIN-KEYWORD":
        return { type: "domain-keyword", value: r.match, action };
      case "IP-CIDR":
        return { type: "ip-cidr", value: r.match, action };
      case "GEOIP":
        return { type: "geoip", value: r.match.toLowerCase(), action };
      case "FINAL":
        return { type: "all", value: null, action };
      default:
        return { type: "domain", value: r.match, action };
    }
  });
}

/** Parse port forward lines: "name,local_addr,remote_port" */
export function parsePortForwards(text: string): { name: string; local_addr: string; remote_port: number }[] {
  if (!text) return [];
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split(",").map((p) => p.trim());
      return {
        name: parts[0] || "",
        local_addr: parts[1] || "",
        remote_port: parseInt(parts[2] || "0", 10),
      };
    })
    .filter((pf) => pf.name && pf.local_addr && pf.remote_port > 0);
}

/**
 * Merge global settings + GUI routing rules into a raw profile config,
 * producing a complete ClientConfig-shaped object ready for the backend.
 */
export function mergeSettingsIntoConfig(
  profileConfig: Record<string, unknown>,
  settings: import("@/store/settings").AppSettings,
  guiRules: { type: string; match: string; action: string }[],
): Record<string, unknown> {
  const config = { ...profileConfig };

  // Ports
  config.socks5_listen_addr = `127.0.0.1:${settings.socks5Port || 1080}`;
  if (settings.httpPort && settings.httpPort > 0) {
    config.http_listen_addr = `127.0.0.1:${settings.httpPort}`;
  } else {
    delete config.http_listen_addr;
  }

  // DNS
  config.dns = {
    mode: settings.dnsMode,
    upstream: settings.dnsUpstream,
    ...(settings.dnsMode === "fake" ? { fake_ip_range: settings.fakeIpRange } : {}),
  };

  // Logging
  if (settings.logLevel !== "info" || settings.logFormat !== "pretty") {
    config.logging = { level: settings.logLevel, format: settings.logFormat };
  } else {
    delete config.logging;
  }

  // TUN
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

  // Port forwards
  const pfs = parsePortForwards(settings.portForwards);
  if (pfs.length > 0) {
    config.port_forwards = pfs;
  } else {
    delete config.port_forwards;
  }

  // Connection pool
  config.connection_pool = {
    enabled: settings.connectionPoolEnabled ?? true,
  };

  // Routing rules + geo paths
  const routing = { ...((config.routing ?? {}) as Record<string, unknown>) };
  if (guiRules.length > 0) {
    const backendRules = convertGuiRulesToBackend(guiRules);
    const existingRules = Array.isArray(routing.rules) ? routing.rules : [];
    routing.rules = [...backendRules, ...existingRules];
  }
  if (settings.routingGeoipPath && !routing.geoip_path) {
    routing.geoip_path = settings.routingGeoipPath;
  }
  if (settings.routingGeositePath && !routing.geosite_path) {
    routing.geosite_path = settings.routingGeositePath;
  }
  if (Object.keys(routing).length > 0) {
    config.routing = routing;
  }

  return config;
}

/** Parse "Key: Value" lines into [key, value] tuples */
function parseHeaderLines(text: string): [string, string][] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const idx = l.indexOf(":");
      if (idx < 0) return [l, ""] as [string, string];
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()] as [string, string];
    });
}


/**
 * Maps WizardState → ClientConfig JSON matching the Rust ClientConfig struct.
 *
 * Produces only the protocol/transport fields for the profile. Global settings
 * (proxy ports, DNS, logging, TUN, routing rules) are merged at connect time
 * by useConnection.ts and do NOT appear here.
 */
export function buildClientConfig(w: WizardState): Record<string, unknown> {
  const config: Record<string, unknown> = {
    // Required fields
    server_addr: `${w.serverHost}:${w.serverPort}`,
    identity: {
      client_id: w.clientId,
      auth_secret: w.authSecret,
    },

    // Transport — plain string, not an object
    transport: w.transport,
    cipher_suite: w.cipher,
    fingerprint: w.fingerprint,
    quic_version: w.quicVersion,
    transport_mode: w.transportMode,
  };

  // TLS options
  if (w.skipCertVerify) config.skip_cert_verify = true;
  if (w.tlsOnTcp) config.tls_on_tcp = true;
  if (w.tlsServerName) config.tls_server_name = w.tlsServerName;
  if (w.transportOnlyCipher) config.transport_only_cipher = true;

  // ALPN
  const alpn = w.alpnProtocols
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (alpn.length > 0) config.alpn_protocols = alpn;

  // Fallback order
  const fo = w.fallbackOrder
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fo.length > 0) config.fallback_order = fo;

  // QUIC-specific
  if (w.transport === "quic") {
    if (w.sniSlicing) config.sni_slicing = true;
    if (w.salamanderPassword) config.salamander_password = w.salamanderPassword;
    if (w.entropyCamouflage) config.entropy_camouflage = true;
  }

  // WebSocket nested config
  if (w.transport === "ws") {
    const ws: Record<string, unknown> = { url: w.wsUrl };
    if (w.wsHost) ws.host = w.wsHost;
    const wsHeaders = parseHeaderLines(w.wsExtraHeaders);
    if (wsHeaders.length > 0) ws.extra_headers = wsHeaders;
    config.ws = ws;
  }

  // gRPC nested config
  if (w.transport === "grpc") {
    config.grpc = { url: w.grpcUrl };
  }

  // XHTTP nested config
  if (w.transport === "xhttp") {
    const xhttp: Record<string, unknown> = {
      mode: w.xhttpMode,
      upload_url: w.xhttpUploadUrl,
      download_url: w.xhttpDownloadUrl,
      stream_url: w.xhttpStreamUrl,
    };
    const xhttpHeaders = parseHeaderLines(w.xhttpExtraHeaders);
    if (xhttpHeaders.length > 0) xhttp.extra_headers = xhttpHeaders;
    config.xhttp = xhttp;
  }

  // XPorta — nested object matching XPortaClientConfig
  if (w.transport === "xporta") {
    config.xporta = {
      base_url: w.xportaBaseUrl,
      encoding: w.xportaEncoding,
      poll_timeout_secs: w.xportaPollTimeout,
    };
  }

  // Header obfuscation
  if (w.userAgent) config.user_agent = w.userAgent;
  if (w.referer) config.referer = w.referer;

  // XMUX connection pool
  if (w.xmuxEnabled) {
    config.xmux = {
      max_connections_min: w.xmuxMaxConnsMin,
      max_connections_max: w.xmuxMaxConnsMax,
      max_concurrency_min: w.xmuxMaxConcurrencyMin,
      max_concurrency_max: w.xmuxMaxConcurrencyMax,
      max_lifetime_secs_min: w.xmuxMaxLifetimeMin,
      max_lifetime_secs_max: w.xmuxMaxLifetimeMax,
      max_requests_min: w.xmuxMaxRequestsMin,
      max_requests_max: w.xmuxMaxRequestsMax,
    };
  }

  // Congestion — nested CongestionConfig
  config.congestion = {
    mode: w.congestion,
    ...(w.targetBandwidth ? { target_bandwidth: w.targetBandwidth } : {}),
  };

  // Port hopping — nested PortHoppingConfig
  if (w.portHopping) {
    config.port_hopping = {
      enabled: true,
      base_port: w.portHopBase,
      port_range: w.portHopRange,
      interval_secs: w.portHopInterval,
      grace_period_secs: w.portHopGracePeriod,
    };
  }

  // Traffic shaping
  if (
    w.trafficPaddingMode !== "none" ||
    w.trafficTimingJitter > 0 ||
    w.trafficChaffInterval > 0 ||
    w.trafficCoalesceWindow > 0
  ) {
    config.traffic_shaping = {
      padding_mode: w.trafficPaddingMode,
      timing_jitter_ms: w.trafficTimingJitter,
      chaff_interval_ms: w.trafficChaffInterval,
      coalesce_window_ms: w.trafficCoalesceWindow,
    };
  }

  // UDP FEC
  if (w.fecEnabled) {
    config.udp_fec = {
      enabled: true,
      data_shards: w.fecDataShards,
      parity_shards: w.fecParityShards,
    };
  }

  // PrismaAuth secret
  if (w.prismaAuthSecret) {
    config.prisma_auth_secret = w.prismaAuthSecret;
  }

  // Server key pinning
  if (w.serverKeyPin) {
    config.server_key_pin = w.serverKeyPin;
  }

  // WireGuard
  if (w.transport === "wireguard") {
    config.wireguard = {
      endpoint: w.wireguardEndpoint,
      keepalive_secs: w.wireguardKeepalive,
    };
  }

  // Client fallback strategy
  if (w.fallbackUseServerFallback || w.fallbackMaxAttempts !== 3 || w.fallbackConnectTimeout !== 10) {
    config.fallback = {
      use_server_fallback: w.fallbackUseServerFallback,
      max_fallback_attempts: w.fallbackMaxAttempts,
      connect_timeout_secs: w.fallbackConnectTimeout,
    };
  }

  return config;
}

/** Maps a stored ClientConfig back to WizardState (for editing) */
export function parseProfileToWizard(name: string, config: unknown, tags?: string[]): WizardState {
  const c = (config ?? {}) as Record<string, unknown>;
  const identity = (c.identity ?? {}) as Record<string, unknown>;
  const congestion = (c.congestion ?? {}) as Record<string, unknown>;
  const ph = (c.port_hopping ?? {}) as Record<string, unknown>;
  const xporta = (c.xporta ?? {}) as Record<string, unknown>;
  const xmux = (c.xmux ?? null) as Record<string, unknown> | null;
  const ts = (c.traffic_shaping ?? {}) as Record<string, unknown>;
  const fec = (c.udp_fec ?? {}) as Record<string, unknown>;
  const wg = (c.wireguard ?? {}) as Record<string, unknown>;
  const fb = (c.fallback ?? {}) as Record<string, unknown>;

  // Parse server_addr "host:port"
  const serverAddr = String(c.server_addr ?? "");
  const lastColon = serverAddr.lastIndexOf(":");
  const serverHost = lastColon > 0 ? serverAddr.slice(0, lastColon) : serverAddr;
  const serverPort = lastColon > 0 ? Number(serverAddr.slice(lastColon + 1)) || 443 : 443;

  // Parse nested transport configs
  const ws = (c.ws ?? {}) as Record<string, unknown>;
  const grpc = (c.grpc ?? {}) as Record<string, unknown>;
  const xhttp = (c.xhttp ?? {}) as Record<string, unknown>;

  // Parse extra headers back to "Key: Value" lines
  const wsHeaders = Array.isArray(ws.extra_headers)
    ? (ws.extra_headers as [string, string][]).map(([k, v]) => `${k}: ${v}`).join("\n")
    : "";
  const xhttpHeaders = Array.isArray(xhttp.extra_headers)
    ? (xhttp.extra_headers as [string, string][]).map(([k, v]) => `${k}: ${v}`).join("\n")
    : "";

  // Parse alpn back to comma-separated
  const alpnArr = Array.isArray(c.alpn_protocols) ? (c.alpn_protocols as string[]) : [];
  const alpnProtocols = alpnArr.length > 0 ? alpnArr.join(",") : "h2,http/1.1";

  // Parse fallback order
  const foArr = Array.isArray(c.fallback_order) ? (c.fallback_order as string[]) : [];
  const fallbackOrder = foArr.length > 0 ? foArr.join(",") : "quic-v2,prisma-tls,ws-cdn,xporta";

  return {
    name,
    serverHost,
    serverPort,
    skipCertVerify: Boolean(c.skip_cert_verify),
    tlsOnTcp: Boolean(c.tls_on_tcp),
    tlsServerName: String(c.tls_server_name ?? ""),
    alpnProtocols,
    clientId: String(identity.client_id ?? ""),
    authSecret: String(identity.auth_secret ?? ""),
    prismaAuthSecret: String(c.prisma_auth_secret ?? ""),
    serverKeyPin: String(c.server_key_pin ?? ""),
    transportOnlyCipher: Boolean(c.transport_only_cipher),
    transport: (c.transport as WizardState["transport"]) ?? "quic",
    cipher: String(c.cipher_suite ?? "chacha20-poly1305"),
    fingerprint: String(c.fingerprint ?? "chrome"),
    quicVersion: String(c.quic_version ?? "auto"),
    sniSlicing: Boolean(c.sni_slicing),
    wsUrl: String(ws.url ?? "/ws"),
    wsHost: String(ws.host ?? ""),
    wsExtraHeaders: wsHeaders,
    grpcUrl: String(grpc.url ?? "/prisma.Proxy/Relay"),
    xhttpMode: String(xhttp.mode ?? "auto"),
    xhttpUploadUrl: String(xhttp.upload_url ?? "/up"),
    xhttpDownloadUrl: String(xhttp.download_url ?? "/down"),
    xhttpStreamUrl: String(xhttp.stream_url ?? "/stream"),
    xhttpExtraHeaders: xhttpHeaders,
    xportaBaseUrl: String(xporta.base_url ?? ""),
    xportaEncoding: String(xporta.encoding ?? "json"),
    xportaPollTimeout: Number(xporta.poll_timeout_secs ?? 55),
    congestion: (congestion.mode as WizardState["congestion"]) ?? "bbr",
    targetBandwidth: String(congestion.target_bandwidth ?? ""),
    portHopping: Boolean(ph.enabled),
    portHopBase: Number(ph.base_port ?? 40000),
    portHopRange: Number(ph.port_range ?? 5000),
    portHopInterval: Number(ph.interval_secs ?? 30),
    portHopGracePeriod: Number(ph.grace_period_secs ?? 5),
    salamanderPassword: String(c.salamander_password ?? ""),
    userAgent: String(c.user_agent ?? ""),
    referer: String(c.referer ?? ""),
    xmuxEnabled: xmux !== null,
    xmuxMaxConnsMin: Number(xmux?.max_connections_min ?? 1),
    xmuxMaxConnsMax: Number(xmux?.max_connections_max ?? 4),
    xmuxMaxConcurrencyMin: Number(xmux?.max_concurrency_min ?? 8),
    xmuxMaxConcurrencyMax: Number(xmux?.max_concurrency_max ?? 16),
    xmuxMaxLifetimeMin: Number(xmux?.max_lifetime_secs_min ?? 300),
    xmuxMaxLifetimeMax: Number(xmux?.max_lifetime_secs_max ?? 600),
    xmuxMaxRequestsMin: Number(xmux?.max_requests_min ?? 100),
    xmuxMaxRequestsMax: Number(xmux?.max_requests_max ?? 200),
    transportMode: String(c.transport_mode ?? "auto"),
    fallbackOrder,
    entropyCamouflage: Boolean(c.entropy_camouflage),
    trafficPaddingMode: String(ts.padding_mode ?? "none"),
    trafficTimingJitter: Number(ts.timing_jitter_ms ?? 0),
    trafficChaffInterval: Number(ts.chaff_interval_ms ?? 0),
    trafficCoalesceWindow: Number(ts.coalesce_window_ms ?? 0),
    fecEnabled: Boolean(fec.enabled),
    fecDataShards: Number(fec.data_shards ?? 10),
    fecParityShards: Number(fec.parity_shards ?? 3),
    wireguardEndpoint: String(wg.endpoint ?? ""),
    wireguardKeepalive: Number(wg.keepalive_secs ?? 25),
    fallbackUseServerFallback: Boolean(fb.use_server_fallback),
    fallbackMaxAttempts: Number(fb.max_fallback_attempts ?? 3),
    fallbackConnectTimeout: Number(fb.connect_timeout_secs ?? 10),
    tags: tags ?? [],
  };
}

/** Returns an array of validation error messages (empty = valid) */
export function validateWizard(w: WizardState): string[] {
  const errs: string[] = [];
  if (!w.name.trim()) errs.push("Name is required");
  if (!w.serverHost.trim()) errs.push("Server host is required");
  if (w.serverPort < 1 || w.serverPort > 65535)
    errs.push("Server port must be 1–65535");
  if (!/^[0-9a-f]{64}$/.test(w.authSecret))
    errs.push("Auth secret must be 64 lowercase hex characters");
  if (w.fecEnabled && w.fecDataShards < 1)
    errs.push("FEC data shards must be at least 1");
  if (w.fecEnabled && w.fecParityShards < 1)
    errs.push("FEC parity shards must be at least 1");
  if (w.transport === "xporta" && !w.xportaBaseUrl.trim())
    errs.push("XPorta base URL is required");
  if (w.transport === "wireguard" && !w.wireguardEndpoint.trim())
    errs.push("WireGuard endpoint is required");
  return errs;
}
