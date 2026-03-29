//! TUN packet handler: reads IP packets from the TUN device and routes
//! TCP connections through PrismaVeil CMD_CONNECT, UDP datagrams through
//! CMD_UDP_DATA.
//!
//! Uses smoltcp as a userspace TCP/IP stack to convert raw IP packets into
//! TCP byte streams that can be relayed through PrismaVeil tunnels.

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

use prisma_core::types::{ProxyAddress, ProxyDestination};

use crate::proxy::ProxyContext;
use crate::relay;
use crate::tun::device::TunDevice;
use crate::tun::packet::{self, PROTO_TCP, PROTO_UDP};
use crate::tun::process::AppFilter;
use crate::tun::tcp_stack::TcpStack;
use crate::tunnel;

/// Per-connection state tracked by the handler.
struct ConnectionState {
    handle: smoltcp::iface::SocketHandle,
    dest: SocketAddr,
    domain: Option<String>,
    phase: ConnectionPhase,
}

enum ConnectionPhase {
    /// TCP handshake in progress, waiting for ESTABLISHED.
    Handshaking,
    /// Relay is running. Send data via the channel.
    Relaying {
        data_tx: tokio::sync::mpsc::Sender<Vec<u8>>,
    },
    /// Relay finished, socket pending cleanup.
    Closing,
}

/// Run the TUN handler loop.
pub async fn run_tun_handler(
    device: Box<dyn TunDevice>,
    ctx: ProxyContext,
    app_filter: Option<Arc<AppFilter>>,
) -> Result<()> {
    let device_name = device.name().to_string();
    let mtu = device.mtu();
    info!(device = %device_name, mtu = mtu, "TUN handler starting");

    let device: Arc<Box<dyn TunDevice>> = Arc::from(device);
    let stack = Arc::new(Mutex::new(TcpStack::new(Ipv4Addr::new(10, 0, 85, 1), mtu)));

    // Connection tracking — owned by this task only, no mutex needed.
    let mut connections: HashMap<SocketAddr, ConnectionState> = HashMap::new();

    // Read packets from TUN in a dedicated blocking thread.
    let read_device = device.clone();
    let (pkt_tx, mut pkt_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(512);
    tokio::task::spawn_blocking(move || {
        let mut buf = vec![0u8; mtu as usize + 64];
        loop {
            match read_device.recv(&mut buf) {
                Ok(0) => {
                    std::thread::sleep(std::time::Duration::from_millis(1));
                    continue;
                }
                Ok(n) => {
                    if pkt_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    let is_badf = e
                        .downcast_ref::<std::io::Error>()
                        .map_or(false, |io| io.raw_os_error() == Some(9));
                    if is_badf {
                        tracing::warn!("TUN fd closed (EBADF) — stopping read loop");
                        break;
                    }
                    tracing::warn!(error = %e, "TUN read error");
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
            }
        }
    });

    // Periodic poll timer for smoltcp (handles retransmissions, keepalives, etc.)
    let mut poll_interval = tokio::time::interval(Duration::from_millis(50));

    let mut pkt_count: u64 = 0;

    loop {
        tokio::select! {
            // Process incoming TUN packets
            pkt_data = pkt_rx.recv() => {
                let pkt_data = match pkt_data {
                    Some(d) => d,
                    None => return Ok(()), // read thread exited
                };

                // Also drain any queued packets
                let mut batch = vec![pkt_data];
                while let Ok(pkt) = pkt_rx.try_recv() {
                    batch.push(pkt);
                    if batch.len() >= 64 { break; }
                }

                let mut s = stack.lock().await;

                for pkt_data in &batch {
                    let pkt = &pkt_data[..];
                    pkt_count += 1;
                    if pkt_count <= 5 || pkt_count % 100 == 0 {
                        info!(count = pkt_count, len = pkt.len(), "TUN packet received");
                    }

                    let ip_info = match packet::parse_ipv4(pkt) {
                        Some(info) => info,
                        None => continue,
                    };

                    if let Some(ref filter) = app_filter {
                        if let Some(src_port) = packet::src_port(pkt) {
                            if !filter.should_proxy(ip_info.protocol, src_port) {
                                continue;
                            }
                        }
                    }

                    match ip_info.protocol {
                        PROTO_TCP => {
                            let dest = match packet::tcp_dest(pkt) {
                                Some(d) => d,
                                None => continue,
                            };

                            // Create listener for new connections BEFORE feeding the SYN
                            if !connections.contains_key(&dest) {
                                let domain = if let SocketAddr::V4(v4) = dest {
                                    ctx.dns_resolver.lookup_fake_ip(*v4.ip()).await
                                } else {
                                    None
                                };
                                let dest_str = domain.as_deref().unwrap_or(&dest.to_string()).to_string();
                                info!(dest = %dest_str, "New TUN TCP connection");

                                let handle = s.accept_connection(dest, domain.clone());
                                connections.insert(dest, ConnectionState {
                                    handle,
                                    dest,
                                    domain,
                                    phase: ConnectionPhase::Handshaking,
                                });
                            }

                            s.receive_packet(pkt);
                        }
                        PROTO_UDP => {
                            let dest = match packet::udp_dest(pkt) {
                                Some(d) => d,
                                None => continue,
                            };
                            if dest.port() == 53 {
                                let dns_data = &pkt[ip_info.payload_offset + 8..];
                                if !dns_data.is_empty() {
                                    let ctx = ctx.clone();
                                    let dns_data = dns_data.to_vec();
                                    let device = device.clone();
                                    let src_addr = SocketAddrV4::new(ip_info.src, {
                                        let udp_hdr = &pkt[ip_info.payload_offset..];
                                        u16::from_be_bytes([udp_hdr[0], udp_hdr[1]])
                                    });
                                    let dst_addr = SocketAddrV4::new(ip_info.dst, 53);
                                    tokio::spawn(async move {
                                        handle_tun_dns(&ctx, &dns_data, src_addr, dst_addr, &device).await;
                                    });
                                }
                                continue;
                            }
                            let udp_payload = &pkt[ip_info.payload_offset + 8..];
                            if !udp_payload.is_empty() {
                                let src_addr = SocketAddrV4::new(ip_info.src, {
                                    let udp_hdr = &pkt[ip_info.payload_offset..];
                                    u16::from_be_bytes([udp_hdr[0], udp_hdr[1]])
                                });
                                let dst_addr = SocketAddrV4::new(ip_info.dst, dest.port());
                                let ctx = ctx.clone();
                                let device = device.clone();
                                let payload = udp_payload.to_vec();
                                tokio::spawn(async move {
                                    relay_tun_udp(&ctx, src_addr, dst_addr, &payload, &device).await;
                                });
                            }
                        }
                        _ => {}
                    }
                }

                // Poll smoltcp and write outbound packets to TUN
                let out = s.poll();
                drop(s); // release lock before I/O
                for pkt in &out {
                    if let Err(_) = device.send(pkt) {
                        return Ok(()); // fd dead
                    }
                }

                // Check socket states and push data to relays
                process_connections(&mut connections, &stack, &device, &ctx).await;
            }

            // Periodic poll for retransmissions/keepalives
            _ = poll_interval.tick() => {
                let out = {
                    let mut s = stack.lock().await;
                    s.poll()
                };
                for pkt in &out {
                    if let Err(_) = device.send(pkt) {
                        return Ok(());
                    }
                }
                process_connections(&mut connections, &stack, &device, &ctx).await;
            }
        }
    }
}

/// Check all connections: start relays for newly established, push data to active relays, cleanup closed.
async fn process_connections(
    connections: &mut HashMap<SocketAddr, ConnectionState>,
    stack: &Arc<Mutex<TcpStack>>,
    device: &Arc<Box<dyn TunDevice>>,
    ctx: &ProxyContext,
) {
    let mut to_remove: Vec<SocketAddr> = Vec::new();

    for (dest, conn) in connections.iter_mut() {
        match &conn.phase {
            ConnectionPhase::Handshaking => {
                let s = stack.lock().await;
                if s.is_established(conn.handle) {
                    drop(s);
                    // Connection established — start relay with notification channel
                    let (data_tx, data_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);

                    let handle = conn.handle;
                    let dest = *dest;
                    let domain = conn.domain.clone();
                    let ctx = ctx.clone();
                    let stack = stack.clone();
                    let relay_device = device.clone();

                    tokio::spawn(async move {
                        match relay_tun_tcp_notify(
                            &ctx,
                            dest,
                            domain.as_deref(),
                            handle,
                            &stack,
                            &relay_device,
                            data_rx,
                        )
                        .await
                        {
                            Ok(()) => debug!(dest = %dest, "TUN relay completed"),
                            Err(e) => debug!(dest = %dest, error = %e, "TUN relay error"),
                        }
                        // Cleanup socket
                        let mut s = stack.lock().await;
                        s.close_socket(handle);
                    });

                    conn.phase = ConnectionPhase::Relaying { data_tx };
                } else if s.is_closed(conn.handle) {
                    to_remove.push(*dest);
                }
            }
            ConnectionPhase::Relaying { data_tx } => {
                // Only read if the relay channel has capacity (prevents blocking)
                if data_tx.capacity() == 0 {
                    // Channel full — skip this connection, retry next poll
                    continue;
                }
                let mut s = stack.lock().await;
                let mut buf = [0u8; 32768];
                let n = s.read_from_socket(conn.handle, &mut buf);
                let is_closed = s.is_closed(conn.handle);
                if n > 0 {
                    let out = s.poll();
                    drop(s);
                    for pkt in &out {
                        let _ = device.send(pkt);
                    }
                    // try_send is safe here because we checked capacity above
                    let _ = data_tx.try_send(buf[..n].to_vec());
                } else {
                    drop(s);
                }
                // Only remove if channel is closed (relay exited) AND socket is closed
                if data_tx.is_closed() || is_closed {
                    to_remove.push(*dest);
                }
            }
            ConnectionPhase::Closing => {
                to_remove.push(*dest);
            }
        }
    }

    for dest in to_remove {
        if let Some(conn) = connections.remove(&dest) {
            if matches!(conn.phase, ConnectionPhase::Handshaking) {
                let mut s = stack.lock().await;
                s.close_socket(conn.handle);
            }
        }
    }
}

/// Relay data between a smoltcp TCP socket and a PrismaVeil tunnel.
/// Upload receives data via `data_rx` channel (pushed by the packet loop).
/// Download reads from tunnel and writes to smoltcp directly.
async fn relay_tun_tcp_notify(
    ctx: &ProxyContext,
    dest: SocketAddr,
    domain: Option<&str>,
    handle: smoltcp::iface::SocketHandle,
    stack: &Arc<Mutex<TcpStack>>,
    device: &Arc<Box<dyn TunDevice>>,
    mut data_rx: tokio::sync::mpsc::Receiver<Vec<u8>>,
) -> Result<()> {
    let destination = if let Some(domain) = domain {
        ProxyDestination {
            address: ProxyAddress::Domain(domain.to_string()),
            port: dest.port(),
        }
    } else {
        // Check for stale fake DNS IPs
        if let SocketAddr::V4(v4) = dest {
            if ctx.dns_resolver.is_fake_ip(*v4.ip()).await {
                anyhow::bail!("Stale fake DNS IP {} — no domain mapping", v4.ip());
            }
        }
        match dest {
            SocketAddr::V4(v4) => ProxyDestination {
                address: ProxyAddress::Ipv4(*v4.ip()),
                port: v4.port(),
            },
            SocketAddr::V6(v6) => ProxyDestination {
                address: ProxyAddress::Ipv6(*v6.ip()),
                port: v6.port(),
            },
        }
    };

    // Establish tunnel to destination
    let transport = ctx.connect().await?;
    let tunnel_conn = tunnel::establish_tunnel(
        transport,
        ctx.client_id,
        ctx.auth_secret,
        ctx.cipher_suite,
        &destination,
        ctx.server_key_pin.as_deref(),
    )
    .await?;

    info!(dest = %destination, "TUN tunnel established");

    let (tunnel_read, tunnel_write) = tokio::io::split(tunnel_conn.stream);
    let cipher = tunnel_conn.cipher;
    let session_keys = tunnel_conn.session_keys;

    relay::relay_tun_tcp_encrypted(
        handle,
        stack.clone(),
        tunnel_read,
        tunnel_write,
        cipher,
        session_keys,
        ctx.metrics.clone(),
        Some(device.clone()),
        Some(data_rx),
    )
    .await
}

/// Relay a single UDP datagram through the tunnel and send the response back via TUN.
async fn relay_tun_udp(
    ctx: &ProxyContext,
    src: SocketAddrV4,
    dst: SocketAddrV4,
    payload: &[u8],
    device: &Arc<Box<dyn TunDevice>>,
) {
    let domain = ctx.dns_resolver.lookup_fake_ip(*dst.ip()).await;

    let destination = if let Some(ref domain) = domain {
        ProxyDestination {
            address: ProxyAddress::Domain(domain.clone()),
            port: dst.port(),
        }
    } else {
        ProxyDestination {
            address: ProxyAddress::Ipv4(*dst.ip()),
            port: dst.port(),
        }
    };

    debug!(dest = %destination, len = payload.len(), "TUN UDP relay");

    let transport = match ctx.connect().await {
        Ok(t) => t,
        Err(e) => {
            debug!(error = %e, "TUN UDP: failed to connect transport");
            return;
        }
    };

    let tunnel_conn = match tunnel::establish_udp_tunnel(
        transport,
        ctx.client_id,
        ctx.auth_secret,
        ctx.cipher_suite,
        ctx.server_key_pin.as_deref(),
    )
    .await
    {
        Ok(t) => t,
        Err(e) => {
            debug!(error = %e, "TUN UDP: failed to establish tunnel");
            return;
        }
    };

    // TODO: send UDP datagram through tunnel and write response back to TUN
    let _ = (tunnel_conn, src, device);
}

/// Handle a TUN-captured DNS query.
async fn handle_tun_dns(
    ctx: &ProxyContext,
    dns_data: &[u8],
    src: SocketAddrV4,
    dst: SocketAddrV4,
    device: &Arc<Box<dyn TunDevice>>,
) {
    use prisma_core::dns::DnsMode;

    let domain = match parse_dns_query_domain(dns_data) {
        Some(d) => d,
        None => return,
    };

    let resolved_ip = match ctx.dns_resolver.mode() {
        DnsMode::Fake => match ctx.dns_resolver.assign_fake_ip(&domain).await {
            Some(ip) => {
                debug!(domain = %domain, ip = %ip, "Assigned fake IP via TUN DNS");
                ip
            }
            None => return,
        },
        DnsMode::Tunnel | DnsMode::Smart => match ctx.dns_resolver.resolve_direct(&domain).await {
            Ok(ips) if !ips.is_empty() => ips[0],
            _ => return,
        },
        DnsMode::Direct => match ctx.dns_resolver.resolve_direct(&domain).await {
            Ok(ips) if !ips.is_empty() => ips[0],
            _ => return,
        },
    };

    let dns_response = build_dns_response(dns_data, resolved_ip);
    let ip_packet =
        build_ip_udp_packet(*dst.ip(), *src.ip(), dst.port(), src.port(), &dns_response);
    if let Err(e) = device.send(&ip_packet) {
        warn!(error = %e, "Failed to send DNS response to TUN");
    }
}

fn build_dns_response(query: &[u8], answer_ip: Ipv4Addr) -> Vec<u8> {
    if query.len() < 12 {
        return Vec::new();
    }
    let mut resp = Vec::with_capacity(query.len() + 16);
    resp.extend_from_slice(&query[0..2]);
    resp.extend_from_slice(&[0x81, 0x80]);
    resp.extend_from_slice(&[0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);
    let mut pos = 12;
    while pos < query.len() {
        let len = query[pos] as usize;
        if len == 0 {
            pos += 1;
            break;
        }
        pos += 1 + len;
    }
    pos += 4;
    if pos > query.len() {
        return Vec::new();
    }
    resp.extend_from_slice(&query[12..pos]);
    resp.extend_from_slice(&[
        0xC0, 0x0C, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x3C, 0x00, 0x04,
    ]);
    resp.extend_from_slice(&answer_ip.octets());
    resp
}

fn build_ip_udp_packet(
    src_ip: Ipv4Addr,
    dst_ip: Ipv4Addr,
    src_port: u16,
    dst_port: u16,
    payload: &[u8],
) -> Vec<u8> {
    let udp_len = 8 + payload.len();
    let total_len = 20 + udp_len;
    let mut pkt = Vec::with_capacity(total_len);
    pkt.push(0x45);
    pkt.push(0x00);
    pkt.extend_from_slice(&(total_len as u16).to_be_bytes());
    pkt.extend_from_slice(&[0x00, 0x00, 0x40, 0x00]);
    pkt.push(64);
    pkt.push(17);
    pkt.extend_from_slice(&[0x00, 0x00]);
    pkt.extend_from_slice(&src_ip.octets());
    pkt.extend_from_slice(&dst_ip.octets());
    let checksum = ipv4_checksum(&pkt[..20]);
    pkt[10] = (checksum >> 8) as u8;
    pkt[11] = (checksum & 0xFF) as u8;
    pkt.extend_from_slice(&src_port.to_be_bytes());
    pkt.extend_from_slice(&dst_port.to_be_bytes());
    pkt.extend_from_slice(&(udp_len as u16).to_be_bytes());
    pkt.extend_from_slice(&[0x00, 0x00]);
    pkt.extend_from_slice(payload);
    pkt
}

fn ipv4_checksum(header: &[u8]) -> u16 {
    let mut sum: u32 = 0;
    let mut i = 0;
    while i + 1 < header.len() {
        if i == 10 {
            i += 2;
            continue;
        }
        sum += u16::from_be_bytes([header[i], header[i + 1]]) as u32;
        i += 2;
    }
    while sum > 0xFFFF {
        sum = (sum & 0xFFFF) + (sum >> 16);
    }
    !sum as u16
}

fn parse_dns_query_domain(data: &[u8]) -> Option<String> {
    if data.len() < 12 {
        return None;
    }
    let mut pos = 12;
    let mut parts = Vec::new();
    while pos < data.len() {
        let len = data[pos] as usize;
        if len == 0 {
            break;
        }
        if pos + 1 + len > data.len() {
            return None;
        }
        parts.push(std::str::from_utf8(&data[pos + 1..pos + 1 + len]).ok()?);
        pos += 1 + len;
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("."))
    }
}
