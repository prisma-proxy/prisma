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
  transport: "quic" | "ws" | "grpc" | "xhttp" | "xporta" | "tcp" | "wireguard" | "prisma-tls";
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
  // XPorta advanced fields
  xportaSessionPath: string;
  xportaDataPaths: string;
  xportaPollPaths: string;
  xportaPollConcurrency: number;
  xportaUploadConcurrency: number;
  xportaMaxPayloadSize: number;
  xportaCookieName: string;
  xportaExtraHeaders: string;
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

  // PrismaTLS
  prismaTlsFingerprint: string;
  prismaTlsAuthSecret: string;

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
  wsUrl: "/ws-tunnel",
  wsHost: "",
  wsExtraHeaders: "",
  grpcUrl: "/tunnel.PrismaTunnel",
  xhttpMode: "auto",
  xhttpUploadUrl: "/api/v1/upload",
  xhttpDownloadUrl: "/api/v1/pull",
  xhttpStreamUrl: "/api/v1/stream",
  xhttpExtraHeaders: "",
  xportaBaseUrl: "",
  xportaEncoding: "json",
  xportaPollTimeout: 55,
  xportaSessionPath: "/api/auth",
  xportaDataPaths: "/api/v1/data\n/api/v1/sync\n/api/v1/update",
  xportaPollPaths: "/api/v1/notifications\n/api/v1/feed\n/api/v1/events",
  xportaPollConcurrency: 3,
  xportaUploadConcurrency: 4,
  xportaMaxPayloadSize: 65536,
  xportaCookieName: "_sess",
  xportaExtraHeaders: "",
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
  prismaTlsFingerprint: "chrome",
  prismaTlsAuthSecret: "",
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
 *
 * @param ruleProviders - Enabled rule providers whose rules should be sent
 *   to the backend as provider configurations.
 */
export function mergeSettingsIntoConfig(
  profileConfig: Record<string, unknown>,
  settings: import("@/store/settings").AppSettings,
  guiRules: { type: string; match: string; action: string }[],
  ruleProviders?: { name: string; url: string; behavior: string; action: string }[],
): Record<string, unknown> {
  const config = { ...profileConfig };

  // Ports
  const host = settings.allowLan ? "0.0.0.0" : "127.0.0.1";
  if (settings.socks5Port > 0) {
    config.socks5_listen_addr = `${host}:${settings.socks5Port}`;
  } else {
    delete config.socks5_listen_addr;
  }
  if (settings.httpPort && settings.httpPort > 0) {
    config.http_listen_addr = `${host}:${settings.httpPort}`;
  } else {
    delete config.http_listen_addr;
  }

  // DNS — only include if non-default
  if (settings.dnsMode !== "direct" || settings.dnsUpstream !== "8.8.8.8:53") {
    config.dns = {
      mode: settings.dnsMode,
      upstream: settings.dnsUpstream,
      ...(settings.dnsMode === "fake" ? { fake_ip_range: settings.fakeIpRange } : {}),
    };
  }

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

  // Connection pool — always apply from global settings (sole source of truth)
  config.connection_pool = { enabled: settings.connectionPoolEnabled };

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
  // Rule providers
  if (ruleProviders && ruleProviders.length > 0) {
    routing.rule_providers = ruleProviders.map((p) => {
      let action: string;
      switch (p.action) {
        case "DIRECT":  action = "direct"; break;
        case "REJECT":  action = "block";  break;
        case "PROXY":
        default:        action = "proxy";  break;
      }
      return {
        name: p.name,
        url: p.url,
        behavior: p.behavior,
        action,
        format: "text",
        update_interval_secs: 86400,
      };
    });
  }

  if (Object.keys(routing).length > 0) {
    config.routing = routing;
  }

  return config;
}

/** Build a full URL from a path and the server host/port.
 *  If the value is already a full URL (http/https/ws/wss), return as-is. */
function toFullUrl(pathOrUrl: string, host: string, port: number, scheme: string): string {
  if (/^(https?|wss?):\/\//i.test(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${scheme}://${host}:${port}${path}`;
}

/** Extract the path portion from a URL for display in the form.
 *  If it's already a path, return as-is. */
function extractPath(urlOrPath: string, defaultPath: string): string {
  if (!urlOrPath) return defaultPath;
  if (urlOrPath.startsWith("/")) return urlOrPath;
  try {
    return new URL(urlOrPath).pathname;
  } catch {
    return urlOrPath;
  }
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
  // Only required fields unconditionally; everything else only when non-default.
  // Rust serde defaults fill in omitted fields, so the config stays minimal.
  const config: Record<string, unknown> = {
    server_addr: `${w.serverHost}:${w.serverPort}`,
    identity: {
      client_id: w.clientId,
      auth_secret: w.authSecret,
    },
    transport: w.transport,
  };

  // Only include when different from Rust serde defaults
  if (w.cipher !== "chacha20-poly1305") config.cipher_suite = w.cipher;
  if (w.fingerprint !== "chrome") config.fingerprint = w.fingerprint;
  if (w.transportMode !== "auto") config.transport_mode = w.transportMode;

  // TLS options
  if (w.skipCertVerify) config.skip_cert_verify = true;
  if (w.tlsOnTcp) config.tls_on_tcp = true;
  if (w.tlsServerName) config.tls_server_name = w.tlsServerName;
  if (w.transportOnlyCipher) config.transport_only_cipher = true;

  // ALPN — omit if matching default "h2,http/1.1"
  const alpn = w.alpnProtocols
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const defaultAlpn = ["h2", "http/1.1"];
  if (alpn.length > 0 && JSON.stringify(alpn) !== JSON.stringify(defaultAlpn)) {
    config.alpn_protocols = alpn;
  }

  // Fallback order — omit if matching default
  const fo = w.fallbackOrder
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const defaultFo = ["quic-v2", "prisma-tls", "ws-cdn", "xporta"];
  if (fo.length > 0 && JSON.stringify(fo) !== JSON.stringify(defaultFo)) {
    config.fallback_order = fo;
  }

  // QUIC-specific fields
  if (w.transport === "quic") {
    if (w.quicVersion !== "auto") config.quic_version = w.quicVersion;
    if (w.sniSlicing) config.sni_slicing = true;
    if (w.salamanderPassword) config.salamander_password = w.salamanderPassword;
    if (w.entropyCamouflage) config.entropy_camouflage = true;
    // Port hopping (QUIC-only)
    if (w.portHopping) {
      config.port_hopping = {
        enabled: true,
        base_port: w.portHopBase,
        port_range: w.portHopRange,
        interval_secs: w.portHopInterval,
        grace_period_secs: w.portHopGracePeriod,
      };
    }
  }

  // Congestion control (all transports — omit if default bbr with no target)
  if (w.congestion !== "bbr" || w.targetBandwidth) {
    config.congestion = {
      mode: w.congestion,
      ...(w.targetBandwidth ? { target_bandwidth: w.targetBandwidth } : {}),
    };
  }

  // UDP FEC — applies to PrismaUDP relay on all transports
  if (w.fecEnabled) {
    config.udp_fec = {
      enabled: true,
      data_shards: w.fecDataShards,
      parity_shards: w.fecParityShards,
    };
  }

  // WebSocket URL scheme:
  // - CDN (port 443): wss:// — CDN terminates TLS, client must connect via WSS
  // - Direct with tls_on_tcp: ws:// — TLS handled by the outer TCP layer
  // - Plain: ws://
  if (w.transport === "ws") {
    const scheme = w.serverPort === 443 && !w.tlsOnTcp ? "wss" : "ws";
    const ws: Record<string, unknown> = {
      url: toFullUrl(w.wsUrl, w.serverHost, w.serverPort, scheme),
    };
    if (w.wsHost) ws.host = w.wsHost;
    const wsHeaders = parseHeaderLines(w.wsExtraHeaders);
    if (wsHeaders.length > 0) ws.extra_headers = wsHeaders;
    config.ws = ws;
  }

  // gRPC nested config — Rust client expects full URL (https://host:port/path)
  if (w.transport === "grpc") {
    const scheme = w.tlsOnTcp ? "https" : "http";
    config.grpc = { url: toFullUrl(w.grpcUrl, w.serverHost, w.serverPort, scheme) };
  }

  // XHTTP nested config — Rust client expects full URLs
  if (w.transport === "xhttp") {
    const base = (path: string) => toFullUrl(path, w.serverHost, w.serverPort, "https");
    const xhttp: Record<string, unknown> = {
      mode: w.xhttpMode,
      upload_url: base(w.xhttpUploadUrl),
      download_url: base(w.xhttpDownloadUrl),
      stream_url: base(w.xhttpStreamUrl),
    };
    const xhttpHeaders = parseHeaderLines(w.xhttpExtraHeaders);
    if (xhttpHeaders.length > 0) xhttp.extra_headers = xhttpHeaders;
    config.xhttp = xhttp;
  }

  // XPorta — nested object matching XPortaClientConfig
  if (w.transport === "xporta") {
    const xporta: Record<string, unknown> = {
      base_url: w.xportaBaseUrl,
      encoding: w.xportaEncoding,
      poll_timeout_secs: w.xportaPollTimeout,
    };
    if (w.xportaSessionPath && w.xportaSessionPath !== "/api/auth") {
      xporta.session_path = w.xportaSessionPath;
    }
    const dataPaths = w.xportaDataPaths.split("\n").map((s) => s.trim()).filter(Boolean);
    if (dataPaths.length > 0) xporta.data_paths = dataPaths;
    const pollPaths = w.xportaPollPaths.split("\n").map((s) => s.trim()).filter(Boolean);
    if (pollPaths.length > 0) xporta.poll_paths = pollPaths;
    if (w.xportaPollConcurrency !== 3) xporta.poll_concurrency = w.xportaPollConcurrency;
    if (w.xportaUploadConcurrency !== 4) xporta.upload_concurrency = w.xportaUploadConcurrency;
    if (w.xportaMaxPayloadSize !== 65536) xporta.max_payload_size = w.xportaMaxPayloadSize;
    if (w.xportaCookieName && w.xportaCookieName !== "_sess") xporta.cookie_name = w.xportaCookieName;
    const xportaHeaders = parseHeaderLines(w.xportaExtraHeaders);
    if (xportaHeaders.length > 0) xporta.extra_headers = xportaHeaders;
    config.xporta = xporta;
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

  // Traffic shaping (all transports)
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

  // PrismaTLS transport
  if (w.transport === "prisma-tls") {
    if (w.prismaTlsFingerprint) config.fingerprint = w.prismaTlsFingerprint;
    if (w.prismaTlsAuthSecret) config.prisma_auth_secret = w.prismaTlsAuthSecret;
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
    wsUrl: extractPath(String(ws.url ?? ""), "/ws-tunnel"),
    wsHost: String(ws.host ?? ""),
    wsExtraHeaders: wsHeaders,
    grpcUrl: extractPath(String(grpc.url ?? ""), "/tunnel.PrismaTunnel"),
    xhttpMode: String(xhttp.mode ?? "auto"),
    xhttpUploadUrl: extractPath(String(xhttp.upload_url ?? ""), "/api/v1/upload"),
    xhttpDownloadUrl: extractPath(String(xhttp.download_url ?? ""), "/api/v1/pull"),
    xhttpStreamUrl: extractPath(String(xhttp.stream_url ?? ""), "/api/v1/stream"),
    xhttpExtraHeaders: xhttpHeaders,
    xportaBaseUrl: String(xporta.base_url ?? ""),
    xportaEncoding: String(xporta.encoding ?? "json"),
    xportaPollTimeout: Number(xporta.poll_timeout_secs ?? 55),
    xportaSessionPath: String(xporta.session_path ?? "/api/auth"),
    xportaDataPaths: Array.isArray(xporta.data_paths)
      ? (xporta.data_paths as string[]).join("\n")
      : "/api/v1/data\n/api/v1/sync\n/api/v1/update",
    xportaPollPaths: Array.isArray(xporta.poll_paths)
      ? (xporta.poll_paths as string[]).join("\n")
      : "/api/v1/notifications\n/api/v1/feed\n/api/v1/events",
    xportaPollConcurrency: Number(xporta.poll_concurrency ?? 3),
    xportaUploadConcurrency: Number(xporta.upload_concurrency ?? 4),
    xportaMaxPayloadSize: Number(xporta.max_payload_size ?? 65536),
    xportaCookieName: String(xporta.cookie_name ?? "_sess"),
    xportaExtraHeaders: Array.isArray(xporta.extra_headers)
      ? (xporta.extra_headers as [string, string][]).map(([k, v]) => `${k}: ${v}`).join("\n")
      : "",
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
    prismaTlsFingerprint: String(c.fingerprint ?? "chrome"),
    prismaTlsAuthSecret: String(c.prisma_auth_secret ?? ""),
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
