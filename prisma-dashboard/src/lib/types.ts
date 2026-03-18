export interface HealthResponse {
  status: string;
  uptime_secs: number;
  version: string;
}

export interface MetricsSnapshot {
  timestamp: string;
  uptime_secs: number;
  total_connections: number;
  active_connections: number;
  total_bytes_up: number;
  total_bytes_down: number;
  handshake_failures: number;
}

export interface ConnectionInfo {
  session_id: string;
  client_id: string | null;
  client_name: string | null;
  peer_addr: string;
  transport: string;
  mode: string;
  connected_at: string;
  bytes_up: number;
  bytes_down: number;
}

export interface ClientInfo {
  id: string;
  name: string | null;
  enabled: boolean;
}

export interface CreateClientResponse {
  id: string;
  name: string | null;
  auth_secret_hex: string;
}

// --- Nested config sub-types (matching backend ConfigResponse) ---

export interface PerformanceInfo {
  max_connections: number;
  connection_timeout_secs: number;
}

export interface PortForwardingInfo {
  enabled: boolean;
  port_range_start: number;
  port_range_end: number;
}

export interface CamouflageInfo {
  enabled: boolean;
  tls_on_tcp: boolean;
  fallback_addr: string | null;
  alpn_protocols: string[];
  salamander_password: string | null;
  h3_cover_site: string | null;
  h3_static_dir: string | null;
}

export interface CdnInfo {
  enabled: boolean;
  listen_addr: string;
  ws_tunnel_path: string;
  grpc_tunnel_path: string;
  xhttp_upload_path: string;
  xhttp_download_path: string;
  xhttp_stream_path: string;
  cover_upstream: string | null;
  xporta_enabled: boolean;
  expose_management_api: boolean;
  management_api_path: string;
  padding_header: boolean;
  enable_sse_disguise: boolean;
}

export interface TrafficShapingInfo {
  padding_mode: string;
  bucket_sizes: number[];
  timing_jitter_ms: number;
  chaff_interval_ms: number;
  coalesce_window_ms: number;
}

export interface CongestionInfo {
  mode: string;
  target_bandwidth: string | null;
}

export interface AntiRttInfo {
  enabled: boolean;
  normalization_ms: number;
}

export interface PrismaTlsInfo {
  enabled: boolean;
  mask_server_count: number;
  auth_rotation_hours: number;
}

export interface PaddingInfo {
  min: number;
  max: number;
}

export interface PortHoppingInfo {
  enabled: boolean;
  base_port: number;
  range: number;
  interval_secs: number;
  grace_period_secs: number;
}

export interface ManagementApiInfo {
  enabled: boolean;
  listen_addr: string;
  tls_enabled: boolean;
  cors_origins: string[];
}

export interface ConfigResponse {
  listen_addr: string;
  quic_listen_addr: string;
  tls_enabled: boolean;
  authorized_clients_count: number;
  logging_level: string;
  logging_format: string;
  protocol_version: string;
  dns_upstream: string;
  allow_transport_only_cipher: boolean;
  performance: PerformanceInfo;
  port_forwarding: PortForwardingInfo;
  camouflage: CamouflageInfo;
  cdn: CdnInfo;
  traffic_shaping: TrafficShapingInfo;
  congestion: CongestionInfo;
  anti_rtt: AntiRttInfo;
  prisma_tls: PrismaTlsInfo;
  padding: PaddingInfo;
  port_hopping: PortHoppingInfo;
  management_api: ManagementApiInfo;
  routing_rules_count: number;
}

export interface TlsInfoResponse {
  enabled: boolean;
  cert_path: string | null;
  key_path: string | null;
}

export interface ForwardInfo {
  session_id: string;
  peer_addr: string;
  connected_at: string;
  bytes_up: number;
  bytes_down: number;
}

export interface RoutingRule {
  id: string;
  name: string;
  priority: number;
  condition: RuleCondition;
  action: "Allow" | "Block";
  enabled: boolean;
}

export type RuleCondition =
  | { type: "DomainMatch"; value: string }
  | { type: "DomainExact"; value: string }
  | { type: "IpCidr"; value: string }
  | { type: "PortRange"; value: [number, number] }
  | { type: "All"; value: null };

/** Log levels ordered from most verbose to least verbose. */
export const LOG_LEVELS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Numeric priority for each log level (higher = more severe). */
export const LOG_LEVEL_PRIORITY: Record<string, number> = Object.fromEntries(
  LOG_LEVELS.map((l, i) => [l, i])
);

export interface LogEntry {
  timestamp: string;
  level: string;
  target: string;
  message: string;
}

export interface SystemInfoResponse {
  version: string;
  platform: string;
  pid: number;
  cpu_usage: number;
  memory_used_mb: number;
  memory_total_mb: number;
  listeners: ListenerInfo[];
  cert_expiry_days: number | null;
}

export interface ListenerInfo {
  addr: string;
  protocol: string;
}

export interface ClientBandwidthInfo {
  client_id: string;
  upload_bps: number;
  download_bps: number;
}

export interface ClientQuotaInfo {
  client_id: string;
  quota_bytes: number;
  used_bytes: number;
  remaining_bytes: number;
}

export interface BandwidthSummary {
  clients: ClientBandwidthSummaryEntry[];
}

export interface ClientBandwidthSummaryEntry {
  client_id: string;
  client_name: string | null;
  upload_bps: number;
  download_bps: number;
  quota_bytes: number;
  quota_used: number;
}

export interface BackupInfo {
  name: string;
  timestamp: string;
  size: number;
}

export interface BackupDiff {
  changes: DiffChange[];
}

export interface DiffChange {
  tag: "equal" | "insert" | "delete";
  old_value: string | null;
  new_value: string | null;
}

export interface AlertConfig {
  cert_expiry_days: number;
  quota_warn_percent: number;
  handshake_spike_threshold: number;
}
