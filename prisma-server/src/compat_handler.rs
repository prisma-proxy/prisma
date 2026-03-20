//! Handler for compatibility protocol (VMess/VLESS/Shadowsocks/Trojan) connections.
//!
//! Parses the incoming connection through the appropriate compat protocol handler,
//! extracts the destination, and feeds it into the existing outbound/relay infrastructure.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tracing::{debug, info};
use uuid::Uuid;

use prisma_core::cache::DnsCache;
use prisma_core::config::server::InboundConfig;
use prisma_core::protocol::compat::trojan::{self, TrojanClient};
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
        CompatProtocol::Trojan => handle_trojan_header(header_data, config)?,
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

/// Parse a VMess header and authenticate.
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

    if data.len() < 16 {
        return Err(anyhow::anyhow!("VMess header too short"));
    }

    // Extract auth_id (first 16 bytes)
    let mut auth_id = [0u8; 16];
    auth_id.copy_from_slice(&data[..16]);

    // Verify against known clients (120 second window)
    let matched_uuid = vmess::verify_auth_id(&auth_id, &clients, 120)
        .ok_or_else(|| anyhow::anyhow!("VMess authentication failed"))?;

    info!(client = %matched_uuid, "VMess client authenticated");

    // The AEAD header follows the auth_id. In a full wire-compatible deployment,
    // we would decrypt the AEAD-encrypted header using keys derived from the
    // command key. The auth verification above is functional and correct.
    //
    // For AEAD header decryption, we need the encrypted length (2+16 bytes)
    // followed by the encrypted header payload. The keys are:
    //   length_key = KDF(cmd_key, "VMess AEAD KDF", auth_id, "length")
    //   header_key = KDF(cmd_key, "VMess AEAD KDF", auth_id, "header")
    //
    // This is a protocol-level limitation note: full VMess AEAD relay requires
    // implementing the KDF chain specified in v2fly/v2ray-core.
    if data.len() < 40 {
        return Err(anyhow::anyhow!(
            "VMess AEAD header too short for parsing (auth OK for {})",
            matched_uuid
        ));
    }

    // Return an indication that VMess AEAD decryption was authenticated but
    // the full header decryption requires the v2fly KDF chain.
    Err(anyhow::anyhow!(
        "VMess AEAD header decryption not yet fully wired (auth OK for {})",
        matched_uuid
    ))
}

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
    let _flow = vless::verify_uuid(&request.uuid, &clients)
        .ok_or_else(|| anyhow::anyhow!("VLESS UUID not authorized: {}", request.uuid))?;

    info!(client = %request.uuid, "VLESS client authenticated");

    let response = vless::build_vless_response();
    Ok((request.into_compat_request(), response))
}

/// Parse a Shadowsocks header.
fn handle_shadowsocks_header(
    data: &[u8],
    config: &InboundConfig,
) -> Result<(compat::CompatRequest, Vec<u8>)> {
    let method_str = config
        .settings
        .method
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("Shadowsocks: method not configured"))?;
    let _password = config
        .settings
        .password
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("Shadowsocks: password not configured"))?;

    // Verify the stream has enough data for a valid Shadowsocks AEAD connection.
    let cipher =
        prisma_core::protocol::compat::shadowsocks::ShadowsocksCipher::parse_method(method_str)
            .ok_or_else(|| anyhow::anyhow!("Unknown Shadowsocks cipher: {}", method_str))?;

    let _header = prisma_core::protocol::compat::shadowsocks::parse_stream_header(data, cipher)?;

    // Full AEAD decryption would:
    // 1. Extract salt from stream header
    // 2. Derive subkey via HKDF with the PSK
    // 3. Decrypt length chunk with incrementing nonce
    // 4. Decrypt payload chunk
    // 5. Parse destination address from decrypted first payload
    //
    // Stream header parsing is validated above.
    Err(anyhow::anyhow!(
        "Shadowsocks AEAD decryption not yet fully wired (stream header parsed, cipher={})",
        cipher.as_str()
    ))
}

/// Parse a Trojan header and authenticate.
fn handle_trojan_header(
    data: &[u8],
    config: &InboundConfig,
) -> Result<(compat::CompatRequest, Vec<u8>)> {
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

    let request = trojan::parse_trojan_request(data)?;

    // Verify password
    let client_idx = trojan::verify_password(&request.password_hash, &clients)
        .ok_or_else(|| anyhow::anyhow!("Trojan password not authorized"))?;

    let client_email = config.settings.clients[client_idx]
        .email
        .as_deref()
        .unwrap_or("unknown");
    info!(client = %client_email, "Trojan client authenticated");

    // No response header for Trojan -- data flows immediately after auth
    Ok((request.into_compat_request(), Vec::new()))
}
