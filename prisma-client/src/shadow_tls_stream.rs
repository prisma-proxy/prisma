//! ShadowTLS v3 client stream.
//!
//! Wraps a TCP connection to a ShadowTLS server. Performs a real TLS handshake
//! (relayed through the server to a legitimate cover server), then multiplexes
//! proxy data in HMAC-authenticated TLS application data frames.
//!
//! Implements `AsyncRead + AsyncWrite` so it can be used as a `TransportStream`.

use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};

use bytes::BytesMut;
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

use prisma_core::shadow_tls::{
    decode_frame, derive_hmac_key, encode_proxy_frame, read_tls_record, FrameDecodeResult,
    MAX_PROXY_PAYLOAD,
};

use anyhow::Result;
use tracing::debug;

/// A ShadowTLS v3 client stream that wraps proxy data in TLS application data.
///
/// After the handshake is complete, reads/writes go through an internal duplex
/// channel that bridges async I/O with the TLS-framed TCP connection.
pub struct ShadowTlsClientStream {
    read_rx: mpsc::Receiver<Vec<u8>>,
    write_tx: mpsc::Sender<Vec<u8>>,
    /// Buffered data from a partially consumed receive.
    read_buf: BytesMut,
    /// Pending write reservation future for proper backpressure.
    write_reserve: Option<
        Pin<
            Box<
                dyn Future<Output = Result<mpsc::OwnedPermit<Vec<u8>>, mpsc::error::SendError<()>>>
                    + Send,
            >,
        >,
    >,
}

impl ShadowTlsClientStream {
    /// Connect to a ShadowTLS server and perform the TLS handshake relay.
    ///
    /// - `server_addr`: Address of the ShadowTLS server (host:port)
    /// - `password`: Pre-shared key (used to derive HMAC key)
    /// - `sni`: SNI for the cover server (sent in the TLS ClientHello)
    pub async fn connect(server_addr: &str, password: &str, sni: &str) -> Result<Self> {
        let hmac_key = derive_hmac_key(password);

        // Connect to the ShadowTLS server
        debug!(addr = %server_addr, sni = %sni, "ShadowTLS: connecting");
        let server = TcpStream::connect(server_addr).await?;

        // Build a TLS ClientHello for the cover server SNI.
        // We perform a real TLS handshake — the ShadowTLS server relays it
        // to the cover server, so DPI sees legitimate TLS.
        let tls_config = build_cover_tls_config(sni);
        let connector = tokio_rustls::TlsConnector::from(std::sync::Arc::new(tls_config));
        let server_name = rustls::pki_types::ServerName::try_from(sni.to_string())?;

        // We can't use the TLS connector directly on the TCP stream because
        // we need to keep the raw TCP stream for the post-handshake data phase.
        // Instead we'll manually drive the TLS handshake to completion, then
        // switch to raw framing.
        //
        // However, for simplicity and correctness, we'll use a different approach:
        // perform the TLS handshake through the ShadowTLS server (which relays it
        // to the cover server), let it complete, then discard the TLS session and
        // use raw HMAC-authenticated framing.
        //
        // We use tokio_rustls to handle the handshake. The server will see a
        // genuine TLS session. After completion, we extract the underlying TCP
        // stream and switch to the ShadowTLS v3 data protocol.

        let tls_stream = connector.connect(server_name, server).await?;
        debug!("ShadowTLS: TLS handshake complete with cover server");

        // Extract the underlying TCP stream. The TLS session is discarded —
        // from this point we use HMAC-authenticated framing.
        let (tcp_connection, _tls_session) = tls_stream.into_inner();

        // After the TLS handshake, the server knows we're a ShadowTLS client
        // because the handshake completed successfully through its relay.
        // Now switch to proxy framing mode.
        Self::start_data_phase(tcp_connection, hmac_key)
    }

    /// Start the data phase using raw TLS-framed HMAC-authenticated I/O.
    fn start_data_phase(tcp: TcpStream, hmac_key: [u8; 32]) -> Result<Self> {
        let (mut tcp_read, mut tcp_write) = tcp.into_split();
        let (read_tx, read_rx) = mpsc::channel::<Vec<u8>>(256);
        let (write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(256);

        // Task: TCP -> read channel (read TLS records, extract proxy data)
        let hmac_key_read = hmac_key;
        tokio::spawn(async move {
            while let Ok((ct, payload)) = read_tls_record(&mut tcp_read).await {
                match decode_frame(&hmac_key_read, ct, &payload) {
                    FrameDecodeResult::ProxyData(data) => {
                        if read_tx.send(data).await.is_err() {
                            break;
                        }
                    }
                    FrameDecodeResult::CoverTraffic(_) => {
                        // Discard cover traffic from the server
                    }
                    FrameDecodeResult::Handshake(_) => {
                        // Stale handshake record — ignore
                    }
                }
            }
        });

        // Task: write channel -> TCP (wrap proxy data in TLS frames)
        let hmac_key_write = hmac_key;
        tokio::spawn(async move {
            while let Some(data) = write_rx.recv().await {
                // Split into chunks that fit in a TLS record
                for chunk in data.chunks(MAX_PROXY_PAYLOAD) {
                    let frame = encode_proxy_frame(&hmac_key_write, chunk);
                    if tcp_write.write_all(&frame).await.is_err() {
                        return;
                    }
                }
                if tcp_write.flush().await.is_err() {
                    return;
                }
            }
        });

        Ok(Self {
            read_rx,
            write_tx,
            read_buf: BytesMut::new(),
            write_reserve: None,
        })
    }
}

impl AsyncRead for ShadowTlsClientStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        // First drain any buffered data
        if !self.read_buf.is_empty() {
            let n = std::cmp::min(buf.remaining(), self.read_buf.len());
            buf.put_slice(&self.read_buf.split_to(n));
            return Poll::Ready(Ok(()));
        }

        // Try to receive more data
        match self.read_rx.poll_recv(cx) {
            Poll::Ready(Some(data)) => {
                let n = std::cmp::min(buf.remaining(), data.len());
                buf.put_slice(&data[..n]);
                if n < data.len() {
                    self.read_buf.extend_from_slice(&data[n..]);
                }
                Poll::Ready(Ok(()))
            }
            Poll::Ready(None) => Poll::Ready(Ok(())), // EOF
            Poll::Pending => Poll::Pending,
        }
    }
}

impl AsyncWrite for ShadowTlsClientStream {
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
                permit.send(buf.to_vec());
                Poll::Ready(Ok(buf.len()))
            }
            Poll::Ready(Err(_)) => Poll::Ready(Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "ShadowTLS write channel closed",
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

/// Build a TLS client config for the cover server handshake.
///
/// This uses standard certificate verification with webpki roots so the
/// handshake is indistinguishable from a real browser connection.
fn build_cover_tls_config(_sni: &str) -> rustls::ClientConfig {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let mut config = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    // Use standard ALPN to look like a browser
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    config
}
