// WizardState — the full shape collected across wizard steps 1–5
export interface WizardState {
  // Step 1
  name: string;
  serverHost: string;
  serverPort: number;
  socks5Port: number;
  httpPort: string; // empty = disabled
  // Step 2
  clientId: string;
  authSecret: string;
  prismaAuthSecret: string;
  protocolVersion: "v4" | "v3";
  // Step 3 — transport + sub-fields
  transport: "quic" | "ws" | "grpc" | "xhttp" | "xporta" | "tcp";
  cipher: string;
  fingerprint: string;
  quicVersion: string;
  sniSlicing: boolean;
  wsUrl: string;
  wsHost: string;
  grpcUrl: string;
  xhttpMode: string;
  xhttpUploadUrl: string;
  xhttpDownloadUrl: string;
  xhttpStreamUrl: string;
  xportaBaseUrl: string;
  xportaEncoding: string;
  xportaPollTimeout: number;
  congestion: "bbr" | "brutal" | "adaptive";
  targetBandwidth: string;
  portHopping: boolean;
  portHopBase: number;
  portHopRange: number;
  portHopInterval: number;
  // Step 4
  tunEnabled: boolean;
  tunDevice: string;
  tunMtu: number;
  tunIncludeRoutes: string[];
  tunExcludeRoutes: string[];
  dnsMode: "direct" | "fake" | "smart" | "tunnel";
  dnsUpstream: string;
  fakeIpRange: string;
  // Step 5
  tags: string[];
}

export const DEFAULT_WIZARD: WizardState = {
  name: "",
  serverHost: "",
  serverPort: 443,
  socks5Port: 1080,
  httpPort: "",
  clientId: "",
  authSecret: "",
  prismaAuthSecret: "",
  protocolVersion: "v4",
  transport: "quic",
  cipher: "chacha20-poly1305",
  fingerprint: "",
  quicVersion: "v1",
  sniSlicing: false,
  wsUrl: "/ws",
  wsHost: "",
  grpcUrl: "/prisma.Proxy/Relay",
  xhttpMode: "auto",
  xhttpUploadUrl: "/up",
  xhttpDownloadUrl: "/down",
  xhttpStreamUrl: "/stream",
  xportaBaseUrl: "",
  xportaEncoding: "base64",
  xportaPollTimeout: 30,
  congestion: "bbr",
  targetBandwidth: "",
  portHopping: false,
  portHopBase: 40000,
  portHopRange: 5000,
  portHopInterval: 30,
  tunEnabled: false,
  tunDevice: "prisma-tun0",
  tunMtu: 1500,
  tunIncludeRoutes: [],
  tunExcludeRoutes: [],
  dnsMode: "direct",
  dnsUpstream: "8.8.8.8:53",
  fakeIpRange: "198.18.0.0/15",
  tags: [],
};

/**
 * Maps WizardState → ClientConfig JSON matching the Rust ClientConfig struct.
 *
 * Rust struct uses flat top-level fields, NOT nested transport objects.
 */
export function buildClientConfig(w: WizardState): Record<string, unknown> {
  const config: Record<string, unknown> = {
    // Required fields
    server_addr: `${w.serverHost}:${w.serverPort}`,
    socks5_listen_addr: `127.0.0.1:${w.socks5Port}`,
    identity: {
      client_id: w.clientId,
      auth_secret: w.authSecret,
    },

    // Transport — plain string, not an object
    transport: w.transport,
    cipher_suite: w.cipher,
    protocol_version: w.protocolVersion,
  };

  // Optional HTTP listen addr
  if (w.httpPort) {
    config.http_listen_addr = `127.0.0.1:${parseInt(w.httpPort, 10)}`;
  }

  // Fingerprint
  if (w.fingerprint) config.fingerprint = w.fingerprint;

  // QUIC-specific top-level fields
  if (w.transport === "quic") {
    config.quic_version = w.quicVersion;
    if (w.sniSlicing) config.sni_slicing = true;
  }

  // WebSocket top-level fields
  if (w.transport === "ws") {
    config.ws_url = w.wsUrl;
    if (w.wsHost) config.ws_host = w.wsHost;
  }

  // gRPC top-level field
  if (w.transport === "grpc") {
    config.grpc_url = w.grpcUrl;
  }

  // XHTTP top-level fields
  if (w.transport === "xhttp") {
    config.xhttp_mode = w.xhttpMode;
    config.xhttp_upload_url = w.xhttpUploadUrl;
    config.xhttp_download_url = w.xhttpDownloadUrl;
    config.xhttp_stream_url = w.xhttpStreamUrl;
  }

  // XPorta — nested object matching XPortaClientConfig
  if (w.transport === "xporta" && w.xportaBaseUrl) {
    config.xporta = {
      base_url: w.xportaBaseUrl,
      encoding: w.xportaEncoding,
      poll_timeout_secs: w.xportaPollTimeout,
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
    };
  }

  // TUN — nested TunConfig (field is device_name, not device)
  if (w.tunEnabled) {
    config.tun = {
      enabled: true,
      device_name: w.tunDevice,
      mtu: w.tunMtu,
      include_routes: w.tunIncludeRoutes.length > 0 ? w.tunIncludeRoutes : ["0.0.0.0/0"],
      exclude_routes: w.tunExcludeRoutes,
    };
  }

  // DNS — nested DnsConfig (mode is a lowercase enum string)
  config.dns = {
    mode: w.dnsMode,
    upstream: w.dnsUpstream,
    ...(w.dnsMode === "fake" ? { fake_ip_range: w.fakeIpRange } : {}),
  };

  // PrismaAuth secret (v4)
  if (w.prismaAuthSecret) {
    config.prisma_auth_secret = w.prismaAuthSecret;
  }

  return config;
}

/** Maps a stored ClientConfig back to WizardState (for editing) */
export function parseProfileToWizard(name: string, config: unknown): WizardState {
  const c = (config ?? {}) as Record<string, unknown>;
  const identity = (c.identity ?? {}) as Record<string, unknown>;
  const tun = (c.tun ?? {}) as Record<string, unknown>;
  const dns = (c.dns ?? {}) as Record<string, unknown>;
  const congestion = (c.congestion ?? {}) as Record<string, unknown>;
  const ph = (c.port_hopping ?? {}) as Record<string, unknown>;
  const xporta = (c.xporta ?? {}) as Record<string, unknown>;

  // Parse server_addr "host:port"
  const serverAddr = String(c.server_addr ?? "");
  const lastColon = serverAddr.lastIndexOf(":");
  const serverHost = lastColon > 0 ? serverAddr.slice(0, lastColon) : serverAddr;
  const serverPort = lastColon > 0 ? Number(serverAddr.slice(lastColon + 1)) || 443 : 443;

  // Parse socks5_listen_addr "host:port"
  const socksAddr = String(c.socks5_listen_addr ?? "");
  const socksColon = socksAddr.lastIndexOf(":");
  const socks5Port = socksColon > 0 ? Number(socksAddr.slice(socksColon + 1)) || 1080 : 1080;

  // Parse http_listen_addr
  const httpAddr = c.http_listen_addr ? String(c.http_listen_addr) : "";
  const httpColon = httpAddr.lastIndexOf(":");
  const httpPort = httpColon > 0 ? httpAddr.slice(httpColon + 1) : "";

  return {
    name,
    serverHost,
    serverPort,
    socks5Port,
    httpPort,
    clientId: String(identity.client_id ?? ""),
    authSecret: String(identity.auth_secret ?? ""),
    prismaAuthSecret: String(c.prisma_auth_secret ?? ""),
    protocolVersion: (c.protocol_version as "v4" | "v3") ?? "v4",
    transport: (c.transport as WizardState["transport"]) ?? "quic",
    cipher: String(c.cipher_suite ?? "chacha20-poly1305"),
    fingerprint: String(c.fingerprint ?? ""),
    quicVersion: String(c.quic_version ?? "v1"),
    sniSlicing: Boolean(c.sni_slicing),
    wsUrl: String(c.ws_url ?? "/ws"),
    wsHost: String(c.ws_host ?? ""),
    grpcUrl: String(c.grpc_url ?? "/prisma.Proxy/Relay"),
    xhttpMode: String(c.xhttp_mode ?? "auto"),
    xhttpUploadUrl: String(c.xhttp_upload_url ?? "/up"),
    xhttpDownloadUrl: String(c.xhttp_download_url ?? "/down"),
    xhttpStreamUrl: String(c.xhttp_stream_url ?? "/stream"),
    xportaBaseUrl: String(xporta.base_url ?? ""),
    xportaEncoding: String(xporta.encoding ?? "base64"),
    xportaPollTimeout: Number(xporta.poll_timeout_secs ?? 30),
    congestion: (congestion.mode as WizardState["congestion"]) ?? "bbr",
    targetBandwidth: String(congestion.target_bandwidth ?? ""),
    portHopping: Boolean(ph.enabled),
    portHopBase: Number(ph.base_port ?? 40000),
    portHopRange: Number(ph.port_range ?? 5000),
    portHopInterval: Number(ph.interval_secs ?? 30),
    tunEnabled: Boolean(tun.enabled),
    tunDevice: String(tun.device_name ?? "prisma-tun0"),
    tunMtu: Number(tun.mtu ?? 1500),
    tunIncludeRoutes: (tun.include_routes as string[]) ?? [],
    tunExcludeRoutes: (tun.exclude_routes as string[]) ?? [],
    dnsMode: (dns.mode as WizardState["dnsMode"]) ?? "direct",
    dnsUpstream: String(dns.upstream ?? "8.8.8.8:53"),
    fakeIpRange: String(dns.fake_ip_range ?? "198.18.0.0/15"),
    tags: [],
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
  return errs;
}
