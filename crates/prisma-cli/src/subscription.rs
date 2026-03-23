//! CLI commands for subscription management.

use anyhow::Result;

/// Add a new subscription by URL and name.
pub async fn add(url: &str, name: &str) -> Result<()> {
    println!("Adding subscription '{}' from {}", name, url);

    let servers = prisma_core::subscription::fetch_subscription(url).await?;
    println!("Fetched {} servers:", servers.len());

    let rows: Vec<Vec<String>> = servers
        .iter()
        .enumerate()
        .map(|(i, s)| {
            vec![
                format!("{}", i + 1),
                s.name.clone(),
                s.server_addr.clone(),
                s.transport.clone(),
            ]
        })
        .collect();

    crate::api_client::print_table(&["#", "Name", "Address", "Transport"], &rows);
    println!();
    println!("Subscription '{}' added successfully.", name);
    Ok(())
}

/// Update (re-fetch) a subscription by URL.
pub async fn update(url: &str) -> Result<()> {
    println!("Fetching subscription from {}", url);

    let servers = prisma_core::subscription::fetch_subscription(url).await?;
    println!("Updated: {} servers found", servers.len());

    let rows: Vec<Vec<String>> = servers
        .iter()
        .enumerate()
        .map(|(i, s)| {
            vec![
                format!("{}", i + 1),
                s.name.clone(),
                s.server_addr.clone(),
                s.transport.clone(),
            ]
        })
        .collect();

    crate::api_client::print_table(&["#", "Name", "Address", "Transport"], &rows);
    Ok(())
}

/// List servers from a subscription URL (one-shot fetch).
pub async fn list(url: &str) -> Result<()> {
    let servers = prisma_core::subscription::fetch_subscription(url).await?;

    if servers.is_empty() {
        println!("No servers found in subscription.");
        return Ok(());
    }

    let rows: Vec<Vec<String>> = servers
        .iter()
        .enumerate()
        .map(|(i, s)| {
            vec![
                format!("{}", i + 1),
                s.name.clone(),
                s.server_addr.clone(),
                s.transport.clone(),
            ]
        })
        .collect();

    crate::api_client::print_table(&["#", "Name", "Address", "Transport"], &rows);
    println!();
    println!("{} servers total.", servers.len());
    Ok(())
}

/// Test latency to all servers from a subscription URL and show results.
pub async fn test(url: &str) -> Result<()> {
    println!("Fetching subscription from {}", url);
    let servers = prisma_core::subscription::fetch_subscription(url).await?;

    if servers.is_empty() {
        println!("No servers found.");
        return Ok(());
    }

    println!("Testing latency to {} servers...", servers.len());
    println!();

    let server_infos: Vec<prisma_client::latency::ServerInfo> = servers
        .iter()
        .map(|s| prisma_client::latency::ServerInfo {
            name: s.name.clone(),
            server_addr: s.server_addr.clone(),
        })
        .collect();

    let config = prisma_client::latency::LatencyTestConfig::default();
    let results: Vec<prisma_client::latency::LatencyResult> =
        prisma_client::latency::test_all_servers(&server_infos, &config).await;

    let rows: Vec<Vec<String>> = results
        .iter()
        .map(|r| {
            vec![
                r.name.clone(),
                r.server_addr.clone(),
                r.latency_ms
                    .map(|ms| format!("{}ms", ms))
                    .unwrap_or_else(|| "timeout".to_string()),
                if r.success {
                    "OK".to_string()
                } else {
                    r.error.clone().unwrap_or_else(|| "FAIL".to_string())
                },
            ]
        })
        .collect();

    crate::api_client::print_table(&["Name", "Address", "Latency", "Status"], &rows);

    if let Some(best) = results.first().filter(|r| r.success) {
        println!();
        println!(
            "Best server: {} ({}) - {}ms",
            best.name,
            best.server_addr,
            best.latency_ms.unwrap_or(0)
        );
    }

    Ok(())
}
