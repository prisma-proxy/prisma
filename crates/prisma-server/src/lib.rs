pub mod auth;
pub mod bandwidth;
pub mod camouflage;
pub mod channel_stream;
pub mod forward;
pub mod grpc_stream;
pub mod handler;
pub mod listener;
pub mod mux_handler;
pub mod outbound;
pub mod relay;
#[cfg(all(target_os = "linux", feature = "io-uring"))]
pub mod relay_uring;
pub mod reload;
pub mod state;
pub mod tls_probe_guard;
pub mod udp_relay;
pub mod ws_stream;
pub mod xhttp_stream;
pub mod xporta_stream;

use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use prisma_core::cache::DnsCache;
use prisma_core::config::load_server_config;
use prisma_core::config::server::RoutingRule;
use prisma_core::crypto::kdf::derive_ticket_key;
use prisma_core::crypto::ticket_key_ring::TicketKeyRing;
use prisma_core::logging::init_logging_with_broadcast;
use prisma_core::state::{LogEntry, MetricsSnapshot, ServerState};
use tracing::info;

use prisma_core::state::AuthStoreInner;

use crate::auth::AuthStore;
use crate::bandwidth::limiter::{parse_bandwidth, BandwidthLimit, BandwidthLimiterStore};
use crate::bandwidth::quota::{parse_quota, QuotaStore};
use crate::state::ServerContext;

pub async fn run(config_path: &str) -> Result<()> {
    let config = load_server_config(config_path)
        .map_err(|e| anyhow::anyhow!("Failed to load config: {}", e))?;

    // Print startup banner before logging init — always visible regardless of log level
    print_startup_banner(&config, config_path);

    // Create broadcast channels
    let (log_tx, _) = tokio::sync::broadcast::channel::<LogEntry>(1024);
    let (metrics_tx, _) = tokio::sync::broadcast::channel::<MetricsSnapshot>(256);

    // Initialize logging with broadcast
    init_logging_with_broadcast(
        &config.logging.level,
        &config.logging.format,
        log_tx.clone(),
    );

    let auth_inner = AuthStoreInner::from_config(&config.authorized_clients)?;
    let state = ServerState::new(&config, auth_inner, log_tx, metrics_tx);

    // Populate per-client permissions from config
    state
        .populate_permissions_from_config(&config.authorized_clients)
        .await;

    // Load static routing rules from config
    if !config.routing.rules.is_empty() {
        let static_rules: Vec<RoutingRule> = config
            .routing
            .rules
            .iter()
            .enumerate()
            .map(|(i, rule)| RoutingRule::from_router_rule(rule, 10000 + i as u32))
            .collect();
        let count = static_rules.len();
        state.routing_rules.write().await.extend(static_rules);
        info!(count, "Loaded static routing rules from config");
    }

    let auth_store = AuthStore::from_inner(state.auth_store.clone());
    let dns_cache = DnsCache::default();

    // Initialize bandwidth limiter and quota stores from client config
    let bandwidth = Arc::new(BandwidthLimiterStore::new());
    let quotas = Arc::new(QuotaStore::new());

    for client in &config.authorized_clients {
        let upload_bps = client
            .bandwidth_up
            .as_deref()
            .and_then(parse_bandwidth)
            .unwrap_or(0);
        let download_bps = client
            .bandwidth_down
            .as_deref()
            .and_then(parse_bandwidth)
            .unwrap_or(0);
        if upload_bps > 0 || download_bps > 0 {
            bandwidth
                .set_limit(
                    &client.id,
                    &BandwidthLimit {
                        upload_bps,
                        download_bps,
                    },
                )
                .await;
            info!(
                client_id = %client.id,
                up = upload_bps,
                down = download_bps,
                "Configured bandwidth limits"
            );
        }
        if let Some(quota_str) = &client.quota {
            if let Some(quota_bytes) = parse_quota(quota_str) {
                quotas.set_quota(&client.id, quota_bytes).await;
                info!(
                    client_id = %client.id,
                    quota_bytes,
                    "Configured traffic quota"
                );
            }
        }
    }

    // Initialize session ticket key ring with automatic rotation.
    // Derive the initial ticket key from the first client's auth secret.
    let initial_ticket_key = {
        let auth_store = state.auth_store.read().await;
        if let Some(entry) = auth_store.clients.values().next() {
            derive_ticket_key(&entry.auth_secret)
        } else {
            [0u8; 32] // Fallback, should not happen in production
        }
    };
    let ticket_rotation_hours = {
        let cfg = state.config.read().await;
        cfg.ticket_rotation_hours
    };
    let ticket_key_ring = TicketKeyRing::new(
        initial_ticket_key,
        Some(Duration::from_secs(ticket_rotation_hours * 3600)),
        Some(3), // Retain 3 expired keys for graceful rotation
    );
    info!(
        rotation_interval_hours = ticket_rotation_hours,
        "Session ticket key ring initialized"
    );

    let ctx = ServerContext {
        state: state.clone(),
        bandwidth,
        quotas,
        config_path: config_path.to_string(),
        ticket_key_ring,
    };

    // Start metrics ticker (1s snapshots)
    tokio::spawn(prisma_core::state::metrics_ticker(state.clone()));

    // Start transport fallback health check loop if enabled
    if config.fallback.enabled {
        let fb_config = Arc::new(config.clone());
        let fb_state = state.clone();
        let fb_auth = auth_store.clone();
        let fb_dns = dns_cache.clone();
        let fb_ctx = ctx.clone();
        // Initialize fallback transports from what is actually configured
        {
            let configured = listener::fallback::configured_transports(&config);
            let chain = fb_state.fallback_manager.chain.read().await;
            for entry in chain.iter() {
                if configured.contains(&entry.name) {
                    entry.set_status(prisma_core::state::TransportStatus::Active);
                }
            }
        }
        tokio::spawn(async move {
            listener::fallback::run_health_check_loop(fb_config, fb_state, fb_auth, fb_dns, fb_ctx)
                .await;
        });
        info!(
            chain = ?config.fallback.chain,
            "Transport fallback manager started"
        );
    }

    // Start SIGHUP signal handler for config hot-reload (Unix only)
    #[cfg(unix)]
    {
        let reload_ctx = ctx.clone();
        tokio::spawn(async move {
            use tokio::signal::unix::{signal, SignalKind};
            let mut sighup =
                signal(SignalKind::hangup()).expect("Failed to register SIGHUP handler");
            loop {
                sighup.recv().await;
                info!("Received SIGHUP, triggering config reload");
                match reload::reload_config(&reload_ctx.config_path, &reload_ctx).await {
                    Ok(summary) => info!(summary = %summary, "Config reload complete"),
                    Err(e) => tracing::error!(error = %e, "Config reload failed"),
                }
            }
        });
        info!("SIGHUP config reload handler registered");
    }

    // Start config file watcher for automatic hot-reload
    if config.config_watch {
        let watch_ctx = ctx.clone();
        let watch_path = config_path.to_string();
        tokio::spawn(async move {
            if let Err(e) = run_config_watcher(&watch_path, &watch_ctx).await {
                tracing::error!(error = %e, "Config file watcher stopped");
            }
        });
        info!(path = %config_path, "Config file watcher started");
    }

    // Start management API if enabled
    if config.management_api.enabled {
        let mut mgmt_config = config.management_api.clone();

        // Inherit TLS from server config if not explicitly set on management API
        if mgmt_config.tls.is_none() && mgmt_config.tls_enabled {
            mgmt_config.tls = config.tls.clone();
        }
        if !mgmt_config.tls_enabled {
            mgmt_config.tls = None;
        }

        // Load alert config from {config_dir}/alerts.json if it exists
        let config_path_buf = std::path::PathBuf::from(config_path);
        let alert_config = {
            let alerts_path = config_path_buf
                .parent()
                .unwrap_or(std::path::Path::new("."))
                .join("alerts.json");
            if alerts_path.exists() {
                std::fs::read_to_string(&alerts_path)
                    .ok()
                    .and_then(|s| serde_json::from_str::<prisma_mgmt::AlertConfig>(&s).ok())
                    .unwrap_or_default()
            } else {
                prisma_mgmt::AlertConfig::default()
            }
        };

        // Load raw TOML for merge-based persistence (preserves unknown fields)
        let raw_toml = std::fs::read_to_string(&config_path_buf).unwrap_or_default();

        let mgmt_state = prisma_mgmt::MgmtState {
            state: state.clone(),
            bandwidth: Some(ctx.bandwidth.clone()),
            quotas: Some(ctx.quotas.clone()),
            config_path: Some(config_path_buf),
            alert_config: std::sync::Arc::new(tokio::sync::RwLock::new(alert_config)),
            db: None,
            raw_config_toml: std::sync::Arc::new(tokio::sync::RwLock::new(raw_toml)),
        };

        let mgmt_addr = mgmt_config.listen_addr.clone();
        tokio::spawn(async move {
            if let Err(e) = prisma_mgmt::serve(mgmt_config, mgmt_state).await {
                tracing::error!(
                    addr = %mgmt_addr,
                    error = %e,
                    "Management API failed to start — check address/port availability"
                );
            }
        });
    }

    // Start CDN listener if enabled
    if config.cdn.enabled {
        let cdn_config = config.clone();
        let cdn_auth = auth_store.clone();
        let cdn_dns = dns_cache.clone();
        let cdn_ctx = ctx.clone();
        tokio::spawn(async move {
            if let Err(e) = listener::cdn::listen(&cdn_config, cdn_auth, cdn_dns, cdn_ctx).await {
                tracing::error!("CDN listener error: {}", e);
            }
        });
        info!(addr = %config.cdn.listen_addr, "CDN HTTPS listener spawned");
    }

    // Construct TLS probe guard if TLS-on-TCP camouflage with guard enabled
    let tls_probe_guard =
        if config.camouflage.tls_on_tcp && config.camouflage.tls_probe_guard.enabled {
            let cfg = &config.camouflage.tls_probe_guard;
            Some(Arc::new(tls_probe_guard::TlsProbeGuard::new(
                cfg.max_failures,
                cfg.failure_window_secs,
                cfg.block_duration_secs,
            )))
        } else {
            None
        };

    // Spawn periodic cleanup task for the probe guard
    if let Some(ref guard) = tls_probe_guard {
        let g = guard.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(300));
            loop {
                interval.tick().await;
                g.cleanup();
            }
        });
    }

    // Start TCP and QUIC listeners concurrently
    let tcp_config = config.clone();
    let tcp_auth = auth_store.clone();
    let tcp_dns = dns_cache.clone();
    let tcp_ctx = ctx.clone();
    let tcp_guard = tls_probe_guard.clone();
    let tcp_handle = tokio::spawn(async move {
        if let Err(e) =
            listener::tcp::listen(&tcp_config, tcp_auth, tcp_dns, tcp_ctx, tcp_guard).await
        {
            tracing::error!("TCP listener error: {}", e);
        }
    });

    let quic_config = config.clone();
    let quic_auth = auth_store.clone();
    let quic_dns = dns_cache.clone();
    let quic_ctx = ctx.clone();
    let quic_handle = tokio::spawn(async move {
        if let Err(e) = listener::quic::listen(&quic_config, quic_auth, quic_dns, quic_ctx).await {
            tracing::error!("QUIC listener error: {}", e);
        }
    });

    // Start SSH listener if enabled
    if config.ssh.enabled {
        let ssh_config = config.clone();
        let ssh_auth = auth_store.clone();
        let ssh_dns = dns_cache.clone();
        let ssh_ctx = ctx.clone();
        tokio::spawn(async move {
            if let Err(e) = listener::ssh::listen(&ssh_config, ssh_auth, ssh_dns, ssh_ctx).await {
                tracing::error!("SSH listener error: {}", e);
            }
        });
        info!(addr = %config.ssh.listen_addr, "SSH transport listener spawned");
    }

    // Start WireGuard-compatible UDP listener if enabled
    if config.wireguard.enabled {
        let wg_config = config.clone();
        let wg_auth = auth_store.clone();
        let wg_dns = dns_cache.clone();
        let wg_ctx = ctx.clone();
        tokio::spawn(async move {
            if let Err(e) = listener::wireguard::listen(&wg_config, wg_auth, wg_dns, wg_ctx).await {
                tracing::error!("WireGuard listener error: {}", e);
            }
        });
        info!(addr = %config.wireguard.listen_addr, "WireGuard-compatible UDP listener spawned");
    }

    tokio::select! {
        _ = tcp_handle => {},
        _ = quic_handle => {},
    }

    Ok(())
}

fn print_startup_banner(config: &prisma_core::config::server::ServerConfig, config_path: &str) {
    use prisma_core::types::PRISMA_PROTOCOL_VERSION;

    eprintln!();
    eprintln!(
        "  Prisma v{} (protocol v{})",
        env!("CARGO_PKG_VERSION"),
        PRISMA_PROTOCOL_VERSION
    );
    eprintln!("  ─────────────────────────────────────");
    eprintln!("  TCP    listening on  {}", config.listen_addr);
    eprintln!("  QUIC   listening on  {}", config.quic_listen_addr);
    if config.management_api.enabled {
        let mgmt_tls = if config.management_api.tls_enabled
            && (config.management_api.tls.is_some() || config.tls.is_some())
        {
            "HTTPS"
        } else {
            "HTTP"
        };
        eprintln!(
            "  API    listening on  {} ({})",
            config.management_api.listen_addr, mgmt_tls
        );
    }
    if config.cdn.enabled {
        eprintln!("  CDN    listening on  {}", config.cdn.listen_addr);
    }
    if config.ssh.enabled {
        eprintln!("  SSH    listening on  {}", config.ssh.listen_addr);
    }
    eprintln!("  ─────────────────────────────────────");
    eprintln!("  Config:    {}", config_path);
    eprintln!("  Clients:   {}", config.authorized_clients.len());
    eprintln!("  Log level: {}", config.logging.level);

    // Transport features
    let mut transports = vec!["TCP", "QUIC"];
    if config.cdn.enabled {
        transports.push("WS");
        transports.push("gRPC");
        transports.push("XHTTP");
        if config.cdn.xporta.as_ref().is_some_and(|x| x.enabled) {
            transports.push("XPorta");
        }
    }
    if config.prisma_tls.enabled {
        transports.push("PrismaTLS");
    }
    if config.ssh.enabled {
        transports.push("SSH");
    }
    if config.wireguard.enabled {
        transports.push("WireGuard");
    }
    eprintln!("  Transports: {}", transports.join(", "));

    // Security features
    let tls_status = if config.tls.is_some() {
        "enabled"
    } else {
        "disabled"
    };
    let camo_status = if config.camouflage.enabled {
        "enabled"
    } else {
        "disabled"
    };
    eprintln!("  TLS: {}  Camouflage: {}", tls_status, camo_status);

    eprintln!();
}

/// Watch the config file for changes and trigger hot-reload automatically.
///
/// Uses `notify` crate for cross-platform filesystem events. Debounces rapid
/// changes (e.g., editor save) with a 2-second cooldown.
async fn run_config_watcher(
    config_path: &str,
    ctx: &crate::state::ServerContext,
) -> anyhow::Result<()> {
    use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
    use std::time::Duration;

    let (tx, mut rx) = tokio::sync::mpsc::channel::<()>(1);

    let path = std::path::PathBuf::from(config_path);
    let watch_path = path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .to_path_buf();
    let file_name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();

    let mut watcher = RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| {
            if let Ok(event) = result {
                match event.kind {
                    EventKind::Modify(_) | EventKind::Create(_) => {
                        // Only trigger for our specific config file
                        let is_our_file = event
                            .paths
                            .iter()
                            .any(|p| p.file_name().map(|n| n == file_name).unwrap_or(false));
                        if is_our_file {
                            let _ = tx.try_send(());
                        }
                    }
                    _ => {}
                }
            }
        },
        notify::Config::default().with_poll_interval(Duration::from_secs(2)),
    )?;

    watcher.watch(&watch_path, RecursiveMode::NonRecursive)?;

    info!(
        path = %config_path,
        "Watching config file for changes (2s debounce)"
    );

    // Keep watcher alive and process events with debouncing
    let mut last_reload = tokio::time::Instant::now();
    let debounce = Duration::from_secs(2);

    loop {
        rx.recv().await;

        // Debounce: skip if we reloaded recently
        if last_reload.elapsed() < debounce {
            // Drain any queued events
            while rx.try_recv().is_ok() {}
            continue;
        }

        // Small delay to let the editor finish writing
        tokio::time::sleep(Duration::from_millis(500)).await;
        // Drain any events that arrived during the delay
        while rx.try_recv().is_ok() {}

        info!("Config file changed, triggering hot-reload");
        match reload::reload_config(config_path, ctx).await {
            Ok(summary) => info!(summary = %summary, "Auto-reload complete"),
            Err(e) => tracing::error!(error = %e, "Auto-reload failed"),
        }
        last_reload = tokio::time::Instant::now();
    }
}
