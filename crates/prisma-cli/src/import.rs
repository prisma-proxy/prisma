//! CLI `import` subcommand — import server configs from multi-protocol URIs.

use prisma_core::import::{import_batch, import_uri, ImportedServer};

/// Import a single URI and print the result.
pub fn run_single(uri: &str, json_output: bool) -> anyhow::Result<()> {
    let server = import_uri(uri).map_err(|e| anyhow::anyhow!("{}", e))?;
    print_server(&server, json_output)?;
    Ok(())
}

/// Import URIs from a file (one per line, or base64-encoded subscription block).
pub fn run_file(path: &str, json_output: bool) -> anyhow::Result<()> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| anyhow::anyhow!("failed to read file \"{}\": {}", path, e))?;
    run_batch(&content, json_output)
}

/// Import URIs from a subscription URL.
pub fn run_url(url: &str, json_output: bool) -> anyhow::Result<()> {
    eprintln!("Fetching subscription from {}...", url);
    let body: String = ureq::get(url)
        .call()
        .map_err(|e| anyhow::anyhow!("fetch failed: {}", e))?
        .body_mut()
        .read_to_string()
        .map_err(|e| anyhow::anyhow!("read body failed: {}", e))?;
    run_batch(&body, json_output)
}

/// Import a batch of URIs from text content.
fn run_batch(text: &str, json_output: bool) -> anyhow::Result<()> {
    let results = import_batch(text);

    if results.is_empty() {
        eprintln!("No URIs found in input.");
        return Ok(());
    }

    let mut success_count = 0;
    let mut fail_count = 0;
    let mut servers: Vec<ImportedServer> = Vec::new();

    for result in results {
        match result {
            Ok(server) => {
                success_count += 1;
                servers.push(server);
            }
            Err(e) => {
                fail_count += 1;
                if !json_output {
                    eprintln!("  [FAIL] {}", e);
                }
            }
        }
    }

    if json_output {
        let output = serde_json::json!({
            "imported": success_count,
            "failed": fail_count,
            "servers": servers,
        });
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!();
        println!(
            "Imported {} server(s), {} failed.",
            success_count, fail_count
        );
        println!();
        for server in &servers {
            print_server(server, false)?;
            println!();
        }
    }

    Ok(())
}

/// Print a single imported server in human-readable or JSON format.
fn print_server(server: &ImportedServer, json_output: bool) -> anyhow::Result<()> {
    if json_output {
        println!("{}", serde_json::to_string_pretty(server)?);
    } else {
        println!("  Protocol:   {}", server.original_protocol);
        println!("  Name:       {}", server.server_name);
        println!("  Host:       {}", server.host);
        println!("  Port:       {}", server.port);
        println!("  Transport:  {}", server.config.transport);
        println!("  Cipher:     {}", server.config.cipher_suite);
        if server.config.tls_on_tcp {
            println!("  TLS:        yes");
        }
        if let Some(ref sni) = server.config.tls_server_name {
            println!("  SNI:        {}", sni);
        }
        if let Some(ref ws) = server.config.ws.url {
            println!("  WS URL:     {}", ws);
        }
        if let Some(ref grpc) = server.config.grpc.url {
            println!("  gRPC URL:   {}", grpc);
        }
    }
    Ok(())
}
