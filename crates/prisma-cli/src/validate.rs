use std::net::SocketAddr;
use std::path::Path;

use anyhow::Result;
use colored::Colorize;

pub fn run_validate(config_path: &str, config_type: &str) -> Result<()> {
    match config_type {
        "server" => validate_server(config_path),
        "client" => validate_client(config_path),
        _ => Err(anyhow::anyhow!(
            "Unknown config type '{}'. Use 'server' or 'client'.",
            config_type
        )),
    }
}

/// Read a TOML file from disk and return its contents.
/// On failure, prints a colored error message with context.
fn read_config_file(path: &str) -> Result<String> {
    let abs_path = if Path::new(path).is_absolute() {
        path.to_string()
    } else {
        std::env::current_dir()
            .map(|d| d.join(path).display().to_string())
            .unwrap_or_else(|_| path.to_string())
    };

    std::fs::read_to_string(path).map_err(|e| {
        anyhow::anyhow!(
            "{} Cannot read config file '{}': {}",
            "Error:".red().bold(),
            abs_path,
            e
        )
    })
}

// ---------------------------------------------------------------------------
// Server validation
// ---------------------------------------------------------------------------

fn validate_server(path: &str) -> Result<()> {
    println!("{} Validating server config: {}", ">>".cyan().bold(), path);
    println!();

    // 1. Read the file
    let _raw = read_config_file(path)?;

    // 2. Parse through prisma-core (which includes structural + semantic validation)
    let config = match prisma_core::config::load_server_config(path) {
        Ok(c) => c,
        Err(e) => {
            println!(
                "  {} {}",
                "Error:".red().bold(),
                format_config_error(&e.to_string())
            );
            return Err(anyhow::anyhow!("Config validation failed"));
        }
    };

    // 3. Additional semantic checks (warnings + extended errors)
    let mut warnings: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    // auth_secret length check: should be 64 hex chars (32 bytes)
    for (i, client) in config.authorized_clients.iter().enumerate() {
        let label = client.name.as_deref().unwrap_or(&client.id);
        if client.auth_secret.len() != 64 {
            errors.push(format!(
                "authorized_clients[{}] ({}): auth_secret should be 64 hex chars (32 bytes), got {} chars",
                i, label, client.auth_secret.len()
            ));
        }
    }

    // listen_addr is valid socket address
    if config.listen_addr.parse::<SocketAddr>().is_err() {
        errors.push(format!(
            "listen_addr '{}' is not a valid socket address (expected host:port)",
            config.listen_addr
        ));
    }

    // quic_listen_addr is valid socket address
    if config.quic_listen_addr.parse::<SocketAddr>().is_err() {
        errors.push(format!(
            "quic_listen_addr '{}' is not a valid socket address (expected host:port)",
            config.quic_listen_addr
        ));
    }

    // Port range check
    if config.port_forwarding.enabled
        && config.port_forwarding.port_range_start >= config.port_forwarding.port_range_end
    {
        errors.push(format!(
            "port_forwarding: port_range_start ({}) must be < port_range_end ({})",
            config.port_forwarding.port_range_start, config.port_forwarding.port_range_end
        ));
    }

    // TLS: if tls configured, check cert/key files exist on disk
    if let Some(ref tls) = config.tls {
        if !Path::new(&tls.cert_path).exists() {
            errors.push(format!(
                "tls.cert_path '{}' does not exist on disk",
                tls.cert_path
            ));
        }
        if !Path::new(&tls.key_path).exists() {
            errors.push(format!(
                "tls.key_path '{}' does not exist on disk",
                tls.key_path
            ));
        }
    }

    // CDN TLS: if cdn enabled with tls, check files exist
    if config.cdn.enabled {
        if let Some(ref tls) = config.cdn.tls {
            if !Path::new(&tls.cert_path).exists() {
                errors.push(format!(
                    "cdn.tls.cert_path '{}' does not exist on disk",
                    tls.cert_path
                ));
            }
            if !Path::new(&tls.key_path).exists() {
                errors.push(format!(
                    "cdn.tls.key_path '{}' does not exist on disk",
                    tls.key_path
                ));
            }
        }
    }

    // Management API warnings
    if config.management_api.enabled {
        if config.management_api.auth_token.is_empty() {
            warnings.push(
                "management_api is enabled but auth_token is empty -- API is unprotected"
                    .to_string(),
            );
        } else if config.management_api.auth_token.len() < 16 {
            warnings.push(format!(
                "management_api.auth_token is only {} chars -- consider using at least 16 chars",
                config.management_api.auth_token.len()
            ));
        }

        // Check management API TLS cert files if TLS is enabled
        if config.management_api.tls_enabled {
            if let Some(ref tls) = config.management_api.tls {
                if !Path::new(&tls.cert_path).exists() {
                    errors.push(format!(
                        "management_api.tls.cert_path '{}' does not exist on disk",
                        tls.cert_path
                    ));
                }
                if !Path::new(&tls.key_path).exists() {
                    errors.push(format!(
                        "management_api.tls.key_path '{}' does not exist on disk",
                        tls.key_path
                    ));
                }
            }
        }
    }

    // Warn if no authorized clients (though prisma-core should catch this as error)
    if config.authorized_clients.is_empty() {
        warnings.push(
            "No authorized_clients defined -- server will reject all connections".to_string(),
        );
    }

    // Camouflage fallback warning
    if config.camouflage.enabled && config.camouflage.fallback_addr.is_none() {
        warnings.push(
            "camouflage is enabled but no fallback_addr set -- non-Prisma connections will be dropped".to_string(),
        );
    }

    // SSH host key path
    if config.ssh.enabled {
        if let Some(ref key_path) = config.ssh.host_key_path {
            if !Path::new(key_path).exists() {
                errors.push(format!(
                    "ssh.host_key_path '{}' does not exist on disk",
                    key_path
                ));
            }
        }
    }

    // Print errors
    for err in &errors {
        println!("  {} {}", "Error:".red().bold(), err);
    }

    // Print warnings
    for warn in &warnings {
        println!("  {} {}", "Warning:".yellow().bold(), warn);
    }

    if !errors.is_empty() {
        println!();
        println!(
            "  {} Config has {} error(s)",
            "FAIL".red().bold(),
            errors.len()
        );
        return Err(anyhow::anyhow!("Config validation failed"));
    }

    // 4. Summary
    println!("  {} Config is valid", "OK".green().bold());
    println!();
    println!("  Listen (TCP):    {}", config.listen_addr);
    println!("  Listen (QUIC):   {}", config.quic_listen_addr);
    println!(
        "  TLS:             {}",
        if config.tls.is_some() {
            "configured".green().to_string()
        } else {
            "not configured".yellow().to_string()
        }
    );
    println!("  Clients:         {}", config.authorized_clients.len());
    println!(
        "  Camouflage:      {}",
        if config.camouflage.enabled {
            "enabled".green().to_string()
        } else {
            "disabled".dimmed().to_string()
        }
    );
    println!(
        "  CDN:             {}",
        if config.cdn.enabled {
            format!("enabled ({})", config.cdn.listen_addr)
                .green()
                .to_string()
        } else {
            "disabled".dimmed().to_string()
        }
    );
    println!(
        "  Management API:  {}",
        if config.management_api.enabled {
            format!("enabled ({})", config.management_api.listen_addr)
                .green()
                .to_string()
        } else {
            "disabled".dimmed().to_string()
        }
    );
    println!(
        "  Port Forwarding: {}",
        if config.port_forwarding.enabled {
            "enabled".green().to_string()
        } else {
            "disabled".dimmed().to_string()
        }
    );
    println!(
        "  SSH:             {}",
        if config.ssh.enabled {
            format!("enabled ({})", config.ssh.listen_addr)
                .green()
                .to_string()
        } else {
            "disabled".dimmed().to_string()
        }
    );
    println!(
        "  PrismaTLS:       {}",
        if config.prisma_tls.enabled {
            "enabled".green().to_string()
        } else {
            "disabled".dimmed().to_string()
        }
    );

    if config.cdn.enabled {
        println!();
        println!("  CDN Details:");
        println!("    WS tunnel path:   {}", config.cdn.ws_tunnel_path);
        println!("    gRPC tunnel path: {}", config.cdn.grpc_tunnel_path);
        if let Some(ref upstream) = config.cdn.cover_upstream {
            println!("    Cover upstream:   {}", upstream);
        }
        if let Some(ref dir) = config.cdn.cover_static_dir {
            println!("    Cover static dir: {}", dir);
        }
        println!("    Expose mgmt API: {}", config.cdn.expose_management_api);
    }

    if !warnings.is_empty() {
        println!();
        println!(
            "  {} {} warning(s) above",
            "NOTE:".yellow().bold(),
            warnings.len()
        );
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Client validation
// ---------------------------------------------------------------------------

fn validate_client(path: &str) -> Result<()> {
    println!("{} Validating client config: {}", ">>".cyan().bold(), path);
    println!();

    // 1. Read the file
    let _raw = read_config_file(path)?;

    // 2. Parse through prisma-core
    let config = match prisma_core::config::load_client_config(path) {
        Ok(c) => c,
        Err(e) => {
            println!(
                "  {} {}",
                "Error:".red().bold(),
                format_config_error(&e.to_string())
            );
            return Err(anyhow::anyhow!("Config validation failed"));
        }
    };

    // 3. Additional semantic checks
    let mut warnings: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    // auth_secret should be 64 hex chars (32 bytes)
    if config.identity.auth_secret.len() != 64 {
        errors.push(format!(
            "identity.auth_secret should be 64 hex chars (32 bytes), got {} chars",
            config.identity.auth_secret.len()
        ));
    }

    // socks5_listen_addr is valid socket address
    if let Some(ref addr) = config.socks5_listen_addr {
        if addr.parse::<SocketAddr>().is_err() {
            errors.push(format!(
                "socks5_listen_addr '{}' is not a valid socket address",
                addr
            ));
        }
    }

    // http_listen_addr is valid socket address
    if let Some(ref addr) = config.http_listen_addr {
        if addr.parse::<SocketAddr>().is_err() {
            errors.push(format!(
                "http_listen_addr '{}' is not a valid socket address",
                addr
            ));
        }
    }

    // Warn if neither SOCKS5 nor HTTP listener is configured
    if config.socks5_listen_addr.is_none() && config.http_listen_addr.is_none() {
        warnings.push(
            "Neither socks5_listen_addr nor http_listen_addr is configured -- no inbound proxy listener".to_string(),
        );
    }

    // skip_cert_verify warning
    if config.skip_cert_verify {
        warnings.push(
            "skip_cert_verify is true -- TLS certificate verification is disabled (insecure)"
                .to_string(),
        );
    }

    // Print errors
    for err in &errors {
        println!("  {} {}", "Error:".red().bold(), err);
    }

    // Print warnings
    for warn in &warnings {
        println!("  {} {}", "Warning:".yellow().bold(), warn);
    }

    if !errors.is_empty() {
        println!();
        println!(
            "  {} Config has {} error(s)",
            "FAIL".red().bold(),
            errors.len()
        );
        return Err(anyhow::anyhow!("Config validation failed"));
    }

    // 4. Summary
    println!("  {} Config is valid", "OK".green().bold());
    println!();
    println!(
        "  SOCKS5:    {}",
        config.socks5_listen_addr.as_deref().unwrap_or("disabled")
    );
    if let Some(ref http) = config.http_listen_addr {
        println!("  HTTP:      {}", http);
    }
    println!("  Server:    {}", config.server_addr);
    println!("  Transport: {}", config.transport);
    println!("  Cipher:    {}", config.cipher_suite);

    if config.transport == "ws" {
        if let Some(ref url) = config.ws.url {
            println!("  WS URL:    {}", url);
        }
    }
    if config.transport == "grpc" {
        if let Some(ref url) = config.grpc.url {
            println!("  gRPC URL:  {}", url);
        }
    }
    if config.transport == "xhttp" {
        if let Some(ref mode) = config.xhttp.mode {
            println!("  XHTTP:     mode={}", mode);
        }
    }
    if config.transport == "xporta" {
        if let Some(ref xp) = config.xporta {
            println!("  XPorta:    {}", xp.base_url);
        }
    }

    if !config.port_forwards.is_empty() {
        println!("  Forwards:  {} configured", config.port_forwards.len());
    }

    if config.tun.enabled {
        println!(
            "  TUN:       {} (mtu={})",
            "enabled".green(),
            config.tun.mtu
        );
    }

    if !warnings.is_empty() {
        println!();
        println!(
            "  {} {} warning(s) above",
            "NOTE:".yellow().bold(),
            warnings.len()
        );
    }

    Ok(())
}

/// Format a config error message for display, improving readability.
fn format_config_error(err: &str) -> String {
    // The `config` crate sometimes wraps errors -- try to make them readable.
    err.replace("configuration property", "field")
        .replace(" for key ", " for ")
}
