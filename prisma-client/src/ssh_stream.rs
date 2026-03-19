//! SSH transport stream adapter for the Prisma client.
//!
//! Wraps a russh SSH channel into `AsyncRead + AsyncWrite` so it can be used
//! as a `TransportStream` variant. Data flows through an SSH "direct-tcpip"
//! or "session" channel, making the traffic look like a normal SSH session
//! to network observers.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use bytes::{Buf, Bytes, BytesMut};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::mpsc;

type ReserveFut<T> =
    Pin<Box<dyn Future<Output = Result<mpsc::OwnedPermit<T>, mpsc::error::SendError<()>>> + Send>>;

/// Adapter that bridges a russh SSH channel into `AsyncRead + AsyncWrite`.
///
/// The SSH connection is driven by a background task that forwards data
/// between the SSH channel and a pair of `mpsc` channels. This struct
/// wraps those channels to implement tokio's async I/O traits.
pub struct SshStream {
    read_rx: mpsc::Receiver<Bytes>,
    write_tx: mpsc::Sender<Bytes>,
    read_buf: BytesMut,
    write_reserve: Option<ReserveFut<Bytes>>,
}

impl SshStream {
    /// Create a new `SshStream` from channel endpoints.
    pub fn new(read_rx: mpsc::Receiver<Bytes>, write_tx: mpsc::Sender<Bytes>) -> Self {
        Self {
            read_rx,
            write_tx,
            read_buf: BytesMut::new(),
            write_reserve: None,
        }
    }
}

impl AsyncRead for SshStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        // Drain internal buffer first
        if !self.read_buf.is_empty() {
            let to_copy = self.read_buf.len().min(buf.remaining());
            buf.put_slice(&self.read_buf[..to_copy]);
            self.read_buf.advance(to_copy);
            return Poll::Ready(Ok(()));
        }

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

impl AsyncWrite for SshStream {
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
                "SSH channel closed",
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

/// SSH client handler that receives data from the server-side channel.
///
/// Implements the `russh::client::Handler` trait. Received channel data
/// is forwarded to the `data_tx` sender, which feeds the `SshStream`'s
/// read side.
struct SshClientHandler {
    data_tx: mpsc::Sender<Bytes>,
}

impl russh::client::Handler for SshClientHandler {
    type Error = anyhow::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        // Accept any server key. The Prisma protocol layer handles its own
        // authentication via the PrismaVeil handshake, so SSH host key
        // verification is not security-critical here. The SSH layer is
        // used purely for camouflage.
        Ok(true)
    }

    async fn data(
        &mut self,
        _channel: russh::ChannelId,
        data: &[u8],
        _session: &mut russh::client::Session,
    ) -> Result<(), Self::Error> {
        let _ = self.data_tx.send(Bytes::copy_from_slice(data)).await;
        Ok(())
    }

    async fn channel_eof(
        &mut self,
        _channel: russh::ChannelId,
        _session: &mut russh::client::Session,
    ) -> Result<(), Self::Error> {
        Ok(())
    }
}

/// Connect to a Prisma server via SSH transport.
///
/// Establishes an SSH connection, authenticates, opens a session channel,
/// and returns an `SshStream` that implements `AsyncRead + AsyncWrite`.
pub async fn connect_ssh(
    server_addr: &str,
    username: &str,
    password: Option<&str>,
    private_key_path: Option<&str>,
    private_key_passphrase: Option<&str>,
) -> anyhow::Result<SshStream> {
    use anyhow::Context;
    use russh::client::AuthResult;

    let config = Arc::new(russh::client::Config {
        ..Default::default()
    });

    let (data_tx, data_rx) = mpsc::channel::<Bytes>(256);
    let (write_tx, mut write_rx) = mpsc::channel::<Bytes>(256);

    let handler = SshClientHandler {
        data_tx: data_tx.clone(),
    };

    // Connect to SSH server
    let mut handle = russh::client::connect(config, server_addr, handler)
        .await
        .context("SSH connection failed")?;

    // Authenticate
    let auth_result = if let Some(key_path) = private_key_path {
        let key_pair = if let Some(passphrase) = private_key_passphrase {
            russh::keys::load_secret_key(key_path, Some(passphrase))
                .context("Failed to load SSH private key")?
        } else {
            russh::keys::load_secret_key(key_path, None)
                .context("Failed to load SSH private key")?
        };
        let key_with_alg = russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
        handle
            .authenticate_publickey(username, key_with_alg)
            .await
            .context("SSH public key authentication failed")?
    } else if let Some(password) = password {
        handle
            .authenticate_password(username, password)
            .await
            .context("SSH password authentication failed")?
    } else {
        return Err(anyhow::anyhow!(
            "SSH: no authentication method (password or key) provided"
        ));
    };

    match auth_result {
        AuthResult::Success => {}
        _ => {
            return Err(anyhow::anyhow!("SSH authentication rejected by server"));
        }
    }

    // Open a session channel for proxy data
    let channel = handle
        .channel_open_session()
        .await
        .context("Failed to open SSH session channel")?;

    // Spawn a writer task that forwards outbound data to the SSH channel.
    tokio::spawn(async move {
        while let Some(data) = write_rx.recv().await {
            if channel.data(data.as_ref()).await.is_err() {
                break;
            }
        }
    });

    Ok(SshStream::new(data_rx, write_tx))
}
