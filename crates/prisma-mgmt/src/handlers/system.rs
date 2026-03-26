use std::net::IpAddr;

use axum::extract::State;
use axum::Json;
use serde::Serialize;

use crate::MgmtState;

const SECS_PER_DAY: i64 = 86_400;

#[derive(Serialize)]
pub struct SystemInfoResponse {
    pub version: &'static str,
    pub platform: &'static str,
    pub pid: u32,
    pub cpu_usage: f32,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub listeners: Vec<ListenerInfo>,
    pub cert_expiry_days: Option<i64>,
}

#[derive(Serialize)]
pub struct ListenerInfo {
    pub addr: String,
    pub protocol: String,
}

struct SystemMetrics {
    cpu_usage: f32,
    memory_used_mb: u64,
    memory_total_mb: u64,
}

pub async fn get_system_info(State(state): State<MgmtState>) -> Json<SystemInfoResponse> {
    let metrics = get_system_metrics();

    let config = state.config.read().await;
    let mut listeners = vec![
        ListenerInfo {
            addr: config.listen_addr.clone(),
            protocol: "TCP".into(),
        },
        ListenerInfo {
            addr: config.quic_listen_addr.clone(),
            protocol: "QUIC".into(),
        },
    ];
    if config.management_api.enabled {
        listeners.push(ListenerInfo {
            addr: config.management_api.listen_addr.clone(),
            protocol: "Management API".into(),
        });
    }

    let cert_expiry_days = config
        .tls
        .as_ref()
        .and_then(|tls| get_cert_expiry_days(&tls.cert_path));

    Json(SystemInfoResponse {
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        pid: std::process::id(),
        cpu_usage: metrics.cpu_usage,
        memory_used_mb: metrics.memory_used_mb,
        memory_total_mb: metrics.memory_total_mb,
        listeners,
        cert_expiry_days,
    })
}

#[cfg(feature = "sysinfo")]
fn get_system_metrics() -> SystemMetrics {
    use sysinfo::System;

    const BYTES_PER_MB: u64 = 1024 * 1024;

    let mut sys = System::new();
    sys.refresh_cpu_all();
    sys.refresh_memory();
    SystemMetrics {
        cpu_usage: sys.global_cpu_usage(),
        memory_used_mb: sys.used_memory() / BYTES_PER_MB,
        memory_total_mb: sys.total_memory() / BYTES_PER_MB,
    }
}

#[cfg(not(feature = "sysinfo"))]
fn get_system_metrics() -> SystemMetrics {
    SystemMetrics {
        cpu_usage: 0.0,
        memory_used_mb: 0,
        memory_total_mb: 0,
    }
}

#[derive(Serialize)]
pub struct ServerGeoResponse {
    pub country: String,
}

/// GET /api/server/geo — return the server's own country code by looking up
/// its `public_address` in the GeoIP MMDB database.
pub async fn server_geo(State(state): State<MgmtState>) -> Json<Option<ServerGeoResponse>> {
    let cfg = state.config.read().await;

    let Some(ref addr) = cfg.public_address else {
        return Json(None);
    };

    // Extract host part (handle IPv6 brackets and port)
    let host: String = if addr.starts_with('[') {
        addr.split(']')
            .next()
            .unwrap_or(addr)
            .trim_start_matches('[')
            .to_string()
    } else if addr.matches(':').count() > 1 {
        addr.clone()
    } else {
        addr.rsplit_once(':')
            .map(|(h, _)| h)
            .unwrap_or(addr)
            .to_string()
    };

    let geoip_path = cfg.routing.geoip_path.clone();
    drop(cfg);

    // Try parsing directly as IP, otherwise resolve the hostname asynchronously
    let ip: Option<IpAddr> = if let Ok(ip) = host.parse::<IpAddr>() {
        Some(ip)
    } else {
        tokio::net::lookup_host(format!("{host}:0"))
            .await
            .ok()
            .and_then(|mut addrs| addrs.next())
            .map(|sa| sa.ip())
    };

    let Some(ip) = ip else {
        return Json(None);
    };

    let reader = geoip_path
        .as_deref()
        .and_then(|p| maxminddb::Reader::open_readfile(p).ok());

    let Some(reader) = reader else {
        return Json(None);
    };

    let Ok(city): Result<maxminddb::geoip2::City, _> = reader.lookup(ip) else {
        return Json(None);
    };

    let country = city.country.and_then(|c| c.iso_code).map(|s| s.to_string());

    Json(country.map(|c| ServerGeoResponse { country: c }))
}

fn get_cert_expiry_days(cert_path: &str) -> Option<i64> {
    let pem = std::fs::read(cert_path).ok()?;
    let (_, pem_parsed) = x509_parser::pem::parse_x509_pem(&pem).ok()?;
    let (_, cert) = x509_parser::parse_x509_certificate(pem_parsed.contents.as_ref()).ok()?;
    let expiry_epoch = cert.validity().not_after.timestamp();
    let now_epoch = chrono::Utc::now().timestamp();
    Some((expiry_epoch - now_epoch) / SECS_PER_DAY)
}
