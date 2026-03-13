use anyhow::Result;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tracing::{debug, warn};

use prisma_core::protocol::codec::*;
use prisma_core::protocol::types::*;
use prisma_core::types::{MAX_FRAME_SIZE, PROTOCOL_VERSION_V2};

use crate::tunnel::TunnelConnection;

/// Bidirectional relay between SOCKS5 client and encrypted tunnel.
///
/// SOCKS5 client ↔ [plain TCP] ↔ relay ↔ [encrypted frames] ↔ tunnel
pub async fn relay(socks_stream: TcpStream, tunnel: TunnelConnection) -> Result<()> {
    let (mut socks_read, mut socks_write) = socks_stream.into_split();
    let (mut tunnel_read, mut tunnel_write) = tokio::io::split(tunnel.stream);

    let cipher: Arc<dyn prisma_core::crypto::aead::AeadCipher> = Arc::from(tunnel.cipher);

    // SOCKS5 → tunnel: read raw data, encrypt into frames
    let mut client_keys = tunnel.session_keys.clone();
    let use_padding = client_keys.protocol_version >= PROTOCOL_VERSION_V2;
    let padding_range = client_keys.padding_range;
    let cipher_s2t = cipher.clone();
    let socks_to_tunnel = async move {
        let mut buf = vec![0u8; 8192];
        loop {
            match socks_read.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let flags = if use_padding { FLAG_PADDED } else { 0 };
                    let frame = DataFrame {
                        command: Command::Data(buf[..n].to_vec()),
                        flags,
                        stream_id: 0,
                    };
                    let frame_bytes = if use_padding {
                        encode_data_frame_padded(&frame, &padding_range)
                    } else {
                        encode_data_frame(&frame)
                    };
                    let nonce = client_keys.next_client_nonce();
                    match encrypt_frame(cipher_s2t.as_ref(), &nonce, &frame_bytes) {
                        Ok(encrypted) => {
                            let len = (encrypted.len() as u16).to_be_bytes();
                            if tunnel_write.write_all(&len).await.is_err() {
                                break;
                            }
                            if tunnel_write.write_all(&encrypted).await.is_err() {
                                break;
                            }
                        }
                        Err(e) => {
                            warn!("Encrypt error: {}", e);
                            break;
                        }
                    }
                }
                Err(_) => break,
            }
        }
    };

    // tunnel → SOCKS5: decrypt frames, send raw data
    let cipher_t2s = cipher.clone();
    let tunnel_to_socks = async move {
        let mut frame_buf = Vec::with_capacity(MAX_FRAME_SIZE);
        loop {
            let mut len_buf = [0u8; 2];
            if tunnel_read.read_exact(&mut len_buf).await.is_err() {
                break;
            }
            let frame_len = u16::from_be_bytes(len_buf) as usize;
            if frame_len > MAX_FRAME_SIZE {
                warn!(size = frame_len, max = MAX_FRAME_SIZE, "Frame too large");
                break;
            }
            frame_buf.resize(frame_len, 0);
            if tunnel_read
                .read_exact(&mut frame_buf[..frame_len])
                .await
                .is_err()
            {
                break;
            }

            match decrypt_frame(cipher_t2s.as_ref(), &frame_buf[..frame_len]) {
                Ok((plaintext, _)) => match decode_data_frame(&plaintext) {
                    Ok(frame) => match frame.command {
                        Command::Data(data) => {
                            if socks_write.write_all(&data).await.is_err() {
                                break;
                            }
                        }
                        Command::Close => break,
                        _ => {}
                    },
                    Err(e) => {
                        warn!("Frame decode error: {}", e);
                        break;
                    }
                },
                Err(e) => {
                    warn!("Decrypt error: {}", e);
                    break;
                }
            }
        }
    };

    tokio::select! {
        _ = socks_to_tunnel => {},
        _ = tunnel_to_socks => {},
    }

    debug!("Relay session ended");
    Ok(())
}

/// Relay data between a smoltcp TCP socket (via TUN) and an encrypted PrismaVeil tunnel.
///
/// Reads data from the smoltcp socket, encrypts it, and sends through the tunnel.
/// Reads encrypted data from the tunnel, decrypts it, and writes to the smoltcp socket.
pub async fn relay_tun_tcp_encrypted<R, W>(
    handle: smoltcp::iface::SocketHandle,
    stack: Arc<tokio::sync::Mutex<crate::tun::tcp_stack::TcpStack>>,
    mut tunnel_read: R,
    mut tunnel_write: W,
    cipher: Box<dyn prisma_core::crypto::aead::AeadCipher>,
    mut session_keys: prisma_core::protocol::types::SessionKeys,
) -> Result<()>
where
    R: tokio::io::AsyncRead + Unpin + Send,
    W: tokio::io::AsyncWrite + Unpin + Send,
{
    let cipher: Arc<dyn prisma_core::crypto::aead::AeadCipher> = Arc::from(cipher);
    let use_padding = session_keys.protocol_version >= PROTOCOL_VERSION_V2;
    let padding_range = session_keys.padding_range;

    // Poll interval for checking smoltcp socket state
    let mut interval = tokio::time::interval(std::time::Duration::from_millis(5));

    let mut local_buf = vec![0u8; 32768];
    let mut frame_buf = Vec::with_capacity(MAX_FRAME_SIZE);

    loop {
        tokio::select! {
            _ = interval.tick() => {
                // Read data and check close state in a single lock acquisition
                let (n, is_closed) = {
                    let mut s = stack.lock().await;
                    let n = s.read_from_socket(handle, &mut local_buf);
                    let closed = s.is_closed(handle);
                    (n, closed)
                };
                if n > 0 {
                    let flags = if use_padding { FLAG_PADDED } else { 0 };
                    let frame = DataFrame {
                        command: Command::Data(local_buf[..n].to_vec()),
                        flags,
                        stream_id: 0,
                    };
                    let frame_bytes = if use_padding {
                        encode_data_frame_padded(&frame, &padding_range)
                    } else {
                        encode_data_frame(&frame)
                    };
                    let nonce = session_keys.next_client_nonce();
                    match encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes) {
                        Ok(encrypted) => {
                            let len = (encrypted.len() as u16).to_be_bytes();
                            if tunnel_write.write_all(&len).await.is_err() { break; }
                            if tunnel_write.write_all(&encrypted).await.is_err() { break; }
                        }
                        Err(e) => {
                            warn!("TUN relay encrypt error: {}", e);
                            break;
                        }
                    }
                }
                if is_closed { break; }
            }
            // Read encrypted data from tunnel → decrypt → write to smoltcp socket
            result = async {
                let mut len_buf = [0u8; 2];
                tunnel_read.read_exact(&mut len_buf).await?;
                let frame_len = u16::from_be_bytes(len_buf) as usize;
                if frame_len > MAX_FRAME_SIZE {
                    return Err(anyhow::anyhow!("Frame too large"));
                }
                frame_buf.resize(frame_len, 0);
                tunnel_read.read_exact(&mut frame_buf[..frame_len]).await?;
                Ok::<_, anyhow::Error>(frame_len)
            } => {
                match result {
                    Ok(frame_len) => {
                        match decrypt_frame(cipher.as_ref(), &frame_buf[..frame_len]) {
                            Ok((plaintext, _)) => match decode_data_frame(&plaintext) {
                                Ok(frame) => match frame.command {
                                    Command::Data(data) => {
                                        let mut s = stack.lock().await;
                                        s.write_to_socket(handle, &data);
                                    }
                                    Command::Close => break,
                                    _ => {}
                                },
                                Err(e) => {
                                    warn!("TUN relay frame decode error: {}", e);
                                    break;
                                }
                            },
                            Err(e) => {
                                warn!("TUN relay decrypt error: {}", e);
                                break;
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        }
    }

    debug!("TUN TCP relay ended");
    Ok(())
}

/// Direct relay between local client and outbound connection (no encryption).
/// Used when routing rules select "direct" action.
pub async fn relay_direct(local: TcpStream, outbound: TcpStream) -> Result<()> {
    let (mut local_read, mut local_write) = local.into_split();
    let (mut out_read, mut out_write) = outbound.into_split();

    let l2o = async move {
        let _ = tokio::io::copy(&mut local_read, &mut out_write).await;
    };
    let o2l = async move {
        let _ = tokio::io::copy(&mut out_read, &mut local_write).await;
    };

    tokio::select! {
        _ = l2o => {},
        _ = o2l => {},
    }

    debug!("Direct relay session ended");
    Ok(())
}
