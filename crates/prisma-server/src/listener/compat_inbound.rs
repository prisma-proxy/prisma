//! Listener for multi-protocol compatibility inbounds (VMess/VLESS/Shadowsocks/Trojan).
//!
//! Each configured `[[inbounds]]` entry spawns a dedicated TCP listener that accepts
//! connections and dispatches them through the appropriate protocol handler.

use anyhow::Result;
use tokio::net::TcpListener;
use tracing::{error, info};

use prisma_core::cache::DnsCache;
use prisma_core::config::server::InboundConfig;

use crate::compat_handler;
use crate::state::ServerContext;

/// Start a TCP listener for a single compat protocol inbound.
///
/// Accepts connections and spawns a task per connection to handle the
/// protocol-specific handshake, authentication, and bidirectional relay.
pub async fn listen(inbound: InboundConfig, dns_cache: DnsCache, ctx: ServerContext) -> Result<()> {
    let listener = TcpListener::bind(&inbound.listen).await?;

    info!(
        tag = %inbound.tag,
        protocol = %inbound.protocol,
        addr = %inbound.listen,
        transport = %inbound.transport,
        "Compat inbound listener started"
    );

    loop {
        let (stream, peer_addr) = match listener.accept().await {
            Ok(conn) => conn,
            Err(e) => {
                error!(
                    tag = %inbound.tag,
                    error = %e,
                    "Failed to accept compat inbound connection"
                );
                continue;
            }
        };

        let config = inbound.clone();
        let dns = dns_cache.clone();
        let server_ctx = ctx.clone();
        let peer = peer_addr.to_string();

        tokio::spawn(async move {
            if let Err(e) =
                compat_handler::handle_compat_connection(stream, &config, dns, server_ctx, peer)
                    .await
            {
                // Log at debug level since auth failures from scanners are expected
                tracing::debug!(
                    tag = %config.tag,
                    protocol = %config.protocol,
                    error = %e,
                    "Compat connection handler error"
                );
            }
        });
    }
}
