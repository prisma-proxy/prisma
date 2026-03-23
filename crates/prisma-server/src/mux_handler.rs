//! Server-side stream multiplexing handler.
//!
//! When a client establishes a raw tunnel (handshake + challenge, no initial command)
//! and then sends MUX frames, this module demultiplexes the streams and spawns
//! independent relay tasks for each multiplexed stream.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use anyhow::Result;
use tokio::io::{AsyncRead, AsyncWrite};
use tracing::{debug, info, warn};

use prisma_core::cache::DnsCache;
use prisma_core::mux::{MuxDemuxer, MuxStream};
use prisma_core::state::ServerMetrics;
use prisma_core::types::ProxyDestination;

use crate::outbound;

/// Run a mux demuxer session: accept multiplexed streams and handle each one.
///
/// Each SYN frame contains the destination address. For each accepted stream,
/// we connect outbound and relay bidirectionally.
pub async fn handle_mux_session<R, W>(
    tunnel_read: R,
    tunnel_write: W,
    dns_cache: DnsCache,
    metrics: Arc<ServerMetrics>,
    bytes_up: Arc<AtomicU64>,
    bytes_down: Arc<AtomicU64>,
) -> Result<()>
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let mut demuxer = MuxDemuxer::new(tunnel_read, tunnel_write);

    info!("Starting mux demuxer session");

    while let Some((syn_payload, mux_stream)) = demuxer.accept().await {
        let dest_str = String::from_utf8_lossy(&syn_payload).to_string();
        let dns_cache = dns_cache.clone();
        let metrics = metrics.clone();
        let bytes_up = bytes_up.clone();
        let bytes_down = bytes_down.clone();

        debug!(stream_id = mux_stream.stream_id, dest = %dest_str, "Mux stream accepted");

        tokio::spawn(async move {
            if let Err(e) = handle_mux_stream(
                mux_stream, &dest_str, dns_cache, metrics, bytes_up, bytes_down,
            )
            .await
            {
                warn!(dest = %dest_str, error = %e, "Mux stream relay error");
            }
        });
    }

    debug!("Mux demuxer session ended");
    Ok(())
}

/// Handle a single multiplexed stream: connect outbound and relay data.
async fn handle_mux_stream(
    mut mux_stream: MuxStream,
    dest_str: &str,
    dns_cache: DnsCache,
    metrics: Arc<ServerMetrics>,
    bytes_up: Arc<AtomicU64>,
    bytes_down: Arc<AtomicU64>,
) -> Result<()> {
    // Parse destination from SYN payload (format: "host:port" or "ip:port")
    let dest = parse_destination(dest_str)?;

    let outbound = outbound::connect(&dest, &dns_cache).await?;
    let (mut out_read, mut out_write) = outbound.into_split();

    let stream_id = mux_stream.stream_id;
    let writer = mux_stream.writer.clone();

    // mux_stream -> outbound (upload)
    let up_bytes = bytes_up.clone();
    let up_metrics = metrics.clone();
    let upload = tokio::spawn(async move {
        while let Some(data) = mux_stream.read().await {
            let n = data.len() as u64;
            up_bytes.fetch_add(n, Ordering::Relaxed);
            up_metrics.total_bytes_up.fetch_add(n, Ordering::Relaxed);
            if tokio::io::AsyncWriteExt::write_all(&mut out_write, &data)
                .await
                .is_err()
            {
                break;
            }
        }
    });

    // outbound -> mux_stream (download)
    let download = tokio::spawn(async move {
        let mut buf = vec![0u8; 32768];
        loop {
            match tokio::io::AsyncReadExt::read(&mut out_read, &mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    bytes_down.fetch_add(n as u64, Ordering::Relaxed);
                    metrics
                        .total_bytes_down
                        .fetch_add(n as u64, Ordering::Relaxed);
                    let frame = prisma_core::mux::MuxFrame {
                        stream_id,
                        frame_type: prisma_core::mux::MUX_DATA,
                        payload: buf[..n].to_vec(),
                    };
                    if writer.send_frame(frame).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        // Send FIN when outbound closes
        let _ = writer
            .send_frame(prisma_core::mux::MuxFrame {
                stream_id,
                frame_type: prisma_core::mux::MUX_FIN,
                payload: Vec::new(),
            })
            .await;
    });

    tokio::select! {
        _ = upload => {},
        _ = download => {},
    }

    debug!(stream_id, "Mux stream relay ended");
    Ok(())
}

/// Parse a "host:port" string into a ProxyDestination.
fn parse_destination(s: &str) -> Result<ProxyDestination> {
    use prisma_core::types::{ProxyAddress, ProxyDestination};

    // Handle IPv6 addresses in brackets: [::1]:port
    if let Some(rest) = s.strip_prefix('[') {
        if let Some(bracket_end) = rest.find(']') {
            let ip_str = &rest[..bracket_end];
            let port_str = rest[bracket_end + 1..].strip_prefix(':').unwrap_or("0");
            let port: u16 = port_str
                .parse()
                .map_err(|e| anyhow::anyhow!("Invalid port: {}", e))?;
            let ip: std::net::Ipv6Addr = ip_str
                .parse()
                .map_err(|e| anyhow::anyhow!("Invalid IPv6: {}", e))?;
            return Ok(ProxyDestination {
                address: ProxyAddress::Ipv6(ip),
                port,
            });
        }
    }

    // Split on last ':' for host:port
    let (host, port_str) = s
        .rsplit_once(':')
        .ok_or_else(|| anyhow::anyhow!("Missing port in destination: {}", s))?;
    let port: u16 = port_str
        .parse()
        .map_err(|e| anyhow::anyhow!("Invalid port '{}': {}", port_str, e))?;

    // Try IPv4
    if let Ok(ip) = host.parse::<std::net::Ipv4Addr>() {
        return Ok(ProxyDestination {
            address: ProxyAddress::Ipv4(ip),
            port,
        });
    }

    // Otherwise treat as domain
    Ok(ProxyDestination {
        address: ProxyAddress::Domain(host.to_string()),
        port,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_destination_domain() {
        let dest = parse_destination("example.com:443").unwrap();
        assert_eq!(
            dest.address,
            prisma_core::types::ProxyAddress::Domain("example.com".into())
        );
        assert_eq!(dest.port, 443);
    }

    #[test]
    fn test_parse_destination_ipv4() {
        let dest = parse_destination("1.2.3.4:80").unwrap();
        assert_eq!(
            dest.address,
            prisma_core::types::ProxyAddress::Ipv4(std::net::Ipv4Addr::new(1, 2, 3, 4))
        );
        assert_eq!(dest.port, 80);
    }

    #[test]
    fn test_parse_destination_ipv6() {
        let dest = parse_destination("[::1]:8080").unwrap();
        assert_eq!(
            dest.address,
            prisma_core::types::ProxyAddress::Ipv6(std::net::Ipv6Addr::LOCALHOST)
        );
        assert_eq!(dest.port, 8080);
    }

    #[test]
    fn test_parse_destination_no_port() {
        assert!(parse_destination("example.com").is_err());
    }
}
