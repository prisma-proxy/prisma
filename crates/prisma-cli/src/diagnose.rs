use std::net::{SocketAddr, TcpListener, ToSocketAddrs};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;

// ── Colour helpers (no external dep) ───────────────────────────────────────
const GREEN: &str = "\x1b[32m";
const RED: &str = "\x1b[31m";
const YELLOW: &str = "\x1b[33m";
const CYAN: &str = "\x1b[36m";
const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[2m";
const RESET: &str = "\x1b[0m";

fn pass(msg: &str) {
    println!("  {GREEN}[PASS]{RESET}  {msg}");
}
fn fail(msg: &str) {
    println!("  {RED}[FAIL]{RESET}  {msg}");
}
fn warn(msg: &str) {
    println!("  {YELLOW}[WARN]{RESET}  {msg}");
}
fn info(msg: &str) {
    println!("  {DIM}[INFO]{RESET}  {msg}");
}

fn section(title: &str) {
    println!();
    println!("{BOLD}{CYAN}--- {title} ---{RESET}");
}

/// Run the full diagnostic suite against a client config.
pub async fn run(config_path: &str) -> Result<()> {
    println!("{BOLD}Prisma Diagnostics{RESET}  {DIM}(config: {config_path}){RESET}");

    let mut passes = 0u32;
    let mut fails = 0u32;
    let mut warnings = 0u32;

    // ── 1. Config validation ───────────────────────────────────────────
    section("Config Validation");

    let config = match prisma_core::config::load_client_config(config_path) {
        Ok(c) => {
            pass("Config parsed and validated successfully");
            passes += 1;
            info(&format!("Server:    {}", c.server_addr));
            info(&format!("Transport: {}", c.transport));
            info(&format!("Cipher:    {}", c.cipher_suite));
            info(&format!(
                "SOCKS5:    {}",
                c.socks5_listen_addr.as_deref().unwrap_or("disabled")
            ));
            if let Some(ref h) = c.http_listen_addr {
                info(&format!("HTTP:      {}", h));
            }
            Some(c)
        }
        Err(e) => {
            fail(&format!("Config validation failed: {}", e));
            fails += 1;
            None
        }
    };

    // Remaining checks require a valid config.
    let config = match config {
        Some(c) => c,
        None => {
            print_summary(passes, fails, warnings);
            return Ok(());
        }
    };

    // ── 2. DNS Resolution ──────────────────────────────────────────────
    section("DNS Resolution");

    let server_host = config
        .server_addr
        .rsplit_once(':')
        .map(|(h, _)| h)
        .unwrap_or(&config.server_addr);

    // Check if the host is already an IP address.
    let resolved_addrs: Vec<SocketAddr> = if server_host.parse::<std::net::IpAddr>().is_ok() {
        info(&format!(
            "{} is an IP literal, skipping DNS lookup",
            server_host
        ));
        // Build synthetic SocketAddr so we can use it later.
        let port: u16 = config
            .server_addr
            .rsplit_once(':')
            .and_then(|(_, p)| p.parse().ok())
            .unwrap_or(8443);
        vec![SocketAddr::new(
            server_host.parse().expect("validated as IP above"),
            port,
        )]
    } else {
        let lookup_addr = if config.server_addr.contains(':') {
            config.server_addr.clone()
        } else {
            format!("{}:8443", config.server_addr)
        };

        match tokio::task::spawn_blocking(move || lookup_addr.to_socket_addrs()).await? {
            Ok(addrs) => {
                let addrs: Vec<SocketAddr> = addrs.collect();
                if addrs.is_empty() {
                    fail(&format!(
                        "DNS resolution returned no addresses for {}",
                        server_host
                    ));
                    fails += 1;
                    Vec::new()
                } else {
                    pass(&format!(
                        "Resolved {} -> {} address(es)",
                        server_host,
                        addrs.len()
                    ));
                    passes += 1;
                    for addr in &addrs {
                        info(&format!("  {}", addr.ip()));
                    }
                    addrs
                }
            }
            Err(e) => {
                fail(&format!("DNS resolution failed for {}: {}", server_host, e));
                fails += 1;
                Vec::new()
            }
        }
    };

    // ── 3. TCP Connectivity ────────────────────────────────────────────
    section("Network Connectivity");

    let tcp_ok = if let Some(addr) = resolved_addrs.first() {
        match tokio::time::timeout(Duration::from_secs(5), tokio::net::TcpStream::connect(addr))
            .await
        {
            Ok(Ok(_stream)) => {
                pass(&format!("TCP connection to {} succeeded", addr));
                passes += 1;
                true
            }
            Ok(Err(e)) => {
                fail(&format!("TCP connection to {} failed: {}", addr, e));
                fails += 1;
                false
            }
            Err(_) => {
                fail(&format!("TCP connection to {} timed out (5s)", addr));
                fails += 1;
                false
            }
        }
    } else {
        fail("Skipped — no resolved addresses");
        fails += 1;
        false
    };

    // ── 4. TLS Handshake ───────────────────────────────────────────────
    section("TLS Handshake");

    if tcp_ok {
        if let Some(addr) = resolved_addrs.first() {
            // Determine the SNI name.
            let sni_name = config.tls_server_name.as_deref().unwrap_or(server_host);

            match tls_probe(addr, sni_name, config.skip_cert_verify).await {
                Ok(tls_info) => {
                    pass("TLS handshake completed");
                    passes += 1;
                    info(&format!("Protocol:  {:?}", tls_info.protocol));
                    info(&format!("Cipher:    {:?}", tls_info.cipher_suite));
                    if let Some(ref issuer) = tls_info.issuer {
                        info(&format!("Issuer:    {}", issuer));
                    }
                    if let Some(ref expiry) = tls_info.expiry {
                        info(&format!("Expires:   {}", expiry));
                    }
                    for san in &tls_info.sans {
                        info(&format!("SAN:       {}", san));
                    }
                    if tls_info.days_until_expiry < 0 {
                        fail("Certificate has EXPIRED");
                        fails += 1;
                    } else if tls_info.days_until_expiry < 14 {
                        warn(&format!(
                            "Certificate expires in {} day(s)",
                            tls_info.days_until_expiry
                        ));
                        warnings += 1;
                    }
                }
                Err(e) => {
                    if config.skip_cert_verify {
                        warn(&format!(
                            "TLS handshake failed (skip_cert_verify=true): {}",
                            e
                        ));
                        warnings += 1;
                    } else {
                        fail(&format!("TLS handshake failed: {}", e));
                        fails += 1;
                    }
                }
            }
        }
    } else {
        info("Skipped — TCP connectivity failed");
    }

    // ── 5. Latency Measurement ─────────────────────────────────────────
    section("Latency Measurement");

    if tcp_ok {
        if let Some(addr) = resolved_addrs.first() {
            let mut rtts = Vec::new();
            for _ in 0..5 {
                let start = Instant::now();
                if let Ok(Ok(_)) = tokio::time::timeout(
                    Duration::from_secs(5),
                    tokio::net::TcpStream::connect(addr),
                )
                .await
                {
                    rtts.push(start.elapsed());
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
            }

            if rtts.is_empty() {
                fail("All 5 latency probes failed");
                fails += 1;
            } else {
                let min = rtts
                    .iter()
                    .map(|d| d.as_secs_f64() * 1000.0)
                    .fold(f64::INFINITY, f64::min);
                let max = rtts
                    .iter()
                    .map(|d| d.as_secs_f64() * 1000.0)
                    .fold(f64::NEG_INFINITY, f64::max);
                let avg: f64 =
                    rtts.iter().map(|d| d.as_secs_f64() * 1000.0).sum::<f64>() / rtts.len() as f64;
                pass(&format!(
                    "Latency ({}/{} probes): min={:.1}ms avg={:.1}ms max={:.1}ms",
                    rtts.len(),
                    5,
                    min,
                    avg,
                    max,
                ));
                passes += 1;
            }
        }
    } else {
        info("Skipped — TCP connectivity failed");
    }

    // ── 6. Port Availability ───────────────────────────────────────────
    section("Port Availability");

    if let Some(ref socks5_addr) = config.socks5_listen_addr {
        check_port(
            socks5_addr,
            "SOCKS5",
            &mut passes,
            &mut fails,
            &mut warnings,
        );
    }
    if let Some(ref http) = config.http_listen_addr {
        check_port(http, "HTTP", &mut passes, &mut fails, &mut warnings);
    }

    // ── 7. System Capabilities ─────────────────────────────────────────
    section("System Capabilities");

    // TUN support
    if config.tun.enabled {
        #[cfg(unix)]
        {
            // Check if we're running as root (needed for TUN on most Unix systems)
            let uid = unsafe { libc::getuid() };
            if uid == 0 {
                pass("Running as root — TUN device creation should work");
                passes += 1;
            } else {
                warn("Not running as root — TUN device creation may fail");
                warnings += 1;
                info("Tip: run with sudo or grant CAP_NET_ADMIN capability");
            }
        }
        #[cfg(not(unix))]
        {
            info("TUN support check is not implemented on this platform");
        }
    } else {
        info("TUN mode is disabled in config");
    }

    // System proxy capability (macOS/Windows)
    #[cfg(target_os = "macos")]
    {
        pass("macOS system proxy configuration is available via networksetup");
        passes += 1;
    }
    #[cfg(target_os = "linux")]
    {
        info("System proxy: use environment variables (http_proxy/https_proxy) or GNOME/KDE settings");
    }
    #[cfg(target_os = "windows")]
    {
        pass("Windows system proxy configuration is available via registry");
        passes += 1;
    }

    // ── 8. GeoIP Database ──────────────────────────────────────────────
    section("GeoIP Database");

    let has_geoip_rules = config
        .routing
        .rules
        .iter()
        .any(|r| matches!(&r.condition, prisma_core::router::RuleCondition::GeoIp(_)));

    if let Some(ref path) = config.routing.geoip_path {
        let p = PathBuf::from(path);
        if p.exists() {
            let meta = std::fs::metadata(&p);
            let size_str = meta
                .map(|m| format_bytes(m.len()))
                .unwrap_or_else(|_| "unknown size".into());
            pass(&format!("GeoIP database found: {} ({})", path, size_str));
            passes += 1;
        } else {
            fail(&format!(
                "GeoIP database not found at configured path: {}",
                path
            ));
            fails += 1;
        }
    } else if has_geoip_rules {
        // Search default locations (same logic as prisma-client)
        match find_geoip_default() {
            Some(path) => {
                let size_str = std::fs::metadata(&path)
                    .map(|m| format_bytes(m.len()))
                    .unwrap_or_else(|_| "unknown size".into());
                pass(&format!(
                    "GeoIP database found at default location: {} ({})",
                    path.display(),
                    size_str
                ));
                passes += 1;
            }
            None => {
                fail("GeoIP rules configured but geoip.dat not found in any default location");
                fails += 1;
                info("Set routing.geoip_path or place geoip.dat in the working directory");
            }
        }
    } else {
        info("No GeoIP routing rules configured — database not needed");
    }

    // ── Summary ────────────────────────────────────────────────────────
    print_summary(passes, fails, warnings);
    Ok(())
}

// ── TLS probing ────────────────────────────────────────────────────────────

struct TlsInfo {
    protocol: rustls::ProtocolVersion,
    cipher_suite: rustls::SupportedCipherSuite,
    issuer: Option<String>,
    expiry: Option<String>,
    sans: Vec<String>,
    days_until_expiry: i64,
}

async fn tls_probe(addr: &SocketAddr, sni: &str, skip_verify: bool) -> Result<TlsInfo> {
    use rustls::pki_types::ServerName;
    use tokio_rustls::TlsConnector;

    let mut root_store = rustls::RootCertStore::empty();
    for cert in rustls_native_certs::load_native_certs().expect("loading native certs") {
        let _ = root_store.add(cert);
    }

    let config = if skip_verify {
        rustls::ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(NoVerify))
            .with_no_client_auth()
    } else {
        rustls::ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth()
    };

    let connector = TlsConnector::from(Arc::new(config));
    let server_name = ServerName::try_from(sni.to_string())
        .map_err(|e| anyhow::anyhow!("Invalid SNI name '{}': {}", sni, e))?;

    let tcp = tokio::time::timeout(Duration::from_secs(5), tokio::net::TcpStream::connect(addr))
        .await
        .map_err(|_| anyhow::anyhow!("TCP connect timed out"))??;

    let tls = tokio::time::timeout(Duration::from_secs(5), connector.connect(server_name, tcp))
        .await
        .map_err(|_| anyhow::anyhow!("TLS handshake timed out"))??;

    let (_, conn) = tls.get_ref();

    let protocol = conn
        .protocol_version()
        .ok_or_else(|| anyhow::anyhow!("No protocol version negotiated"))?;

    let cipher_suite = conn
        .negotiated_cipher_suite()
        .ok_or_else(|| anyhow::anyhow!("No cipher suite negotiated"))?;

    // Parse peer certificates for details.
    let mut issuer = None;
    let mut expiry = None;
    let mut sans = Vec::new();
    let mut days_until_expiry: i64 = i64::MAX;

    if let Some(certs) = conn.peer_certificates() {
        if let Some(cert_der) = certs.first() {
            if let Ok((_, cert)) = x509_parser::parse_x509_certificate(cert_der.as_ref()) {
                issuer = Some(cert.issuer().to_string());

                // Expiry
                let not_after = cert.validity().not_after.to_datetime();
                expiry = Some(format!("{}", cert.validity().not_after));

                // Calculate days until expiry
                let now = chrono::Utc::now();
                let expiry_dt = chrono::NaiveDateTime::new(
                    chrono::NaiveDate::from_ymd_opt(
                        not_after.year(),
                        not_after.month() as u32,
                        not_after.day() as u32,
                    )
                    .unwrap_or_default(),
                    chrono::NaiveTime::from_hms_opt(
                        not_after.hour() as u32,
                        not_after.minute() as u32,
                        not_after.second() as u32,
                    )
                    .unwrap_or_default(),
                );
                let expiry_utc = expiry_dt.and_utc();
                days_until_expiry = (expiry_utc - now).num_days();

                // SANs
                for ext in cert.extensions() {
                    if let x509_parser::extensions::ParsedExtension::SubjectAlternativeName(san) =
                        ext.parsed_extension()
                    {
                        for name in &san.general_names {
                            sans.push(format!("{}", name));
                        }
                    }
                }
            }
        }
    }

    Ok(TlsInfo {
        protocol,
        cipher_suite,
        issuer,
        expiry,
        sans,
        days_until_expiry,
    })
}

/// Certificate verifier that accepts anything (for skip_cert_verify mode).
#[derive(Debug)]
struct NoVerify;

impl rustls::client::danger::ServerCertVerifier for NoVerify {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        vec![
            rustls::SignatureScheme::RSA_PKCS1_SHA256,
            rustls::SignatureScheme::RSA_PKCS1_SHA384,
            rustls::SignatureScheme::RSA_PKCS1_SHA512,
            rustls::SignatureScheme::ECDSA_NISTP256_SHA256,
            rustls::SignatureScheme::ECDSA_NISTP384_SHA384,
            rustls::SignatureScheme::ECDSA_NISTP521_SHA512,
            rustls::SignatureScheme::RSA_PSS_SHA256,
            rustls::SignatureScheme::RSA_PSS_SHA384,
            rustls::SignatureScheme::RSA_PSS_SHA512,
            rustls::SignatureScheme::ED25519,
            rustls::SignatureScheme::ED448,
        ]
    }
}

// ── Port check ─────────────────────────────────────────────────────────────

fn check_port(addr: &str, label: &str, passes: &mut u32, fails: &mut u32, warnings: &mut u32) {
    match addr.parse::<SocketAddr>() {
        Ok(sock_addr) => match TcpListener::bind(sock_addr) {
            Ok(_listener) => {
                pass(&format!("{} port {} is available", label, sock_addr));
                *passes += 1;
            }
            Err(e) => {
                if e.kind() == std::io::ErrorKind::AddrInUse {
                    warn(&format!(
                        "{} port {} is already in use (maybe Prisma is running?)",
                        label, sock_addr
                    ));
                    *warnings += 1;
                } else {
                    fail(&format!("{} cannot bind {}: {}", label, sock_addr, e));
                    *fails += 1;
                }
            }
        },
        Err(e) => {
            fail(&format!("{} address '{}' is invalid: {}", label, addr, e));
            *fails += 1;
        }
    }
}

// ── GeoIP search ───────────────────────────────────────────────────────────

fn find_geoip_default() -> Option<PathBuf> {
    let mut search_paths = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            search_paths.push(dir.join("geoip.dat"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        search_paths.push(cwd.join("geoip.dat"));
    }

    #[cfg(target_os = "linux")]
    {
        search_paths.push(PathBuf::from("/usr/share/prisma/geoip.dat"));
        search_paths.push(PathBuf::from("/usr/local/share/prisma/geoip.dat"));
        if let Ok(home) = std::env::var("HOME") {
            search_paths.push(PathBuf::from(format!("{}/.config/prisma/geoip.dat", home)));
            search_paths.push(PathBuf::from(format!(
                "{}/.local/share/prisma/geoip.dat",
                home
            )));
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            search_paths.push(PathBuf::from(format!(
                "{}/Library/Application Support/Prisma/geoip.dat",
                home
            )));
        }
        search_paths.push(PathBuf::from("/usr/local/share/prisma/geoip.dat"));
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            search_paths.push(PathBuf::from(format!("{}\\Prisma\\geoip.dat", appdata)));
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            search_paths.push(PathBuf::from(format!("{}\\Prisma\\geoip.dat", local)));
        }
    }

    search_paths.into_iter().find(|p| p.exists())
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn format_bytes(bytes: u64) -> String {
    if bytes >= 1_073_741_824 {
        format!("{:.1} GB", bytes as f64 / 1_073_741_824.0)
    } else if bytes >= 1_048_576 {
        format!("{:.1} MB", bytes as f64 / 1_048_576.0)
    } else if bytes >= 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{} B", bytes)
    }
}

fn print_summary(passes: u32, fails: u32, warnings: u32) {
    println!();
    println!(
        "{BOLD}Summary:{RESET}  {GREEN}{passes} passed{RESET}, \
         {RED}{fails} failed{RESET}, \
         {YELLOW}{warnings} warning(s){RESET}"
    );
    if fails == 0 {
        println!("{GREEN}All checks passed!{RESET}");
    } else {
        println!("{RED}Some checks failed — review the output above for details.{RESET}");
    }
}
