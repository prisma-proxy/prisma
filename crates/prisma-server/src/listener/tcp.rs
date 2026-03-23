use std::sync::atomic::Ordering;
use std::sync::Arc;

use anyhow::Result;
use tokio::net::TcpListener;
use tokio::sync::Semaphore;
use tracing::{info, warn};

use prisma_core::cache::DnsCache;
use prisma_core::config::server::ServerConfig;

use crate::auth::AuthStore;
use crate::camouflage;
use crate::handler;
use crate::state::ServerContext;

pub async fn listen(
    config: &ServerConfig,
    auth: AuthStore,
    dns_cache: DnsCache,
    ctx: ServerContext,
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
                tokio::spawn(async move {
                    info!(peer = %peer_addr, "New TCP connection");
                    ctx.state
                        .metrics
                        .total_connections
                        .fetch_add(1, Ordering::Relaxed);
                    ctx.state
                        .metrics
                        .active_connections
                        .fetch_add(1, Ordering::Relaxed);

                    let result = if let Some(acceptor) = tls_acceptor {
                        // TLS-on-TCP: wrap in TLS first, then camouflaged handler
                        match acceptor.accept(stream).await {
                            Ok(tls_stream) => {
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
                            Err(e) => {
                                warn!(peer = %peer_addr, error = %e, "TLS handshake failed");
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
                    ctx.state
                        .metrics
                        .active_connections
                        .fetch_sub(1, Ordering::Relaxed);
                    drop(permit);
                });
            }
            Err(e) => {
                warn!(error = %e, "Failed to accept TCP connection");
            }
        }
    }
}
