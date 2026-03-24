use std::sync::atomic::Ordering::Relaxed;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use tokio::net::TcpListener;
use tokio::sync::Semaphore;
use tracing::{debug, info, warn};

use prisma_core::cache::DnsCache;
use prisma_core::config::server::ServerConfig;

use crate::auth::AuthStore;
use crate::camouflage;
use crate::handler;
use crate::state::ServerContext;
use crate::tls_probe_guard::TlsProbeGuard;

pub async fn listen(
    config: &ServerConfig,
    auth: AuthStore,
    dns_cache: DnsCache,
    ctx: ServerContext,
    tls_probe_guard: Option<Arc<TlsProbeGuard>>,
) -> Result<()> {
    let listener = TcpListener::bind(&config.listen_addr).await?;
    let max_conn = config.performance.max_connections as usize;
    let semaphore = Arc::new(Semaphore::new(max_conn));

    // Build TLS acceptor if camouflage.tls_on_tcp is enabled
    let tls_acceptor = if config.camouflage.tls_on_tcp {
        let acceptor = camouflage::build_tcp_tls_acceptor(config)?;
        info!("TLS-on-TCP camouflage enabled");
        Some(Arc::new(acceptor))
    } else {
        None
    };

    let tls_handshake_timeout = Duration::from_secs(config.camouflage.tls_handshake_timeout_secs);
    let fallback_addr = config.camouflage.fallback_addr.clone();
    let camouflage_enabled = config.camouflage.enabled;
    let prisma_tls_enabled = config.prisma_tls.enabled;
    let anti_rtt_ms = if config.anti_rtt.enabled {
        Some(config.anti_rtt.normalization_ms)
    } else {
        None
    };

    if prisma_tls_enabled {
        if let Some(first) = config.prisma_tls.mask_servers.first() {
            info!(dest = %first.addr, "PrismaTLS mode enabled");
        } else {
            info!("PrismaTLS mode enabled");
        }
    }
    if let Some(ms) = anti_rtt_ms {
        info!(normalization_ms = ms, "Anti-RTT normalization enabled");
    }

    info!(addr = %config.listen_addr, max_connections = max_conn, "TCP listener started");

    loop {
        match listener.accept().await {
            Ok((stream, peer_addr)) => {
                // Check blocked IPs BEFORE acquiring a semaphore permit
                if let Some(ref guard) = tls_probe_guard {
                    if guard.is_blocked(&peer_addr.ip()) {
                        warn!(peer = %peer_addr, "Dropping connection from blocked IP (probe guard)");
                        ctx.state
                            .metrics
                            .tls_blocked_connections
                            .fetch_add(1, Relaxed);
                        drop(stream);
                        continue;
                    }
                }

                let permit = match semaphore.clone().try_acquire_owned() {
                    Ok(p) => p,
                    Err(_) => {
                        warn!(peer = %peer_addr, "Connection rejected: max connections reached");
                        drop(stream);
                        continue;
                    }
                };
                let auth = auth.clone();
                let dns = dns_cache.clone();
                let fwd = config.port_forwarding.clone();
                let ctx = ctx.clone();
                let tls_acceptor = tls_acceptor.clone();
                let fallback_addr = fallback_addr.clone();
                let guard = tls_probe_guard.clone();
                let hs_timeout = tls_handshake_timeout;
                tokio::spawn(async move {
                    info!(peer = %peer_addr, "New TCP connection");
                    ctx.state.metrics.total_connections.fetch_add(1, Relaxed);
                    ctx.state.metrics.active_connections.fetch_add(1, Relaxed);

                    let result = if let Some(acceptor) = tls_acceptor {
                        // TLS-on-TCP: wrap in TLS first with timeout, then camouflaged handler
                        match tokio::time::timeout(hs_timeout, acceptor.accept(stream)).await {
                            Ok(Ok(tls_stream)) => {
                                handler::handle_tcp_connection_camouflaged(
                                    tls_stream,
                                    auth,
                                    dns,
                                    fwd,
                                    ctx.clone(),
                                    peer_addr.to_string(),
                                    fallback_addr,
                                )
                                .await
                            }
                            Ok(Err(e)) => {
                                ctx.state
                                    .metrics
                                    .tls_handshake_failures
                                    .fetch_add(1, Relaxed);
                                let fail_count = guard
                                    .as_ref()
                                    .map(|g| g.record_failure(&peer_addr.ip()))
                                    .unwrap_or(0);
                                if fail_count <= 1 {
                                    warn!(peer = %peer_addr, error = %e, "TLS handshake failed");
                                } else {
                                    debug!(peer = %peer_addr, error = %e, failures = fail_count, "TLS handshake failed (repeat)");
                                }
                                Ok(())
                            }
                            Err(_timeout) => {
                                ctx.state
                                    .metrics
                                    .tls_handshake_timeouts
                                    .fetch_add(1, Relaxed);
                                if let Some(ref g) = guard {
                                    g.record_failure(&peer_addr.ip());
                                }
                                debug!(peer = %peer_addr, "TLS handshake timed out");
                                Ok(())
                            }
                        }
                    } else if camouflage_enabled {
                        // Camouflage without TLS: peek and route
                        handler::handle_tcp_connection_camouflaged(
                            stream,
                            auth,
                            dns,
                            fwd,
                            ctx.clone(),
                            peer_addr.to_string(),
                            fallback_addr,
                        )
                        .await
                    } else {
                        // No camouflage: original handler
                        handler::handle_tcp_connection(
                            stream,
                            auth,
                            dns,
                            fwd,
                            ctx.clone(),
                            peer_addr.to_string(),
                        )
                        .await
                    };

                    if let Err(e) = result {
                        warn!(peer = %peer_addr, error = %e, "Connection handler error");
                    }
                    ctx.state.metrics.active_connections.fetch_sub(1, Relaxed);
                    drop(permit);
                });
            }
            Err(e) => {
                warn!(error = %e, "Failed to accept TCP connection");
            }
        }
    }
}
