use std::path::Path;

use anyhow::{Context, Result};

use crate::api_client::{self, ApiClient};

pub fn list(client: &ApiClient) -> Result<()> {
    let data = client.get("/api/clients")?;

    if client.is_json() {
        println!("{}", serde_json::to_string_pretty(&data)?);
        return Ok(());
    }

    let empty = vec![];
    let arr = data.as_array().unwrap_or(&empty);
    if arr.is_empty() {
        println!("No clients configured.");
        return Ok(());
    }

    let rows: Vec<Vec<String>> = arr
        .iter()
        .map(|c| {
            vec![
                c["id"].as_str().unwrap_or("-").to_string(),
                c["name"].as_str().unwrap_or("-").to_string(),
                c["enabled"]
                    .as_bool()
                    .map(|b| if b { "yes" } else { "no" })
                    .unwrap_or("-")
                    .to_string(),
            ]
        })
        .collect();

    api_client::print_table(&["ID", "Name", "Enabled"], &rows);
    Ok(())
}

pub fn show(client: &ApiClient, id: &str) -> Result<()> {
    let data = client.get("/api/clients")?;
    let empty = vec![];
    let arr = data.as_array().unwrap_or(&empty);

    let found = arr.iter().find(|c| c["id"].as_str() == Some(id));

    match found {
        Some(c) => {
            if client.is_json() {
                println!("{}", serde_json::to_string_pretty(c)?);
            } else {
                println!("Client ID: {}", c["id"].as_str().unwrap_or("-"));
                println!("Name:      {}", c["name"].as_str().unwrap_or("-"));
                println!(
                    "Enabled:   {}",
                    c["enabled"]
                        .as_bool()
                        .map(|b| if b { "yes" } else { "no" })
                        .unwrap_or("-")
                );
            }
        }
        None => {
            anyhow::bail!("Client '{}' not found", id);
        }
    }
    Ok(())
}

pub fn create(client: &ApiClient, name: Option<&str>) -> Result<()> {
    let body = serde_json::json!({ "name": name });
    let resp = client.post("/api/clients", &body)?;

    if client.is_json() {
        println!("{}", serde_json::to_string_pretty(&resp)?);
        return Ok(());
    }

    let id = resp["id"].as_str().unwrap_or("?");
    let secret = resp["auth_secret_hex"].as_str().unwrap_or("?");
    let cname = resp["name"].as_str().unwrap_or("-");

    println!("Client created successfully!");
    println!();
    println!("Client ID:   {}", id);
    println!("Name:        {}", cname);
    println!("Auth Secret: {}", secret);
    println!();
    println!("# Add to server.toml:");
    println!("[[authorized_clients]]");
    println!("id = \"{}\"", id);
    println!("auth_secret = \"{}\"", secret);
    println!("name = \"{}\"", cname);
    println!();
    println!("# Add to client.toml:");
    println!("[identity]");
    println!("client_id = \"{}\"", id);
    println!("auth_secret = \"{}\"", secret);

    Ok(())
}

pub fn delete(client: &ApiClient, id: &str) -> Result<()> {
    client.delete(&format!("/api/clients/{}", id))?;

    if !client.is_json() {
        println!("Client '{}' deleted.", id);
    }
    Ok(())
}

pub fn enable(client: &ApiClient, id: &str) -> Result<()> {
    let body = serde_json::json!({ "enabled": true });
    client.put(&format!("/api/clients/{}", id), &body)?;

    if !client.is_json() {
        println!("Client '{}' enabled.", id);
    }
    Ok(())
}

pub fn disable(client: &ApiClient, id: &str) -> Result<()> {
    let body = serde_json::json!({ "enabled": false });
    client.put(&format!("/api/clients/{}", id), &body)?;

    if !client.is_json() {
        println!("Client '{}' disabled.", id);
    }
    Ok(())
}

pub fn batch_create(client: &ApiClient, count: u32, prefix: &str) -> Result<()> {
    if count == 0 {
        anyhow::bail!("Count must be at least 1");
    }

    let mut created = Vec::new();
    let mut errors = Vec::new();

    for i in 1..=count {
        let name = format!("{}{}", prefix, i);
        let body = serde_json::json!({ "name": name });
        match client.post("/api/clients", &body) {
            Ok(resp) => {
                let id = resp["id"].as_str().unwrap_or("?").to_string();
                let secret = resp["auth_secret_hex"].as_str().unwrap_or("?").to_string();
                let cname = resp["name"].as_str().unwrap_or(&name).to_string();
                if !client.is_json() {
                    println!("[{}/{}] Created: {} ({})", i, count, cname, id);
                }
                created.push(serde_json::json!({
                    "id": id,
                    "name": cname,
                    "auth_secret_hex": secret,
                }));
            }
            Err(e) => {
                let msg = format!("Failed to create '{}': {}", name, e);
                if !client.is_json() {
                    eprintln!("[{}/{}] {}", i, count, msg);
                }
                errors.push(msg);
            }
        }
    }

    if client.is_json() {
        let result = serde_json::json!({
            "created": created,
            "errors": errors,
        });
        println!("{}", serde_json::to_string_pretty(&result)?);
    } else {
        println!();
        println!(
            "Batch complete: {} created, {} failed.",
            created.len(),
            errors.len()
        );
    }

    if !errors.is_empty() {
        anyhow::bail!("{} of {} clients failed to create", errors.len(), count);
    }
    Ok(())
}

pub fn export(client: &ApiClient, output: &str) -> Result<()> {
    let data = client.get("/api/clients")?;

    let json = serde_json::to_string_pretty(&data).context("Failed to serialize clients")?;

    if let Some(parent) = Path::new(output).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create directory {}", parent.display()))?;
        }
    }

    std::fs::write(output, &json).with_context(|| format!("Failed to write to {}", output))?;

    let count = data.as_array().map(|a| a.len()).unwrap_or(0);
    if client.is_json() {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "exported": count,
                "file": output,
            }))?
        );
    } else {
        println!("Exported {} clients to {}", count, output);
    }

    Ok(())
}

pub fn import(client: &ApiClient, file: &str) -> Result<()> {
    let content =
        std::fs::read_to_string(file).with_context(|| format!("Failed to read {}", file))?;
    let data: serde_json::Value =
        serde_json::from_str(&content).with_context(|| format!("Failed to parse {}", file))?;

    let arr = data
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("Expected a JSON array in {}", file))?;

    let mut imported = 0u32;
    let mut errors = Vec::new();

    for (i, entry) in arr.iter().enumerate() {
        let body = if entry.get("name").is_some() {
            entry.clone()
        } else {
            serde_json::json!({ "name": format!("imported-{}", i + 1) })
        };
        match client.post("/api/clients", &body) {
            Ok(resp) => {
                imported += 1;
                if !client.is_json() {
                    let name = resp["name"].as_str().unwrap_or("?");
                    let id = resp["id"].as_str().unwrap_or("?");
                    println!("[{}/{}] Imported: {} ({})", i + 1, arr.len(), name, id);
                }
            }
            Err(e) => {
                let name = entry["name"].as_str().unwrap_or("unknown").to_string();
                let msg = format!("Failed to import '{}': {}", name, e);
                if !client.is_json() {
                    eprintln!("[{}/{}] {}", i + 1, arr.len(), msg);
                }
                errors.push(msg);
            }
        }
    }

    if client.is_json() {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "imported": imported,
                "errors": errors,
            }))?
        );
    } else {
        println!();
        println!(
            "Import complete: {} imported, {} failed.",
            imported,
            errors.len()
        );
    }

    Ok(())
}
