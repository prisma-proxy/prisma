use std::str::FromStr;
use std::sync::Arc;

use anyhow::Result;
use prisma_core::congestion::CongestionMode;
use prisma_core::dns::DnsConfig;
use prisma_core::fec::FecConfig;
use prisma_core::router::Router;
use prisma_core::traffic_shaping::TrafficShapingConfig;
use prisma_core::types::{CipherSuite, ClientId, PRISMA_QUIC_ALPN};
use tracing::{info, warn};

use crate::connector::{self, TransportStream};
use crate::dns_resolver::DnsResolver;
use crate::metrics::ClientMetrics;
use crate::xporta_stream;
use prisma_core::config::client::{
    GrpcTransportConfig, WsTransportConfig, XPortaClientConfig, XhttpTransportConfig,
};
use prisma_core::xporta::types::XPortaEncoding;

/// Shared configuration for all proxy sessions (SOCKS5 and HTTP).
#[derive(Clone)]
pub struct ProxyContext {
    pub server_addr: String,
    pub client_id: ClientId,
    pub auth_secret: [u8; 32],
    pub cipher_suite: CipherSuite,
    pub use_quic: bool,
    pub skip_cert_verify: bool,
    pub tls_on_tcp: bool,
    pub alpn_protocols: Vec<String>,
    pub tls_server_name: Option<String>,
    pub use_ws: bool,
    pub ws: WsTransportConfig,
    pub use_grpc: bool,
    pub grpc: GrpcTransportConfig,
    pub use_xhttp: bool,
    pub xhttp: XhttpTransportConfig,
    pub use_xporta: bool,
    pub xporta_config: Option<XPortaClientConfig>,
    pub user_agent: Option<String>,
    pub referer: Option<String>,
    pub congestion_mode: CongestionMode,
    pub port_hopping: prisma_core::port_hop::PortHoppingConfig,
    pub salamander_password: Option<String>,
    pub udp_fec: Option<FecConfig>,
    pub dns_config: DnsConfig,
    pub dns_resolver: DnsResolver,
    pub router: Arc<Router>,
    /// uTLS fingerprint profile for TLS ClientHello mimicry.
    pub fingerprint: String,
    /// QUIC version preference: "v2", "v1", or "auto".
    pub quic_version: String,
    /// Traffic shaping configuration.
    pub traffic_shaping: TrafficShapingConfig,
    /// Whether to use PrismaTLS transport mode.
    pub use_prisma_tls: bool,
    /// Shared traffic counters for GUI/FFI stats.
    pub metrics: ClientMetrics,
    /// Server public key pin (hex-encoded SHA-256) for server authentication
    /// independent of TLS. See `prisma_core::util::compute_server_key_pin`.
    pub server_key_pin: Option<String>,
    /// Whether to use WireGuard-compatible UDP transport.
    pub use_wireguard: bool,
    /// WireGuard client configuration.
    pub wireguard_config: Option<prisma_core::wireguard::WireGuardClientConfig>,
}

impl ProxyContext {
    /// Connect to the remote Prisma server with retry and exponential backoff.
    ///
    /// Retries up to 3 times (1s, 2s, 4s backoff) to handle transient failures
    /// such as TLS handshake EOF or connection resets.
    pub async fn connect(&self) -> Result<TransportStream> {
        const MAX_RETRIES: u32 = 2;
        let mut last_err = None;

        for attempt in 0..=MAX_RETRIES {
            match self.connect_once().await {
                Ok(stream) => return Ok(stream),
                Err(e) => {
                    if attempt < MAX_RETRIES {
                        let backoff = std::time::Duration::from_millis(1000 * 2u64.pow(attempt));
                        warn!(
                            attempt = attempt + 1,
                            max = MAX_RETRIES + 1,
                            backoff_ms = backoff.as_millis() as u64,
                            error = %e,
                            "Server connection failed, retrying"
                        );
                        tokio::time::sleep(backoff).await;
                    }
                    last_err = Some(e);
                }
            }
        }

        Err(last_err.unwrap())
    }

    /// Single connection attempt using the configured transport.
    async fn connect_once(&self) -> Result<TransportStream> {
        let prefer_quic_v2 = self.quic_version == "v2" || self.quic_version == "auto";

        let transport = if self.use_wireguard {
            "WireGuard"
        } else if self.use_xporta {
            "XPorta"
        } else if self.use_xhttp {
            "XHTTP"
        } else if self.use_ws {
            "WebSocket"
        } else if self.use_grpc {
            "gRPC"
        } else if self.use_prisma_tls {
            "PrismaTLS"
        } else if self.use_quic {
            if prefer_quic_v2 {
                "QUIC-v2"
            } else {
                "QUIC"
            }
        } else if self.tls_on_tcp {
            "TLS-on-TCP"
        } else {
            "TCP"
        };

        // Use standard ALPN ("h3") to avoid protocol identification by DPI.
        let default_quic_alpn = vec![PRISMA_QUIC_ALPN.to_string()];
        let alpn = if self.use_quic && !self.tls_on_tcp {
            &default_quic_alpn
        } else {
            &self.alpn_protocols
        };

        let result = if self.use_wireguard {
            let wg_cfg = self
                .wireguard_config
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("WireGuard transport requires wireguard config"))?;
            let stream =
                crate::wg_stream::WgStream::connect(&wg_cfg.endpoint, wg_cfg.keepalive_secs)
                    .await?;
            Ok(TransportStream::WireGuard(stream))
        } else if self.use_xporta {
            let xporta_cfg = self
                .xporta_config
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("XPorta transport requires xporta config"))?;

            let encoding =
                XPortaEncoding::from_str(&xporta_cfg.encoding).unwrap_or(XPortaEncoding::Json);

            let config = xporta_stream::XPortaConfig {
                base_url: xporta_cfg.base_url.clone(),
                session_path: xporta_cfg.session_path.clone(),
                data_paths: xporta_cfg.data_paths.clone(),
                poll_paths: xporta_cfg.poll_paths.clone(),
                encoding,
                poll_concurrency: xporta_cfg.poll_concurrency,
                upload_concurrency: xporta_cfg.upload_concurrency,
                max_payload_size: xporta_cfg.max_payload_size,
                poll_timeout_secs: xporta_cfg.poll_timeout_secs,
                extra_headers: xporta_cfg.extra_headers.clone(),
                user_agent: self.user_agent.clone(),
                referer: self.referer.clone(),
                cookie_name: xporta_cfg.cookie_name.clone(),
            };

            let client_id_hex = self.client_id.0.to_string();
            let stream =
                xporta_stream::connect_xporta(&config, &client_id_hex, &self.auth_secret).await?;
            Ok(TransportStream::XPorta(stream))
        } else if self.use_xhttp {
            let stream_url = self
                .xhttp
                .stream_url
                .as_deref()
                .unwrap_or("https://localhost/api/v1/stream");
            connector::connect_xhttp(
                stream_url,
                &self.xhttp.extra_headers,
                self.user_agent.as_deref(),
                self.referer.as_deref(),
                self.skip_cert_verify,
            )
            .await
        } else if self.use_ws {
            let ws_url = self.ws.url.as_deref().unwrap_or("ws://localhost");
            connector::connect_ws(ws_url, self.skip_cert_verify, &self.ws.extra_headers).await
        } else if self.use_grpc {
            let grpc_url = self.grpc.url.as_deref().unwrap_or("http://localhost");
            connector::connect_grpc(grpc_url).await
        } else if self.use_prisma_tls {
            // PrismaTLS: TCP+TLS with fingerprint-aware ClientHello
            connector::connect_prisma_tls(
                &self.server_addr,
                self.server_name(),
                &self.fingerprint,
                self.skip_cert_verify,
            )
            .await
        } else if self.use_quic {
            // Apply port hopping if enabled
            let server_addr = if self.port_hopping.enabled {
                let port = prisma_core::port_hop::current_port(
                    &self.port_hopping,
                    &self.auth_secret,
                    std::time::SystemTime::now(),
                );
                // Replace port in server address
                let host = self
                    .server_addr
                    .split(':')
                    .next()
                    .unwrap_or(&self.server_addr);
                format!("{}:{}", host, port)
            } else {
                self.server_addr.clone()
            };
            connector::connect_quic_versioned(
                &server_addr,
                self.skip_cert_verify,
                alpn,
                self.server_name(),
                &self.congestion_mode,
                self.salamander_password.as_deref(),
                prefer_quic_v2,
            )
            .await
        } else if self.tls_on_tcp {
            connector::connect_tcp_tls(
                &self.server_addr,
                self.server_name(),
                self.skip_cert_verify,
                &self.alpn_protocols,
            )
            .await
        } else {
            connector::connect_tcp(&self.server_addr).await
        };

        match &result {
            Ok(_) => info!(
                server = %self.server_addr,
                transport = %transport,
                "Connected to server"
            ),
            Err(e) => warn!(
                server = %self.server_addr,
                transport = %transport,
                error = %e,
                "Failed to connect to server"
            ),
        }
        result
    }

    /// Resolve the server name for TLS SNI.
    /// Uses `tls_server_name` if set, otherwise extracts hostname from `server_addr`.
    pub fn server_name(&self) -> &str {
        if let Some(ref name) = self.tls_server_name {
            return name;
        }
        // Extract hostname from "host:port"
        self.server_addr
            .split(':')
            .next()
            .unwrap_or("prisma-server")
    }
}
