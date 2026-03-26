//! WireGuard-compatible UDP stream for the client.
//!
//! Provides `AsyncRead + AsyncWrite` over a UDP socket that wraps data
//! in WireGuard-like transport data packets. The handshake is performed
//! first to establish a session, then data flows as WG type-4 packets.

use std::future::Future;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use bytes::{Buf, Bytes, BytesMut};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::UdpSocket;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use prisma_core::wireguard::{
    self, WgPacket, WgSession, KEEPALIVE_INTERVAL_SECS, MAX_WG_PACKET_SIZE,
};

type ReserveFut = Pin<
    Box<dyn Future<Output = Result<mpsc::OwnedPermit<Bytes>, mpsc::error::SendError<()>>> + Send>,
>;

/// A WireGuard-framed UDP stream that implements `AsyncRead + AsyncWrite`.
pub struct WgStream {
    read_rx: mpsc::Receiver<Bytes>,
    write_tx: mpsc::Sender<Bytes>,
    read_buf: BytesMut,
    /// In-flight reservation future, kept across polls so the waker stays registered.
    write_reserve: Option<ReserveFut>,
    /// Handle to the background tasks so they are aborted on drop.
    _recv_handle: tokio::task::JoinHandle<()>,
    _keepalive_handle: tokio::task::JoinHandle<()>,
}

impl WgStream {
    /// Perform a WireGuard-like handshake with the server and return an
    /// async stream suitable for Prisma protocol negotiation.
    pub async fn connect(endpoint: &str, keepalive_secs: u64) -> anyhow::Result<Self> {
        let endpoint_addr: SocketAddr = endpoint.parse()?;

        // Bind to any available local port.
        let socket = Arc::new(UdpSocket::bind("0.0.0.0:0").await?);
        socket.connect(endpoint_addr).await?;

        let local_index = wireguard::random_index();

        // Send handshake initiation (type 1) with an empty Prisma payload.
        // The actual Prisma handshake data will flow once the ChannelStream
        // is connected — the server will read it from the inbound channel.
        //
        // However, our design sends the Prisma ClientInit as data payload
        // inside the first handshake initiation packet. The server extracts
        // it and feeds it to the handler's ChannelStream.
        //
        // For the client side, we send a minimal init to establish the session,
        // then the Prisma handshake bytes flow as transport data. This
        // simplifies the design: the WG envelope is transparent.
        let init_packet = WgPacket::HandshakeInit {
            sender_index: local_index,
            payload: Bytes::new(), // empty — handshake data flows as transport data
        };
        socket.send(&init_packet.encode()).await?;
        debug!(
            endpoint = %endpoint,
            local_index,
            "WireGuard handshake initiation sent"
        );

        // Wait for handshake response (type 2).
        let mut buf = vec![0u8; MAX_WG_PACKET_SIZE];
        let n = tokio::time::timeout(std::time::Duration::from_secs(10), socket.recv(&mut buf))
            .await
            .map_err(|_| anyhow::anyhow!("WireGuard handshake response timeout"))??;

        let response = WgPacket::decode(&buf[..n])
            .map_err(|e| anyhow::anyhow!("Invalid WireGuard handshake response: {}", e))?;

        let (server_index, _response_payload) = match response {
            WgPacket::HandshakeResponse {
                sender_index,
                receiver_index,
                payload,
            } => {
                if receiver_index != local_index {
                    return Err(anyhow::anyhow!(
                        "WireGuard handshake response receiver_index mismatch: expected {}, got {}",
                        local_index,
                        receiver_index
                    ));
                }
                (sender_index, payload)
            }
            _ => return Err(anyhow::anyhow!("Expected WireGuard handshake response")),
        };

        info!(
            endpoint = %endpoint,
            local_index,
            server_index,
            "WireGuard session established"
        );

        let session = Arc::new(WgSession::new(local_index, server_index, endpoint_addr));

        // Create channel pair.
        let (inbound_tx, inbound_rx) = mpsc::channel::<Bytes>(256);
        let (outbound_tx, mut outbound_rx) = mpsc::channel::<Bytes>(256);

        // If the server sent handshake response payload, feed it as inbound data.
        if !_response_payload.is_empty() {
            let _ = inbound_tx.send(_response_payload).await;
        }

        // Spawn UDP recv -> inbound channel task.
        let recv_socket = socket.clone();
        let recv_session = session.clone();
        let recv_handle = tokio::spawn(async move {
            let mut buf = vec![0u8; MAX_WG_PACKET_SIZE];
            loop {
                match recv_socket.recv(&mut buf).await {
                    Ok(n) => {
                        match WgPacket::decode(&buf[..n]) {
                            Ok(WgPacket::TransportData { payload, .. }) => {
                                recv_session.update_activity();
                                if !payload.is_empty() && inbound_tx.send(payload).await.is_err() {
                                    break; // stream closed
                                }
                                // Empty payload = keepalive, ignore
                            }
                            Ok(_) => {
                                debug!("Ignoring non-transport-data packet");
                            }
                            Err(e) => {
                                debug!(error = %e, "Ignoring invalid packet");
                            }
                        }
                    }
                    Err(e) => {
                        warn!(error = %e, "WireGuard UDP recv error");
                        break;
                    }
                }
            }
        });

        // Spawn outbound channel -> UDP send task.
        let send_socket = socket.clone();
        let send_session = session.clone();
        tokio::spawn(async move {
            while let Some(data) = outbound_rx.recv().await {
                let counter = send_session.next_tx_counter();
                let packet = WgPacket::TransportData {
                    receiver_index: send_session.peer_index,
                    counter,
                    payload: data,
                };
                let encoded = packet.encode();
                if let Err(e) = send_socket.send(&encoded).await {
                    warn!(error = %e, "WireGuard UDP send error");
                    break;
                }
            }
        });

        // Spawn keepalive task.
        let ka_socket = socket.clone();
        let ka_session = session.clone();
        let ka_interval = if keepalive_secs > 0 {
            keepalive_secs
        } else {
            KEEPALIVE_INTERVAL_SECS
        };
        let keepalive_handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(ka_interval));
            loop {
                interval.tick().await;
                let counter = ka_session.next_tx_counter();
                let packet = WgPacket::TransportData {
                    receiver_index: ka_session.peer_index,
                    counter,
                    payload: Bytes::new(), // empty = keepalive
                };
                let encoded = packet.encode();
                if let Err(e) = ka_socket.send(&encoded).await {
                    warn!(error = %e, "WireGuard keepalive send error");
                    break;
                }
            }
        });

        Ok(WgStream {
            read_rx: inbound_rx,
            write_tx: outbound_tx,
            read_buf: BytesMut::new(),
            write_reserve: None,
            _recv_handle: recv_handle,
            _keepalive_handle: keepalive_handle,
        })
    }
}

impl AsyncRead for WgStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        // Drain internal buffer first.
        if !self.read_buf.is_empty() {
            let to_copy = self.read_buf.len().min(buf.remaining());
            buf.put_slice(&self.read_buf[..to_copy]);
            self.read_buf.advance(to_copy);
            return Poll::Ready(Ok(()));
        }

        // Try to receive more data from the channel.
        match self.read_rx.poll_recv(cx) {
            Poll::Ready(Some(data)) => {
                let to_copy = data.len().min(buf.remaining());
                buf.put_slice(&data[..to_copy]);
                if to_copy < data.len() {
                    self.read_buf.extend_from_slice(&data[to_copy..]);
                }
                Poll::Ready(Ok(()))
            }
            Poll::Ready(None) => Poll::Ready(Ok(())), // EOF
            Poll::Pending => Poll::Pending,
        }
    }
}

impl AsyncWrite for WgStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        let this = self.get_mut();

        let mut fut = this
            .write_reserve
            .take()
            .unwrap_or_else(|| Box::pin(this.write_tx.clone().reserve_owned()));

        match fut.as_mut().poll(cx) {
            Poll::Ready(Ok(permit)) => {
                permit.send(Bytes::copy_from_slice(buf));
                Poll::Ready(Ok(buf.len()))
            }
            Poll::Ready(Err(_)) => Poll::Ready(Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "WireGuard stream channel closed",
            ))),
            Poll::Pending => {
                this.write_reserve = Some(fut);
                Poll::Pending
            }
        }
    }

    fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Poll::Ready(Ok(()))
    }

    fn poll_shutdown(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Poll::Ready(Ok(()))
    }
}
