use serde::{Deserialize, Serialize};

use super::server::LoggingConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientConfig {
    pub socks5_listen_addr: String,
    #[serde(default)]
    pub http_listen_addr: Option<String>,
    /// PAC server port. Defaults to 8070 when not set.
    #[serde(default)]
    pub pac_port: Option<u16>,
    pub server_addr: String,
    pub identity: ClientIdentity,
    #[serde(default = "default_cipher_suite")]
    pub cipher_suite: String,
    #[serde(default = "default_transport")]
    pub transport: String,
    #[serde(default)]
    pub skip_cert_verify: bool,
    #[serde(default)]
    pub logging: LoggingConfig,
    #[serde(default)]
    pub port_forwards: Vec<PortForwardConfig>,
    #[serde(default)]
    pub tls_on_tcp: bool,
    #[serde(default = "super::default_alpn")]
    pub alpn_protocols: Vec<String>,
    #[serde(default)]
    pub tls_server_name: Option<String>,
    #[serde(default)]
    pub ws_url: Option<String>,
    #[serde(default)]
    pub ws_host: Option<String>,
    #[serde(default)]
    pub ws_extra_headers: Vec<(String, String)>,
    #[serde(default)]
    pub grpc_url: Option<String>,
    // XHTTP transport
    #[serde(default)]
    pub xhttp_mode: Option<String>,
    #[serde(default)]
    pub xhttp_upload_url: Option<String>,
    #[serde(default)]
    pub xhttp_download_url: Option<String>,
    #[serde(default)]
    pub xhttp_stream_url: Option<String>,
    #[serde(default)]
    pub xhttp_extra_headers: Vec<(String, String)>,
    // XPorta transport (next-gen CDN transport)
    #[serde(default)]
    pub xporta: Option<XPortaClientConfig>,
    // XMUX connection pool
    #[serde(default)]
    pub xmux: Option<XmuxConfig>,
    /// Enable XMUX stream multiplexing over transport connections.
    #[serde(default)]
    pub mux_enabled: bool,
    /// Maximum number of concurrent streams per mux connection.
    #[serde(default = "default_mux_max_streams")]
    pub mux_max_streams: u32,
    /// Maximum number of mux transport connections in the pool.
    #[serde(default = "default_mux_max_connections")]
    pub mux_max_connections: u16,
    // Header obfuscation
    #[serde(default)]
    pub user_agent: Option<String>,
    #[serde(default)]
    pub referer: Option<String>,
    // Congestion control (QUIC only)
    #[serde(default)]
    pub congestion: CongestionConfig,
    // Port hopping (QUIC only)
    #[serde(default)]
    pub port_hopping: crate::port_hop::PortHoppingConfig,
    // Salamander UDP obfuscation (QUIC only)
    #[serde(default)]
    pub salamander_password: Option<String>,
    // FEC (Forward Error Correction) for UDP relay
    #[serde(default)]
    pub udp_fec: crate::fec::FecConfig,
    // DNS handling
    #[serde(default)]
    pub dns: crate::dns::DnsConfig,
    // Rule-based routing
    #[serde(default)]
    pub routing: crate::router::RoutingConfig,
    // TUN mode
    #[serde(default)]
    pub tun: TunConfig,
    // --- v4 features ---
    /// Protocol version: "v4", "v3" (default for backward compat).
    #[serde(default = "default_protocol_version")]
    pub protocol_version: String,
    /// uTLS fingerprint: "chrome", "firefox", "safari", "random", or "none" (default).
    #[serde(default = "default_fingerprint")]
    pub fingerprint: String,
    /// QUIC version preference: "v2", "v1", "auto" (default: "auto").
    #[serde(default = "default_quic_version")]
    pub quic_version: String,
    /// Transport selection mode: "auto" or explicit transport name.
    #[serde(default = "default_transport_mode")]
    pub transport_mode: String,
    /// Ordered list of transports for auto-fallback.
    #[serde(default = "default_fallback_order")]
    pub fallback_order: Vec<String>,
    /// SNI slicing for QUIC (fragment ClientHello across CRYPTO frames).
    #[serde(default)]
    pub sni_slicing: bool,
    /// Traffic shaping configuration.
    #[serde(default)]
    pub traffic_shaping: crate::traffic_shaping::TrafficShapingConfig,
    /// Entropy camouflage for Salamander/raw UDP.
    #[serde(default)]
    pub entropy_camouflage: bool,
    /// PrismaTLS auth secret for v4 authentication (hex-encoded, 32 bytes).
    #[serde(default)]
    pub prisma_auth_secret: Option<String>,
    /// Use transport-only cipher mode (BLAKE3 MAC only, no application-layer encryption).
    /// Only effective when transport provides confidentiality (TLS/QUIC). Defaults to false.
    #[serde(default)]
    pub transport_only_cipher: bool,
    /// Server public key pin: hex-encoded SHA-256 hash of the server's ephemeral public key.
    /// When set, the client verifies the server's identity during handshake by comparing the
    /// SHA-256 hash of the received `server_ephemeral_pub` against this pinned value.
    /// This provides end-to-end server authentication independent of TLS, which is critical
    /// when traffic traverses CDNs that terminate TLS.
    /// Generate with: `prisma-cli server-key-pin --key <hex-encoded-server-public-key>`
    #[serde(default)]
    pub server_key_pin: Option<String>,
    /// Server list subscriptions for automatic server discovery and updates.
    #[serde(default)]
    pub subscriptions: Vec<SubscriptionConfig>,
    /// ShadowTLS v3 transport configuration.
    #[serde(default)]
    pub shadow_tls: Option<ShadowTlsClientConfig>,
    /// WireGuard-compatible UDP transport.
    #[serde(default)]
    pub wireguard: Option<crate::wireguard::WireGuardClientConfig>,
}

/// A subscription source for fetching server lists from a URL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionConfig {
    /// HTTP(S) URL to fetch the server list from.
    pub url: String,
    /// Human-readable name for this subscription.
    pub name: String,
    /// Auto-update interval in seconds (0 = disabled).
    #[serde(default = "default_subscription_interval")]
    pub update_interval_secs: u64,
    /// ISO 8601 timestamp of the last successful update.
    #[serde(default)]
    pub last_updated: Option<String>,
}

fn default_subscription_interval() -> u64 {
    3600
}

/// ShadowTLS v3 client configuration.
///
/// ShadowTLS wraps the proxy connection in a real TLS handshake with a legitimate
/// cover server. After handshake, proxy data is sent as authenticated TLS application
/// data frames, indistinguishable from real TLS traffic to DPI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShadowTlsClientConfig {
    /// Address of the ShadowTLS server (e.g., "proxy.example.com:8444").
    pub server_addr: String,
    /// Pre-shared password (must match server). Used to derive HMAC key.
    pub password: String,
    /// SNI for the cover server TLS handshake (e.g., "www.microsoft.com").
    /// This determines what the TLS ClientHello looks like to DPI.
    pub sni: String,
}

/// TUN device configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_device_name")]
    pub device_name: String,
    #[serde(default = "default_mtu")]
    pub mtu: u16,
    /// Routes to capture (default: all traffic).
    #[serde(default = "default_include_routes")]
    pub include_routes: Vec<String>,
    /// Routes to exclude (e.g., the proxy server itself).
    #[serde(default)]
    pub exclude_routes: Vec<String>,
    /// DNS mode override for TUN mode.
    #[serde(default = "default_tun_dns")]
    pub dns: String,
}

impl Default for TunConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            device_name: default_device_name(),
            mtu: default_mtu(),
            include_routes: default_include_routes(),
            exclude_routes: Vec::new(),
            dns: default_tun_dns(),
        }
    }
}

fn default_device_name() -> String {
    "prisma-tun0".into()
}

fn default_mtu() -> u16 {
    1500
}

fn default_include_routes() -> Vec<String> {
    vec!["0.0.0.0/0".into()]
}

fn default_tun_dns() -> String {
    "fake".into()
}

/// Congestion control configuration for QUIC transport.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CongestionConfig {
    /// Mode: "brutal", "bbr", or "adaptive" (default: "bbr")
    #[serde(default = "default_congestion_mode")]
    pub mode: String,
    /// Target bandwidth for brutal/adaptive mode (e.g., "100mbps")
    #[serde(default)]
    pub target_bandwidth: Option<String>,
}

impl Default for CongestionConfig {
    fn default() -> Self {
        Self {
            mode: default_congestion_mode(),
            target_bandwidth: None,
        }
    }
}

fn default_congestion_mode() -> String {
    "bbr".into()
}

/// XMUX connection multiplexing configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XmuxConfig {
    #[serde(default = "default_xmux_max_connections_min")]
    pub max_connections_min: u16,
    #[serde(default = "default_xmux_max_connections_max")]
    pub max_connections_max: u16,
    #[serde(default = "default_xmux_max_concurrency_min")]
    pub max_concurrency_min: u16,
    #[serde(default = "default_xmux_max_concurrency_max")]
    pub max_concurrency_max: u16,
    #[serde(default = "default_xmux_max_lifetime_min")]
    pub max_lifetime_secs_min: u64,
    #[serde(default = "default_xmux_max_lifetime_max")]
    pub max_lifetime_secs_max: u64,
    #[serde(default = "default_xmux_max_requests_min")]
    pub max_requests_min: u32,
    #[serde(default = "default_xmux_max_requests_max")]
    pub max_requests_max: u32,
}

impl Default for XmuxConfig {
    fn default() -> Self {
        Self {
            max_connections_min: default_xmux_max_connections_min(),
            max_connections_max: default_xmux_max_connections_max(),
            max_concurrency_min: default_xmux_max_concurrency_min(),
            max_concurrency_max: default_xmux_max_concurrency_max(),
            max_lifetime_secs_min: default_xmux_max_lifetime_min(),
            max_lifetime_secs_max: default_xmux_max_lifetime_max(),
            max_requests_min: default_xmux_max_requests_min(),
            max_requests_max: default_xmux_max_requests_max(),
        }
    }
}

fn default_xmux_max_connections_min() -> u16 {
    1
}
fn default_xmux_max_connections_max() -> u16 {
    4
}
fn default_xmux_max_concurrency_min() -> u16 {
    8
}
fn default_xmux_max_concurrency_max() -> u16 {
    16
}
fn default_xmux_max_lifetime_min() -> u64 {
    300
}
fn default_xmux_max_lifetime_max() -> u64 {
    600
}
fn default_xmux_max_requests_min() -> u32 {
    100
}
fn default_xmux_max_requests_max() -> u32 {
    200
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientIdentity {
    pub client_id: String,
    pub auth_secret: String, // hex-encoded
}

/// A port forwarding rule: expose a local service on the server's public port.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortForwardConfig {
    pub name: String,
    pub local_addr: String,
    pub remote_port: u16,
}

fn default_protocol_version() -> String {
    "v4".into()
}

fn default_fingerprint() -> String {
    "chrome".into()
}

fn default_quic_version() -> String {
    "auto".into()
}

fn default_transport_mode() -> String {
    "auto".into()
}

fn default_fallback_order() -> Vec<String> {
    vec![
        "quic-v2".into(),
        "prisma-tls".into(),
        "ws-cdn".into(),
        "xporta".into(),
    ]
}

fn default_cipher_suite() -> String {
    "chacha20-poly1305".into()
}

fn default_transport() -> String {
    "quic".into()
}

fn default_mux_max_streams() -> u32 {
    128
}

fn default_mux_max_connections() -> u16 {
    4
}

/// XPorta client configuration — next-generation CDN transport.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XPortaClientConfig {
    /// Base URL of the CDN endpoint (e.g., "https://your-domain.com").
    pub base_url: String,
    /// Session initialization path.
    #[serde(default = "default_xporta_session_path")]
    pub session_path: String,
    /// Upload data paths (randomly chosen per request).
    #[serde(default = "default_xporta_data_paths")]
    pub data_paths: Vec<String>,
    /// Long-poll download paths (randomly chosen per request).
    #[serde(default = "default_xporta_poll_paths")]
    pub poll_paths: Vec<String>,
    /// Payload encoding: "json" (default, max stealth), "binary" (max throughput), "auto".
    #[serde(default = "default_xporta_encoding")]
    pub encoding: String,
    /// Number of concurrent pending poll requests.
    #[serde(default = "default_xporta_poll_concurrency")]
    pub poll_concurrency: u8,
    /// Max concurrent upload requests.
    #[serde(default = "default_xporta_upload_concurrency")]
    pub upload_concurrency: u8,
    /// Maximum payload size per request in bytes.
    #[serde(default = "default_xporta_max_payload_size")]
    pub max_payload_size: u32,
    /// Poll timeout in seconds (must be < 100 for Cloudflare).
    #[serde(default = "default_xporta_poll_timeout")]
    pub poll_timeout_secs: u16,
    /// Extra HTTP headers for all XPorta requests.
    #[serde(default)]
    pub extra_headers: Vec<(String, String)>,
    /// Session cookie name (must match server config).
    #[serde(default = "default_xporta_cookie_name")]
    pub cookie_name: String,
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
fn default_xporta_encoding() -> String {
    "json".into()
}
fn default_xporta_poll_concurrency() -> u8 {
    3
}
fn default_xporta_upload_concurrency() -> u8 {
    4
}
fn default_xporta_max_payload_size() -> u32 {
    65536
}
fn default_xporta_poll_timeout() -> u16 {
    55
}
fn default_xporta_cookie_name() -> String {
    "_sess".into()
}
