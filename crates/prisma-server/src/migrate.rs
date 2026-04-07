//! v13 → v14 config migration.
//!
//! Detects old-style full TOML configs and seeds the SQLite database
//! with config sections extracted from the TOML. Also copies TLS
//! certificates to the data directory.

use std::path::Path;

use anyhow::Result;
use prisma_core::config::server::ServerConfig;
use tracing::info;

/// Check if migration is needed and perform it.
///
/// Returns `Ok(true)` if migration was performed, `Ok(false)` if not needed.
pub fn migrate_v13_to_v14(
    config: &ServerConfig,
    _config_path: &Path,
    data_dir: &Path,
    db: &prisma_mgmt::db::Db,
) -> Result<bool> {
    // Check if DB already has config sections (already migrated)
    let existing = prisma_mgmt::db::list_config_sections(db);
    if !existing.is_empty() {
        return Ok(false);
    }

    // Check if the TOML has v13-style fields (authorized_clients, logging, etc.)
    if config.authorized_clients.is_empty() && config.config_version >= 14 {
        return Ok(false);
    }

    info!("Detected v13 config — migrating to v14 DB-first architecture");

    // 1. Seed server_config table with all sections from the full config
    let sections = config.to_db_sections();
    prisma_mgmt::db::seed_config_sections_from_full(db, &sections);

    // 2. Seed ACLs
    for (client_id, acl) in &config.acls {
        if let Ok(json) = serde_json::to_string(acl) {
            prisma_mgmt::db::set_acl(db, client_id, &json);
        }
    }
    if !config.acls.is_empty() {
        info!(count = config.acls.len(), "Migrated ACLs to DB");
    }

    // 3. Copy TLS certificates to data/certs/
    let certs_dir = data_dir.join("certs");
    std::fs::create_dir_all(&certs_dir)?;

    if let Some(ref tls) = config.tls {
        copy_cert_to_data(&tls.cert_path, &tls.key_path, "server", &certs_dir, db);
    }
    if let Some(ref cdn_tls) = config.cdn.tls {
        copy_cert_to_data(&cdn_tls.cert_path, &cdn_tls.key_path, "cdn", &certs_dir, db);
    }
    if let Some(ref mgmt_tls) = config.management_api.tls {
        copy_cert_to_data(
            &mgmt_tls.cert_path,
            &mgmt_tls.key_path,
            "mgmt",
            &certs_dir,
            db,
        );
    }

    info!(
        sections = sections.len(),
        clients = config.authorized_clients.len(),
        "v13 → v14 migration complete"
    );

    Ok(true)
}

/// Copy a certificate pair to the data/certs/ directory and register in DB.
fn copy_cert_to_data(
    cert_path: &str,
    key_path: &str,
    name: &str,
    certs_dir: &Path,
    db: &prisma_mgmt::db::Db,
) {
    let src_cert = Path::new(cert_path);
    let src_key = Path::new(key_path);

    if !src_cert.exists() || !src_key.exists() {
        tracing::warn!(
            name,
            cert_path,
            key_path,
            "Certificate files not found, skipping copy"
        );
        return;
    }

    let dst_cert = certs_dir.join(format!("{name}-cert.pem"));
    let dst_key = certs_dir.join(format!("{name}-key.pem"));

    // Copy files (don't move — keep originals for backward compat)
    if let Err(e) = std::fs::copy(src_cert, &dst_cert) {
        tracing::warn!(error = %e, name, "Failed to copy certificate");
        return;
    }
    if let Err(e) = std::fs::copy(src_key, &dst_key) {
        tracing::warn!(error = %e, name, "Failed to copy key");
        return;
    }

    // Register in DB
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    prisma_mgmt::db::set_certificate(
        db,
        &prisma_mgmt::db::DbCertificate {
            name: name.to_string(),
            cert_path: dst_cert.to_string_lossy().to_string(),
            key_path: dst_key.to_string_lossy().to_string(),
            uploaded_at: now,
            fingerprint: None,
            not_after: None,
        },
    );

    info!(name, "Copied TLS certificate to data directory");
}
