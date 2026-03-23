//! ShadowTLS v3 server listener.
//!
//! Accepts incoming TCP connections and performs a real TLS handshake relay
//! with the configured cover server. After the handshake completes, incoming
//! TLS application data records are inspected: those carrying a valid HMAC
//! tag are proxy frames and are fed into the normal Prisma handler; all other
//! records are cover traffic and are silently discarded.
//!
//! From DPI's perspective the connection looks exactly like a legitimate TLS
//! session to the cover server.

use std::net::ToSocketAddrs;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use anyhow::Result;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Semaphore;
use tracing::{debug, info, warn};

use prisma_core::cache::DnsCache;
use prisma_core::config::server::ServerConfig;
use prisma_core::shadow_tls::{
    decode_frame, derive_hmac_key, encode_proxy_frame, read_tls_record, write_tls_record,
    FrameDecodeResult, HMAC_TAG_SIZE, MAX_PROXY_PAYLOAD, TLS_APPLICATION_DATA,
    TLS_CHANGE_CIPHER_SPEC, TLS_HANDSHAKE, TLS_RECORD_HEADER_SIZE,
};

use crate::auth::AuthStore;
use crate::handler;
use crate::state::ServerContext;

/// Start the ShadowTLS v3 listener.
pub async fn listen(
    config: &ServerConfig,
    auth: AuthStore,
    dns_cache: DnsCache,
    ctx: ServerContext,
) -> Result<()> {
    let stls_config = &config.shadow_tls;
    if !stls_config.enabled {
        return Ok(());
    }

    let handshake_server = stls_config
        .handshake_server
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("ShadowTLS: handshake_server not configured"))?;

    let hmac_key = derive_hmac_key(&stls_config.password);
    let listener = TcpListener::bind(&stls_config.listen_addr).await?;
    let max_conn = config.performance.max_connections as usize;
    let semaphore = Arc::new(Semaphore::new(max_conn));

    info!(
        addr = %stls_config.listen_addr,
        handshake_server = %handshake_server,
        "ShadowTLS v3 listener started"
    );

    loop {
        match listener.accept().await {
            Ok((stream, peer_addr)) => {
                let permit = match semaphore.clone().try_acquire_owned() {
                    Ok(p) => p,
                    Err(_) => {
                        warn!(peer = %peer_addr, "ShadowTLS: connection rejected (max connections)");
                        drop(stream);
                        continue;
                    }
                };

                let auth = auth.clone();
                let dns = dns_cache.clone();
                let ctx = ctx.clone();
                let fwd = config.port_forwarding.clone();
                let handshake_server = handshake_server.to_string();

                tokio::spawn(async move {
                    debug!(peer = %peer_addr, "ShadowTLS: new connection");
                    ctx.state
                        .metrics
                        .total_connections
                        .fetch_add(1, Ordering::Relaxed);
                    ctx.state
                        .metrics
                        .active_connections
                        .fetch_add(1, Ordering::Relaxed);

                    let result = handle_shadow_tls_connection(
                        stream,
                        &handshake_server,
                        &hmac_key,
                        auth,
                        dns,
                        fwd,
                        ctx.clone(),
                        peer_addr.to_string(),
                    )
                    .await;

                    if let Err(e) = result {
                        // Don't log connection reset errors — they're normal for probers
                        let msg = e.to_string();
                        if !msg.contains("reset") && !msg.contains("broken pipe") {
                            warn!(peer = %peer_addr, error = %e, "ShadowTLS: connection error");
                        }
                    }

                    ctx.state
                        .metrics
                        .active_connections
                        .fetch_sub(1, Ordering::Relaxed);
                    drop(permit);
                });
            }
            Err(e) => {
                warn!(error = %e, "ShadowTLS: failed to accept connection");
            }
        }
    }
}

/// Handle a single ShadowTLS connection:
/// 1. Read the ClientHello from the client
/// 2. Forward it to the real handshake server
/// 3. Relay the TLS handshake between client and handshake server
/// 4. After handshake, demux proxy frames from cover traffic
/// 5. Feed proxy data into the normal Prisma handler via an in-memory stream
#[allow(clippy::too_many_arguments)]
async fn handle_shadow_tls_connection(
    mut client: TcpStream,
    handshake_server: &str,
    hmac_key: &[u8; 32],
    auth: AuthStore,
    dns: DnsCache,
    fwd: prisma_core::config::server::PortForwardingConfig,
    ctx: ServerContext,
    peer_addr: String,
) -> Result<()> {
    // Connect to the real handshake server
    let addr = handshake_server
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| anyhow::anyhow!("ShadowTLS: failed to resolve {}", handshake_server))?;

    let mut cover_server = TcpStream::connect(addr).await?;
    debug!(cover = %handshake_server, "ShadowTLS: connected to cover server");

    // Phase 1: Relay the TLS handshake
    // Read ClientHello from client and forward to cover server
    let (content_type, client_hello) = read_tls_record(&mut client).await?;
    if content_type != TLS_HANDSHAKE {
        // Not a TLS ClientHello — just relay everything and close
        debug!("ShadowTLS: not a TLS ClientHello, relaying raw");
        let mut header = [0u8; TLS_RECORD_HEADER_SIZE];
        header[0] = content_type;
        header[1] = 0x03;
        header[2] = 0x03;
        let len = client_hello.len();
        header[3] = (len >> 8) as u8;
        header[4] = (len & 0xFF) as u8;
        cover_server.write_all(&header).await?;
        cover_server.write_all(&client_hello).await?;
        tokio::io::copy_bidirectional(&mut client, &mut cover_server).await?;
        return Ok(());
    }

    // Forward ClientHello to cover server
    write_tls_record(&mut cover_server, content_type, &client_hello).await?;

    // Relay handshake records until we see the handshake is complete.
    // The handshake is considered done when we've relayed a Change Cipher Spec
    // from the server followed by encrypted handshake messages, and then the
    // client also sends a Change Cipher Spec + Finished.
    let mut server_handshake_done = false;
    let mut client_handshake_done = false;

    while !server_handshake_done || !client_handshake_done {
        if !server_handshake_done {
            // Read from cover server and forward to client
            let (ct, payload) = read_tls_record(&mut cover_server).await?;
            write_tls_record(&mut client, ct, &payload).await?;

            // After receiving Application Data from server, handshake is done.
            // In TLS 1.3, the server sends encrypted extensions/certificate/finished
            // as Application Data records after its ServerHello. We consider the
            // server side done after we see at least one Application Data record.
            if ct == TLS_APPLICATION_DATA {
                server_handshake_done = true;
            }
        }

        if server_handshake_done && !client_handshake_done {
            // Read from client. Could be Change Cipher Spec, then Finished (wrapped in AppData)
            let (ct, payload) = read_tls_record(&mut client).await?;

            if ct == TLS_CHANGE_CIPHER_SPEC {
                // Forward to cover server
                write_tls_record(&mut cover_server, ct, &payload).await?;
                // Read the client's Finished (comes as Application Data in TLS 1.3)
                let (ct2, payload2) = read_tls_record(&mut client).await?;
                write_tls_record(&mut cover_server, ct2, &payload2).await?;
                client_handshake_done = true;
            } else if ct == TLS_APPLICATION_DATA {
                // TLS 1.3: client might send Application Data (Finished) directly
                // Check if this is a proxy frame or a TLS handshake-continuation
                match decode_frame(hmac_key, ct, &payload) {
                    FrameDecodeResult::ProxyData(_) => {
                        // Client started sending proxy data — handshake must be done.
                        // Process this initial proxy frame + start the data phase.
                        return handle_data_phase_with_initial(
                            client,
                            cover_server,
                            hmac_key,
                            payload,
                            auth,
                            dns,
                            fwd,
                            ctx,
                            peer_addr,
                        )
                        .await;
                    }
                    _ => {
                        // Regular TLS handshake continuation (encrypted Finished)
                        write_tls_record(&mut cover_server, ct, &payload).await?;
                        client_handshake_done = true;
                    }
                }
            } else {
                // Forward other handshake records
                write_tls_record(&mut cover_server, ct, &payload).await?;
            }
        }
    }

    debug!("ShadowTLS: handshake relay complete, entering data phase");

    // Phase 2: Data phase — demux proxy frames from cover traffic
    handle_data_phase(
        client,
        cover_server,
        hmac_key,
        auth,
        dns,
        fwd,
        ctx,
        peer_addr,
    )
    .await
}

/// Data phase: read TLS records from the client, check HMAC, and dispatch.
///
/// Proxy frames are collected and fed into the Prisma handler via an
/// in-memory duplex stream. The handler writes response data which we
/// wrap in HMAC-tagged TLS records and send back to the client.
#[allow(clippy::too_many_arguments)]
async fn handle_data_phase(
    client: TcpStream,
    cover_server: TcpStream,
    hmac_key: &[u8; 32],
    auth: AuthStore,
    dns: DnsCache,
    fwd: prisma_core::config::server::PortForwardingConfig,
    ctx: ServerContext,
    peer_addr: String,
) -> Result<()> {
    handle_data_phase_with_initial(
        client,
        cover_server,
        hmac_key,
        Vec::new(),
        auth,
        dns,
        fwd,
        ctx,
        peer_addr,
    )
    .await
}

/// Data phase with an optional initial proxy frame payload that was already
/// extracted during the handshake relay (when the first client Application
/// Data record happens to be a proxy frame).
#[allow(clippy::too_many_arguments)]
async fn handle_data_phase_with_initial(
    client: TcpStream,
    _cover_server: TcpStream,
    hmac_key: &[u8; 32],
    initial_payload: Vec<u8>,
    auth: AuthStore,
    dns: DnsCache,
    fwd: prisma_core::config::server::PortForwardingConfig,
    ctx: ServerContext,
    peer_addr: String,
) -> Result<()> {
    // Create an in-memory duplex stream to bridge the ShadowTLS transport
    // with the Prisma protocol handler. The handler reads/writes from one
    // end, and we read/write TLS-framed data on the other.
    let (handler_stream, mut our_stream) = tokio::io::duplex(65536);

    // Spawn the Prisma handler on the handler_stream end
    let handler_auth = auth.clone();
    let handler_dns = dns.clone();
    let handler_fwd = fwd.clone();
    let handler_ctx = ctx.clone();
    let handler_peer = peer_addr.clone();
    let handler_task = tokio::spawn(async move {
        if let Err(e) = handler::handle_generic_connection(
            handler_stream,
            handler_auth,
            handler_dns,
            handler_fwd,
            handler_ctx,
            handler_peer,
            prisma_core::state::Transport::ShadowTls,
        )
        .await
        {
            debug!("ShadowTLS handler error: {}", e);
        }
    });

    // If we have an initial proxy payload, write it to the handler immediately
    if !initial_payload.is_empty() {
        // Decode the HMAC tag from the record payload
        if initial_payload.len() >= HMAC_TAG_SIZE {
            let proxy_data = &initial_payload[HMAC_TAG_SIZE..];
            our_stream.write_all(proxy_data).await?;
        }
    }

    let (mut client_read, mut client_write) = client.into_split();
    let (mut our_read, mut our_write) = tokio::io::split(our_stream);

    let hmac_key_c2s = *hmac_key;
    let hmac_key_s2c = *hmac_key;

    // Task: client -> handler (read TLS records, extract proxy data, write to handler)
    let c2s = tokio::spawn(async move {
        loop {
            let record = read_tls_record(&mut client_read).await;
            match record {
                Ok((ct, payload)) => {
                    match decode_frame(&hmac_key_c2s, ct, &payload) {
                        FrameDecodeResult::ProxyData(data) => {
                            if our_write.write_all(&data).await.is_err() {
                                break;
                            }
                            if our_write.flush().await.is_err() {
                                break;
                            }
                        }
                        FrameDecodeResult::CoverTraffic(_) => {
                            // Silently discard cover traffic from client
                            debug!("ShadowTLS: discarding cover traffic from client");
                        }
                        FrameDecodeResult::Handshake(_) => {
                            // Unexpected handshake record in data phase — ignore
                            debug!("ShadowTLS: unexpected handshake record in data phase");
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Task: handler -> client (read from handler, wrap in TLS proxy frames, send to client)
    let s2c = tokio::spawn(async move {
        let mut buf = vec![0u8; MAX_PROXY_PAYLOAD];
        loop {
            match our_read.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let frame = encode_proxy_frame(&hmac_key_s2c, &buf[..n]);
                    if client_write.write_all(&frame).await.is_err() {
                        break;
                    }
                    if client_write.flush().await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Wait for either direction to finish
    tokio::select! {
        _ = c2s => {},
        _ = s2c => {},
        _ = handler_task => {},
    }

    Ok(())
}
