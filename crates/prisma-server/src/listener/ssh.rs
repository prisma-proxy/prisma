//! SSH transport listener for the Prisma server.
//!
//! Accepts SSH connections, authenticates clients using password or public-key,
//! and pipes session channel data into the normal Prisma protocol handler.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use anyhow::Result;
use bytes::Bytes;
use russh::server::{Auth, Msg, Session};
use russh::{Channel, ChannelId};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Semaphore};
use tracing::{info, warn};

use prisma_core::cache::DnsCache;
use prisma_core::config::server::{ServerConfig, SshServerConfig};
use prisma_core::util;

use crate::auth::AuthStore;
use crate::channel_stream::ChannelStream;
use crate::handler;
use crate::state::ServerContext;

/// Start the SSH transport listener.
pub async fn listen(
    config: &ServerConfig,
    auth: AuthStore,
    dns_cache: DnsCache,
    ctx: ServerContext,
) -> Result<()> {
    let ssh_config = &config.ssh;
    let max_conn = config.performance.max_connections as usize;
    let semaphore = Arc::new(Semaphore::new(max_conn));

    // Load or generate host key
    let key_pair = if let Some(ref key_path) = ssh_config.host_key_path {
        russh::keys::load_secret_key(key_path, None)
            .map_err(|e| anyhow::anyhow!("Failed to load SSH host key from {}: {}", key_path, e))?
    } else {
        info!("No SSH host key configured, generating ephemeral Ed25519 key");
        russh::keys::PrivateKey::random(&mut rand::thread_rng(), russh::keys::Algorithm::Ed25519)
            .map_err(|e| anyhow::anyhow!("Failed to generate SSH host key: {}", e))?
    };

    let russh_config = Arc::new(russh::server::Config {
        keys: vec![key_pair],
        ..Default::default()
    });

    let tcp_listener = TcpListener::bind(&ssh_config.listen_addr).await?;
    info!(addr = %ssh_config.listen_addr, "SSH listener started");

    let ssh_cfg = Arc::new(ssh_config.clone());

    loop {
        match tcp_listener.accept().await {
            Ok((stream, peer_addr)) => {
                let permit = match semaphore.clone().try_acquire_owned() {
                    Ok(p) => p,
                    Err(_) => {
                        warn!(peer = %peer_addr, "SSH connection rejected: max connections reached");
                        drop(stream);
                        continue;
                    }
                };

                let russh_cfg = Arc::clone(&russh_config);
                let handler = SshConnectionHandler {
                    ssh_config: Arc::clone(&ssh_cfg),
                    fwd_config: config.port_forwarding.clone(),
                    auth: auth.clone(),
                    dns_cache: dns_cache.clone(),
                    ctx: ctx.clone(),
                    peer_addr: peer_addr.to_string(),
                    channel_tx: None,
                    permit: Some(permit),
                };

                tokio::spawn(async move {
                    match russh::server::run_stream(russh_cfg, stream, handler).await {
                        Ok(_session) => {}
                        Err(e) => {
                            warn!(peer = %peer_addr, error = %e, "SSH session error");
                        }
                    }
                });
            }
            Err(e) => {
                warn!(error = %e, "Failed to accept SSH connection");
            }
        }
    }
}

/// Per-connection SSH handler.
struct SshConnectionHandler {
    ssh_config: Arc<SshServerConfig>,
    fwd_config: prisma_core::config::server::PortForwardingConfig,
    auth: AuthStore,
    dns_cache: DnsCache,
    ctx: ServerContext,
    peer_addr: String,
    /// Sender for channel data -> Prisma handler direction.
    channel_tx: Option<mpsc::Sender<Bytes>>,
    permit: Option<tokio::sync::OwnedSemaphorePermit>,
}

impl russh::server::Handler for SshConnectionHandler {
    type Error = anyhow::Error;

    async fn channel_open_session(
        &mut self,
        _channel: Channel<Msg>,
        session: &mut Session,
    ) -> Result<bool, Self::Error> {
        self.ctx
            .state
            .metrics
            .total_connections
            .fetch_add(1, Ordering::Relaxed);
        self.ctx
            .state
            .metrics
            .active_connections
            .fetch_add(1, Ordering::Relaxed);

        // Create channels for bidirectional data flow
        let (inbound_tx, inbound_rx) = mpsc::channel::<Bytes>(256);
        let (outbound_tx, mut outbound_rx) = mpsc::channel::<Bytes>(256);

        self.channel_tx = Some(inbound_tx);

        let channel_id = _channel.id();

        // Spawn a task to write outbound data back to the SSH channel.
        // We use the session handle to send data back.
        let session_handle = session.handle();
        tokio::spawn(async move {
            while let Some(data) = outbound_rx.recv().await {
                if session_handle
                    .data(channel_id, Bytes::copy_from_slice(data.as_ref()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });

        // Create a ChannelStream (AsyncRead + AsyncWrite) from the channel pair
        let stream = ChannelStream::new(inbound_rx, outbound_tx);

        let auth = self.auth.clone();
        let dns = self.dns_cache.clone();
        let fwd = self.fwd_config.clone();
        let ctx = self.ctx.clone();
        let peer = self.peer_addr.clone();
        let permit = self.permit.take();

        // Spawn the Prisma protocol handler on this stream
        tokio::spawn(async move {
            let result = handler::handle_tcp_connection_camouflaged(
                stream,
                auth,
                dns,
                fwd,
                ctx.clone(),
                peer.clone(),
                None,
            )
            .await;

            if let Err(e) = result {
                warn!(peer = %peer, error = %e, "SSH tunnel handler error");
            }

            ctx.state
                .metrics
                .active_connections
                .fetch_sub(1, Ordering::Relaxed);
            drop(permit);
        });

        Ok(true)
    }

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        // Check allowed users
        if !self.ssh_config.allowed_users.is_empty()
            && !self.ssh_config.allowed_users.iter().any(|u| u == user)
        {
            return Ok(Auth::reject());
        }

        // Check password (constant-time comparison to prevent timing attacks)
        if let Some(ref expected_password) = self.ssh_config.password {
            if util::ct_eq_slice(password.as_bytes(), expected_password.as_bytes()) {
                info!(peer = %self.peer_addr, user = %user, "SSH password auth accepted");
                return Ok(Auth::Accept);
            }
        }

        Ok(Auth::reject())
    }

    async fn auth_publickey(
        &mut self,
        user: &str,
        public_key: &russh::keys::PublicKey,
    ) -> Result<Auth, Self::Error> {
        // Check allowed users
        if !self.ssh_config.allowed_users.is_empty()
            && !self.ssh_config.allowed_users.iter().any(|u| u == user)
        {
            return Ok(Auth::reject());
        }

        // Check authorized keys file
        if let Some(ref keys_path) = self.ssh_config.authorized_keys_path {
            if let Ok(contents) = std::fs::read_to_string(keys_path) {
                for line in contents.lines() {
                    let line = line.trim();
                    if line.is_empty() || line.starts_with('#') {
                        continue;
                    }
                    if let Some(key_data) = line.split_whitespace().nth(1) {
                        if let Ok(parsed_key) = russh::keys::parse_public_key_base64(key_data) {
                            if &parsed_key == public_key {
                                info!(peer = %self.peer_addr, user = %user, "SSH public key auth accepted");
                                return Ok(Auth::Accept);
                            }
                        }
                    }
                }
            }
        }

        Ok(Auth::reject())
    }

    async fn data(
        &mut self,
        _channel: ChannelId,
        data: &[u8],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        if let Some(ref tx) = self.channel_tx {
            let _ = tx.send(Bytes::copy_from_slice(data)).await;
        }
        Ok(())
    }

    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if self.ssh_config.fake_shell {
            let banner = b"Last login: Mon Mar 17 09:42:13 2026 from 192.168.1.100\r\n$ ";
            let _ = session.data(channel, Bytes::copy_from_slice(banner.as_ref()));
        }
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if self.ssh_config.fake_shell {
            let cmd = String::from_utf8_lossy(data);
            let response: &[u8] = match cmd.trim() {
                "uname -a" => {
                    b"Linux server 6.1.0-26-amd64 #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux\r\n"
                }
                "id" => b"uid=1000(user) gid=1000(user) groups=1000(user)\r\n",
                "whoami" => b"user\r\n",
                _ => b"\r\n",
            };
            let _ = session.data(channel, Bytes::copy_from_slice(response));
            let _ = session.close(channel);
        }
        Ok(())
    }
}
