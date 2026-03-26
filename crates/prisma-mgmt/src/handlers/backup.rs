use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

use crate::db;
use crate::MgmtState;

/// Current backup schema version. Embedded as a comment in backup files.
const BACKUP_SCHEMA_VERSION: u32 = 1;

#[derive(Serialize)]
pub struct BackupInfo {
    pub name: String,
    pub timestamp: String,
    pub size: u64,
}

#[derive(Serialize)]
pub struct BackupDiff {
    pub changes: Vec<DiffChange>,
}

#[derive(Serialize)]
pub struct DiffChange {
    pub tag: String, // "equal", "insert", "delete"
    pub old_value: Option<String>,
    pub new_value: Option<String>,
}

fn backup_dir(state: &MgmtState) -> Result<PathBuf, StatusCode> {
    let config_path = state
        .config_path
        .as_ref()
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let dir = config_path
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .join("backups");
    fs::create_dir_all(&dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(dir)
}

/// Dump the SQLite database as a companion .sql file alongside a TOML backup.
fn dump_sql_companion(
    state: &MgmtState,
    dir: &std::path::Path,
    prefix: &str,
    timestamp: &impl std::fmt::Display,
) -> Result<(), StatusCode> {
    if let Some(ref database) = state.db {
        let sql = db::dump_sql(database);
        let sql_path = dir.join(format!("{}_{}.sql", prefix, timestamp));
        fs::write(sql_path, sql).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    Ok(())
}

fn validated_backup_path(dir: &std::path::Path, name: &str) -> Result<PathBuf, StatusCode> {
    let name = std::path::Path::new(name)
        .file_name()
        .ok_or(StatusCode::BAD_REQUEST)?
        .to_str()
        .ok_or(StatusCode::BAD_REQUEST)?;
    let path = dir.join(name);
    let canonical_dir = dir
        .canonicalize()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let canonical_path = path.canonicalize().map_err(|_| StatusCode::NOT_FOUND)?;
    if !canonical_path.starts_with(&canonical_dir) {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(path)
}

pub async fn auto_backup(state: &MgmtState) -> Result<(), StatusCode> {
    let config_path = state
        .config_path
        .as_ref()
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let dir = backup_dir(state)?;
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let backup_name = format!("auto_{}.toml", timestamp);
    let dest = dir.join(&backup_name);
    write_versioned_backup(config_path, &dest)?;
    dump_sql_companion(state, &dir, "auto", &timestamp)?;

    // Keep only last 50 auto-backups (TOML files)
    let mut entries: Vec<_> = fs::read_dir(&dir)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("auto_"))
        .filter(|e| e.file_name().to_string_lossy().ends_with(".toml"))
        .collect();
    entries.sort_by_key(|e| e.file_name());
    if entries.len() > 50 {
        for entry in &entries[..entries.len() - 50] {
            let _ = fs::remove_file(entry.path());
            // Also remove matching .sql file
            let sql_name = entry.file_name().to_string_lossy().replace(".toml", ".sql");
            let _ = fs::remove_file(entry.path().with_file_name(sql_name));
        }
    }

    Ok(())
}

/// GET /api/config/backups
pub async fn list_backups(
    State(state): State<MgmtState>,
) -> Result<Json<Vec<BackupInfo>>, StatusCode> {
    let dir = backup_dir(&state)?;
    let mut backups = Vec::new();

    let entries = fs::read_dir(&dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    for entry in entries.filter_map(|e| e.ok()) {
        let meta = entry
            .metadata()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if meta.is_file() {
            let name = entry.file_name().to_string_lossy().to_string();
            // Only show .toml files in the list (SQL files are companions)
            if !name.ends_with(".toml") {
                continue;
            }
            let modified = meta
                .modified()
                .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
                .unwrap_or_default();
            backups.push(BackupInfo {
                name,
                timestamp: modified,
                size: meta.len(),
            });
        }
    }

    backups.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(Json(backups))
}

/// POST /api/config/backup
pub async fn create_backup(State(state): State<MgmtState>) -> Result<Json<BackupInfo>, StatusCode> {
    let config_path = state
        .config_path
        .as_ref()
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let dir = backup_dir(&state)?;
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let backup_name = format!("manual_{}.toml", timestamp);
    let dest = dir.join(&backup_name);
    write_versioned_backup(config_path, &dest)?;
    dump_sql_companion(&state, &dir, "manual", &timestamp)?;

    let meta = fs::metadata(&dest).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(BackupInfo {
        name: backup_name,
        timestamp: chrono::Utc::now().to_rfc3339(),
        size: meta.len(),
    }))
}

/// GET /api/config/backups/{name}
pub async fn get_backup(
    State(state): State<MgmtState>,
    Path(name): Path<String>,
) -> Result<String, StatusCode> {
    let dir = backup_dir(&state)?;
    let path = validated_backup_path(&dir, &name)?;
    fs::read_to_string(path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

/// POST /api/config/backups/{name}/restore
pub async fn restore_backup(
    State(state): State<MgmtState>,
    Path(name): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let dir = backup_dir(&state)?;
    let backup_path = validated_backup_path(&dir, &name)?;
    let config_path = state
        .config_path
        .as_ref()
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;

    // Auto-backup current before restore
    auto_backup(&state).await?;

    // Read backup content and check version
    let backup_content =
        fs::read_to_string(&backup_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let backup_version = parse_backup_version(&backup_content);
    if backup_version > BACKUP_SCHEMA_VERSION {
        tracing::warn!(
            backup_version,
            current_version = BACKUP_SCHEMA_VERSION,
            "Restoring backup from a newer version -- some fields may be unknown"
        );
    }

    // Strip the version comment before writing the config file
    let toml_content = strip_version_comment(&backup_content);
    fs::write(config_path, &toml_content).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Reload config
    let new_config: prisma_core::config::server::ServerConfig =
        toml::from_str(&toml_content).map_err(|_| StatusCode::BAD_REQUEST)?;
    *state.config.write().await = new_config;

    // Update raw config TOML for merge-based persistence
    *state.raw_config_toml.write().await = toml_content;

    // Restore companion SQL file if it exists
    if let Some(ref database) = state.db {
        let sql_name = name.replace(".toml", ".sql");
        let sql_path = dir.join(&sql_name);
        if sql_path.exists() {
            if let Ok(sql) = fs::read_to_string(&sql_path) {
                if let Err(e) = db::restore_sql(database, &sql) {
                    tracing::warn!(error = %e, "Failed to restore SQL data from backup");
                }
            }
        } else {
            tracing::info!(
                backup = %name,
                "Backup predates SQLite -- skipping data restore"
            );
        }
    }

    Ok(StatusCode::OK)
}

/// DELETE /api/config/backups/{name}
pub async fn delete_backup(
    State(state): State<MgmtState>,
    Path(name): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let dir = backup_dir(&state)?;
    let path = validated_backup_path(&dir, &name)?;
    fs::remove_file(&path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Also remove companion SQL file
    let sql_name = name.replace(".toml", ".sql");
    let sql_path = dir.join(&sql_name);
    let _ = fs::remove_file(sql_path);

    Ok(StatusCode::OK)
}

/// GET /api/config/backups/{name}/diff
pub async fn diff_backup(
    State(state): State<MgmtState>,
    Path(name): Path<String>,
) -> Result<Json<BackupDiff>, StatusCode> {
    let dir = backup_dir(&state)?;
    let backup_path = validated_backup_path(&dir, &name)?;

    let config_path = state
        .config_path
        .as_ref()
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let current = fs::read_to_string(config_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let backup = fs::read_to_string(&backup_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    use similar::{ChangeTag, TextDiff};
    let diff = TextDiff::from_lines(&backup, &current);
    let changes = diff
        .iter_all_changes()
        .map(|change| {
            let value = change.value().to_string();
            let (tag, old_value, new_value) = match change.tag() {
                ChangeTag::Equal => ("equal", Some(value.clone()), Some(value)),
                ChangeTag::Delete => ("delete", Some(value), None),
                ChangeTag::Insert => ("insert", None, Some(value)),
            };
            DiffChange {
                tag: tag.to_string(),
                old_value,
                new_value,
            }
        })
        .collect();

    Ok(Json(BackupDiff { changes }))
}

/// Write a config file as a versioned backup: prepend version comment, then TOML content.
fn write_versioned_backup(
    source_path: &std::path::Path,
    dest_path: &std::path::Path,
) -> Result<(), StatusCode> {
    let content = fs::read_to_string(source_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let versioned = format!(
        "# prisma_backup_version = {}\n{}",
        BACKUP_SCHEMA_VERSION, content
    );
    fs::write(dest_path, versioned).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

/// Parse the backup version from the first line comment.
/// Returns 0 if no version marker is found (pre-versioned backup).
fn parse_backup_version(content: &str) -> u32 {
    if let Some(first_line) = content.lines().next() {
        if let Some(rest) = first_line.strip_prefix("# prisma_backup_version = ") {
            return rest.trim().parse().unwrap_or(0);
        }
    }
    0
}

/// Strip the version comment line from backup content, returning clean TOML.
fn strip_version_comment(content: &str) -> String {
    if content.starts_with("# prisma_backup_version = ") {
        // Skip the first line
        content
            .split_once('\n')
            .map(|x| x.1)
            .unwrap_or("")
            .to_string()
    } else {
        content.to_string()
    }
}
