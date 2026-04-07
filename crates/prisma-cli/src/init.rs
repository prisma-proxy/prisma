use std::path::Path;

use anyhow::Result;
use colored::Colorize;

use crate::ui;

pub async fn run_init(
    _cdn: bool,
    server_only: bool,
    client_only: bool,
    console: bool,
    force: bool,
) -> Result<()> {
    // Download console if requested (before writing config so we have the path)
    let console_dir = if console && !client_only {
        match crate::console::download_console_to_cache().await {
            Ok(dir) => Some(dir.to_string_lossy().to_string()),
            Err(e) => {
                ui::warn(&format!("Failed to download console: {}", e));
                ui::warn("You can download it later with: prisma console --update");
                None
            }
        }
    } else {
        None
    };

    if !client_only {
        write_server_config(console_dir.as_deref(), force)?;

        // Create data directory structure
        let data_dir = Path::new("data");
        let cert_dir = data_dir.join("certs");
        std::fs::create_dir_all(&cert_dir)?;

        // Auto-generate self-signed TLS certificate
        let cert_path = cert_dir.join("server-cert.pem");
        if !cert_path.exists() {
            ui::info("Generating self-signed TLS certificate...");
            let key_pair = rcgen::KeyPair::generate()?;
            let mut params = rcgen::CertificateParams::new(vec!["prisma-server".to_string()])?;
            params.subject_alt_names.push(rcgen::SanType::DnsName(
                "prisma-server".to_string().try_into()?,
            ));
            let cert = params.self_signed(&key_pair)?;
            std::fs::write(&cert_path, cert.pem())?;
            std::fs::write(cert_dir.join("server-key.pem"), key_pair.serialize_pem())?;
            ui::detail("data/certs/server-cert.pem");
            ui::detail("data/certs/server-key.pem");
        }
    }

    if !server_only && client_only {
        // Client-only mode: generate a placeholder client config
        let client_id = uuid::Uuid::new_v4();
        let mut secret = [0u8; 32];
        rand::Rng::fill(&mut rand::thread_rng(), &mut secret);
        let secret_hex: String = secret.iter().map(|b| format!("{:02x}", b)).collect();
        write_client_config(&client_id.to_string(), &secret_hex, force)?;
    }

    println!();
    ui::success("Initialization complete");

    if let Some(ref dir) = console_dir {
        println!("  {} {}", "Console:".bold(), dir);
    }

    println!();
    println!("{}", "Next steps:".bold());
    if !client_only {
        println!();
        ui::detail("Start the server:");
        println!(
            "    {} {}",
            "$".dimmed(),
            "prisma server -c server.toml".bold()
        );
        println!();
        ui::detail("Open the web console to complete setup:");
        println!(
            "    {} {}",
            " ".dimmed(),
            "https://your-server-ip:443".bold()
        );
        println!();
        ui::detail("The setup wizard will guide you through:");
        println!("    {} Creating an admin account", "-".dimmed());
        println!(
            "    {} Adding your first client (generates credentials)",
            "-".dimmed()
        );
        println!("    {} Configuring routing rules", "-".dimmed());
        println!("    {} Uploading production TLS certificates", "-".dimmed());
    }
    if !server_only && client_only {
        println!();
        ui::detail("Edit client.toml — set server_addr + credentials from the web console");
        ui::detail("Start client: prisma client -c client.toml");
    }
    println!();

    Ok(())
}

fn write_server_config(console_dir: Option<&str>, force: bool) -> Result<()> {
    let path = "server.toml";
    if Path::new(path).exists() && !force {
        ui::warn(&format!(
            "Skipping {} (already exists, use --force to overwrite)",
            path
        ));
        return Ok(());
    }

    let console_dir_line = match console_dir {
        Some(dir) => {
            let normalized = dir.replace('\\', "/");
            format!("console_dir = \"{}\"", normalized)
        }
        None => "# console_dir = \"/path/to/prisma-console/out\"".to_string(),
    };

    // v14 minimal TOML — everything else is configured via web console + stored in SQLite
    let content = format!(
        r#"# Prisma Proxy v14 — minimal TOML config
# All other settings are managed via the web console and stored in SQLite.
# See: https://docs.prisma-proxy.dev/config/v14

config_version = 14
listen_addr = "0.0.0.0:8443"
quic_listen_addr = "0.0.0.0:8443"

[management_api]
enabled = true
listen_addr = "0.0.0.0:443"
{console_dir_line}
"#
    );

    std::fs::write(path, content)?;
    ui::success(&format!("Created {} (v14 DB-first)", path));
    Ok(())
}

fn write_client_config(client_id: &str, secret_hex: &str, force: bool) -> Result<()> {
    let path = "client.toml";
    if Path::new(path).exists() && !force {
        ui::warn(&format!(
            "Skipping {} (already exists, use --force to overwrite)",
            path
        ));
        return Ok(());
    }

    let content = format!(
        r#"socks5_listen_addr = "127.0.0.1:1080"
http_listen_addr = "127.0.0.1:8080"
server_addr = "127.0.0.1:8443"
cipher_suite = "chacha20-poly1305"
transport = "quic"
skip_cert_verify = true

[identity]
client_id = "{client_id}"
auth_secret = "{secret_hex}"

# Port forwarding — expose local services through the server
# [[port_forwards]]
# name = "my-web-app"
# local_addr = "127.0.0.1:3000"
# remote_port = 10080

# WebSocket transport options (when transport = "ws")
# ws_url = "wss://domain.com/ws-tunnel"
# ws_host = "domain.com"

# gRPC transport options (when transport = "grpc")
# grpc_url = "https://domain.com/tunnel.PrismaTunnel/Tunnel"

[logging]
level = "info"
format = "pretty"
"#
    );

    std::fs::write(path, content)?;
    ui::success(&format!("Created {}", path));
    Ok(())
}
