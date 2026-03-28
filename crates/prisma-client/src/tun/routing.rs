//! Platform-specific OS routing configuration for TUN mode.
//!
//! After creating the TUN device, this module:
//! 1. Assigns an IP address to the TUN interface
//! 2. Adds routes to direct traffic through the TUN device
//! 3. Excludes the proxy server endpoint to prevent routing loops
//!
//! Uses the split-route trick (0.0.0.0/1 + 128.0.0.0/1) instead of replacing
//! the default gateway, so the original default route is preserved as a fallback.
//!
//! `TunRouteGuard` implements `Drop` to clean up all routing changes.

use std::net::Ipv4Addr;

use anyhow::{Context, Result};
use tracing::{debug, info, warn};

/// The IP address assigned to the TUN interface (must match smoltcp stack).
const TUN_LOCAL_IP: Ipv4Addr = Ipv4Addr::new(10, 0, 85, 1);
#[cfg(target_os = "windows")]
const TUN_NETMASK: &str = "255.255.255.0";

/// Actions recorded for cleanup on Drop.
#[derive(Debug)]
enum CleanupAction {
    /// Remove a route that was added.
    RemoveRoute { args: Vec<String> },
    /// Remove an IP address from an interface.
    RemoveAddr { args: Vec<String> },
}

/// RAII guard that cleans up OS routing on drop.
pub struct TunRouteGuard {
    actions: Vec<CleanupAction>,
}

impl Drop for TunRouteGuard {
    fn drop(&mut self) {
        info!(
            "TUN route guard dropping — cleaning up {} routing changes",
            self.actions.len()
        );
        // Replay cleanup actions in reverse order
        for action in self.actions.iter().rev() {
            let result = match action {
                CleanupAction::RemoveRoute { args } => run_cmd(args),
                CleanupAction::RemoveAddr { args } => run_cmd(args),
            };
            if let Err(e) = result {
                warn!(error = %e, action = ?action, "TUN route cleanup failed");
            }
        }
    }
}

/// Configure OS routing for TUN mode.
///
/// `device_name`: name of the TUN interface (e.g., "prisma-tun0")
/// `server_addr`: proxy server address "host:port" to exclude from TUN
/// `include_routes`: CIDRs to route through TUN (e.g., ["0.0.0.0/0"])
/// `exclude_routes`: CIDRs to bypass TUN
pub fn setup_tun_routing(
    device_name: &str,
    server_addr: &str,
    include_routes: &[String],
    exclude_routes: &[String],
) -> Result<TunRouteGuard> {
    let mut guard = TunRouteGuard {
        actions: Vec::new(),
    };

    // Resolve the server IP from the server address (host:port or ip:port)
    let server_ip = resolve_server_ip(server_addr)?;
    info!(
        device = %device_name,
        server_ip = %server_ip,
        "Setting up TUN routing"
    );

    // Get the original default gateway before we modify routes
    let original_gw = get_default_gateway()?;
    info!(gateway = %original_gw, "Original default gateway");

    // Step 1: Assign IP address to TUN interface
    assign_tun_ip(device_name, &mut guard)?;

    // Step 2: Add server endpoint bypass (via original gateway)
    add_server_bypass(&server_ip, &original_gw, &mut guard)?;

    // Step 3: Add exclude routes (via original gateway)
    for route in exclude_routes {
        if !route.is_empty() {
            if let Err(e) = add_exclude_route(route, &original_gw, &mut guard) {
                warn!(route = %route, error = %e, "Failed to add exclude route");
            }
        }
    }

    // Step 4: Add include routes through TUN
    let use_default = include_routes.is_empty() || include_routes.iter().any(|r| r == "0.0.0.0/0");

    if use_default {
        // Split-route trick: 0.0.0.0/1 + 128.0.0.0/1 covers all IPs
        // without replacing the system's default gateway.
        add_tun_route(device_name, "0.0.0.0/1", &mut guard)?;
        add_tun_route(device_name, "128.0.0.0/1", &mut guard)?;
    } else {
        for route in include_routes {
            if !route.is_empty() {
                add_tun_route(device_name, route, &mut guard)?;
            }
        }
    }

    info!(
        cleanup_actions = guard.actions.len(),
        "TUN routing configured"
    );
    Ok(guard)
}

/// Resolve the server IP from "host:port" format.
fn resolve_server_ip(server_addr: &str) -> Result<Ipv4Addr> {
    // Strip port
    let host = server_addr
        .rsplit_once(':')
        .map(|(h, _)| h)
        .unwrap_or(server_addr);

    // Try parsing as IP first
    if let Ok(ip) = host.parse::<Ipv4Addr>() {
        return Ok(ip);
    }

    // DNS resolution
    use std::net::ToSocketAddrs;
    let addr_str = format!("{}:0", host);
    let addr = addr_str
        .to_socket_addrs()
        .context("Failed to resolve server hostname")?
        .find(|a| a.is_ipv4())
        .context("No IPv4 address for server")?;

    match addr.ip() {
        std::net::IpAddr::V4(ip) => Ok(ip),
        _ => unreachable!(),
    }
}

// =============================================================================
// Windows implementation
// =============================================================================

#[cfg(target_os = "windows")]
fn get_default_gateway() -> Result<Ipv4Addr> {
    // Parse `route print 0.0.0.0` to find the default gateway
    let output = std::process::Command::new("route")
        .args(["print", "0.0.0.0", "mask", "0.0.0.0"])
        .output()
        .context("Failed to run 'route print'")?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Look for a line like: "0.0.0.0  0.0.0.0  192.168.1.1  192.168.1.100  25"
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 && parts[0] == "0.0.0.0" && parts[1] == "0.0.0.0" {
            if let Ok(gw) = parts[2].parse::<Ipv4Addr>() {
                return Ok(gw);
            }
        }
    }

    Err(anyhow::anyhow!("Could not determine default gateway"))
}

#[cfg(target_os = "windows")]
fn assign_tun_ip(device_name: &str, guard: &mut TunRouteGuard) -> Result<()> {
    // Assign static IP to the TUN adapter
    run_cmd(&[
        "netsh",
        "interface",
        "ip",
        "set",
        "address",
        &format!("name={}", device_name),
        "static",
        &TUN_LOCAL_IP.to_string(),
        TUN_NETMASK,
    ])?;

    guard.actions.push(CleanupAction::RemoveAddr {
        args: vec![
            "netsh".into(),
            "interface".into(),
            "ip".into(),
            "set".into(),
            "address".into(),
            format!("name={}", device_name),
            "dhcp".into(),
        ],
    });

    debug!(device = %device_name, ip = %TUN_LOCAL_IP, "Assigned IP to TUN interface");
    Ok(())
}

#[cfg(target_os = "windows")]
fn add_server_bypass(
    server_ip: &Ipv4Addr,
    original_gw: &Ipv4Addr,
    guard: &mut TunRouteGuard,
) -> Result<()> {
    run_cmd(&[
        "route",
        "add",
        &server_ip.to_string(),
        "mask",
        "255.255.255.255",
        &original_gw.to_string(),
        "metric",
        "1",
    ])?;

    guard.actions.push(CleanupAction::RemoveRoute {
        args: vec!["route".into(), "delete".into(), server_ip.to_string()],
    });

    debug!(server = %server_ip, gateway = %original_gw, "Added server bypass route");
    Ok(())
}

#[cfg(target_os = "windows")]
fn add_exclude_route(cidr: &str, original_gw: &Ipv4Addr, guard: &mut TunRouteGuard) -> Result<()> {
    let (network, mask) = cidr_to_network_mask(cidr)?;

    run_cmd(&[
        "route",
        "add",
        &network,
        "mask",
        &mask,
        &original_gw.to_string(),
        "metric",
        "1",
    ])?;

    guard.actions.push(CleanupAction::RemoveRoute {
        args: vec!["route".into(), "delete".into(), network.clone()],
    });

    debug!(cidr = %cidr, gateway = %original_gw, "Added exclude route");
    Ok(())
}

#[cfg(target_os = "windows")]
fn add_tun_route(device_name: &str, cidr: &str, guard: &mut TunRouteGuard) -> Result<()> {
    let (network, mask) = cidr_to_network_mask(cidr)?;

    run_cmd(&[
        "route",
        "add",
        &network,
        "mask",
        &mask,
        &TUN_LOCAL_IP.to_string(),
        "metric",
        "5",
    ])?;

    guard.actions.push(CleanupAction::RemoveRoute {
        args: vec![
            "route".into(),
            "delete".into(),
            network.clone(),
            "mask".into(),
            mask.clone(),
            TUN_LOCAL_IP.to_string(),
        ],
    });

    debug!(cidr = %cidr, device = %device_name, "Added TUN route");
    Ok(())
}

// =============================================================================
// Linux implementation
// =============================================================================

#[cfg(target_os = "linux")]
fn get_default_gateway() -> Result<Ipv4Addr> {
    let output = std::process::Command::new("ip")
        .args(["route", "show", "default"])
        .output()
        .context("Failed to run 'ip route show default'")?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    // "default via 192.168.1.1 dev eth0"
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 && parts[0] == "default" && parts[1] == "via" {
            if let Ok(gw) = parts[2].parse::<Ipv4Addr>() {
                return Ok(gw);
            }
        }
    }

    Err(anyhow::anyhow!("Could not determine default gateway"))
}

#[cfg(target_os = "linux")]
fn assign_tun_ip(device_name: &str, guard: &mut TunRouteGuard) -> Result<()> {
    run_cmd(&[
        "ip",
        "addr",
        "add",
        &format!("{}/24", TUN_LOCAL_IP),
        "dev",
        device_name,
    ])?;
    run_cmd(&["ip", "link", "set", "dev", device_name, "up"])?;

    guard.actions.push(CleanupAction::RemoveAddr {
        args: vec![
            "ip".into(),
            "addr".into(),
            "del".into(),
            format!("{}/24", TUN_LOCAL_IP),
            "dev".into(),
            device_name.into(),
        ],
    });

    debug!(device = %device_name, ip = %TUN_LOCAL_IP, "Assigned IP to TUN interface");
    Ok(())
}

#[cfg(target_os = "linux")]
fn add_server_bypass(
    server_ip: &Ipv4Addr,
    original_gw: &Ipv4Addr,
    guard: &mut TunRouteGuard,
) -> Result<()> {
    run_cmd(&[
        "ip",
        "route",
        "add",
        &format!("{}/32", server_ip),
        "via",
        &original_gw.to_string(),
    ])?;

    guard.actions.push(CleanupAction::RemoveRoute {
        args: vec![
            "ip".into(),
            "route".into(),
            "del".into(),
            format!("{}/32", server_ip),
        ],
    });

    debug!(server = %server_ip, gateway = %original_gw, "Added server bypass route");
    Ok(())
}

#[cfg(target_os = "linux")]
fn add_exclude_route(cidr: &str, original_gw: &Ipv4Addr, guard: &mut TunRouteGuard) -> Result<()> {
    run_cmd(&["ip", "route", "add", cidr, "via", &original_gw.to_string()])?;

    guard.actions.push(CleanupAction::RemoveRoute {
        args: vec!["ip".into(), "route".into(), "del".into(), cidr.into()],
    });

    debug!(cidr = %cidr, gateway = %original_gw, "Added exclude route");
    Ok(())
}

#[cfg(target_os = "linux")]
fn add_tun_route(device_name: &str, cidr: &str, guard: &mut TunRouteGuard) -> Result<()> {
    run_cmd(&["ip", "route", "add", cidr, "dev", device_name])?;

    guard.actions.push(CleanupAction::RemoveRoute {
        args: vec![
            "ip".into(),
            "route".into(),
            "del".into(),
            cidr.into(),
            "dev".into(),
            device_name.into(),
        ],
    });

    debug!(cidr = %cidr, device = %device_name, "Added TUN route");
    Ok(())
}

// =============================================================================
// macOS implementation
// =============================================================================

#[cfg(target_os = "macos")]
fn get_default_gateway() -> Result<Ipv4Addr> {
    let output = std::process::Command::new("route")
        .args(["-n", "get", "default"])
        .output()
        .context("Failed to run 'route -n get default'")?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    // "gateway: 192.168.1.1"
    for line in stdout.lines() {
        let trimmed = line.trim();
        if let Some(gw_str) = trimmed.strip_prefix("gateway:") {
            if let Ok(gw) = gw_str.trim().parse::<Ipv4Addr>() {
                return Ok(gw);
            }
        }
    }

    Err(anyhow::anyhow!("Could not determine default gateway"))
}

#[cfg(target_os = "macos")]
fn assign_tun_ip(device_name: &str, guard: &mut TunRouteGuard) -> Result<()> {
    // macOS utun point-to-point: ifconfig utunN inet <local> <peer> mtu <mtu> up
    run_cmd(&[
        "ifconfig",
        device_name,
        "inet",
        &TUN_LOCAL_IP.to_string(),
        &TUN_LOCAL_IP.to_string(),
        "mtu",
        "1500",
        "up",
    ])?;

    guard.actions.push(CleanupAction::RemoveAddr {
        args: vec!["ifconfig".into(), device_name.into(), "down".into()],
    });

    debug!(device = %device_name, ip = %TUN_LOCAL_IP, "Assigned IP to TUN interface");
    Ok(())
}

#[cfg(target_os = "macos")]
fn add_server_bypass(
    server_ip: &Ipv4Addr,
    original_gw: &Ipv4Addr,
    guard: &mut TunRouteGuard,
) -> Result<()> {
    run_cmd(&[
        "route",
        "add",
        "-host",
        &server_ip.to_string(),
        &original_gw.to_string(),
    ])?;

    guard.actions.push(CleanupAction::RemoveRoute {
        args: vec![
            "route".into(),
            "delete".into(),
            "-host".into(),
            server_ip.to_string(),
        ],
    });

    debug!(server = %server_ip, gateway = %original_gw, "Added server bypass route");
    Ok(())
}

#[cfg(target_os = "macos")]
fn add_exclude_route(cidr: &str, original_gw: &Ipv4Addr, guard: &mut TunRouteGuard) -> Result<()> {
    run_cmd(&["route", "add", "-net", cidr, &original_gw.to_string()])?;

    guard.actions.push(CleanupAction::RemoveRoute {
        args: vec!["route".into(), "delete".into(), "-net".into(), cidr.into()],
    });

    debug!(cidr = %cidr, gateway = %original_gw, "Added exclude route");
    Ok(())
}

#[cfg(target_os = "macos")]
fn add_tun_route(device_name: &str, cidr: &str, guard: &mut TunRouteGuard) -> Result<()> {
    run_cmd(&["route", "add", "-net", cidr, "-interface", device_name])?;

    guard.actions.push(CleanupAction::RemoveRoute {
        args: vec!["route".into(), "delete".into(), "-net".into(), cidr.into()],
    });

    debug!(cidr = %cidr, device = %device_name, "Added TUN route");
    Ok(())
}

// =============================================================================
// Unsupported platforms
// =============================================================================

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn get_default_gateway() -> Result<Ipv4Addr> {
    Err(anyhow::anyhow!(
        "TUN routing not supported on this platform"
    ))
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn assign_tun_ip(_device_name: &str, _guard: &mut TunRouteGuard) -> Result<()> {
    Err(anyhow::anyhow!(
        "TUN routing not supported on this platform"
    ))
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn add_server_bypass(
    _server_ip: &Ipv4Addr,
    _original_gw: &Ipv4Addr,
    _guard: &mut TunRouteGuard,
) -> Result<()> {
    Err(anyhow::anyhow!(
        "TUN routing not supported on this platform"
    ))
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn add_exclude_route(
    _cidr: &str,
    _original_gw: &Ipv4Addr,
    _guard: &mut TunRouteGuard,
) -> Result<()> {
    Err(anyhow::anyhow!(
        "TUN routing not supported on this platform"
    ))
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn add_tun_route(_device_name: &str, _cidr: &str, _guard: &mut TunRouteGuard) -> Result<()> {
    Err(anyhow::anyhow!(
        "TUN routing not supported on this platform"
    ))
}

// =============================================================================
// Helpers
// =============================================================================

/// Run a system command, returning an error if it fails.
fn run_cmd(args: &[impl AsRef<str>]) -> Result<()> {
    let args_str: Vec<&str> = args.iter().map(|a| a.as_ref()).collect();
    if args_str.is_empty() {
        return Err(anyhow::anyhow!("Empty command"));
    }

    debug!(cmd = %args_str.join(" "), "Running routing command");

    let output = std::process::Command::new(args_str[0])
        .args(&args_str[1..])
        .output()
        .with_context(|| format!("Failed to run: {}", args_str.join(" ")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(anyhow::anyhow!(
            "Command failed (exit {}): {}\nstdout: {}\nstderr: {}",
            output.status.code().unwrap_or(-1),
            args_str.join(" "),
            stdout.trim(),
            stderr.trim(),
        ));
    }

    Ok(())
}

/// Convert CIDR notation (e.g., "0.0.0.0/1") to (network, subnet_mask) pair.
#[cfg(any(target_os = "windows", test))]
fn cidr_to_network_mask(cidr: &str) -> Result<(String, String)> {
    let (network, prefix) = cidr
        .split_once('/')
        .context("Invalid CIDR format (expected 'x.x.x.x/n')")?;

    let prefix_len: u8 = prefix.parse().context("Invalid prefix length")?;
    if prefix_len > 32 {
        return Err(anyhow::anyhow!("Prefix length must be 0-32"));
    }

    let mask_bits: u32 = if prefix_len == 0 {
        0
    } else {
        !0u32 << (32 - prefix_len)
    };
    let mask = Ipv4Addr::from(mask_bits);

    Ok((network.to_string(), mask.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cidr_to_network_mask() {
        let (net, mask) = cidr_to_network_mask("0.0.0.0/1").unwrap();
        assert_eq!(net, "0.0.0.0");
        assert_eq!(mask, "128.0.0.0");

        let (net, mask) = cidr_to_network_mask("128.0.0.0/1").unwrap();
        assert_eq!(net, "128.0.0.0");
        assert_eq!(mask, "128.0.0.0");

        let (net, mask) = cidr_to_network_mask("192.168.0.0/16").unwrap();
        assert_eq!(net, "192.168.0.0");
        assert_eq!(mask, "255.255.0.0");

        let (net, mask) = cidr_to_network_mask("10.0.0.0/8").unwrap();
        assert_eq!(net, "10.0.0.0");
        assert_eq!(mask, "255.0.0.0");

        let (_, mask) = cidr_to_network_mask("0.0.0.0/0").unwrap();
        assert_eq!(mask, "0.0.0.0");

        let (_, mask) = cidr_to_network_mask("1.2.3.4/32").unwrap();
        assert_eq!(mask, "255.255.255.255");
    }

    #[test]
    fn test_cidr_invalid() {
        assert!(cidr_to_network_mask("no-slash").is_err());
        assert!(cidr_to_network_mask("0.0.0.0/33").is_err());
        assert!(cidr_to_network_mask("0.0.0.0/abc").is_err());
    }

    #[test]
    fn test_resolve_server_ip_literal() {
        let ip = resolve_server_ip("1.2.3.4:443").unwrap();
        assert_eq!(ip, Ipv4Addr::new(1, 2, 3, 4));

        let ip = resolve_server_ip("10.0.0.1").unwrap();
        assert_eq!(ip, Ipv4Addr::new(10, 0, 0, 1));
    }
}
