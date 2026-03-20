use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::router;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub listen_addr: String,
    pub quic_listen_addr: String,
    pub tls: Option<TlsConfig>,
    pub authorized_clients: Vec<AuthorizedClient>,
    #[serde(default)]
    pub logging: LoggingConfig,
    #[serde(default)]
    pub performance: PerformanceConfig,
    #[serde(default)]
    pub port_forwarding: PortForwardingConfig,
    #[serde(default)]
    pub management_api: ManagementApiConfig,
    #[serde(default)]
    pub camouflage: CamouflageConfig,
    #[serde(default)]
    pub cdn: CdnConfig,
    #[serde(default)]
    pub padding: PaddingConfig,
    // Congestion control (QUIC only)
    #[serde(default)]
    pub congestion: super::client::CongestionConfig,
    // Port hopping (QUIC only)
    #[serde(default)]
    pub port_hopping: crate::port_hop::PortHoppingConfig,
    /// Upstream DNS server for CMD_DNS_QUERY forwarding.
    #[serde(default = "default_dns_upstream")]
    pub dns_upstream: String,
    /// Protocol version (always "v5"; read-only, kept for config file compatibility).
    #[serde(default = "default_protocol_version")]
    pub protocol_version: String,
    /// PrismaTLS configuration (replaces REALITY).
    #[serde(default)]
    pub prisma_tls: PrismaTlsConfig,
    /// Traffic shaping (anti-fingerprinting).
    #[serde(default)]
    pub traffic_shaping: crate::traffic_shaping::TrafficShapingConfig,
    /// Allow transport-only cipher mode (BLAKE3 MAC only, no application-layer encryption).
    /// Safe when transport already provides confidentiality (TLS/QUIC). Defaults to false.
    #[serde(default)]
    pub allow_transport_only_cipher: bool,
    /// Cross-layer RTT normalization.
    #[serde(default)]
    pub anti_rtt: AntiRttConfig,
    /// Static routing rules (loaded from config, persist across restarts).
    #[serde(default)]
    pub routing: router::RoutingConfig,
    /// ShadowTLS v3 configuration.
    #[serde(default)]
    pub shadow_tls: ShadowTlsServerConfig,
    /// WireGuard-compatible UDP transport.
    #[serde(default)]
    pub wireguard: crate::wireguard::WireGuardServerConfig,
    /// Per-client access control lists.
    #[serde(default)]
    pub acls: std::collections::HashMap<String, crate::acl::Acl>,
    /// Server-side transport fallback configuration.
    #[serde(default)]
    pub fallback: FallbackConfig,
    /// Graceful shutdown drain timeout in seconds (default: 30).
    #[serde(default = "default_shutdown_drain_timeout")]
    pub shutdown_drain_timeout_secs: u64,
    /// Watch the config file for changes and auto-reload.
    #[serde(default)]
    pub config_watch: bool,
    /// SSH transport configuration.
    #[serde(default)]
    pub ssh: SshServerConfig,
    /// Session ticket key rotation interval in hours (default: 6).
    #[serde(default = "default_ticket_rotation_hours")]
    pub ticket_rotation_hours: u64,
}

/// ShadowTLS v3 server configuration.
///
/// ShadowTLS uses a real TLS handshake with a legitimate server as camouflage.
/// Proxy data is multiplexed in TLS application data frames and authenticated
/// using HMAC to distinguish proxy traffic from the cover server's real responses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShadowTlsServerConfig {
    /// Whether ShadowTLS listener is enabled.
    #[serde(default)]
    pub enabled: bool,
    /// Listen address for ShadowTLS connections (e.g., "0.0.0.0:8444").
    #[serde(default = "default_shadow_tls_listen_addr")]
    pub listen_addr: String,
    /// The legitimate TLS server to forward handshakes to (e.g., "www.microsoft.com:443").
    #[serde(default)]
    pub handshake_server: Option<String>,
    /// Pre-shared password used to derive the HMAC key for frame authentication.
    #[serde(default)]
    pub password: String,
    /// SNI to expect from clients (for validation).
    #[serde(default)]
    pub sni: Option<String>,
}

impl Default for ShadowTlsServerConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            listen_addr: default_shadow_tls_listen_addr(),
            handshake_server: None,
            password: String::new(),
            sni: None,
        }
    }
}

fn default_shadow_tls_listen_addr() -> String {
    "0.0.0.0:8444".into()
}

fn default_protocol_version() -> String {
    "v5".into()
}

fn default_dns_upstream() -> String {
    "8.8.8.8:53".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsConfig {
    pub cert_path: String,
    pub key_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorizedClient {
    pub id: String,
    pub auth_secret: String, // hex-encoded
    pub name: Option<String>,
    /// Per-client upload bandwidth limit (e.g., "100mbps").
    #[serde(default)]
    pub bandwidth_up: Option<String>,
    /// Per-client download bandwidth limit (e.g., "100mbps").
    #[serde(default)]
    pub bandwidth_down: Option<String>,
    /// Traffic quota (e.g., "100GB").
    #[serde(default)]
    pub quota: Option<String>,
    /// Quota reset period.
    #[serde(default)]
    pub quota_period: Option<String>,
    /// Per-client permissions (granular access control).
    #[serde(default)]
    pub permissions: Option<crate::permissions::ClientPermissions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    #[serde(default = "default_level")]
    pub level: String,
    #[serde(default = "default_format")]
    pub format: String,
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: default_level(),
            format: default_format(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceConfig {
    #[serde(default = "default_max_connections")]
    pub max_connections: u32,
    #[serde(default = "default_timeout")]
    pub connection_timeout_secs: u64,
}

impl Default for PerformanceConfig {
    fn default() -> Self {
        Self {
            max_connections: default_max_connections(),
            connection_timeout_secs: default_timeout(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortForwardingConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_port_range_start")]
    pub port_range_start: u16,
    #[serde(default = "default_port_range_end")]
    pub port_range_end: u16,
    /// Max port forwards per client (default: 10).
    #[serde(default)]
    pub max_forwards_per_client: Option<u32>,
    /// Default max connections per forward (default: 100).
    #[serde(default)]
    pub max_connections_per_forward: Option<u32>,
    /// Default idle timeout in seconds (default: 300).
    #[serde(default)]
    pub default_idle_timeout_secs: Option<u64>,
    /// Specific allowed ports (in addition to range).
    #[serde(default)]
    pub allowed_ports: Vec<u16>,
    /// Specific denied ports (overrides range).
    #[serde(default)]
    pub denied_ports: Vec<u16>,
    /// Global forward bandwidth limit (upload).
    #[serde(default)]
    pub global_bandwidth_up: Option<String>,
    /// Global forward bandwidth limit (download).
    #[serde(default)]
    pub global_bandwidth_down: Option<String>,
    /// Require clients to name their forwards (default: false).
    #[serde(default)]
    pub require_name: bool,
    /// Log each forwarded connection (default: true).
    #[serde(default = "default_log_connections")]
    pub log_connections: bool,
    /// IP CIDRs allowed to connect to forwarded ports (empty = allow all).
    #[serde(default)]
    pub allowed_ips: Vec<String>,
    /// Bind addresses the server allows clients to request (empty = only wildcard).
    #[serde(default)]
    pub allowed_bind_addrs: Vec<String>,
}

fn default_log_connections() -> bool {
    true
}

impl PortForwardingConfig {
    /// Check whether a given port is allowed for forwarding.
    ///
    /// A port is allowed when:
    /// 1. Port forwarding is globally enabled, AND
    /// 2. The port is NOT in the `denied_ports` list, AND
    /// 3. The port is either within the configured range OR in the `allowed_ports` list.
    pub fn is_port_allowed(&self, port: u16) -> bool {
        if !self.enabled {
            return false;
        }
        // Denied ports always take precedence
        if self.denied_ports.contains(&port) {
            return false;
        }
        // Check range or explicit allow list
        let in_range = port >= self.port_range_start && port <= self.port_range_end;
        let in_allowed = self.allowed_ports.contains(&port);
        in_range || in_allowed
    }

    /// Check whether a requested bind address is permitted by server policy.
    pub fn is_bind_addr_allowed(&self, addr: &str) -> bool {
        if addr == "0.0.0.0" || addr == "::" {
            return true; // Wildcard always allowed
        }
        if self.allowed_bind_addrs.is_empty() {
            return false; // Only wildcard when no explicit list
        }
        self.allowed_bind_addrs.iter().any(|a| a == addr)
    }

    /// Effective max forwards per client (defaults to 10).
    pub fn effective_max_forwards_per_client(&self) -> usize {
        self.max_forwards_per_client.unwrap_or(10) as usize
    }

    /// Effective max connections per individual forward (defaults to 100).
    pub fn effective_max_connections_per_forward(&self) -> usize {
        self.max_connections_per_forward.unwrap_or(100) as usize
    }

    /// Effective idle timeout in seconds (defaults to 300). 0 = disabled.
    pub fn effective_idle_timeout_secs(&self) -> u64 {
        self.default_idle_timeout_secs.unwrap_or(300)
    }
}

impl Default for PortForwardingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port_range_start: default_port_range_start(),
            port_range_end: default_port_range_end(),
            max_forwards_per_client: None,
            max_connections_per_forward: None,
            default_idle_timeout_secs: None,
            allowed_ports: Vec::new(),
            denied_ports: Vec::new(),
            global_bandwidth_up: None,
            global_bandwidth_down: None,
            require_name: false,
            log_connections: true,
            allowed_ips: Vec::new(),
            allowed_bind_addrs: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagementApiConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_mgmt_listen_addr")]
    pub listen_addr: String,
    #[serde(default)]
    pub auth_token: String,
    #[serde(default)]
    pub cors_origins: Vec<String>,
    #[serde(default)]
    pub console_dir: Option<String>,
    /// TLS configuration for the management API.
    /// If omitted and `tls_enabled = true`, inherits from the server's top-level
    /// `[tls]` section automatically. By default TLS is **disabled** on the
    /// management API so it serves plain HTTP; set `tls_enabled = true` to opt in.
    pub tls: Option<TlsConfig>,
    /// Enable TLS on the management API. When true and no `[management_api.tls]`
    /// is provided, the server's top-level `[tls]` cert is inherited.
    /// Defaults to `false` so the API is accessible via HTTP out of the box.
    #[serde(default)]
    pub tls_enabled: bool,
}

impl Default for ManagementApiConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            listen_addr: default_mgmt_listen_addr(),
            auth_token: String::new(),
            cors_origins: Vec::new(),
            console_dir: None,
            tls: None,
            tls_enabled: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingRule {
    pub id: Uuid,
    pub name: String,
    pub priority: u32,
    pub condition: RuleCondition,
    pub action: RuleAction,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum RuleCondition {
    DomainMatch(String),
    DomainExact(String),
    IpCidr(String),
    PortRange(u16, u16),
    All,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RuleAction {
    Allow,
    Block,
}

impl RoutingRule {
    /// Convert a client-style router::Rule into a server RoutingRule.
    /// Used to load static rules from the server config file.
    pub fn from_router_rule(rule: &router::Rule, priority: u32) -> Self {
        let condition = match &rule.condition {
            router::RuleCondition::Domain(s) => RuleCondition::DomainExact(s.clone()),
            router::RuleCondition::DomainSuffix(s) => {
                RuleCondition::DomainMatch(format!("*.{}", s))
            }
            router::RuleCondition::DomainKeyword(s) => {
                RuleCondition::DomainMatch(format!("*{}*", s))
            }
            router::RuleCondition::IpCidr(s) => RuleCondition::IpCidr(s.clone()),
            router::RuleCondition::GeoIp(s) => RuleCondition::IpCidr(format!("geoip:{}", s)),
            router::RuleCondition::Port(s) => {
                if let Some((a, b)) = s.split_once('-') {
                    RuleCondition::PortRange(a.parse().unwrap_or(0), b.parse().unwrap_or(0))
                } else {
                    let p = s.parse().unwrap_or(0);
                    RuleCondition::PortRange(p, p)
                }
            }
            router::RuleCondition::All => RuleCondition::All,
        };
        let action = match rule.action {
            router::RouteAction::Block => RuleAction::Block,
            _ => RuleAction::Allow,
        };
        RoutingRule {
            id: Uuid::new_v4(),
            name: format!("static-{}", priority),
            priority,
            condition,
            action,
            enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CamouflageConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub fallback_addr: Option<String>,
    #[serde(default)]
    pub tls_on_tcp: bool,
    #[serde(default = "super::default_alpn")]
    pub alpn_protocols: Vec<String>,
    /// Salamander UDP obfuscation password. When set, QUIC packets are XOR-obfuscated.
    #[serde(default)]
    pub salamander_password: Option<String>,
    /// HTTP/3 masquerade: upstream URL to reverse-proxy for non-PrismaVeil QUIC connections.
    /// When set, active probers see a real website over HTTP/3.
    #[serde(default)]
    pub h3_cover_site: Option<String>,
    /// HTTP/3 masquerade: directory of static files to serve for non-PrismaVeil QUIC connections.
    /// Used as fallback when `h3_cover_site` is not set.
    #[serde(default)]
    pub h3_static_dir: Option<String>,
}

impl Default for CamouflageConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            fallback_addr: None,
            tls_on_tcp: false,
            alpn_protocols: super::default_alpn(),
            salamander_password: None,
            h3_cover_site: None,
            h3_static_dir: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CdnConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_cdn_listen_addr")]
    pub listen_addr: String,
    #[serde(default)]
    pub tls: Option<CdnTlsConfig>,
    #[serde(default = "default_ws_tunnel_path")]
    pub ws_tunnel_path: String,
    #[serde(default = "default_grpc_tunnel_path")]
    pub grpc_tunnel_path: String,
    #[serde(default)]
    pub cover_upstream: Option<String>,
    #[serde(default)]
    pub cover_static_dir: Option<String>,
    #[serde(default)]
    pub trusted_proxies: Vec<String>,
    #[serde(default)]
    pub expose_management_api: bool,
    #[serde(default = "default_management_api_path")]
    pub management_api_path: String,
    // XHTTP transport paths
    #[serde(default = "default_xhttp_upload_path")]
    pub xhttp_upload_path: String,
    #[serde(default = "default_xhttp_download_path")]
    pub xhttp_download_path: String,
    #[serde(default = "default_xhttp_stream_path")]
    pub xhttp_stream_path: String,
    #[serde(default)]
    pub xhttp_mode: Option<String>,
    #[serde(default)]
    pub xhttp_extra_headers: Vec<(String, String)>,
    #[serde(default)]
    pub xhttp_nosse: bool,
    // XPorta transport (next-gen CDN transport)
    #[serde(default)]
    pub xporta: Option<XPortaServerConfig>,
    // Header obfuscation
    #[serde(default)]
    pub response_server_header: Option<String>,
    #[serde(default = "default_true")]
    pub padding_header: bool,
    #[serde(default)]
    pub enable_sse_disguise: bool,
}

impl Default for CdnConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            listen_addr: default_cdn_listen_addr(),
            tls: None,
            ws_tunnel_path: default_ws_tunnel_path(),
            grpc_tunnel_path: default_grpc_tunnel_path(),
            cover_upstream: None,
            cover_static_dir: None,
            trusted_proxies: Vec::new(),
            expose_management_api: false,
            management_api_path: default_management_api_path(),
            xhttp_upload_path: default_xhttp_upload_path(),
            xhttp_download_path: default_xhttp_download_path(),
            xhttp_stream_path: default_xhttp_stream_path(),
            xhttp_mode: None,
            xhttp_extra_headers: Vec::new(),
            xhttp_nosse: false,
            xporta: None,
            response_server_header: None,
            padding_header: true,
            enable_sse_disguise: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CdnTlsConfig {
    pub cert_path: String,
    pub key_path: String,
}

/// Per-frame padding configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaddingConfig {
    #[serde(default = "default_padding_min")]
    pub min: u16,
    #[serde(default = "default_padding_max")]
    pub max: u16,
}

impl Default for PaddingConfig {
    fn default() -> Self {
        Self {
            min: default_padding_min(),
            max: default_padding_max(),
        }
    }
}

fn default_padding_min() -> u16 {
    0
}
fn default_padding_max() -> u16 {
    256
}

fn default_cdn_listen_addr() -> String {
    "0.0.0.0:443".into()
}
fn default_ws_tunnel_path() -> String {
    "/ws-tunnel".into()
}
fn default_grpc_tunnel_path() -> String {
    "/tunnel.PrismaTunnel".into()
}
fn default_management_api_path() -> String {
    "/prisma-mgmt".into()
}
fn default_xhttp_upload_path() -> String {
    "/api/v1/upload".into()
}
fn default_xhttp_download_path() -> String {
    "/api/v1/pull".into()
}
fn default_xhttp_stream_path() -> String {
    "/api/v1/stream".into()
}
fn default_true() -> bool {
    true
}

fn default_mgmt_listen_addr() -> String {
    "127.0.0.1:9090".into()
}

fn default_port_range_start() -> u16 {
    1024
}
fn default_port_range_end() -> u16 {
    65535
}

/// XPorta server configuration — next-generation CDN transport.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XPortaServerConfig {
    /// Whether XPorta transport is enabled.
    #[serde(default)]
    pub enabled: bool,
    /// Session initialization path.
    #[serde(default = "default_xporta_session_path")]
    pub session_path: String,
    /// Upload data paths (must match client config).
    #[serde(default = "default_xporta_data_paths")]
    pub data_paths: Vec<String>,
    /// Long-poll download paths (must match client config).
    #[serde(default = "default_xporta_poll_paths")]
    pub poll_paths: Vec<String>,
    /// Session timeout in seconds.
    #[serde(default = "default_xporta_session_timeout")]
    pub session_timeout_secs: u64,
    /// Maximum concurrent sessions per client.
    #[serde(default = "default_xporta_max_sessions")]
    pub max_sessions_per_client: u16,
    /// Cookie name for session tokens.
    #[serde(default = "default_xporta_cookie_name")]
    pub cookie_name: String,
    /// Payload encoding: "json" (default) or "binary".
    #[serde(default = "default_xporta_encoding")]
    pub encoding: String,
}

fn default_xporta_session_path() -> String {
    "/api/auth".into()
}
fn default_xporta_data_paths() -> Vec<String> {
    vec![
        "/api/v1/data".into(),
        "/api/v1/sync".into(),
        "/api/v1/update".into(),
    ]
}
fn default_xporta_poll_paths() -> Vec<String> {
    vec![
        "/api/v1/notifications".into(),
        "/api/v1/feed".into(),
        "/api/v1/events".into(),
    ]
}
fn default_xporta_session_timeout() -> u64 {
    300
}
fn default_xporta_max_sessions() -> u16 {
    8
}
fn default_xporta_cookie_name() -> String {
    "_sess".into()
}
fn default_xporta_encoding() -> String {
    "json".into()
}

/// PrismaTLS configuration (replaces REALITY).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrismaTlsConfig {
    #[serde(default)]
    pub enabled: bool,
    /// Mask servers for relay (replaces single `dest`).
    #[serde(default)]
    pub mask_servers: Vec<MaskServerEntry>,
    /// Shared auth secret (hex-encoded, 32 bytes).
    #[serde(default)]
    pub auth_secret: String,
    /// Auth key rotation interval in hours. Default: 1.
    #[serde(default = "default_auth_rotation_hours")]
    pub auth_rotation_hours: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaskServerEntry {
    pub addr: String,
    #[serde(default)]
    pub names: Vec<String>,
}

fn default_auth_rotation_hours() -> u64 {
    1
}

fn default_shutdown_drain_timeout() -> u64 {
    30
}

fn default_ticket_rotation_hours() -> u64 {
    6
}

impl Default for PrismaTlsConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            mask_servers: Vec::new(),
            auth_secret: String::new(),
            auth_rotation_hours: 1,
        }
    }
}

/// Cross-layer RTT normalization.
/// Delays transport-layer ACKs to mask the proxy hop.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AntiRttConfig {
    #[serde(default)]
    pub enabled: bool,
    /// Target RTT in milliseconds to normalize transport ACKs to.
    /// Should match typical RTT to popular destinations (~100-200ms).
    #[serde(default = "default_normalization_ms")]
    pub normalization_ms: u32,
}

impl Default for AntiRttConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            normalization_ms: default_normalization_ms(),
        }
    }
}

fn default_normalization_ms() -> u32 {
    150
}

/// SSH transport server configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshServerConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_ssh_listen_addr")]
    pub listen_addr: String,
    #[serde(default)]
    pub host_key_path: Option<String>,
    #[serde(default)]
    pub allowed_users: Vec<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub authorized_keys_path: Option<String>,
    #[serde(default)]
    pub fake_shell: bool,
    #[serde(default = "default_ssh_banner")]
    pub banner: String,
}

impl Default for SshServerConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            listen_addr: default_ssh_listen_addr(),
            host_key_path: None,
            allowed_users: Vec::new(),
            password: None,
            authorized_keys_path: None,
            fake_shell: false,
            banner: default_ssh_banner(),
        }
    }
}

fn default_ssh_listen_addr() -> String {
    "0.0.0.0:2222".into()
}

fn default_ssh_banner() -> String {
    "SSH-2.0-OpenSSH_9.6".into()
}

/// Server-side transport fallback configuration.
///
/// When the primary transport fails or encounters repeated errors,
/// the server can automatically start fallback transports.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FallbackConfig {
    /// Whether fallback is enabled.
    #[serde(default)]
    pub enabled: bool,
    /// Ordered list of transports to try: "tcp", "quic", "websocket", "grpc", "xhttp", "xporta".
    #[serde(default = "default_fallback_chain")]
    pub chain: Vec<String>,
    /// Interval (in seconds) for health checks on each transport listener.
    #[serde(default = "default_health_check_interval")]
    pub health_check_interval: u64,
    /// Automatically switch to the next transport on failure.
    #[serde(default = "default_true_fallback")]
    pub auto_switch_on_failure: bool,
    /// Maximum consecutive failures before triggering fallback.
    #[serde(default = "default_max_failures")]
    pub max_consecutive_failures: u32,
    /// Whether to migrate back to the primary when it recovers.
    #[serde(default)]
    pub migrate_back_on_recovery: bool,
}

impl Default for FallbackConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            chain: default_fallback_chain(),
            health_check_interval: default_health_check_interval(),
            auto_switch_on_failure: true,
            max_consecutive_failures: default_max_failures(),
            migrate_back_on_recovery: false,
        }
    }
}

fn default_fallback_chain() -> Vec<String> {
    vec![
        "tcp".into(),
        "quic".into(),
        "websocket".into(),
        "grpc".into(),
    ]
}

fn default_health_check_interval() -> u64 {
    30
}

fn default_true_fallback() -> bool {
    true
}

fn default_max_failures() -> u32 {
    5
}

fn default_level() -> String {
    "info".into()
}
fn default_format() -> String {
    "pretty".into()
}
fn default_max_connections() -> u32 {
    1024
}
fn default_timeout() -> u64 {
    300
}
