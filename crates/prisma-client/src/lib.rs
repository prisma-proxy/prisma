pub mod connection_pool;
pub mod connector;
pub mod dns_resolver;
pub mod dns_server;
pub mod forward;
pub mod grpc_stream;
pub mod http;
pub mod latency;
pub mod metrics;
pub mod pac;
pub mod proxy;
pub mod relay;
pub mod socks5;
pub mod ssh_stream;
pub mod transport_selector;
pub mod tun;
pub mod tunnel;
pub mod udp_relay;
pub mod wg_stream;
pub mod ws_stream;
pub mod xhttp_stream;
pub mod xporta_stream;

use std::sync::Arc;

use anyhow::Result;
use prisma_core::config::load_client_config;
use prisma_core::congestion::CongestionMode;
use prisma_core::geodata::GeoIPMatcher;
use prisma_core::logging::{init_logging, init_logging_with_broadcast};
use prisma_core::router::Router;
use prisma_core::state::LogEntry;
use prisma_core::types::{CipherSuite, ClientId};
use prisma_core::util;
use tokio::sync::broadcast;
use tracing::{info, warn};

use dns_resolver::DnsResolver;
use metrics::ClientMetrics;
use proxy::ProxyContext;

/// Guard that aborts all held task handles when dropped, ensuring spawned
/// services are cleaned up when the owning future is cancelled.
struct TaskGuard(Vec<tokio::task::JoinHandle<()>>);

impl Drop for TaskGuard {
    fn drop(&mut self) {
        for h in &self.0 {
            h.abort();
        }
    }
}

/// Auto-select the best cipher suite based on hardware capabilities.
///
/// - On x86_64 with AES-NI: selects AES-256-GCM (hardware-accelerated)
/// - On aarch64 with NEON (always available): selects AES-256-GCM
/// - Otherwise: selects ChaCha20-Poly1305 (fast in software)
///
/// This is only used when `cipher_suite = "auto"` is set in config.
fn auto_select_cipher() -> CipherSuite {
    #[cfg(target_arch = "x86_64")]
    {
        if std::arch::is_x86_feature_detected!("aes") {
            info!("Auto-selected AES-256-GCM (AES-NI detected)");
            return CipherSuite::Aes256Gcm;
        }
    }

    #[cfg(target_arch = "x86")]
    {
        if std::arch::is_x86_feature_detected!("aes") {
            info!("Auto-selected AES-256-GCM (AES-NI detected)");
            return CipherSuite::Aes256Gcm;
        }
    }

    // On aarch64, NEON is always available and aes-gcm uses hardware AES
    #[cfg(target_arch = "aarch64")]
    {
        info!("Auto-selected AES-256-GCM (AArch64 hardware AES)");
        return CipherSuite::Aes256Gcm;
    }

    #[allow(unreachable_code)]
    {
        info!("Auto-selected ChaCha20-Poly1305 (no hardware AES)");
        CipherSuite::ChaCha20Poly1305
    }
}

/// Run client in standalone mode (CLI). Sets up its own logging.
pub async fn run(config_path: &str) -> Result<()> {
    let config = load_client_config(config_path)
        .map_err(|e| anyhow::anyhow!("Failed to load config: {}", e))?;

    init_logging(&config.logging.level, &config.logging.format);

    run_inner(config, ClientMetrics::new(), None, None).await
}

/// Run client in embedded mode (GUI/FFI). Uses broadcast logging and shared metrics.
pub async fn run_embedded(
    config_path: &str,
    log_tx: broadcast::Sender<LogEntry>,
    metrics: ClientMetrics,
) -> Result<()> {
    let config = load_client_config(config_path)
        .map_err(|e| anyhow::anyhow!("Failed to load config: {}", e))?;

    init_logging_with_broadcast(&config.logging.level, &config.logging.format, log_tx);

    run_inner(config, metrics, None, None).await
}

/// Run client in embedded mode with an optional per-app filter.
///
/// When `shutdown` is provided, the client will cleanly abort all spawned
/// service tasks when the signal fires. This ensures that SOCKS5, HTTP, TUN,
/// DNS, PAC, and port-forward servers are all stopped on disconnect.
pub async fn run_embedded_with_filter(
    config_path: &str,
    log_tx: broadcast::Sender<LogEntry>,
    metrics: ClientMetrics,
    app_filter: Option<Arc<tun::process::AppFilter>>,
    shutdown: Option<tokio::sync::oneshot::Receiver<()>>,
) -> Result<()> {
    let config = load_client_config(config_path)
        .map_err(|e| anyhow::anyhow!("Failed to load config: {}", e))?;

    init_logging_with_broadcast(&config.logging.level, &config.logging.format, log_tx);

    run_inner(config, metrics, app_filter, shutdown).await
}

async fn run_inner(
    config: prisma_core::config::client::ClientConfig,
    metrics: ClientMetrics,
    app_filter: Option<Arc<tun::process::AppFilter>>,
    shutdown: Option<tokio::sync::oneshot::Receiver<()>>,
) -> Result<()> {
    info!("Prisma client starting");
    if let Some(ref socks5_addr) = config.socks5_listen_addr {
        info!(socks5 = %socks5_addr, server = %config.server_addr);
    } else {
        info!(server = %config.server_addr, "SOCKS5 disabled");
    }
    if let Some(ref http_addr) = config.http_listen_addr {
        info!(http = %http_addr, "HTTP proxy enabled");
    }
    if !config.port_forwards.is_empty() {
        info!(
            count = config.port_forwards.len(),
            "Port forwards configured"
        );
    }

    let client_id = ClientId::from_uuid(
        uuid::Uuid::parse_str(&config.identity.client_id)
            .map_err(|e| anyhow::anyhow!("Invalid client_id: {}", e))?,
    );

    let auth_secret = util::hex_decode_32(&config.identity.auth_secret)
        .map_err(|e| anyhow::anyhow!("Invalid auth_secret: {}", e))?;

    let cipher_suite = match config.cipher_suite.as_str() {
        "aes-256-gcm" => CipherSuite::Aes256Gcm,
        "auto" => auto_select_cipher(),
        _ => CipherSuite::ChaCha20Poly1305,
    };

    let use_quic = config.transport == "quic";
    let use_ws = config.transport == "ws";
    let use_grpc = config.transport == "grpc";
    let use_xhttp = config.transport == "xhttp";
    let use_xporta = config.transport == "xporta";
    let use_prisma_tls = config.transport == "prisma-tls";
    let use_wireguard = config.transport == "wireguard";

    if use_wireguard {
        info!(endpoint = ?config.wireguard.as_ref().map(|w| &w.endpoint), "WireGuard transport enabled");
    }

    info!(
        fingerprint = %config.fingerprint,
        quic_version = %config.quic_version,
        "PrismaVeil v5 protocol"
    );

    if use_ws {
        info!(ws_url = ?config.ws.url, "WebSocket transport enabled");
    }
    if use_grpc {
        info!(grpc_url = ?config.grpc.url, "gRPC transport enabled");
    }
    if use_xhttp {
        info!(xhttp_mode = ?config.xhttp.mode, "XHTTP transport enabled");
    }
    if use_xporta {
        info!("XPorta transport enabled");
    }

    let congestion_mode = CongestionMode::from_config(
        &config.congestion.mode,
        config.congestion.target_bandwidth.as_deref(),
    );

    if use_quic {
        info!(mode = ?congestion_mode, "Congestion control configured");
    }

    let ctx = ProxyContext {
        server_addr: config.server_addr.clone(),
        client_id,
        auth_secret,
        cipher_suite,
        use_quic,
        skip_cert_verify: config.skip_cert_verify,
        tls_on_tcp: config.tls_on_tcp,
        alpn_protocols: config.alpn_protocols.clone(),
        tls_server_name: config.tls_server_name.clone(),
        use_ws,
        ws: config.ws.clone(),
        use_grpc,
        grpc: config.grpc.clone(),
        use_xhttp,
        xhttp: config.xhttp.clone(),
        use_xporta,
        xporta_config: config.xporta.clone(),
        user_agent: config.user_agent.clone(),
        referer: config.referer.clone(),
        congestion_mode,
        port_hopping: config.port_hopping.clone(),
        salamander_password: config.salamander_password.clone(),
        udp_fec: if config.udp_fec.enabled {
            Some(config.udp_fec.clone())
        } else {
            None
        },
        dns_config: config.dns.clone(),
        dns_resolver: DnsResolver::new(&config.dns),
        router: Arc::new({
            let mut all_rules = config.routing.rules.clone();

            // Load rules from rule providers (remote rule lists)
            if !config.routing.rule_providers.is_empty() {
                let cache_dir = std::path::PathBuf::from("./data/rule-providers");
                let mgr = prisma_core::rule_provider::RuleProviderManager::new(
                    config.routing.rule_providers.clone(),
                    cache_dir,
                );
                // Load from cache only (fast, non-blocking). The GUI pre-populates
                // the cache when the user clicks "Update" on a provider. Network
                // fetch is skipped here because the proxy is not running yet and
                // each provider has a 30s timeout that would block connect.
                mgr.load_cached_only().await;
                let provider_rules = mgr.all_rules().await;
                if !provider_rules.is_empty() {
                    info!(
                        count = provider_rules.len(),
                        "Loaded rules from provider cache"
                    );
                    all_rules.extend(provider_rules);
                } else {
                    warn!(
                        providers = config.routing.rule_providers.len(),
                        "Rule providers configured but no cached rules found — update providers first"
                    );
                }
            }

            info!(
                total = all_rules.len(),
                domain = all_rules
                    .iter()
                    .filter(|r| matches!(
                        r.condition,
                        prisma_core::router::RuleCondition::Domain(_)
                    ))
                    .count(),
                suffix = all_rules
                    .iter()
                    .filter(|r| matches!(
                        r.condition,
                        prisma_core::router::RuleCondition::DomainSuffix(_)
                    ))
                    .count(),
                keyword = all_rules
                    .iter()
                    .filter(|r| matches!(
                        r.condition,
                        prisma_core::router::RuleCondition::DomainKeyword(_)
                    ))
                    .count(),
                ip_cidr = all_rules
                    .iter()
                    .filter(|r| matches!(
                        r.condition,
                        prisma_core::router::RuleCondition::IpCidr(_)
                    ))
                    .count(),
                geoip = all_rules
                    .iter()
                    .filter(|r| matches!(r.condition, prisma_core::router::RuleCondition::GeoIp(_)))
                    .count(),
                "Routing rules loaded"
            );

            let has_geoip_rules = all_rules
                .iter()
                .any(|r| matches!(r.condition, prisma_core::router::RuleCondition::GeoIp(_)));
            let geoip = load_geoip_matcher(config.routing.geoip_path.as_deref(), has_geoip_rules);
            Router::with_geoip(all_rules, geoip)
        }),
        fingerprint: config.fingerprint.clone(),
        quic_version: config.quic_version.clone(),
        traffic_shaping: config.traffic_shaping.clone(),
        use_prisma_tls,
        metrics,
        server_key_pin: config.server_key_pin.clone(),
        use_wireguard,
        wireguard_config: config.wireguard.clone(),
    };

    // Log DNS mode
    if config.dns.mode != prisma_core::dns::DnsMode::Direct {
        info!(mode = ?config.dns.mode, "DNS mode configured");
    }

    // Optionally start SOCKS5 server
    let socks5_handle = if let Some(ref socks5_addr) = config.socks5_listen_addr {
        let socks5_addr = socks5_addr.clone();
        let socks5_ctx = ctx.clone();
        Some(tokio::spawn(async move {
            if let Err(e) = socks5::server::run_socks5_server(&socks5_addr, socks5_ctx).await {
                tracing::error!("SOCKS5 server error: {}", e);
            }
        }))
    } else {
        None
    };

    // Optionally start HTTP proxy server
    let http_handle = if let Some(ref http_addr) = config.http_listen_addr {
        let http_addr = http_addr.clone();
        let http_ctx = ctx.clone();
        Some(tokio::spawn(async move {
            if let Err(e) = http::server::run_http_proxy(&http_addr, http_ctx).await {
                tracing::error!("HTTP proxy server error: {}", e);
            }
        }))
    } else {
        None
    };

    // Optionally start port forwarding
    let forward_handle = if !config.port_forwards.is_empty() {
        let fwd_ctx = ctx.clone();
        let forwards = config.port_forwards.clone();
        Some(tokio::spawn(async move {
            if let Err(e) = forward::run_port_forwards(fwd_ctx, forwards).await {
                tracing::error!("Port forwarding error: {}", e);
            }
        }))
    } else {
        None
    };

    // Optionally start local DNS server (for Fake, Tunnel, or Smart modes)
    let dns_handle = if config.dns.mode != prisma_core::dns::DnsMode::Direct {
        let dns_ctx = ctx.clone();
        Some(tokio::spawn(async move {
            if let Err(e) = dns_server::run_dns_server(dns_ctx).await {
                tracing::error!("DNS server error: {}", e);
            }
        }))
    } else {
        None
    };

    // Optionally start PAC server (only when pac_port is configured)
    let pac_handle = if let Some(pac_port) = config.pac_port {
        let proxy_directive = pac::build_proxy_directive(
            config
                .socks5_listen_addr
                .as_deref()
                .unwrap_or("127.0.0.1:1080"),
            config.http_listen_addr.as_deref(),
        );
        let pac_content = pac::generate_pac(
            &config.routing.rules,
            &proxy_directive,
            prisma_core::router::RouteAction::Proxy,
        );
        let pac_addr = format!("127.0.0.1:{}", pac_port);
        info!(url = %format!("http://{}/proxy.pac", pac_addr), "PAC server enabled");
        Some(tokio::spawn(async move {
            if let Err(e) = pac::serve_pac(&pac_addr, pac_content).await {
                tracing::error!("PAC server error: {}", e);
            }
        }))
    } else {
        None
    };

    // Optionally start TUN mode
    // The route guard must live as long as TUN is active — dropping it cleans up
    // all OS routing changes (added routes, interface IP, server bypass).
    let (tun_handle, _tun_route_guard) = if config.tun.enabled {
        info!(device = %config.tun.device_name, mtu = config.tun.mtu, "Starting TUN mode");
        match tun::device::create_tun_device(
            &config.tun.device_name,
            config.tun.mtu,
            &config.server_addr,
            &config.tun.include_routes,
            &config.tun.exclude_routes,
        ) {
            Ok((device, route_guard)) => {
                let tun_ctx = ctx.clone();
                let tun_filter = app_filter.clone();
                let handle = tokio::spawn(async move {
                    if let Err(e) = tun::handler::run_tun_handler(device, tun_ctx, tun_filter).await
                    {
                        tracing::error!("TUN handler error: {}", e);
                    }
                });
                (Some(handle), Some(route_guard))
            }
            Err(e) => {
                tracing::error!("Failed to create TUN device: {}. TUN mode disabled.", e);
                (None, None)
            }
        }
    } else {
        (None, None)
    };

    // Collect all spawned task handles into the guard. When the guard is
    // dropped (either via shutdown signal or future cancellation), every
    // service task is aborted, preventing leaked background work.
    let mut handles: Vec<tokio::task::JoinHandle<()>> = Vec::new();
    if let Some(h) = socks5_handle {
        handles.push(h);
    }
    if let Some(h) = http_handle {
        handles.push(h);
    }
    if let Some(h) = forward_handle {
        handles.push(h);
    }
    if let Some(h) = dns_handle {
        handles.push(h);
    }
    if let Some(h) = pac_handle {
        handles.push(h);
    }
    if let Some(h) = tun_handle {
        handles.push(h);
    }
    let _guard = TaskGuard(handles);

    // Wait for shutdown signal if provided; otherwise wait forever (CLI mode
    // runs until the process is killed, and cancellation drops the guard).
    if let Some(rx) = shutdown {
        let _ = rx.await;
        info!("Shutdown signal received, stopping all services");
    } else {
        // CLI mode: pend forever; process termination or future cancellation
        // will drop the guard and abort tasks.
        std::future::pending::<()>().await;
    }

    // _guard is dropped here, aborting all spawned service tasks.
    Ok(())
}

/// Load the GeoIP matcher from a configured path, or by searching common
/// locations if no path is given but GeoIP rules are present.
///
/// Without a GeoIP database, GeoIP routing rules silently never match,
/// causing all traffic to fall through to the default action (Proxy).
fn load_geoip_matcher(
    configured_path: Option<&str>,
    has_geoip_rules: bool,
) -> Option<Arc<GeoIPMatcher>> {
    // If an explicit path is configured, use it.
    if let Some(path) = configured_path {
        if !path.is_empty() {
            return match GeoIPMatcher::load(path) {
                Ok(m) => Some(Arc::new(m)),
                Err(e) => {
                    tracing::warn!(path = %path, "Failed to load GeoIP database: {}", e);
                    None
                }
            };
        }
    }

    // No explicit path — if there are no GeoIP rules, skip loading.
    if !has_geoip_rules {
        return None;
    }

    // GeoIP rules exist but no path configured. Search common locations.
    tracing::info!("GeoIP rules found but no geoip_path configured, searching default locations");

    let mut search_paths = Vec::new();

    // 1. Next to the current executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            search_paths.push(dir.join("geoip.dat"));
        }
    }

    // 2. Current working directory
    if let Ok(cwd) = std::env::current_dir() {
        search_paths.push(cwd.join("geoip.dat"));
    }

    // 3. Platform-specific data directories
    #[cfg(target_os = "linux")]
    {
        search_paths.push(std::path::PathBuf::from("/usr/share/prisma/geoip.dat"));
        search_paths.push(std::path::PathBuf::from(
            "/usr/local/share/prisma/geoip.dat",
        ));
        if let Ok(home) = std::env::var("HOME") {
            search_paths.push(std::path::PathBuf::from(format!(
                "{}/.config/prisma/geoip.dat",
                home
            )));
            search_paths.push(std::path::PathBuf::from(format!(
                "{}/.local/share/prisma/geoip.dat",
                home
            )));
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            search_paths.push(std::path::PathBuf::from(format!(
                "{}/Library/Application Support/Prisma/geoip.dat",
                home
            )));
        }
        search_paths.push(std::path::PathBuf::from(
            "/usr/local/share/prisma/geoip.dat",
        ));
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            search_paths.push(std::path::PathBuf::from(format!(
                "{}\\Prisma\\geoip.dat",
                appdata
            )));
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            search_paths.push(std::path::PathBuf::from(format!(
                "{}\\Prisma\\geoip.dat",
                local
            )));
        }
    }

    // Also check v2ray/xray common locations
    #[cfg(target_os = "linux")]
    {
        search_paths.push(std::path::PathBuf::from("/usr/share/v2ray/geoip.dat"));
        search_paths.push(std::path::PathBuf::from("/usr/local/share/v2ray/geoip.dat"));
        search_paths.push(std::path::PathBuf::from("/usr/share/xray/geoip.dat"));
        search_paths.push(std::path::PathBuf::from("/usr/local/share/xray/geoip.dat"));
    }

    for path in &search_paths {
        if path.exists() {
            let path_str = path.to_string_lossy();
            match GeoIPMatcher::load(&path_str) {
                Ok(m) => {
                    info!(path = %path_str, "Auto-detected GeoIP database");
                    return Some(Arc::new(m));
                }
                Err(e) => {
                    tracing::debug!(path = %path_str, error = %e, "Skipping invalid GeoIP file");
                }
            }
        }
    }

    tracing::warn!(
        "GeoIP routing rules are configured but no geoip.dat file was found. \
         GeoIP rules will NOT match any traffic. Set routing.geoip_path or \
         place geoip.dat next to the executable."
    );
    None
}
