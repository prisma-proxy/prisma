use anyhow::Result;

use crate::api_client::{self, ApiClient};

pub fn get_config(client: &ApiClient) -> Result<()> {
    let data = client.get("/api/config")?;

    if client.is_json() {
        println!("{}", serde_json::to_string_pretty(&data)?);
        return Ok(());
    }

    // Pretty-print the config as key-value pairs with sections
    print_config_section("", &data, 0);
    Ok(())
}

pub fn set_config(client: &ApiClient, key: &str, value: &str) -> Result<()> {
    // Map dotted keys to flat PATCH fields
    let field = key.replace('.', "_");

    // Auto-coerce value types based on field name
    let typed_value = coerce_value(&field, value);

    // Use a Map to set the dynamic key — json!({field: v}) uses "field" literally
    let mut map = serde_json::Map::new();
    map.insert(field, typed_value);
    let body = serde_json::Value::Object(map);
    client.patch("/api/config", &body)?;

    if !client.is_json() {
        println!("Config updated: {} = {}", key, value);
    }
    Ok(())
}

pub fn tls(client: &ApiClient) -> Result<()> {
    let data = client.get("/api/config/tls")?;

    if client.is_json() {
        println!("{}", serde_json::to_string_pretty(&data)?);
        return Ok(());
    }

    println!("TLS Configuration:");
    println!(
        "  Enabled:   {}",
        data["enabled"]
            .as_bool()
            .map(|b| if b { "yes" } else { "no" })
            .unwrap_or("-")
    );
    if let Some(cert) = data["cert_path"].as_str() {
        println!("  Cert Path: {}", cert);
    }
    if let Some(key) = data["key_path"].as_str() {
        println!("  Key Path:  {}", key);
    }
    Ok(())
}

pub fn backup_create(client: &ApiClient) -> Result<()> {
    let resp = client.post_empty("/api/config/backup")?;

    if client.is_json() {
        println!("{}", serde_json::to_string_pretty(&resp)?);
        return Ok(());
    }

    println!(
        "Backup created: {}",
        resp["name"].as_str().unwrap_or("unknown")
    );
    Ok(())
}

pub fn backup_list(client: &ApiClient) -> Result<()> {
    let data = client.get("/api/config/backups")?;

    if client.is_json() {
        println!("{}", serde_json::to_string_pretty(&data)?);
        return Ok(());
    }

    let empty = vec![];
    let arr = data.as_array().unwrap_or(&empty);
    if arr.is_empty() {
        println!("No backups found.");
        return Ok(());
    }

    let rows: Vec<Vec<String>> = arr
        .iter()
        .map(|b| {
            vec![
                b["name"].as_str().unwrap_or("-").to_string(),
                b["timestamp"]
                    .as_str()
                    .unwrap_or("-")
                    .chars()
                    .take(19)
                    .collect(),
                b["size"]
                    .as_u64()
                    .map(api_client::format_bytes)
                    .unwrap_or_else(|| "-".to_string()),
            ]
        })
        .collect();

    api_client::print_table(&["Name", "Timestamp", "Size"], &rows);
    Ok(())
}

pub fn backup_restore(client: &ApiClient, name: &str) -> Result<()> {
    client.post_empty(&format!("/api/config/backups/{}/restore", name))?;

    if !client.is_json() {
        println!("Backup '{}' restored successfully.", name);
    }
    Ok(())
}

pub fn backup_diff(client: &ApiClient, name: &str) -> Result<()> {
    let data = client.get(&format!("/api/config/backups/{}/diff", name))?;

    if client.is_json() {
        println!("{}", serde_json::to_string_pretty(&data)?);
        return Ok(());
    }

    let empty = vec![];
    let changes = data["changes"].as_array().unwrap_or(&empty);
    if changes.is_empty() {
        println!("No differences found.");
        return Ok(());
    }

    for change in changes {
        let tag = change["tag"].as_str().unwrap_or("equal");
        match tag {
            "delete" => {
                if let Some(old) = change["old_value"].as_str() {
                    for line in old.lines() {
                        println!("\x1b[31m- {}\x1b[0m", line);
                    }
                }
            }
            "insert" => {
                if let Some(new) = change["new_value"].as_str() {
                    for line in new.lines() {
                        println!("\x1b[32m+ {}\x1b[0m", line);
                    }
                }
            }
            _ => {
                // equal - show context
                if let Some(old) = change["old_value"].as_str() {
                    for line in old.lines() {
                        println!("  {}", line);
                    }
                }
            }
        }
    }
    Ok(())
}

pub fn backup_delete(client: &ApiClient, name: &str) -> Result<()> {
    client.delete(&format!("/api/config/backups/{}", name))?;

    if !client.is_json() {
        println!("Backup '{}' deleted.", name);
    }
    Ok(())
}

// --- Helpers ---

fn coerce_value(field: &str, value: &str) -> serde_json::Value {
    // Boolean fields
    static BOOL_FIELDS: &[&str] = &[
        "port_forwarding_enabled",
        "camouflage_enabled",
        "camouflage_tls_on_tcp",
        "anti_rtt_enabled",
        "allow_transport_only_cipher",
        "cdn_enabled",
        "cdn_expose_management_api",
        "cdn_padding_header",
        "cdn_enable_sse_disguise",
        "prisma_tls_enabled",
        "management_api_enabled",
    ];
    if BOOL_FIELDS.contains(&field) {
        return match value.to_lowercase().as_str() {
            "true" | "yes" | "1" => serde_json::Value::Bool(true),
            "false" | "no" | "0" => serde_json::Value::Bool(false),
            _ => serde_json::Value::String(value.to_string()),
        };
    }

    // u32 fields
    static U32_FIELDS: &[&str] = &[
        "max_connections",
        "traffic_shaping_timing_jitter_ms",
        "traffic_shaping_chaff_interval_ms",
        "traffic_shaping_coalesce_window_ms",
        "anti_rtt_normalization_ms",
    ];
    if U32_FIELDS.contains(&field) {
        if let Ok(n) = value.parse::<u32>() {
            return serde_json::Value::Number(n.into());
        }
    }

    // u16 fields
    static U16_FIELDS: &[&str] = &[
        "port_hopping_base_port",
        "port_hopping_range",
        "port_forwarding_port_range_start",
        "port_forwarding_port_range_end",
        "padding_min",
        "padding_max",
    ];
    if U16_FIELDS.contains(&field) {
        if let Ok(n) = value.parse::<u16>() {
            return serde_json::Value::Number(n.into());
        }
    }

    // u64 fields
    static U64_FIELDS: &[&str] = &[
        "connection_timeout_secs",
        "prisma_tls_auth_rotation_hours",
        "port_hopping_interval_secs",
        "port_hopping_grace_period_secs",
    ];
    if U64_FIELDS.contains(&field) {
        if let Ok(n) = value.parse::<u64>() {
            return serde_json::Value::Number(n.into());
        }
    }

    // Default: string
    serde_json::Value::String(value.to_string())
}

fn print_config_section(prefix: &str, value: &serde_json::Value, depth: usize) {
    match value {
        serde_json::Value::Object(map) => {
            for (k, v) in map {
                let full_key = if prefix.is_empty() {
                    k.clone()
                } else {
                    format!("{}.{}", prefix, k)
                };
                match v {
                    serde_json::Value::Object(_) => {
                        println!("\x1b[36m[{}]\x1b[0m", full_key);
                        print_config_section(&full_key, v, depth + 1);
                        if depth == 0 {
                            println!();
                        }
                    }
                    serde_json::Value::Array(arr) if arr.iter().any(|i| i.is_object()) => {
                        println!("  {} = ({} items)", k, arr.len());
                    }
                    _ => {
                        println!("  {} = {}", k, format_value(v));
                    }
                }
            }
        }
        _ => {
            println!("{}", format_value(value));
        }
    }
}

fn format_value(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => format!("\x1b[33m\"{}\"\x1b[0m", s),
        serde_json::Value::Bool(b) => {
            if *b {
                "\x1b[32mtrue\x1b[0m".to_string()
            } else {
                "\x1b[31mfalse\x1b[0m".to_string()
            }
        }
        serde_json::Value::Null => "\x1b[90mnull\x1b[0m".to_string(),
        serde_json::Value::Array(arr) => {
            if arr.is_empty() {
                "[]".to_string()
            } else {
                let items: Vec<String> = arr.iter().map(format_value).collect();
                format!("[{}]", items.join(", "))
            }
        }
        other => other.to_string(),
    }
}
