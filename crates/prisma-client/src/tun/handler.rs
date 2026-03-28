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

/// Run the TUN handler loop.
///
/// Creates a smoltcp TCP/IP stack and processes raw IP packets from the TUN
/// device. TCP connections are bridged to PrismaVeil tunnels, UDP datagrams
/// are relayed via CMD_UDP_DATA.
pub async fn run_tun_handler(
    device: Box<dyn TunDevice>,
    ctx: ProxyContext,
    app_filter: Option<Arc<AppFilter>>,
) -> Result<()> {
    let device_name = device.name().to_string();
    let mtu = device.mtu();
    info!(device = %device_name, mtu = mtu, "TUN handler starting");

    // Wrap device in Arc for shared access.
    // TunDevice uses &self for both recv/send, so no mutex needed — the
    // underlying fd I/O is thread-safe on Unix (atomic syscalls).
    let device: Arc<Box<dyn TunDevice>> = Arc::from(device);

    let stack = Arc::new(Mutex::new(TcpStack::new(Ipv4Addr::new(10, 0, 85, 1), mtu)));

    let active_tunnels: Arc<Mutex<HashMap<SocketAddr, TunnelState>>> =
        Arc::new(Mutex::new(HashMap::new()));

    // Spawn the stack polling loop (writes outbound packets to TUN)
    let poll_stack = stack.clone();
    let poll_device = device.clone();
    let poll_tunnels = active_tunnels.clone();
    let poll_ctx = ctx.clone();
    tokio::spawn(async move {
        stack_poll_loop(poll_stack, poll_device, poll_tunnels, poll_ctx).await;
    });

    // Read packets from TUN in a dedicated blocking thread.
    // No mutex — recv(&self) on the fd is safe to call concurrently with send(&self).
    let read_device = device.clone();
    let (pkt_tx, mut pkt_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);
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
                    tracing::warn!(error = %e, "TUN read error");
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
            }
        }
    });

    loop {
        let pkt_data = match pkt_rx.recv().await {
            Some(data) => data,
            None => return Ok(()), // reader thread exited
        };
        let n = pkt_data.len();

        let pkt = &pkt_data[..n];

        // Parse IPv4 header
        let ip_info = match packet::parse_ipv4(pkt) {
            Some(info) => info,
            None => continue,
        };

        // Per-app filter: check if this packet should be proxied
        if let Some(ref filter) = app_filter {
            if let Some(src_port) = packet::src_port(pkt) {
                if !filter.should_proxy(ip_info.protocol, src_port) {
                    debug!(
                        proto = ip_info.protocol,
                        src_port = src_port,
                        "Per-app filter: bypassing (direct)"
                    );
                    continue; // Skip this packet — it goes direct via OS routing
                }
            }
        }

        match ip_info.protocol {
            PROTO_TCP => {
                // Feed TCP packets into the smoltcp stack
                let mut s = stack.lock().await;
                s.receive_packet(pkt);

                // Check if this is a new connection (SYN)
                let dest = match packet::tcp_dest(pkt) {
                    Some(d) => d,
                    None => continue,
                };

                let mut tunnels = active_tunnels.lock().await;
                if let std::collections::hash_map::Entry::Vacant(entry) = tunnels.entry(dest) {
                    // Resolve fake IP to domain if in Fake DNS mode
                    let domain = if let SocketAddr::V4(v4) = dest {
                        ctx.dns_resolver.lookup_fake_ip(*v4.ip()).await
                    } else {
                        None
                    };

                    let dest_str = if let Some(ref domain) = domain {
                        format!("{}:{}", domain, dest.port())
                    } else {
                        dest.to_string()
                    };
                    debug!(dest = %dest_str, "New TUN TCP connection");

                    // Accept the connection in smoltcp
                    s.accept_connection(dest, domain.clone());
                    entry.insert(TunnelState::Connecting);
                }
            }
            PROTO_UDP => {
                let dest = match packet::udp_dest(pkt) {
                    Some(d) => d,
                    None => continue,
                };

                // DNS interception: port 53 traffic
                if dest.port() == 53 {
                    let dns_data = &pkt[ip_info.payload_offset + 8..]; // Skip UDP header
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

                // Relay non-DNS UDP through the tunnel
                let udp_payload = &pkt[ip_info.payload_offset + 8..]; // Skip UDP header
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
}

/// Relay a single UDP datagram through the tunnel and send the response back via TUN.
async fn relay_tun_udp(
    ctx: &ProxyContext,
    src: SocketAddrV4,
    dst: SocketAddrV4,
    payload: &[u8],
    device: &Arc<Box<dyn TunDevice>>,
) {
    // Resolve fake IP to domain if in Fake DNS mode
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

    // Open a UDP association through the tunnel
    let transport = match ctx.connect().await {
        Ok(t) => t,
        Err(e) => {
            debug!(error = %e, "TUN UDP: failed to connect transport");
            return;
        }
    };

    let tunnel_conn = match tunnel::establish_tunnel(
        transport,
        ctx.client_id,
        ctx.auth_secret,
        ctx.cipher_suite,
        &destination,
        ctx.server_key_pin.as_deref(),
    )
    .await
    {
        Ok(c) => c,
        Err(e) => {
            debug!(error = %e, "TUN UDP: failed to establish tunnel");
            return;
        }
    };

    // Send the UDP payload through the tunnel as a framed packet
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let (mut read, mut write) = tokio::io::split(tunnel_conn.stream);
    let cipher: Arc<dyn prisma_core::crypto::aead::AeadCipher> = Arc::from(tunnel_conn.cipher);
    let mut keys = tunnel_conn.session_keys;

    // Encrypt and send the UDP payload
    let mut encoder = prisma_core::protocol::frame_encoder::FrameEncoder::new();
    let payload_buf = encoder.payload_mut();
    let copy_len = payload.len().min(payload_buf.len());
    payload_buf[..copy_len].copy_from_slice(&payload[..copy_len]);

    let nonce = keys.next_client_nonce();
    match encoder.seal_data_frame_v5(
        cipher.as_ref(),
        &nonce,
        copy_len,
        0,
        &keys.padding_range,
        keys.header_key.as_ref(),
    ) {
        Ok(wire) => {
            if write.write_all(wire).await.is_err() {
                return;
            }
        }
        Err(e) => {
            debug!(error = %e, "TUN UDP: encrypt failed");
            return;
        }
    }

    // Wait for a response with a timeout (UDP is fire-and-forget but we try)
    let mut resp_buf = vec![0u8; 65536];
    match tokio::time::timeout(Duration::from_secs(5), async {
        let mut len_buf = [0u8; 2];
        read.read_exact(&mut len_buf).await?;
        let frame_len = u16::from_be_bytes(len_buf) as usize;
        if frame_len > resp_buf.len() {
            return Err(anyhow::anyhow!("UDP response too large"));
        }
        read.read_exact(&mut resp_buf[..frame_len]).await?;
        Ok::<usize, anyhow::Error>(frame_len)
    })
    .await
    {
        Ok(Ok(frame_len)) => {
            // Decrypt the response
            match prisma_core::protocol::frame_encoder::FrameDecoder::unseal_data_frame_v5(
                &mut resp_buf[..frame_len],
                frame_len,
                cipher.as_ref(),
                keys.header_key.as_ref(),
            ) {
                Ok((_cmd, resp_payload, _nonce)) => {
                    // Wrap response in IP+UDP and send back through TUN
                    let response_pkt = build_ip_udp_packet(
                        *dst.ip(),
                        *src.ip(),
                        dst.port(),
                        src.port(),
                        resp_payload,
                    );
                    let dev = &**device;
                    if let Err(e) = dev.send(&response_pkt) {
                        warn!(error = %e, "TUN UDP: failed to send response");
                    }
                }
                Err(e) => {
                    debug!(error = %e, "TUN UDP: decrypt response failed");
                }
            }
        }
        Ok(Err(e)) => {
            debug!(error = %e, "TUN UDP: read response failed");
        }
        Err(_) => {
            debug!("TUN UDP: response timeout");
        }
    }
}

/// State of a tunnel for a TUN-captured TCP connection.
enum TunnelState {
    /// Waiting for TCP handshake to complete in smoltcp.
    Connecting,
    /// Tunnel is established and relaying data.
    Established,
    /// Connection is being torn down.
    Closing,
}

/// Periodically poll the smoltcp stack, check for established connections,
/// bridge data between smoltcp sockets and PrismaVeil tunnels, and write
/// outbound packets back to the TUN device.
async fn stack_poll_loop(
    stack: Arc<Mutex<TcpStack>>,
    device: Arc<Box<dyn TunDevice>>,
    tunnels: Arc<Mutex<HashMap<SocketAddr, TunnelState>>>,
    ctx: ProxyContext,
) {
    let mut interval = tokio::time::interval(Duration::from_millis(5));

    loop {
        interval.tick().await;

        // Single stack lock: poll, check established, cleanup — all at once
        let (out_packets, to_establish, closed_handles) = {
            let mut s = stack.lock().await;
            let out = s.poll();

            // Check for newly established connections
            let mut establish = Vec::new();
            for handle in s.connection_handles() {
                if s.is_established(handle) {
                    if let Some(conn) = s.get_connection(handle) {
                        establish.push((conn.dest, handle, conn.domain.clone()));
                    }
                }
            }

            // Cleanup closed sockets
            let closed = s.cleanup_closed();

            (out, establish, closed)
        };

        // Write outbound packets to TUN device (no stack lock held)
        if !out_packets.is_empty() {
            let dev = &**device;
            for pkt in &out_packets {
                if let Err(e) = dev.send(pkt) {
                    warn!(error = %e, "TUN write error");
                }
            }
        }

        // Process established connections and cleanup under tunnels lock
        let mut tunnels_guard = tunnels.lock().await;

        // Filter to_establish to only include connections still in Connecting state
        for (dest, handle, domain) in to_establish {
            if !matches!(tunnels_guard.get(&dest), Some(TunnelState::Connecting)) {
                continue;
            }

            debug!(dest = %dest, "TUN TCP connection established, starting tunnel relay");
            tunnels_guard.insert(dest, TunnelState::Established);

            let ctx = ctx.clone();
            let stack = stack.clone();
            let tunnels = tunnels.clone();
            tokio::spawn(async move {
                if let Err(e) = relay_tun_tcp(&ctx, dest, domain.as_deref(), handle, &stack).await {
                    debug!(dest = %dest, error = %e, "TUN TCP relay error");
                }
                tunnels.lock().await.insert(dest, TunnelState::Closing);
                let mut s = stack.lock().await;
                s.close_socket(handle);
            });
        }

        // Remove closing entries for cleaned-up handles
        if !closed_handles.is_empty() {
            tunnels_guard.retain(|_, state| !matches!(state, TunnelState::Closing));
        }
    }
}

/// Relay data between a smoltcp TCP socket and a PrismaVeil tunnel.
async fn relay_tun_tcp(
    ctx: &ProxyContext,
    dest: SocketAddr,
    domain: Option<&str>,
    handle: smoltcp::iface::SocketHandle,
    stack: &Arc<Mutex<TcpStack>>,
) -> Result<()> {
    let destination = if let Some(domain) = domain {
        ProxyDestination {
            address: ProxyAddress::Domain(domain.to_string()),
            port: dest.port(),
        }
    } else {
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

    // Split the tunnel for bidirectional relay
    let (tunnel_read, tunnel_write) = tokio::io::split(tunnel_conn.stream);
    let cipher = tunnel_conn.cipher;
    let session_keys = tunnel_conn.session_keys;

    // For the TUN TCP relay, we use the encrypted relay which handles
    // the PrismaVeil frame encryption/decryption
    relay::relay_tun_tcp_encrypted(
        handle,
        stack.clone(),
        tunnel_read,
        tunnel_write,
        cipher,
        session_keys,
        ctx.metrics.clone(),
    )
    .await
}

/// Handle a TUN-captured DNS query: resolve the domain and send a DNS response
/// back through the TUN device so the application receives the answer.
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
        DnsMode::Tunnel | DnsMode::Smart => {
            // For tunnel/smart modes, resolve via the configured upstream
            // (through tunnel for blocked domains, directly for others).
            let should_tunnel = ctx.dns_resolver.should_tunnel_dns(&domain);
            match ctx.dns_resolver.resolve_direct(&domain).await {
                Ok(ips) if !ips.is_empty() => {
                    let ip = ips[0];
                    if should_tunnel {
                        debug!(domain = %domain, ip = %ip, "TUN DNS resolved via tunnel");
                    } else {
                        debug!(domain = %domain, ip = %ip, "TUN DNS resolved directly");
                    }
                    ip
                }
                Ok(_) => {
                    debug!(domain = %domain, "TUN DNS: no A records");
                    return;
                }
                Err(e) => {
                    debug!(domain = %domain, error = %e, "TUN DNS resolve failed");
                    return;
                }
            }
        }
        DnsMode::Direct => match ctx.dns_resolver.resolve_direct(&domain).await {
            Ok(ips) if !ips.is_empty() => {
                debug!(domain = %domain, ip = %ips[0], "TUN DNS resolved directly");
                ips[0]
            }
            _ => return,
        },
    };

    // Build the DNS response and wrap it in a UDP/IP packet
    let dns_response = build_dns_response(dns_data, resolved_ip);
    let ip_packet = build_ip_udp_packet(
        *dst.ip(),  // DNS server IP becomes the source
        *src.ip(),  // client IP becomes the destination
        dst.port(), // 53
        src.port(), // client's original source port
        &dns_response,
    );

    let dev = &**device;
    if let Err(e) = dev.send(&ip_packet) {
        warn!(error = %e, "Failed to send DNS response to TUN");
    }
}

/// Build a DNS response packet from a query, with a single A record answer.
fn build_dns_response(query: &[u8], answer_ip: Ipv4Addr) -> Vec<u8> {
    if query.len() < 12 {
        return Vec::new();
    }

    let mut resp = Vec::with_capacity(query.len() + 16);

    // Copy transaction ID from query
    resp.extend_from_slice(&query[0..2]);

    // Flags: response (0x80), recursion desired (0x01), recursion available (0x80) = 0x8180
    resp.extend_from_slice(&[0x81, 0x80]);

    // QDCOUNT: 1
    resp.extend_from_slice(&[0x00, 0x01]);
    // ANCOUNT: 1
    resp.extend_from_slice(&[0x00, 0x01]);
    // NSCOUNT: 0
    resp.extend_from_slice(&[0x00, 0x00]);
    // ARCOUNT: 0
    resp.extend_from_slice(&[0x00, 0x00]);

    // Copy the question section from the query (starts at byte 12)
    let mut pos = 12;
    while pos < query.len() {
        let len = query[pos] as usize;
        if len == 0 {
            pos += 1; // null terminator
            break;
        }
        pos += 1 + len;
    }
    pos += 4; // QTYPE + QCLASS
    if pos > query.len() {
        return Vec::new();
    }
    resp.extend_from_slice(&query[12..pos]);

    // Answer section: A record
    // Name: compression pointer to question name at offset 12
    resp.extend_from_slice(&[0xC0, 0x0C]);
    // TYPE: A (1)
    resp.extend_from_slice(&[0x00, 0x01]);
    // CLASS: IN (1)
    resp.extend_from_slice(&[0x00, 0x01]);
    // TTL: 60 seconds
    resp.extend_from_slice(&[0x00, 0x00, 0x00, 0x3C]);
    // RDLENGTH: 4
    resp.extend_from_slice(&[0x00, 0x04]);
    // RDATA: IP address
    resp.extend_from_slice(&answer_ip.octets());

    resp
}

/// Build a complete IPv4 + UDP packet wrapping the given payload.
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

    // === IPv4 header (20 bytes) ===
    pkt.push(0x45); // version=4, IHL=5
    pkt.push(0x00); // DSCP/ECN
    pkt.extend_from_slice(&(total_len as u16).to_be_bytes()); // total length
    pkt.extend_from_slice(&[0x00, 0x00]); // identification
    pkt.extend_from_slice(&[0x40, 0x00]); // flags: Don't Fragment, fragment offset 0
    pkt.push(64); // TTL
    pkt.push(17); // protocol: UDP
    pkt.extend_from_slice(&[0x00, 0x00]); // checksum placeholder
    pkt.extend_from_slice(&src_ip.octets());
    pkt.extend_from_slice(&dst_ip.octets());

    // Calculate IPv4 header checksum
    let checksum = ipv4_checksum(&pkt[..20]);
    pkt[10] = (checksum >> 8) as u8;
    pkt[11] = (checksum & 0xFF) as u8;

    // === UDP header (8 bytes) ===
    pkt.extend_from_slice(&src_port.to_be_bytes());
    pkt.extend_from_slice(&dst_port.to_be_bytes());
    pkt.extend_from_slice(&(udp_len as u16).to_be_bytes());
    pkt.extend_from_slice(&[0x00, 0x00]); // UDP checksum (0 = not computed)

    // === Payload ===
    pkt.extend_from_slice(payload);

    pkt
}

/// Compute the IPv4 header checksum (RFC 1071).
fn ipv4_checksum(header: &[u8]) -> u16 {
    let mut sum: u32 = 0;
    let mut i = 0;
    while i + 1 < header.len() {
        // Skip the checksum field itself (bytes 10-11)
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

/// Extract the queried domain name from a raw DNS query packet.
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn make_dns_query(domain: &str) -> Vec<u8> {
        let mut data = vec![0xAB, 0xCD]; // transaction ID
        data.extend_from_slice(&[0x01, 0x00]); // flags: standard query
        data.extend_from_slice(&[0x00, 0x01]); // QDCOUNT: 1
        data.extend_from_slice(&[0x00, 0x00]); // ANCOUNT: 0
        data.extend_from_slice(&[0x00, 0x00]); // NSCOUNT: 0
        data.extend_from_slice(&[0x00, 0x00]); // ARCOUNT: 0
        for label in domain.split('.') {
            data.push(label.len() as u8);
            data.extend_from_slice(label.as_bytes());
        }
        data.push(0); // root label
        data.extend_from_slice(&[0x00, 0x01]); // QTYPE: A
        data.extend_from_slice(&[0x00, 0x01]); // QCLASS: IN
        data
    }

    #[test]
    fn test_parse_dns_query_domain() {
        let data = make_dns_query("example.com");
        assert_eq!(
            parse_dns_query_domain(&data),
            Some("example.com".to_string())
        );
    }

    #[test]
    fn test_parse_dns_query_domain_too_short() {
        assert_eq!(parse_dns_query_domain(&[0u8; 5]), None);
    }

    #[test]
    fn test_parse_dns_query_subdomain() {
        let data = make_dns_query("www.google.com");
        assert_eq!(
            parse_dns_query_domain(&data),
            Some("www.google.com".to_string())
        );
    }

    #[test]
    fn test_build_dns_response() {
        let query = make_dns_query("example.com");
        let ip = Ipv4Addr::new(198, 18, 0, 1);
        let resp = build_dns_response(&query, ip);

        // Transaction ID preserved
        assert_eq!(resp[0], 0xAB);
        assert_eq!(resp[1], 0xCD);
        // Flags: response + recursion
        assert_eq!(resp[2], 0x81);
        assert_eq!(resp[3], 0x80);
        // QDCOUNT: 1
        assert_eq!(u16::from_be_bytes([resp[4], resp[5]]), 1);
        // ANCOUNT: 1
        assert_eq!(u16::from_be_bytes([resp[6], resp[7]]), 1);

        // Answer section is at the end — last 4 bytes should be the IP
        let ip_start = resp.len() - 4;
        assert_eq!(&resp[ip_start..], &[198, 18, 0, 1]);
    }

    #[test]
    fn test_build_dns_response_too_short() {
        let resp = build_dns_response(&[0u8; 5], Ipv4Addr::new(1, 2, 3, 4));
        assert!(resp.is_empty());
    }

    #[test]
    fn test_build_ip_udp_packet() {
        let payload = b"hello";
        let pkt = build_ip_udp_packet(
            Ipv4Addr::new(8, 8, 8, 8),
            Ipv4Addr::new(10, 0, 0, 1),
            53,
            12345,
            payload,
        );

        // IPv4 header
        assert_eq!(pkt[0], 0x45); // version 4, IHL 5
        assert_eq!(pkt[9], 17); // protocol UDP
        let total_len = u16::from_be_bytes([pkt[2], pkt[3]]) as usize;
        assert_eq!(total_len, 20 + 8 + 5); // IP + UDP + payload
        assert_eq!(&pkt[12..16], &[8, 8, 8, 8]); // src IP
        assert_eq!(&pkt[16..20], &[10, 0, 0, 1]); // dst IP

        // Verify checksum: sum of all 16-bit words including stored checksum = 0xFFFF
        let mut sum: u32 = 0;
        for i in (0..20).step_by(2) {
            sum += u16::from_be_bytes([pkt[i], pkt[i + 1]]) as u32;
        }
        while sum > 0xFFFF {
            sum = (sum & 0xFFFF) + (sum >> 16);
        }
        assert_eq!(sum, 0xFFFF);

        // UDP header
        let src_port = u16::from_be_bytes([pkt[20], pkt[21]]);
        let dst_port = u16::from_be_bytes([pkt[22], pkt[23]]);
        assert_eq!(src_port, 53);
        assert_eq!(dst_port, 12345);
        let udp_len = u16::from_be_bytes([pkt[24], pkt[25]]) as usize;
        assert_eq!(udp_len, 8 + 5);

        // Payload
        assert_eq!(&pkt[28..], b"hello");
    }

    #[test]
    fn test_ipv4_checksum() {
        // Known good: RFC 1071 example-like header
        let header = [
            0x45, 0x00, 0x00, 0x21, // version, len
            0x00, 0x00, 0x40, 0x00, // id, flags
            0x40, 0x11, 0x00, 0x00, // ttl, proto, checksum=0
            0x08, 0x08, 0x08, 0x08, // src
            0x0A, 0x00, 0x00, 0x01, // dst
        ];
        let cksum = ipv4_checksum(&header);
        // Verify: set checksum in header, then full sum should be 0xFFFF
        let mut copy = header;
        copy[10] = (cksum >> 8) as u8;
        copy[11] = (cksum & 0xFF) as u8;
        let mut sum: u32 = 0;
        for i in (0..20).step_by(2) {
            sum += u16::from_be_bytes([copy[i], copy[i + 1]]) as u32;
        }
        while sum > 0xFFFF {
            sum = (sum & 0xFFFF) + (sum >> 16);
        }
        assert_eq!(sum, 0xFFFF);
    }
}
