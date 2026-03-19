//! WireGuard-compatible UDP listener.
//!
//! Accepts UDP packets that mimic WireGuard framing, performs the Prisma
//! handshake inside the WireGuard envelope, then relays proxy data as
//! WireGuard transport data packets.

use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use anyhow::Result;
use bytes::Bytes;
use tokio::net::UdpSocket;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use prisma_core::cache::DnsCache;
use prisma_core::config::server::ServerConfig;
use prisma_core::wireguard::{self, WgPacket, WgSession, MAX_WG_PACKET_SIZE};

use crate::auth::AuthStore;
use crate::handler;
use crate::state::ServerContext;

/// Start the WireGuard-compatible UDP listener.
pub async fn listen(
    config: &ServerConfig,
    auth: AuthStore,
    dns_cache: DnsCache,
    ctx: ServerContext,
) -> Result<()> {
    let wg_config = &config.wireguard;
    let socket = Arc::new(UdpSocket::bind(&wg_config.listen_addr).await?);
    info!(addr = %wg_config.listen_addr, "WireGuard-compatible UDP listener started");

    let sessions = wireguard::new_session_store();
    let session_timeout = wg_config.session_timeout_secs;

    // Spawn a reaper task that removes expired sessions.
    let reaper_sessions = sessions.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            let mut store = reaper_sessions.write().await;
            store.retain(|_, session| session.seconds_since_activity() < session_timeout);
        }
    });

    let mut recv_buf = vec![0u8; MAX_WG_PACKET_SIZE];

    loop {
        let (n, peer_addr) = match socket.recv_from(&mut recv_buf).await {
            Ok(r) => r,
            Err(e) => {
                warn!(error = %e, "UDP recv error");
                continue;
            }
        };

        let data = &recv_buf[..n];
        let packet = match WgPacket::decode(data) {
            Ok(p) => p,
            Err(e) => {
                debug!(peer = %peer_addr, error = %e, "Invalid WireGuard packet, ignoring");
                continue;
            }
        };

        match packet {
            WgPacket::HandshakeInit {
                sender_index,
                payload,
            } => {
                // New handshake: assign a local index, create a session,
                // then spawn a task to run the Prisma handshake and session.
                let local_index = wireguard::random_index();
                let session = Arc::new(WgSession::new(local_index, sender_index, peer_addr));
                sessions.write().await.insert(local_index, session.clone());

                let socket = socket.clone();
                let auth = auth.clone();
                let dns = dns_cache.clone();
                let fwd = config.port_forwarding.clone();
                let ctx = ctx.clone();
                let sessions = sessions.clone();

                tokio::spawn(async move {
                    ctx.state
                        .metrics
                        .total_connections
                        .fetch_add(1, Ordering::Relaxed);
                    ctx.state
                        .metrics
                        .active_connections
                        .fetch_add(1, Ordering::Relaxed);

                    let result = handle_wg_session(
                        socket,
                        session.clone(),
                        payload,
                        auth,
                        dns,
                        fwd,
                        ctx.clone(),
                        peer_addr,
                    )
                    .await;

                    if let Err(e) = result {
                        warn!(peer = %peer_addr, error = %e, "WireGuard session error");
                    }

                    // Clean up session
                    sessions.write().await.remove(&session.local_index);
                    ctx.state
                        .metrics
                        .active_connections
                        .fetch_sub(1, Ordering::Relaxed);
                });
            }
            WgPacket::TransportData {
                receiver_index,
                counter: _,
                payload,
            } => {
                // Route to existing session
                let sessions_read = sessions.read().await;
                if let Some(session) = sessions_read.get(&receiver_index) {
                    session.update_activity();
                    // Forward payload to the session's inbound channel.
                    // The session task has a channel receiver that feeds its
                    // ChannelStream.
                    //
                    // We use a side channel stored in the session map. Since
                    // the session handle loop is spawned in handle_wg_session,
                    // we relay through a shared inbound sender.
                    if let Some(tx) = INBOUND_CHANNELS.get(&receiver_index) {
                        let _ = tx.try_send(payload);
                    }
                } else {
                    debug!(index = receiver_index, peer = %peer_addr, "Transport data for unknown session");
                }
            }
            WgPacket::HandshakeResponse { .. } => {
                // Server should not receive handshake responses.
                debug!(peer = %peer_addr, "Unexpected handshake response from peer");
            }
        }
    }
}

/// Global inbound channel map: local_index -> Sender for incoming transport data.
/// This is safe because each index is unique and the entry is inserted before
/// the accept loop starts for that session.
static INBOUND_CHANNELS: std::sync::LazyLock<dashmap::DashMap<u32, mpsc::Sender<Bytes>>> =
    std::sync::LazyLock::new(dashmap::DashMap::new);

/// Handle a single WireGuard session from handshake through data relay.
async fn handle_wg_session(
    socket: Arc<UdpSocket>,
    session: Arc<WgSession>,
    handshake_payload: Bytes,
    auth: AuthStore,
    dns_cache: DnsCache,
    fwd: prisma_core::config::server::PortForwardingConfig,
    ctx: ServerContext,
    peer_addr: SocketAddr,
) -> Result<()> {
    info!(
        peer = %peer_addr,
        local_index = session.local_index,
        peer_index = session.peer_index,
        "WireGuard handshake initiation"
    );

    // Create channel pair for bridging UDP <-> AsyncRead/AsyncWrite.
    // Inbound: UDP recv -> channel -> ChannelStream read side.
    // Outbound: ChannelStream write side -> channel -> UDP send.
    let (inbound_tx, inbound_rx) = mpsc::channel::<Bytes>(256);
    let (outbound_tx, mut outbound_rx) = mpsc::channel::<Bytes>(256);

    // Register inbound channel so the main recv loop can route packets.
    INBOUND_CHANNELS.insert(session.local_index, inbound_tx.clone());

    // Feed the initial handshake payload into the inbound channel.
    inbound_tx.send(handshake_payload).await?;

    // Spawn outbound sender: reads from channel, wraps in WG transport data, sends UDP.
    let out_socket = socket.clone();
    let out_session = session.clone();
    let outbound_handle = tokio::spawn(async move {
        while let Some(data) = outbound_rx.recv().await {
            let counter = out_session.next_tx_counter();

            // Check if this is the first outbound message (counter == 0).
            // If so, it's the handshake response — wrap it accordingly.
            let packet = if counter == 0 {
                WgPacket::HandshakeResponse {
                    sender_index: out_session.local_index,
                    receiver_index: out_session.peer_index,
                    payload: data,
                }
            } else {
                WgPacket::TransportData {
                    receiver_index: out_session.peer_index,
                    counter,
                    payload: data,
                }
            };

            let encoded = packet.encode();
            if let Err(e) = out_socket.send_to(&encoded, out_session.peer_addr).await {
                warn!(error = %e, "Failed to send WG packet");
                break;
            }
        }
    });

    // Build a ChannelStream from the inbound/outbound channels.
    let stream = crate::channel_stream::ChannelStream::new(inbound_rx, outbound_tx);

    // Run the standard Prisma handler over the channel stream.
    let result = handler::handle_tcp_connection_camouflaged(
        stream,
        auth,
        dns_cache,
        fwd,
        ctx,
        peer_addr.to_string(),
        None, // no fallback for WireGuard
    )
    .await;

    // Clean up
    INBOUND_CHANNELS.remove(&session.local_index);
    outbound_handle.abort();

    result
}
