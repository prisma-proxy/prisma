use anyhow::Result;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tracing::{debug, info, warn};

use prisma_core::protocol::frame_encoder::{FrameEncoder, MAX_PAYLOAD_SIZE};
use prisma_core::router::RouteAction;
use prisma_core::types::{ProxyAddress, ProxyDestination};

use crate::proxy::ProxyContext;
use crate::relay;
use crate::tunnel::{self, TunnelConnection};

/// HTTP proxy server supporting CONNECT (HTTPS tunneling) and plain HTTP forwarding.
pub async fn run_http_proxy(listen_addr: &str, ctx: ProxyContext) -> Result<()> {
    let listener = TcpListener::bind(listen_addr).await?;
    info!(addr = %listen_addr, "HTTP proxy server started");

    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                let ctx = ctx.clone();
                debug!(peer = %peer, "HTTP proxy client connected");
                tokio::spawn(async move {
                    if let Err(e) = handle_http_client(stream, &ctx).await {
                        warn!(peer = %peer, error = %e, "HTTP proxy session error");
                    }
                });
            }
            Err(e) => {
                warn!(error = %e, "Failed to accept HTTP proxy connection");
            }
        }
    }
}

async fn handle_http_client(stream: TcpStream, ctx: &ProxyContext) -> Result<()> {
    let mut buf_reader = BufReader::new(stream);

    // Read the request line: "METHOD target HTTP/1.x\r\n"
    let mut request_line = String::new();
    buf_reader.read_line(&mut request_line).await?;
    let request_line = request_line.trim_end();

    // Empty request line = browser preconnect probe
    if request_line.is_empty() {
        debug!("Empty request line (preconnect), closing");
        return Ok(());
    }

    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 3 {
        let mut stream = buf_reader.into_inner();
        send_http_error(&mut stream, 400, "Bad Request").await?;
        return Err(anyhow::anyhow!("Malformed request line: {}", request_line));
    }

    let method = parts[0];
    let target = parts[1];
    let version = parts[2];

    if method.eq_ignore_ascii_case("CONNECT") {
        handle_connect(buf_reader, target, ctx).await
    } else {
        handle_http_forward(buf_reader, method, target, version, ctx).await
    }
}

/// Handle CONNECT method (HTTPS tunneling).
async fn handle_connect(
    mut buf_reader: BufReader<TcpStream>,
    target: &str,
    ctx: &ProxyContext,
) -> Result<()> {
    // Parse host:port from CONNECT target
    let destination = parse_connect_target(target)?;

    // Consume remaining headers until empty line
    loop {
        let mut header = String::new();
        buf_reader.read_line(&mut header).await?;
        if header.trim().is_empty() {
            break;
        }
    }

    // Check routing rules
    let (domain, mut ip) = extract_address_parts(&destination);

    if ip.is_none() && ctx.router.needs_ip_for_routing() {
        ip = resolve_for_routing(domain, ctx).await;
    }

    // Smart DNS: domains that should be tunneled are always proxied
    let force_proxy = domain.is_some_and(|d| ctx.dns_resolver.should_tunnel_dns(d));

    match ctx.router.route(domain, ip, destination.port) {
        RouteAction::Block => {
            info!(dest = %destination, "HTTP CONNECT blocked by routing rule");
            let mut stream = buf_reader.into_inner();
            send_http_error(&mut stream, 403, "Forbidden").await?;
            return Ok(());
        }
        RouteAction::Direct if !force_proxy => {
            info!(dest = %destination, "HTTP CONNECT direct (bypassing proxy)");
            let dest_str = format_dest_str(&destination);
            let outbound = TcpStream::connect(&dest_str).await?;
            let mut stream = buf_reader.into_inner();
            stream
                .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                .await?;
            return relay::relay_direct(stream, outbound, ctx.metrics.clone()).await;
        }
        RouteAction::Direct => {
            debug!(dest = %destination, "Smart DNS overriding Direct route to Proxy");
        }
        RouteAction::Proxy => {}
    }

    info!(dest = %destination, "HTTP CONNECT");

    // Establish tunnel to remote Prisma server (with timeout)
    let tunnel_conn = match tokio::time::timeout(std::time::Duration::from_secs(30), async {
        let tunnel_stream = ctx.connect().await?;
        tunnel::establish_tunnel(
            tunnel_stream,
            ctx.client_id,
            ctx.auth_secret,
            ctx.cipher_suite,
            &destination,
            ctx.server_key_pin.as_deref(),
        )
        .await
    })
    .await
    {
        Ok(Ok(conn)) => conn,
        Ok(Err(e)) => {
            let mut stream = buf_reader.into_inner();
            let _ = send_http_error(&mut stream, 502, "Bad Gateway").await;
            return Err(e);
        }
        Err(_) => {
            let mut stream = buf_reader.into_inner();
            let _ = send_http_error(&mut stream, 504, "Gateway Timeout").await;
            return Err(anyhow::anyhow!(
                "Tunnel establishment timed out for {}",
                destination
            ));
        }
    };

    // Send 200 Connection Established
    let mut stream = buf_reader.into_inner();
    stream
        .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        .await?;

    // Relay data bidirectionally
    relay::relay(stream, tunnel_conn, ctx.metrics.clone()).await
}

/// Handle plain HTTP requests (GET http://host/path, POST http://host/path, etc.)
async fn handle_http_forward(
    mut buf_reader: BufReader<TcpStream>,
    method: &str,
    target: &str,
    version: &str,
    ctx: &ProxyContext,
) -> Result<()> {
    // Parse the absolute URL
    let (host, port, path) = parse_http_url(target)?;

    // Read headers, filtering out proxy-specific ones
    let mut headers = Vec::new();
    let mut has_host = false;
    loop {
        let mut header = String::new();
        buf_reader.read_line(&mut header).await?;
        if header.trim().is_empty() {
            break;
        }
        let lower = header.to_ascii_lowercase();
        if lower.starts_with("proxy-connection:") || lower.starts_with("proxy-authorization:") {
            continue;
        }
        if lower.starts_with("host:") {
            has_host = true;
        }
        headers.push(header);
    }

    // Reconstruct the request with a relative path
    let mut request = format!("{method} {path} {version}\r\n");
    if !has_host {
        if port == 80 {
            request.push_str(&format!("Host: {host}\r\n"));
        } else {
            request.push_str(&format!("Host: {host}:{port}\r\n"));
        }
    }
    for h in &headers {
        request.push_str(h);
    }
    request.push_str("Connection: close\r\n");
    request.push_str("\r\n");

    // Capture any buffered body data before consuming the BufReader
    let buffered_body = buf_reader.buffer().to_vec();
    let stream = buf_reader.into_inner();

    // Combine reconstructed request + any buffered body
    let mut initial_data = request.into_bytes();
    if !buffered_body.is_empty() {
        initial_data.extend_from_slice(&buffered_body);
    }

    // Build destination
    let dest_target = format!("{host}:{port}");
    let destination = parse_connect_target(&dest_target)?;

    // Routing
    let (domain, mut ip) = extract_address_parts(&destination);

    if ip.is_none() && ctx.router.needs_ip_for_routing() {
        ip = resolve_for_routing(domain, ctx).await;
    }

    // Smart DNS: domains that should be tunneled are always proxied
    let force_proxy = domain.is_some_and(|d| ctx.dns_resolver.should_tunnel_dns(d));

    match ctx.router.route(domain, ip, destination.port) {
        RouteAction::Block => {
            info!(dest = %destination, method, "HTTP forward blocked by routing rule");
            let mut stream = stream;
            send_http_error(&mut stream, 403, "Forbidden").await?;
            return Ok(());
        }
        RouteAction::Direct if !force_proxy => {
            info!(dest = %destination, method, "HTTP forward direct (bypassing proxy)");
            let dest_str = format_dest_str(&destination);
            let mut outbound = TcpStream::connect(&dest_str).await?;
            outbound.write_all(&initial_data).await?;
            return relay::relay_direct(stream, outbound, ctx.metrics.clone()).await;
        }
        RouteAction::Direct => {
            debug!(dest = %destination, method, "Smart DNS overriding Direct route to Proxy");
        }
        RouteAction::Proxy => {}
    }

    info!(dest = %destination, method, "HTTP forward via proxy");

    // Establish tunnel to remote Prisma server (with timeout)
    let mut tunnel_conn = match tokio::time::timeout(std::time::Duration::from_secs(30), async {
        let tunnel_stream = ctx.connect().await?;
        tunnel::establish_tunnel(
            tunnel_stream,
            ctx.client_id,
            ctx.auth_secret,
            ctx.cipher_suite,
            &destination,
            ctx.server_key_pin.as_deref(),
        )
        .await
    })
    .await
    {
        Ok(Ok(conn)) => conn,
        Ok(Err(e)) => {
            let mut stream = stream;
            let _ = send_http_error(&mut stream, 502, "Bad Gateway").await;
            return Err(e);
        }
        Err(_) => {
            let mut stream = stream;
            let _ = send_http_error(&mut stream, 504, "Gateway Timeout").await;
            return Err(anyhow::anyhow!(
                "Tunnel establishment timed out for {}",
                destination
            ));
        }
    };

    // Send the initial HTTP request data through the encrypted tunnel
    send_initial_data(&mut tunnel_conn, &initial_data).await?;

    // Relay remaining data bidirectionally
    relay::relay(stream, tunnel_conn, ctx.metrics.clone()).await
}

/// Send initial data through an encrypted tunnel before relay begins.
///
/// Encrypts data in chunks using the tunnel's frame encoder and advances
/// the nonce state so relay picks up the correct counter.
async fn send_initial_data(tunnel: &mut TunnelConnection, data: &[u8]) -> Result<()> {
    let mut encoder = FrameEncoder::new();
    let padding_range = tunnel.session_keys.padding_range;
    let header_key = tunnel.session_keys.header_key;

    for chunk in data.chunks(MAX_PAYLOAD_SIZE) {
        encoder.payload_mut()[..chunk.len()].copy_from_slice(chunk);
        let nonce = tunnel.session_keys.next_client_nonce();

        let wire = encoder
            .seal_data_frame_v5(
                tunnel.cipher.as_ref(),
                &nonce,
                chunk.len(),
                0,
                &padding_range,
                header_key.as_ref(),
            )
            .map_err(|e| anyhow::anyhow!("Failed to encrypt initial data: {}", e))?;

        tokio::io::AsyncWriteExt::write_all(&mut tunnel.stream, wire).await?;
    }

    Ok(())
}

/// Parse an absolute HTTP URL into (host, port, path_and_query).
///
/// Handles `http://host[:port][/path[?query]]` including IPv6 bracket notation.
/// Returns error for non-HTTP schemes.
fn parse_http_url(url: &str) -> Result<(&str, u16, &str)> {
    let rest = url
        .strip_prefix("http://")
        .ok_or_else(|| anyhow::anyhow!("Only http:// URLs are supported, got: {}", url))?;

    // Split host+port from path at the first '/'
    let (authority, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };

    // Parse host and port from authority, handling IPv6 brackets
    let (host, port) = if let Some(bracket_rest) = authority.strip_prefix('[') {
        // IPv6: [::1]:port or [::1]
        match bracket_rest.split_once("]:") {
            Some((addr, port_str)) => {
                let port: u16 = port_str
                    .parse()
                    .map_err(|_| anyhow::anyhow!("Invalid port in URL: {}", url))?;
                (addr, port)
            }
            None => {
                let addr = bracket_rest
                    .strip_suffix(']')
                    .ok_or_else(|| anyhow::anyhow!("Malformed IPv6 in URL: {}", url))?;
                (addr, 80)
            }
        }
    } else {
        match authority.rsplit_once(':') {
            Some((h, port_str)) => {
                let port: u16 = port_str
                    .parse()
                    .map_err(|_| anyhow::anyhow!("Invalid port in URL: {}", url))?;
                (h, port)
            }
            None => (authority, 80),
        }
    };

    Ok((host, port, path))
}

/// Extract domain/IP parts from a ProxyDestination for routing.
fn extract_address_parts(
    destination: &ProxyDestination,
) -> (Option<&str>, Option<std::net::IpAddr>) {
    let domain = match &destination.address {
        ProxyAddress::Domain(d) => Some(d.as_str()),
        _ => None,
    };
    let ip = match &destination.address {
        ProxyAddress::Ipv4(ip) => Some(std::net::IpAddr::V4(*ip)),
        ProxyAddress::Ipv6(ip) => Some(std::net::IpAddr::V6(*ip)),
        _ => None,
    };
    (domain, ip)
}

/// Resolve a domain to IP for routing decisions (GeoIP/IP-CIDR rules).
async fn resolve_for_routing(domain: Option<&str>, ctx: &ProxyContext) -> Option<std::net::IpAddr> {
    if let Some(d) = domain {
        match ctx.dns_resolver.resolve_direct(d).await {
            Ok(addrs) if !addrs.is_empty() => {
                debug!(domain = d, ip = %addrs[0], "Resolved domain for routing");
                Some(std::net::IpAddr::V4(addrs[0]))
            }
            Ok(_) => {
                debug!(
                    domain = d,
                    "DNS resolution returned no addresses for routing"
                );
                None
            }
            Err(e) => {
                debug!(domain = d, error = %e, "DNS resolution failed for routing");
                None
            }
        }
    } else {
        None
    }
}

/// Format a ProxyDestination as a connectable address string.
fn format_dest_str(destination: &ProxyDestination) -> String {
    match &destination.address {
        ProxyAddress::Domain(d) => format!("{}:{}", d, destination.port),
        ProxyAddress::Ipv4(ip) => format!("{}:{}", ip, destination.port),
        ProxyAddress::Ipv6(ip) => format!("[{}]:{}", ip, destination.port),
    }
}

/// Parse a CONNECT target like "example.com:443" or "[::1]:443" or "1.2.3.4:80"
fn parse_connect_target(target: &str) -> Result<ProxyDestination> {
    // Handle IPv6 bracket notation: [::1]:port
    if let Some(rest) = target.strip_prefix('[') {
        let (addr_str, port_str) = rest
            .split_once("]:")
            .ok_or_else(|| anyhow::anyhow!("Invalid IPv6 CONNECT target: {}", target))?;
        let port: u16 = port_str.parse()?;
        let addr: std::net::Ipv6Addr = addr_str.parse()?;
        return Ok(ProxyDestination {
            address: ProxyAddress::Ipv6(addr),
            port,
        });
    }

    // Split on last ':' to separate host from port
    let (host, port_str) = target
        .rsplit_once(':')
        .ok_or_else(|| anyhow::anyhow!("Missing port in CONNECT target: {}", target))?;
    let port: u16 = port_str
        .parse()
        .map_err(|_| anyhow::anyhow!("Invalid port in CONNECT target: {}", target))?;

    // Try parsing as IPv4, otherwise treat as domain
    if let Ok(ipv4) = host.parse::<std::net::Ipv4Addr>() {
        Ok(ProxyDestination {
            address: ProxyAddress::Ipv4(ipv4),
            port,
        })
    } else {
        Ok(ProxyDestination {
            address: ProxyAddress::Domain(host.to_string()),
            port,
        })
    }
}

async fn send_http_error(stream: &mut TcpStream, code: u16, reason: &str) -> Result<()> {
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        code, reason
    );
    stream.write_all(response.as_bytes()).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_domain_target() {
        let dest = parse_connect_target("example.com:443").unwrap();
        assert_eq!(dest.address, ProxyAddress::Domain("example.com".into()));
        assert_eq!(dest.port, 443);
    }

    #[test]
    fn test_parse_ipv4_target() {
        let dest = parse_connect_target("1.2.3.4:8080").unwrap();
        assert_eq!(dest.address, ProxyAddress::Ipv4("1.2.3.4".parse().unwrap()));
        assert_eq!(dest.port, 8080);
    }

    #[test]
    fn test_parse_ipv6_target() {
        let dest = parse_connect_target("[::1]:443").unwrap();
        assert_eq!(dest.address, ProxyAddress::Ipv6("::1".parse().unwrap()));
        assert_eq!(dest.port, 443);
    }

    #[test]
    fn test_parse_missing_port() {
        assert!(parse_connect_target("example.com").is_err());
    }

    #[test]
    fn test_parse_invalid_port() {
        assert!(parse_connect_target("example.com:notaport").is_err());
    }

    #[test]
    fn test_parse_http_url_simple() {
        let (host, port, path) = parse_http_url("http://example.com/path").unwrap();
        assert_eq!(host, "example.com");
        assert_eq!(port, 80);
        assert_eq!(path, "/path");
    }

    #[test]
    fn test_parse_http_url_with_port() {
        let (host, port, path) = parse_http_url("http://example.com:8080/path").unwrap();
        assert_eq!(host, "example.com");
        assert_eq!(port, 8080);
        assert_eq!(path, "/path");
    }

    #[test]
    fn test_parse_http_url_no_path() {
        let (host, port, path) = parse_http_url("http://example.com").unwrap();
        assert_eq!(host, "example.com");
        assert_eq!(port, 80);
        assert_eq!(path, "/");
    }

    #[test]
    fn test_parse_http_url_with_query() {
        let (host, port, path) = parse_http_url("http://example.com/s?q=1").unwrap();
        assert_eq!(host, "example.com");
        assert_eq!(port, 80);
        assert_eq!(path, "/s?q=1");
    }

    #[test]
    fn test_parse_http_url_ipv4() {
        let (host, port, path) = parse_http_url("http://1.2.3.4:8080/api").unwrap();
        assert_eq!(host, "1.2.3.4");
        assert_eq!(port, 8080);
        assert_eq!(path, "/api");
    }

    #[test]
    fn test_parse_http_url_https_rejected() {
        assert!(parse_http_url("https://example.com").is_err());
    }
}
