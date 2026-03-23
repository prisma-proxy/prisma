use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::handlers::backup;
use crate::MgmtState;

// --- Sub-responses ---

#[derive(Serialize)]
pub struct CamouflageInfo {
    pub enabled: bool,
    pub tls_on_tcp: bool,
    pub fallback_addr: Option<String>,
    pub alpn_protocols: Vec<String>,
    pub salamander_password: Option<String>,
    pub h3_cover_site: Option<String>,
    pub h3_static_dir: Option<String>,
}

#[derive(Serialize)]
pub struct CdnInfo {
    pub enabled: bool,
    pub listen_addr: String,
    pub ws_tunnel_path: String,
    pub grpc_tunnel_path: String,
    pub xhttp_upload_path: String,
    pub xhttp_download_path: String,
    pub xhttp_stream_path: String,
    pub cover_upstream: Option<String>,
    pub xporta_enabled: bool,
    pub expose_management_api: bool,
    pub management_api_path: String,
    pub padding_header: bool,
    pub enable_sse_disguise: bool,
}

#[derive(Serialize)]
pub struct TrafficShapingInfo {
    pub padding_mode: String,
    pub bucket_sizes: Vec<u16>,
    pub timing_jitter_ms: u32,
    pub chaff_interval_ms: u32,
    pub coalesce_window_ms: u32,
}

#[derive(Serialize)]
pub struct CongestionInfo {
    pub mode: String,
    pub target_bandwidth: Option<String>,
}

#[derive(Serialize)]
pub struct AntiRttInfo {
    pub enabled: bool,
    pub normalization_ms: u32,
}

#[derive(Serialize)]
pub struct PrismaTlsInfo {
    pub enabled: bool,
    pub mask_server_count: usize,
    pub auth_rotation_hours: u64,
}

#[derive(Serialize)]
pub struct PaddingInfo {
    pub min: u16,
    pub max: u16,
}

#[derive(Serialize)]
pub struct PortHoppingInfo {
    pub enabled: bool,
    pub base_port: u16,
    pub range: u16,
    pub interval_secs: u64,
    pub grace_period_secs: u64,
}

#[derive(Serialize)]
pub struct ManagementApiInfo {
    pub enabled: bool,
    pub listen_addr: String,
    pub tls_enabled: bool,
    pub cors_origins: Vec<String>,
}

#[derive(Serialize)]
pub struct ConfigResponse {
    pub listen_addr: String,
    pub quic_listen_addr: String,
    pub tls_enabled: bool,
    pub authorized_clients_count: usize,
    pub logging_level: String,
    pub logging_format: String,
    pub dns_upstream: String,
    pub allow_transport_only_cipher: bool,
    // Nested sections
    pub performance: PerformanceInfo,
    pub port_forwarding: PortForwardingInfo,
    pub camouflage: CamouflageInfo,
    pub cdn: CdnInfo,
    pub traffic_shaping: TrafficShapingInfo,
    pub congestion: CongestionInfo,
    pub anti_rtt: AntiRttInfo,
    pub prisma_tls: PrismaTlsInfo,
    pub padding: PaddingInfo,
    pub port_hopping: PortHoppingInfo,
    pub management_api: ManagementApiInfo,
    pub routing_rules_count: usize,
}

#[derive(Serialize)]
pub struct PerformanceInfo {
    pub max_connections: u32,
    pub connection_timeout_secs: u64,
}

#[derive(Serialize)]
pub struct PortForwardingInfo {
    pub enabled: bool,
    pub port_range_start: u16,
    pub port_range_end: u16,
}

pub async fn get_config(State(state): State<MgmtState>) -> Json<ConfigResponse> {
    let cfg = state.config.read().await;

    let routing_count = state.routing_rules.read().await.len();

    Json(ConfigResponse {
        listen_addr: cfg.listen_addr.clone(),
        quic_listen_addr: cfg.quic_listen_addr.clone(),
        tls_enabled: cfg.tls.is_some(),
        authorized_clients_count: cfg.authorized_clients.len(),
        logging_level: cfg.logging.level.clone(),
        logging_format: cfg.logging.format.clone(),
        dns_upstream: cfg.dns_upstream.clone(),
        allow_transport_only_cipher: cfg.allow_transport_only_cipher,
        performance: PerformanceInfo {
            max_connections: cfg.performance.max_connections,
            connection_timeout_secs: cfg.performance.connection_timeout_secs,
        },
        port_forwarding: PortForwardingInfo {
            enabled: cfg.port_forwarding.enabled,
            port_range_start: cfg.port_forwarding.port_range_start,
            port_range_end: cfg.port_forwarding.port_range_end,
        },
        camouflage: CamouflageInfo {
            enabled: cfg.camouflage.enabled,
            tls_on_tcp: cfg.camouflage.tls_on_tcp,
            fallback_addr: cfg.camouflage.fallback_addr.clone(),
            alpn_protocols: cfg.camouflage.alpn_protocols.clone(),
            salamander_password: cfg.camouflage.salamander_password.clone(),
            h3_cover_site: cfg.camouflage.h3_cover_site.clone(),
            h3_static_dir: cfg.camouflage.h3_static_dir.clone(),
        },
        cdn: CdnInfo {
            enabled: cfg.cdn.enabled,
            listen_addr: cfg.cdn.listen_addr.clone(),
            ws_tunnel_path: cfg.cdn.ws_tunnel_path.clone(),
            grpc_tunnel_path: cfg.cdn.grpc_tunnel_path.clone(),
            xhttp_upload_path: cfg.cdn.xhttp_upload_path.clone(),
            xhttp_download_path: cfg.cdn.xhttp_download_path.clone(),
            xhttp_stream_path: cfg.cdn.xhttp_stream_path.clone(),
            cover_upstream: cfg.cdn.cover_upstream.clone(),
            xporta_enabled: cfg.cdn.xporta.as_ref().is_some_and(|x| x.enabled),
            expose_management_api: cfg.cdn.expose_management_api,
            management_api_path: cfg.cdn.management_api_path.clone(),
            padding_header: cfg.cdn.padding_header,
            enable_sse_disguise: cfg.cdn.enable_sse_disguise,
        },
        traffic_shaping: TrafficShapingInfo {
            padding_mode: cfg.traffic_shaping.padding_mode.clone(),
            bucket_sizes: cfg.traffic_shaping.bucket_sizes.clone(),
            timing_jitter_ms: cfg.traffic_shaping.timing_jitter_ms,
            chaff_interval_ms: cfg.traffic_shaping.chaff_interval_ms,
            coalesce_window_ms: cfg.traffic_shaping.coalesce_window_ms,
        },
        congestion: CongestionInfo {
            mode: cfg.congestion.mode.clone(),
            target_bandwidth: cfg.congestion.target_bandwidth.clone(),
        },
        anti_rtt: AntiRttInfo {
            enabled: cfg.anti_rtt.enabled,
            normalization_ms: cfg.anti_rtt.normalization_ms,
        },
        prisma_tls: PrismaTlsInfo {
            enabled: cfg.prisma_tls.enabled,
            mask_server_count: cfg.prisma_tls.mask_servers.len(),
            auth_rotation_hours: cfg.prisma_tls.auth_rotation_hours,
        },
        padding: PaddingInfo {
            min: cfg.padding.min,
            max: cfg.padding.max,
        },
        port_hopping: PortHoppingInfo {
            enabled: cfg.port_hopping.enabled,
            base_port: cfg.port_hopping.base_port,
            range: cfg.port_hopping.port_range,
            interval_secs: cfg.port_hopping.interval_secs,
            grace_period_secs: cfg.port_hopping.grace_period_secs,
        },
        management_api: ManagementApiInfo {
            enabled: cfg.management_api.enabled,
            listen_addr: cfg.management_api.listen_addr.clone(),
            tls_enabled: cfg.management_api.tls_enabled,
            cors_origins: cfg.management_api.cors_origins.clone(),
        },
        routing_rules_count: routing_count,
    })
}

#[derive(Deserialize)]
pub struct PatchConfigRequest {
    // Top-level
    pub listen_addr: Option<String>,
    pub quic_listen_addr: Option<String>,
    pub dns_upstream: Option<String>,
    pub allow_transport_only_cipher: Option<bool>,
    // Logging
    pub logging_level: Option<String>,
    pub logging_format: Option<String>,
    // Performance
    pub max_connections: Option<u32>,
    pub connection_timeout_secs: Option<u64>,
    // Port forwarding
    pub port_forwarding_enabled: Option<bool>,
    pub port_forwarding_port_range_start: Option<u16>,
    pub port_forwarding_port_range_end: Option<u16>,
    // Camouflage
    pub camouflage_enabled: Option<bool>,
    pub camouflage_tls_on_tcp: Option<bool>,
    pub camouflage_fallback_addr: Option<String>,
    // Traffic shaping
    pub traffic_shaping_padding_mode: Option<String>,
    pub traffic_shaping_timing_jitter_ms: Option<u32>,
    pub traffic_shaping_chaff_interval_ms: Option<u32>,
    pub traffic_shaping_coalesce_window_ms: Option<u32>,
    // Congestion
    pub congestion_mode: Option<String>,
    pub congestion_target_bandwidth: Option<String>,
    // Anti-RTT
    pub anti_rtt_enabled: Option<bool>,
    pub anti_rtt_normalization_ms: Option<u32>,
    // Padding
    pub padding_min: Option<u16>,
    pub padding_max: Option<u16>,
    // Port hopping
    pub port_hopping_enabled: Option<bool>,
    pub port_hopping_base_port: Option<u16>,
    pub port_hopping_range: Option<u16>,
    pub port_hopping_interval_secs: Option<u64>,
    pub port_hopping_grace_period_secs: Option<u64>,
    // CDN
    pub cdn_enabled: Option<bool>,
    pub cdn_listen_addr: Option<String>,
    pub cdn_expose_management_api: Option<bool>,
    pub cdn_padding_header: Option<bool>,
    pub cdn_enable_sse_disguise: Option<bool>,
    // PrismaTLS
    pub prisma_tls_enabled: Option<bool>,
    pub prisma_tls_auth_rotation_hours: Option<u64>,
    // Management API
    pub management_api_enabled: Option<bool>,
}

pub async fn patch_config(
    State(state): State<MgmtState>,
    Json(req): Json<PatchConfigRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    if let Some(ref level) = req.logging_level {
        prisma_core::config::validation::validate_logging_level(level)
            .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    }
    if let Some(ref format) = req.logging_format {
        prisma_core::config::validation::validate_logging_format(format)
            .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    }

    // Auto-backup before applying changes
    let _ = backup::auto_backup(&state).await;

    let mut cfg = state.config.write().await;

    // Top-level
    if let Some(addr) = req.listen_addr {
        cfg.listen_addr = addr;
    }
    if let Some(addr) = req.quic_listen_addr {
        cfg.quic_listen_addr = addr;
    }
    if let Some(upstream) = req.dns_upstream {
        cfg.dns_upstream = upstream;
    }
    if let Some(allow) = req.allow_transport_only_cipher {
        cfg.allow_transport_only_cipher = allow;
    }

    // Logging
    if let Some(level) = req.logging_level {
        cfg.logging.level = level;
    }
    if let Some(format) = req.logging_format {
        cfg.logging.format = format;
    }

    // Performance
    if let Some(max) = req.max_connections {
        cfg.performance.max_connections = max;
    }
    if let Some(timeout) = req.connection_timeout_secs {
        cfg.performance.connection_timeout_secs = timeout;
    }

    // Port forwarding
    if let Some(enabled) = req.port_forwarding_enabled {
        cfg.port_forwarding.enabled = enabled;
    }
    if let Some(start) = req.port_forwarding_port_range_start {
        cfg.port_forwarding.port_range_start = start;
    }
    if let Some(end) = req.port_forwarding_port_range_end {
        cfg.port_forwarding.port_range_end = end;
    }

    // Camouflage
    if let Some(enabled) = req.camouflage_enabled {
        cfg.camouflage.enabled = enabled;
    }
    if let Some(tls_on_tcp) = req.camouflage_tls_on_tcp {
        cfg.camouflage.tls_on_tcp = tls_on_tcp;
    }
    if let Some(fallback) = req.camouflage_fallback_addr {
        cfg.camouflage.fallback_addr = Some(fallback);
    }

    // Traffic shaping
    if let Some(mode) = req.traffic_shaping_padding_mode {
        cfg.traffic_shaping.padding_mode = mode;
    }
    if let Some(jitter) = req.traffic_shaping_timing_jitter_ms {
        cfg.traffic_shaping.timing_jitter_ms = jitter;
    }
    if let Some(chaff) = req.traffic_shaping_chaff_interval_ms {
        cfg.traffic_shaping.chaff_interval_ms = chaff;
    }
    if let Some(coalesce) = req.traffic_shaping_coalesce_window_ms {
        cfg.traffic_shaping.coalesce_window_ms = coalesce;
    }

    // Congestion
    if let Some(mode) = req.congestion_mode {
        cfg.congestion.mode = mode;
    }
    if let Some(target) = req.congestion_target_bandwidth {
        cfg.congestion.target_bandwidth = Some(target);
    }

    // Anti-RTT
    if let Some(enabled) = req.anti_rtt_enabled {
        cfg.anti_rtt.enabled = enabled;
    }
    if let Some(ms) = req.anti_rtt_normalization_ms {
        cfg.anti_rtt.normalization_ms = ms;
    }

    // Padding
    if let Some(min) = req.padding_min {
        cfg.padding.min = min;
    }
    if let Some(max) = req.padding_max {
        cfg.padding.max = max;
    }

    // Port hopping
    if let Some(enabled) = req.port_hopping_enabled {
        cfg.port_hopping.enabled = enabled;
    }
    if let Some(port) = req.port_hopping_base_port {
        cfg.port_hopping.base_port = port;
    }
    if let Some(range) = req.port_hopping_range {
        cfg.port_hopping.port_range = range;
    }
    if let Some(interval) = req.port_hopping_interval_secs {
        cfg.port_hopping.interval_secs = interval;
    }
    if let Some(grace) = req.port_hopping_grace_period_secs {
        cfg.port_hopping.grace_period_secs = grace;
    }

    // CDN
    if let Some(enabled) = req.cdn_enabled {
        cfg.cdn.enabled = enabled;
    }
    if let Some(addr) = req.cdn_listen_addr {
        cfg.cdn.listen_addr = addr;
    }
    if let Some(expose) = req.cdn_expose_management_api {
        cfg.cdn.expose_management_api = expose;
    }
    if let Some(padding) = req.cdn_padding_header {
        cfg.cdn.padding_header = padding;
    }
    if let Some(sse) = req.cdn_enable_sse_disguise {
        cfg.cdn.enable_sse_disguise = sse;
    }

    // PrismaTLS
    if let Some(enabled) = req.prisma_tls_enabled {
        cfg.prisma_tls.enabled = enabled;
    }
    if let Some(hours) = req.prisma_tls_auth_rotation_hours {
        cfg.prisma_tls.auth_rotation_hours = hours;
    }

    // Management API
    if let Some(enabled) = req.management_api_enabled {
        cfg.management_api.enabled = enabled;
    }

    Ok(StatusCode::OK)
}

#[derive(Serialize)]
pub struct TlsInfoResponse {
    pub enabled: bool,
    pub cert_path: Option<String>,
    pub key_path: Option<String>,
}

pub async fn get_tls_info(State(state): State<MgmtState>) -> Json<TlsInfoResponse> {
    let cfg = state.config.read().await;
    match &cfg.tls {
        Some(tls) => Json(TlsInfoResponse {
            enabled: true,
            cert_path: Some(tls.cert_path.clone()),
            key_path: Some(tls.key_path.clone()),
        }),
        None => Json(TlsInfoResponse {
            enabled: false,
            cert_path: None,
            key_path: None,
        }),
    }
}
