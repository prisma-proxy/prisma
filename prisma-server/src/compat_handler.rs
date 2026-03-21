//! Handler for compatibility protocol (VMess/VLESS/Shadowsocks/Trojan) connections.
//!
//! Parses the incoming connection through the appropriate compat protocol handler,
//! extracts the destination, and feeds it into the existing outbound/relay infrastructure.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tracing::{debug, info, warn};
use uuid::Uuid;

use prisma_core::cache::DnsCache;
use prisma_core::config::server::InboundConfig;
use prisma_core::protocol::compat::trojan::{self, TrojanAuthResult, TrojanClient};
use prisma_core::protocol::compat::vless::{self, VlessClient};
use prisma_core::protocol::compat::vmess::{self, VMessClient};
use prisma_core::protocol::compat::{self, CompatProtocol};
use prisma_core::state::{ConnectionInfo, SessionMode, Transport};

use crate::outbound;
use crate::state::ServerContext;

/// Handle an incoming connection on a compat protocol inbound.
///
/// This function reads the protocol header, authenticates the client,
/// establishes the outbound connection, and relays data bidirectionally.
pub async fn handle_compat_connection<S>(
    mut stream: S,
    config: &InboundConfig,
    dns_cache: DnsCache,
    ctx: ServerContext,
    peer_addr: String,
) -> Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let protocol: CompatProtocol = config
        .protocol
        .parse()
        .map_err(|_| anyhow::anyhow!("Unknown protocol: {}", config.protocol))?;

    // Read initial data for protocol parsing
    let mut header_buf = vec![0u8; 4096];
    let n = stream.read(&mut header_buf).await?;
    if n == 0 {
        return Err(anyhow::anyhow!("Connection closed before header"));
    }
    let header_data = &header_buf[..n];

    let (compat_request, response_data) = match protocol {
        CompatProtocol::VMess => handle_vmess_header(header_data, config)?,
        CompatProtocol::Vless => handle_vless_header(header_data, config)?,
        CompatProtocol::Shadowsocks => handle_shadowsocks_header(header_data, config)?,
        CompatProtocol::Trojan => {
            match handle_trojan_header(header_data, config, &peer_addr) {
                Ok(result) => result,
                Err(TrojanHandlerError::Fallback {
                    raw_data,
                    fallback_addr,
                }) => {
                    // Redirect to fallback
                    debug!(
                        tag = %config.tag,
                        fallback = %fallback_addr,
                        peer = %peer_addr,
                        "Trojan auth failed, redirecting to fallback"
                    );
                    return relay_to_fallback(stream, &raw_data, &fallback_addr).await;
                }
                Err(TrojanHandlerError::Protocol(e)) => return Err(e),
            }
        }
    };

    let dest = &compat_request.destination;

    info!(
        protocol = %protocol,
        tag = %config.tag,
        dest = %dest,
        peer = %peer_addr,
        "Compat connection established"
    );

    // Send protocol response header if needed
    if !response_data.is_empty() {
        stream.write_all(&response_data).await?;
    }

    // Track connection
    let session_id = Uuid::new_v4();
    let bytes_up = Arc::new(AtomicU64::new(0));
    let bytes_down = Arc::new(AtomicU64::new(0));

    let conn_info = ConnectionInfo {
        session_id,
        client_id: None,
        client_name: Some(format!("{}/{}", protocol, config.tag)),
        peer_addr: peer_addr.clone(),
        transport: Transport::Tcp,
        mode: SessionMode::Proxy,
        connected_at: Utc::now(),
        bytes_up: bytes_up.clone(),
        bytes_down: bytes_down.clone(),
        destination: Some(dest.to_string()),
        matched_rule: None,
    };
    ctx.state
        .connections
        .write()
        .await
        .insert(session_id, conn_info);

    // Connect to destination
    let outbound = match outbound::connect(dest, &dns_cache).await {
        Ok(s) => s,
        Err(e) => {
            ctx.state.connections.write().await.remove(&session_id);
            return Err(e);
        }
    };

    let (mut out_read, mut out_write) = outbound.into_split();

    // Write initial payload to outbound (data that came after the protocol header)
    if !compat_request.initial_payload.is_empty() {
        debug!(
            bytes = compat_request.initial_payload.len(),
            "Writing initial payload to outbound"
        );
        out_write.write_all(&compat_request.initial_payload).await?;
    }

    let (mut stream_read, mut stream_write) = tokio::io::split(stream);

    let metrics = ctx.state.metrics.clone();
    let bytes_up_task = bytes_up.clone();
    let bytes_down_relay = bytes_down.clone();
    let metrics_up = metrics.clone();
    let metrics_down = metrics;

    // Upload: client -> destination
    let upload = tokio::spawn(async move {
        let mut buf = [0u8; 32768];
        loop {
            match stream_read.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    bytes_up_task.fetch_add(n as u64, Ordering::Relaxed);
                    metrics_up
                        .total_bytes_up
                        .fetch_add(n as u64, Ordering::Relaxed);
                    if out_write.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = out_write.shutdown().await;
    });

    // Download: destination -> client
    let download = tokio::spawn(async move {
        let mut buf = [0u8; 32768];
        loop {
            match out_read.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    bytes_down_relay.fetch_add(n as u64, Ordering::Relaxed);
                    metrics_down
                        .total_bytes_down
                        .fetch_add(n as u64, Ordering::Relaxed);
                    if stream_write.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = stream_write.shutdown().await;
    });

    tokio::select! {
        _ = upload => {},
        _ = download => {},
    }

    // Clean up connection tracking
    ctx.state.connections.write().await.remove(&session_id);

    debug!(
        session_id = %session_id,
        protocol = %protocol,
        tag = %config.tag,
        up = bytes_up.load(Ordering::Relaxed),
        down = bytes_down.load(Ordering::Relaxed),
        "Compat connection closed"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// VMess handler
// ---------------------------------------------------------------------------

/// Parse a VMess header and authenticate using full AEAD decryption.
fn handle_vmess_header(
    data: &[u8],
    config: &InboundConfig,
) -> Result<(compat::CompatRequest, Vec<u8>)> {
    // Build client list from config
    let clients: Vec<VMessClient> = config
        .settings
        .clients
        .iter()
        .filter_map(|c| {
            let uuid = Uuid::parse_str(c.id.as_deref()?).ok()?;
            Some(VMessClient {
                uuid,
                alter_id: c.alter_id.unwrap_or(0),
            })
        })
        .collect();

    let disable_insecure = config.settings.disable_insecure_encryption;

    // Full AEAD decode: auth_id verification + header length + header payload decryption
    let (parsed, _cmd_key, _consumed) =
        vmess::decode_vmess_request(data, &clients, 120, disable_insecure)
            .map_err(|e| anyhow::anyhow!("VMess: {}", e))?;

    info!(
        security = ?parsed.security,
        option = parsed.option,
        dest = %parsed.destination,
        "VMess client authenticated"
    );

    // Build encrypted response header
    let resp_key = vmess::derive_response_key(&parsed.data_key);
    let resp_iv = vmess::derive_response_iv(&parsed.data_iv);
    let resp_header = vmess::build_response_header(parsed.response_header);

    let response = vmess::encrypt_response_header(&resp_key, &resp_iv, &resp_header)
        .map_err(|e| anyhow::anyhow!("VMess response encrypt: {}", e))?;

    Ok((parsed.into_compat_request(), response))
}

// ---------------------------------------------------------------------------
// VLESS handler
// ---------------------------------------------------------------------------

/// Parse a VLESS header and authenticate.
fn handle_vless_header(
    data: &[u8],
    config: &InboundConfig,
) -> Result<(compat::CompatRequest, Vec<u8>)> {
    // Build client list
    let clients: Vec<VlessClient> = config
        .settings
        .clients
        .iter()
        .filter_map(|c| {
            let uuid = Uuid::parse_str(c.id.as_deref()?).ok()?;
            Some(VlessClient {
                uuid,
                flow: vless::VlessFlow::parse_flow(c.flow.as_deref().unwrap_or("")),
            })
        })
        .collect();

    let (request, _consumed) = vless::parse_vless_request(data)?;

    // Verify UUID
    let flow = vless::verify_uuid(&request.uuid, &clients)
        .ok_or_else(|| anyhow::anyhow!("VLESS UUID not authorized: {}", request.uuid))?;

    info!(
        client = %request.uuid,
        flow = %flow.as_str(),
        is_mux = request.is_mux,
        "VLESS client authenticated"
    );

    // Build response with flow addon if vision is active
    let response = if flow == vless::VlessFlow::XtlsRprxVision {
        let addon = vless::VlessAddon {
            flow: vless::VlessFlow::XtlsRprxVision,
            seed: None,
        };
        vless::build_vless_response_with_addon(&addon)
    } else {
        vless::build_vless_response()
    };

    Ok((request.into_compat_request(), response))
}

// ---------------------------------------------------------------------------
// Shadowsocks handler
// ---------------------------------------------------------------------------

/// Parse a Shadowsocks header with full AEAD decryption.
fn handle_shadowsocks_header(
    data: &[u8],
    config: &InboundConfig,
) -> Result<(compat::CompatRequest, Vec<u8>)> {
    let method_str = config
        .settings
        .method
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("Shadowsocks: method not configured"))?;
    let password = config
        .settings
        .password
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("Shadowsocks: password not configured"))?;

    let cipher =
        prisma_core::protocol::compat::shadowsocks::ShadowsocksCipher::parse_method(method_str)
            .ok_or_else(|| anyhow::anyhow!("Unknown Shadowsocks cipher: {}", method_str))?;

    let ss_config = prisma_core::protocol::compat::shadowsocks::ShadowsocksConfig::with_udp(
        cipher,
        password,
        config.settings.udp,
    );

    // Full AEAD decryption: extract salt, derive subkey, decrypt first chunk, parse address
    let (request, _tcp_cipher, _consumed) =
        prisma_core::protocol::compat::shadowsocks::decode_ss_tcp_request(data, &ss_config)
            .map_err(|e| anyhow::anyhow!("Shadowsocks: {}", e))?;

    info!(
        cipher = %cipher.as_str(),
        dest = %request.destination,
        "Shadowsocks connection decoded"
    );

    // No response header for Shadowsocks
    Ok((request, Vec::new()))
}

// ---------------------------------------------------------------------------
// Trojan handler
// ---------------------------------------------------------------------------

/// Error type for Trojan handler that can signal fallback.
enum TrojanHandlerError {
    /// Authentication failed, redirect to fallback.
    Fallback {
        raw_data: Vec<u8>,
        fallback_addr: String,
    },
    /// Protocol-level error.
    Protocol(anyhow::Error),
}

/// Parse a Trojan header and authenticate with fallback support.
fn handle_trojan_header(
    data: &[u8],
    config: &InboundConfig,
    peer_addr: &str,
) -> Result<(compat::CompatRequest, Vec<u8>), TrojanHandlerError> {
    // Build client list
    let clients: Vec<TrojanClient> = config
        .settings
        .clients
        .iter()
        .filter_map(|c| {
            let password = c.password.as_deref()?;
            Some(TrojanClient::new(password))
        })
        .collect();

    // Use try_authenticate for fallback support
    match trojan::try_authenticate(data, &clients) {
        Ok(TrojanAuthResult::Authenticated {
            client_index,
            request,
        }) => {
            let client_email = config.settings.clients[client_index]
                .email
                .as_deref()
                .unwrap_or("unknown");
            info!(
                client = %client_email,
                peer = %peer_addr,
                "Trojan client authenticated"
            );
            Ok((request.into_compat_request(), Vec::new()))
        }
        Ok(TrojanAuthResult::Fallback { raw_data }) => {
            if let Some(ref fallback_addr) = config.settings.fallback_addr {
                Err(TrojanHandlerError::Fallback {
                    raw_data,
                    fallback_addr: fallback_addr.clone(),
                })
            } else {
                warn!(
                    tag = %config.tag,
                    peer = %peer_addr,
                    "Trojan auth failed, no fallback configured"
                );
                Err(TrojanHandlerError::Protocol(anyhow::anyhow!(
                    "Trojan password not authorized"
                )))
            }
        }
        Err(e) => Err(TrojanHandlerError::Protocol(anyhow::anyhow!(
            "Trojan parse error: {}",
            e
        ))),
    }
}

/// Relay data to a fallback endpoint (for Trojan auth failure camouflage).
async fn relay_to_fallback<S>(
    client_stream: S,
    initial_data: &[u8],
    fallback_addr: &str,
) -> Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let mut fallback = TcpStream::connect(fallback_addr)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to connect to fallback {}: {}", fallback_addr, e))?;

    // Send the initial data that we already read
    fallback.write_all(initial_data).await?;

    let (mut fb_read, mut fb_write) = fallback.into_split();
    let (mut cl_read, mut cl_write) = tokio::io::split(client_stream);

    let up = tokio::spawn(async move {
        let mut buf = [0u8; 32768];
        loop {
            match cl_read.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if fb_write.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                }
            }
        }
        let _ = fb_write.shutdown().await;
    });

    let down = tokio::spawn(async move {
        let mut buf = [0u8; 32768];
        loop {
            match fb_read.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if cl_write.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                }
            }
        }
        let _ = cl_write.shutdown().await;
    });

    tokio::select! {
        _ = up => {},
        _ = down => {},
    }

    Ok(())
}
