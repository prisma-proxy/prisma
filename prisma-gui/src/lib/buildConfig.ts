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
  tunDevice: "prisma-tun",
  tunMtu: 1500,
  tunIncludeRoutes: [],
  tunExcludeRoutes: [],
  dnsMode: "direct",
  dnsUpstream: "8.8.8.8:53",
  fakeIpRange: "198.18.0.0/15",
  tags: [],
};

/** Maps WizardState → ClientConfig JSON object */
export function buildClientConfig(w: WizardState): Record<string, unknown> {
  const transport: Record<string, unknown> = { type: w.transport };

  switch (w.transport) {
    case "quic":
      if (w.cipher) transport.cipher = w.cipher;
      if (w.fingerprint) transport.fingerprint = w.fingerprint;
      transport.version = w.quicVersion;
      if (w.sniSlicing) transport.sni_slicing = true;
      break;
    case "ws":
      transport.url = w.wsUrl;
      if (w.wsHost) transport.host = w.wsHost;
      break;
    case "grpc":
      transport.url = w.grpcUrl;
      break;
    case "xhttp":
      transport.mode = w.xhttpMode;
      transport.upload_url = w.xhttpUploadUrl;
      transport.download_url = w.xhttpDownloadUrl;
      transport.stream_url = w.xhttpStreamUrl;
      break;
    case "xporta":
      transport.base_url = w.xportaBaseUrl;
      transport.encoding = w.xportaEncoding;
      transport.poll_timeout = w.xportaPollTimeout;
      break;
    // tcp: no sub-fields
  }

  transport.congestion = w.congestion;
  if (w.targetBandwidth) transport.target_bandwidth = w.targetBandwidth;
  if (w.portHopping) {
    transport.port_hopping = {
      base: w.portHopBase,
      range: w.portHopRange,
      interval: w.portHopInterval,
    };
  }

  const config: Record<string, unknown> = {
    server_host: w.serverHost,
    server_port: w.serverPort,
    client_id: w.clientId,
    auth_secret: w.authSecret,
    protocol_version: w.protocolVersion,
    transport,
    socks5_port: w.socks5Port,
  };

  if (w.httpPort) config.http_port = parseInt(w.httpPort, 10);

  if (w.tunEnabled) {
    config.tun = {
      enabled: true,
      device: w.tunDevice,
      mtu: w.tunMtu,
      include_routes: w.tunIncludeRoutes,
      exclude_routes: w.tunExcludeRoutes,
    };
  }

  config.dns = {
    mode: w.dnsMode,
    upstream: w.dnsUpstream,
    ...(w.dnsMode === "fake" ? { fake_ip_range: w.fakeIpRange } : {}),
  };

  return config;
}

/** Maps a stored ClientConfig back to WizardState (for editing) */
export function parseProfileToWizard(name: string, config: unknown): WizardState {
  const c = (config ?? {}) as Record<string, unknown>;
  const t = (c.transport ?? {}) as Record<string, unknown>;
  const tun = (c.tun ?? {}) as Record<string, unknown>;
  const dns = (c.dns ?? {}) as Record<string, unknown>;
  const ph = (t.port_hopping ?? {}) as Record<string, unknown>;

  return {
    name,
    serverHost: String(c.server_host ?? ""),
    serverPort: Number(c.server_port ?? 443),
    socks5Port: Number(c.socks5_port ?? 1080),
    httpPort: c.http_port ? String(c.http_port) : "",
    clientId: String(c.client_id ?? ""),
    authSecret: String(c.auth_secret ?? ""),
    prismaAuthSecret: "",
    protocolVersion: (c.protocol_version as "v4" | "v3") ?? "v4",
    transport: (t.type as WizardState["transport"]) ?? "quic",
    cipher: String(t.cipher ?? "chacha20-poly1305"),
    fingerprint: String(t.fingerprint ?? ""),
    quicVersion: String(t.version ?? "v1"),
    sniSlicing: Boolean(t.sni_slicing),
    wsUrl: String(t.url ?? "/ws"),
    wsHost: String(t.host ?? ""),
    grpcUrl: String(t.url ?? "/prisma.Proxy/Relay"),
    xhttpMode: String(t.mode ?? "auto"),
    xhttpUploadUrl: String(t.upload_url ?? "/up"),
    xhttpDownloadUrl: String(t.download_url ?? "/down"),
    xhttpStreamUrl: String(t.stream_url ?? "/stream"),
    xportaBaseUrl: String(t.base_url ?? ""),
    xportaEncoding: String(t.encoding ?? "base64"),
    xportaPollTimeout: Number(t.poll_timeout ?? 30),
    congestion: (t.congestion as WizardState["congestion"]) ?? "bbr",
    targetBandwidth: String(t.target_bandwidth ?? ""),
    portHopping: Object.keys(ph).length > 0,
    portHopBase: Number(ph.base ?? 40000),
    portHopRange: Number(ph.range ?? 5000),
    portHopInterval: Number(ph.interval ?? 30),
    tunEnabled: Boolean(tun.enabled),
    tunDevice: String(tun.device ?? "prisma-tun"),
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
