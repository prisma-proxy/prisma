use anyhow::Result;

pub fn run_status(api_url: &str, token: &str) -> Result<()> {
    let health_url = format!("{}/api/health", api_url.trim_end_matches('/'));
    let metrics_url = format!("{}/api/metrics", api_url.trim_end_matches('/'));

    // Fetch health
    let health_resp = ureq::get(&health_url)
        .header("Authorization", &format!("Bearer {}", token))
        .call();

    match health_resp {
        Ok(mut resp) => {
            let body: serde_json::Value = resp.body_mut().read_json()?;
            println!("Server Status: UP");
            if let Some(version) = body.get("version").and_then(|v| v.as_str()) {
                println!("  Version:  {}", version);
            }
        }
        Err(e) => {
            println!("Server Status: DOWN ({})", e);
            return Ok(());
        }
    }

    // Fetch metrics
    let metrics_resp = ureq::get(&metrics_url)
        .header("Authorization", &format!("Bearer {}", token))
        .call();

    match metrics_resp {
        Ok(mut resp) => {
            let body: serde_json::Value = resp.body_mut().read_json()?;

            if let Some(uptime) = body.get("uptime_secs").and_then(|v| v.as_u64()) {
                let hours = uptime / 3600;
                let mins = (uptime % 3600) / 60;
                let secs = uptime % 60;
                println!("  Uptime:   {}h {}m {}s", hours, mins, secs);
            }
            if let Some(active) = body.get("active_connections").and_then(|v| v.as_u64()) {
                println!("  Active:   {} connections", active);
            }
            if let Some(total) = body.get("total_connections").and_then(|v| v.as_u64()) {
                println!("  Total:    {} connections", total);
            }
            if let Some(up) = body.get("total_bytes_up").and_then(|v| v.as_u64()) {
                println!("  Bytes Up: {}", format_bytes(up));
            }
            if let Some(down) = body.get("total_bytes_down").and_then(|v| v.as_u64()) {
                println!("  Bytes Dn: {}", format_bytes(down));
            }
            if let Some(failures) = body.get("handshake_failures").and_then(|v| v.as_u64()) {
                if failures > 0 {
                    println!("  HS Fails: {}", failures);
                }
            }
        }
        Err(e) => {
            println!("  Metrics:  unavailable ({})", e);
        }
    }

    Ok(())
}

fn format_bytes(bytes: u64) -> String {
    if bytes >= 1_073_741_824 {
        format!("{:.2} GiB", bytes as f64 / 1_073_741_824.0)
    } else if bytes >= 1_048_576 {
        format!("{:.2} MiB", bytes as f64 / 1_048_576.0)
    } else if bytes >= 1024 {
        format!("{:.2} KiB", bytes as f64 / 1024.0)
    } else {
        format!("{} B", bytes)
    }
}
