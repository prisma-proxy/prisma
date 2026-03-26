//! SQLite database layer for dynamic management data.
//!
//! All mutable state (users, clients, routing rules, subscription codes,
//! invites, and console settings) is stored here.  Static server configuration
//! (listen addresses, TLS, transport, crypto) remains in TOML.

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension};
use tracing::{info, warn};
use uuid::Uuid;

use prisma_core::config::server::{
    AuthorizedClient, RoutingRule, RuleAction, RuleCondition, UserConfig, UserRole,
};

/// Current schema version.  Increment when adding migrations.
const SCHEMA_VERSION: i64 = 1;

// ───────────────────────────── Public types ─────────────────────────────

pub type Db = Arc<Mutex<Connection>>;

/// Open (or create) the SQLite database and run migrations.
pub fn init_db(path: &Path) -> anyhow::Result<Db> {
    let conn = Connection::open(path)?;

    // WAL mode for better concurrent read performance
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

    run_migrations(&conn)?;
    seed_default_settings(&conn)?;

    info!(path = %path.display(), "SQLite database initialized (schema v{SCHEMA_VERSION})");
    Ok(Arc::new(Mutex::new(conn)))
}

// ───────────────────────────── Migrations ───────────────────────────────

fn run_migrations(conn: &Connection) -> anyhow::Result<()> {
    // Ensure the version table exists
    conn.execute_batch("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);")?;

    let current: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if current < SCHEMA_VERSION {
        // Forward migrations: apply each step up to the current code version
        for v in (current + 1)..=SCHEMA_VERSION {
            apply_up_migration(conn, v)?;
        }
    } else if current > SCHEMA_VERSION {
        // Downgrade: database is newer than code — apply down migrations in reverse
        warn!(
            db_version = current,
            code_version = SCHEMA_VERSION,
            "Database is newer than code -- applying down migrations"
        );
        for v in ((SCHEMA_VERSION + 1)..=current).rev() {
            apply_down_migration(conn, v)?;
        }
        // Update schema_version to reflect the new version
        conn.execute_batch("DELETE FROM schema_version;")?;
        if SCHEMA_VERSION > 0 {
            conn.execute(
                "INSERT INTO schema_version (version) VALUES (?1)",
                [SCHEMA_VERSION],
            )?;
        }
    }

    Ok(())
}

/// Apply a forward (up) migration for the given version.
fn apply_up_migration(conn: &Connection, version: i64) -> anyhow::Result<()> {
    match version {
        1 => {
            conn.execute_batch(include_str!("db_migrations/v1.sql"))?;
            conn.execute("INSERT INTO schema_version (version) VALUES (?1)", [1])?;
            info!("Applied SQLite migration v1 (up)");
        }
        other => {
            warn!(version = other, "No up migration found for version");
        }
    }
    Ok(())
}

/// Apply a reverse (down) migration for the given version.
fn apply_down_migration(conn: &Connection, version: i64) -> anyhow::Result<()> {
    match version {
        1 => {
            conn.execute_batch(include_str!("db_migrations/v1_down.sql"))?;
            info!("Applied SQLite migration v1 (down)");
        }
        other => {
            warn!(
                version = other,
                "No down migration found for version -- skipping"
            );
        }
    }
    Ok(())
}

/// Insert default console settings if the settings table is empty.
/// No-op if the settings table does not exist (e.g., after a down migration to v0).
fn seed_default_settings(conn: &Connection) -> anyhow::Result<()> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM settings", [], |r| r.get(0))
        .unwrap_or(-1);
    if count < 0 {
        return Ok(()); // Table doesn't exist
    }
    if count == 0 {
        let defaults = [
            ("registration_enabled", "true"),
            ("default_user_role", "client"),
            ("session_expiry_hours", "24"),
            ("auto_backup_interval_mins", "0"),
        ];
        for (k, v) in defaults {
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
                params![k, v],
            )?;
        }
    }
    Ok(())
}

// ───────────────────────── TOML → SQLite migration ─────────────────────

/// Import existing users and clients from the TOML config into SQLite.
/// Only inserts rows that don't already exist (safe to call multiple times).
pub fn migrate_from_config(
    conn: &Mutex<Connection>,
    users: &[UserConfig],
    clients: &[AuthorizedClient],
    rules: &[RoutingRule],
) {
    let db = conn.lock().expect("db lock poisoned");

    // Users
    for u in users {
        let role_str = u.role.to_string();
        let res = db.execute(
            "INSERT OR IGNORE INTO users (username, password_hash, role, enabled) VALUES (?1, ?2, ?3, ?4)",
            params![u.username, u.password_hash, role_str, u.enabled as i32],
        );
        if let Err(e) = res {
            warn!(username = %u.username, error = %e, "Failed to migrate user");
        }
    }

    // Clients
    for c in clients {
        let tags_json = serde_json::to_string(&c.tags).unwrap_or_else(|_| "[]".into());
        let res = db.execute(
            "INSERT OR IGNORE INTO clients (id, auth_secret, name, enabled, owner, bandwidth_up, bandwidth_down, quota, quota_period, tags) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                c.id,
                c.auth_secret,
                c.name,
                1i32,
                c.owner,
                c.bandwidth_up,
                c.bandwidth_down,
                c.quota,
                c.quota_period,
                tags_json,
            ],
        );
        if let Err(e) = res {
            warn!(client_id = %c.id, error = %e, "Failed to migrate client");
        }
    }

    // Routing rules
    for r in rules {
        let (cond_type, cond_value) = serialize_condition(&r.condition);
        let action = serialize_action(&r.action);
        let res = db.execute(
            "INSERT OR IGNORE INTO routing_rules (id, name, priority, condition_type, condition_value, action, enabled) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                r.id.to_string(),
                r.name,
                r.priority,
                cond_type,
                cond_value,
                action,
                r.enabled as i32,
            ],
        );
        if let Err(e) = res {
            warn!(rule_id = %r.id, error = %e, "Failed to migrate routing rule");
        }
    }

    info!(
        "TOML→SQLite migration complete (users={}, clients={}, rules={})",
        users.len(),
        clients.len(),
        rules.len()
    );
}

// ─────────────────────────── Settings helpers ───────────────────────────

pub fn get_setting(db: &Mutex<Connection>, key: &str) -> Option<String> {
    let conn = db.lock().expect("db lock poisoned");
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
        r.get(0)
    })
    .optional()
    .ok()
    .flatten()
}

pub fn get_all_settings(db: &Mutex<Connection>) -> Vec<(String, String)> {
    let conn = db.lock().expect("db lock poisoned");
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings")
        .expect("prepare settings query");
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .expect("query settings")
        .filter_map(|r| r.ok())
        .collect()
}

pub fn set_setting(db: &Mutex<Connection>, key: &str, value: &str) {
    let conn = db.lock().expect("db lock poisoned");
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .ok();
}

pub fn get_setting_bool(db: &Mutex<Connection>, key: &str) -> bool {
    get_setting(db, key)
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false)
}

pub fn get_setting_i64(db: &Mutex<Connection>, key: &str) -> i64 {
    get_setting(db, key)
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

// ─────────────────────────── User helpers ───────────────────────────────

pub fn get_user(db: &Mutex<Connection>, username: &str) -> Option<UserConfig> {
    let conn = db.lock().expect("db lock poisoned");
    conn.query_row(
        "SELECT username, password_hash, role, enabled FROM users WHERE username = ?1",
        [username],
        |row| {
            Ok(UserConfig {
                username: row.get(0)?,
                password_hash: row.get(1)?,
                role: parse_role(&row.get::<_, String>(2)?),
                enabled: row.get::<_, i32>(3)? != 0,
            })
        },
    )
    .optional()
    .ok()
    .flatten()
}

pub fn list_users(db: &Mutex<Connection>) -> Vec<UserConfig> {
    let conn = db.lock().expect("db lock poisoned");
    let mut stmt = conn
        .prepare("SELECT username, password_hash, role, enabled FROM users ORDER BY rowid")
        .expect("prepare users query");
    stmt.query_map([], |row| {
        Ok(UserConfig {
            username: row.get(0)?,
            password_hash: row.get(1)?,
            role: parse_role(&row.get::<_, String>(2)?),
            enabled: row.get::<_, i32>(3)? != 0,
        })
    })
    .expect("query users")
    .filter_map(|r| r.ok())
    .collect()
}

pub fn insert_user(db: &Mutex<Connection>, user: &UserConfig) -> rusqlite::Result<()> {
    let conn = db.lock().expect("db lock poisoned");
    conn.execute(
        "INSERT INTO users (username, password_hash, role, enabled) VALUES (?1, ?2, ?3, ?4)",
        params![
            user.username,
            user.password_hash,
            user.role.to_string(),
            user.enabled as i32
        ],
    )?;
    Ok(())
}

pub fn update_user_role_enabled(
    db: &Mutex<Connection>,
    username: &str,
    role: Option<UserRole>,
    enabled: Option<bool>,
) -> bool {
    let conn = db.lock().expect("db lock poisoned");
    if let Some(r) = role {
        conn.execute(
            "UPDATE users SET role = ?1 WHERE username = ?2",
            params![r.to_string(), username],
        )
        .ok();
    }
    if let Some(e) = enabled {
        conn.execute(
            "UPDATE users SET enabled = ?1 WHERE username = ?2",
            params![e as i32, username],
        )
        .ok();
    }
    // Return true if the user exists
    conn.query_row(
        "SELECT 1 FROM users WHERE username = ?1",
        [username],
        |_| Ok(()),
    )
    .optional()
    .ok()
    .flatten()
    .is_some()
}

pub fn update_user_password(db: &Mutex<Connection>, username: &str, hash: &str) -> bool {
    let conn = db.lock().expect("db lock poisoned");
    let rows = conn
        .execute(
            "UPDATE users SET password_hash = ?1 WHERE username = ?2",
            params![hash, username],
        )
        .unwrap_or(0);
    rows > 0
}

pub fn delete_user(db: &Mutex<Connection>, username: &str) -> bool {
    let conn = db.lock().expect("db lock poisoned");
    let rows = conn
        .execute("DELETE FROM users WHERE username = ?1", [username])
        .unwrap_or(0);
    rows > 0
}

pub fn has_admin(db: &Mutex<Connection>) -> bool {
    let conn = db.lock().expect("db lock poisoned");
    conn.query_row(
        "SELECT 1 FROM users WHERE role = 'admin' LIMIT 1",
        [],
        |_| Ok(()),
    )
    .optional()
    .ok()
    .flatten()
    .is_some()
}

pub fn user_exists(db: &Mutex<Connection>, username: &str) -> bool {
    let conn = db.lock().expect("db lock poisoned");
    conn.query_row(
        "SELECT 1 FROM users WHERE username = ?1",
        [username],
        |_| Ok(()),
    )
    .optional()
    .ok()
    .flatten()
    .is_some()
}

// ─────────────────────────── Client helpers ─────────────────────────────

#[derive(Clone, serde::Serialize)]
pub struct DbClient {
    pub id: String,
    pub auth_secret: String,
    pub name: Option<String>,
    pub enabled: bool,
    pub owner: Option<String>,
    pub bandwidth_up: Option<String>,
    pub bandwidth_down: Option<String>,
    pub quota: Option<String>,
    pub quota_period: Option<String>,
    pub tags: Vec<String>,
}

pub fn list_clients(db: &Mutex<Connection>) -> Vec<DbClient> {
    let conn = db.lock().expect("db lock poisoned");
    let mut stmt = conn
        .prepare("SELECT id, auth_secret, name, enabled, owner, bandwidth_up, bandwidth_down, quota, quota_period, tags FROM clients ORDER BY rowid")
        .expect("prepare clients query");
    stmt.query_map([], |row| {
        let tags_json: String = row.get(9)?;
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        Ok(DbClient {
            id: row.get(0)?,
            auth_secret: row.get(1)?,
            name: row.get(2)?,
            enabled: row.get::<_, i32>(3)? != 0,
            owner: row.get(4)?,
            bandwidth_up: row.get(5)?,
            bandwidth_down: row.get(6)?,
            quota: row.get(7)?,
            quota_period: row.get(8)?,
            tags,
        })
    })
    .expect("query clients")
    .filter_map(|r| r.ok())
    .collect()
}

pub fn get_client(db: &Mutex<Connection>, id: &str) -> Option<DbClient> {
    let conn = db.lock().expect("db lock poisoned");
    conn.query_row(
        "SELECT id, auth_secret, name, enabled, owner, bandwidth_up, bandwidth_down, quota, quota_period, tags FROM clients WHERE id = ?1",
        [id],
        |row| {
            let tags_json: String = row.get(9)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            Ok(DbClient {
                id: row.get(0)?,
                auth_secret: row.get(1)?,
                name: row.get(2)?,
                enabled: row.get::<_, i32>(3)? != 0,
                owner: row.get(4)?,
                bandwidth_up: row.get(5)?,
                bandwidth_down: row.get(6)?,
                quota: row.get(7)?,
                quota_period: row.get(8)?,
                tags,
            })
        },
    )
    .optional()
    .ok()
    .flatten()
}

pub fn insert_client(db: &Mutex<Connection>, c: &DbClient) -> rusqlite::Result<()> {
    let conn = db.lock().expect("db lock poisoned");
    let tags_json = serde_json::to_string(&c.tags).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "INSERT INTO clients (id, auth_secret, name, enabled, owner, bandwidth_up, bandwidth_down, quota, quota_period, tags) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            c.id,
            c.auth_secret,
            c.name,
            c.enabled as i32,
            c.owner,
            c.bandwidth_up,
            c.bandwidth_down,
            c.quota,
            c.quota_period,
            tags_json,
        ],
    )?;
    Ok(())
}

pub fn update_client(
    db: &Mutex<Connection>,
    id: &str,
    name: Option<&str>,
    enabled: Option<bool>,
    tags: Option<&[String]>,
) -> bool {
    let conn = db.lock().expect("db lock poisoned");
    let exists: bool = conn
        .query_row("SELECT 1 FROM clients WHERE id = ?1", [id], |_| Ok(()))
        .optional()
        .ok()
        .flatten()
        .is_some();
    if !exists {
        return false;
    }
    if let Some(n) = name {
        conn.execute("UPDATE clients SET name = ?1 WHERE id = ?2", params![n, id])
            .ok();
    }
    if let Some(e) = enabled {
        conn.execute(
            "UPDATE clients SET enabled = ?1 WHERE id = ?2",
            params![e as i32, id],
        )
        .ok();
    }
    if let Some(t) = tags {
        let json = serde_json::to_string(t).unwrap_or_else(|_| "[]".into());
        conn.execute(
            "UPDATE clients SET tags = ?1 WHERE id = ?2",
            params![json, id],
        )
        .ok();
    }
    true
}

pub fn delete_client(db: &Mutex<Connection>, id: &str) -> bool {
    let conn = db.lock().expect("db lock poisoned");
    let rows = conn
        .execute("DELETE FROM clients WHERE id = ?1", [id])
        .unwrap_or(0);
    rows > 0
}

pub fn clients_by_owner(db: &Mutex<Connection>, owner: &str) -> Vec<String> {
    let conn = db.lock().expect("db lock poisoned");
    let mut stmt = conn
        .prepare("SELECT id FROM clients WHERE owner = ?1")
        .expect("prepare");
    stmt.query_map([owner], |row| row.get(0))
        .expect("query")
        .filter_map(|r| r.ok())
        .collect()
}

/// Convert DB clients into `AuthorizedClient` configs for rebuilding the in-memory auth store.
pub fn clients_as_authorized(db: &Mutex<Connection>) -> Vec<AuthorizedClient> {
    list_clients(db)
        .into_iter()
        .map(|c| AuthorizedClient {
            id: c.id,
            auth_secret: c.auth_secret,
            name: c.name,
            bandwidth_up: c.bandwidth_up,
            bandwidth_down: c.bandwidth_down,
            quota: c.quota,
            quota_period: c.quota_period,
            permissions: None,
            tags: c.tags,
            owner: c.owner,
        })
        .collect()
}

// ─────────────────────────── Routing rule helpers ───────────────────────

pub fn list_routing_rules(db: &Mutex<Connection>) -> Vec<RoutingRule> {
    let conn = db.lock().expect("db lock poisoned");
    let mut stmt = conn
        .prepare("SELECT id, name, priority, condition_type, condition_value, action, enabled FROM routing_rules ORDER BY priority")
        .expect("prepare routing_rules query");
    stmt.query_map([], |row| {
        let id_str: String = row.get(0)?;
        let cond_type: String = row.get(3)?;
        let cond_value: Option<String> = row.get(4)?;
        let action_str: String = row.get(5)?;
        Ok(RoutingRule {
            id: Uuid::parse_str(&id_str).unwrap_or_else(|_| Uuid::new_v4()),
            name: row.get(1)?,
            priority: row.get(2)?,
            condition: deserialize_condition(&cond_type, cond_value.as_deref()),
            action: deserialize_action(&action_str),
            enabled: row.get::<_, i32>(6)? != 0,
        })
    })
    .expect("query routing_rules")
    .filter_map(|r| r.ok())
    .collect()
}

pub fn insert_routing_rule(db: &Mutex<Connection>, rule: &RoutingRule) -> rusqlite::Result<()> {
    let conn = db.lock().expect("db lock poisoned");
    let (cond_type, cond_value) = serialize_condition(&rule.condition);
    let action = serialize_action(&rule.action);
    conn.execute(
        "INSERT INTO routing_rules (id, name, priority, condition_type, condition_value, action, enabled) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            rule.id.to_string(),
            rule.name,
            rule.priority,
            cond_type,
            cond_value,
            action,
            rule.enabled as i32,
        ],
    )?;
    Ok(())
}

pub fn update_routing_rule(db: &Mutex<Connection>, rule: &RoutingRule) -> bool {
    let conn = db.lock().expect("db lock poisoned");
    let (cond_type, cond_value) = serialize_condition(&rule.condition);
    let action = serialize_action(&rule.action);
    let rows = conn
        .execute(
            "UPDATE routing_rules SET name=?1, priority=?2, condition_type=?3, condition_value=?4, action=?5, enabled=?6 WHERE id=?7",
            params![
                rule.name,
                rule.priority,
                cond_type,
                cond_value,
                action,
                rule.enabled as i32,
                rule.id.to_string(),
            ],
        )
        .unwrap_or(0);
    rows > 0
}

pub fn delete_routing_rule(db: &Mutex<Connection>, id: &Uuid) -> bool {
    let conn = db.lock().expect("db lock poisoned");
    let rows = conn
        .execute("DELETE FROM routing_rules WHERE id = ?1", [id.to_string()])
        .unwrap_or(0);
    rows > 0
}

// ─────────────────────── Redemption codes ───────────────────────────────

#[derive(Clone, serde::Serialize)]
pub struct RedemptionCode {
    pub id: i64,
    pub code: String,
    pub max_uses: i32,
    pub used_count: i32,
    pub max_clients: i32,
    pub bandwidth_up: Option<String>,
    pub bandwidth_down: Option<String>,
    pub quota: Option<String>,
    pub quota_period: Option<String>,
    pub expires_at: Option<String>,
    pub created_by: Option<String>,
    pub created_at: String,
}

pub fn insert_redemption_code(
    db: &Mutex<Connection>,
    code: &RedemptionCode,
) -> rusqlite::Result<i64> {
    let conn = db.lock().expect("db lock poisoned");
    conn.execute(
        "INSERT INTO redemption_codes (code, max_uses, used_count, max_clients, bandwidth_up, bandwidth_down, quota, quota_period, expires_at, created_by) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            code.code,
            code.max_uses,
            code.used_count,
            code.max_clients,
            code.bandwidth_up,
            code.bandwidth_down,
            code.quota,
            code.quota_period,
            code.expires_at,
            code.created_by,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_redemption_codes(db: &Mutex<Connection>) -> Vec<RedemptionCode> {
    let conn = db.lock().expect("db lock poisoned");
    let mut stmt = conn
        .prepare("SELECT id, code, max_uses, used_count, max_clients, bandwidth_up, bandwidth_down, quota, quota_period, expires_at, created_by, created_at FROM redemption_codes ORDER BY id DESC")
        .expect("prepare");
    stmt.query_map([], |row| {
        Ok(RedemptionCode {
            id: row.get(0)?,
            code: row.get(1)?,
            max_uses: row.get(2)?,
            used_count: row.get(3)?,
            max_clients: row.get(4)?,
            bandwidth_up: row.get(5)?,
            bandwidth_down: row.get(6)?,
            quota: row.get(7)?,
            quota_period: row.get(8)?,
            expires_at: row.get(9)?,
            created_by: row.get(10)?,
            created_at: row.get(11)?,
        })
    })
    .expect("query")
    .filter_map(|r| r.ok())
    .collect()
}

pub fn get_redemption_code_by_code(db: &Mutex<Connection>, code: &str) -> Option<RedemptionCode> {
    let conn = db.lock().expect("db lock poisoned");
    conn.query_row(
        "SELECT id, code, max_uses, used_count, max_clients, bandwidth_up, bandwidth_down, quota, quota_period, expires_at, created_by, created_at FROM redemption_codes WHERE code = ?1",
        [code],
        |row| {
            Ok(RedemptionCode {
                id: row.get(0)?,
                code: row.get(1)?,
                max_uses: row.get(2)?,
                used_count: row.get(3)?,
                max_clients: row.get(4)?,
                bandwidth_up: row.get(5)?,
                bandwidth_down: row.get(6)?,
                quota: row.get(7)?,
                quota_period: row.get(8)?,
                expires_at: row.get(9)?,
                created_by: row.get(10)?,
                created_at: row.get(11)?,
            })
        },
    )
    .optional()
    .ok()
    .flatten()
}

pub fn increment_code_usage(db: &Mutex<Connection>, code_id: i64) {
    let conn = db.lock().expect("db lock poisoned");
    conn.execute(
        "UPDATE redemption_codes SET used_count = used_count + 1 WHERE id = ?1",
        [code_id],
    )
    .ok();
}

pub fn delete_redemption_code(db: &Mutex<Connection>, id: i64) -> bool {
    let conn = db.lock().expect("db lock poisoned");
    let rows = conn
        .execute("DELETE FROM redemption_codes WHERE id = ?1", [id])
        .unwrap_or(0);
    rows > 0
}

pub fn insert_redemption(db: &Mutex<Connection>, code_id: i64, username: &str, client_id: &str) {
    let conn = db.lock().expect("db lock poisoned");
    conn.execute(
        "INSERT INTO redemptions (code_id, username, client_id) VALUES (?1, ?2, ?3)",
        params![code_id, username, client_id],
    )
    .ok();
}

pub fn count_redemptions_for_user_code(
    db: &Mutex<Connection>,
    code_id: i64,
    username: &str,
) -> i32 {
    let conn = db.lock().expect("db lock poisoned");
    conn.query_row(
        "SELECT COUNT(*) FROM redemptions WHERE code_id = ?1 AND username = ?2",
        params![code_id, username],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

// ─────────────────────────── Invite helpers ─────────────────────────────

#[derive(Clone, serde::Serialize)]
pub struct Invite {
    pub id: i64,
    pub token: String,
    pub max_uses: i32,
    pub used_count: i32,
    pub max_clients: i32,
    pub bandwidth_up: Option<String>,
    pub bandwidth_down: Option<String>,
    pub quota: Option<String>,
    pub quota_period: Option<String>,
    pub default_role: String,
    pub expires_at: Option<String>,
    pub created_by: Option<String>,
    pub created_at: String,
}

pub fn insert_invite(db: &Mutex<Connection>, inv: &Invite) -> rusqlite::Result<i64> {
    let conn = db.lock().expect("db lock poisoned");
    conn.execute(
        "INSERT INTO invites (token, max_uses, used_count, max_clients, bandwidth_up, bandwidth_down, quota, quota_period, default_role, expires_at, created_by) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            inv.token,
            inv.max_uses,
            inv.used_count,
            inv.max_clients,
            inv.bandwidth_up,
            inv.bandwidth_down,
            inv.quota,
            inv.quota_period,
            inv.default_role,
            inv.expires_at,
            inv.created_by,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_invites(db: &Mutex<Connection>) -> Vec<Invite> {
    let conn = db.lock().expect("db lock poisoned");
    let mut stmt = conn
        .prepare("SELECT id, token, max_uses, used_count, max_clients, bandwidth_up, bandwidth_down, quota, quota_period, default_role, expires_at, created_by, created_at FROM invites ORDER BY id DESC")
        .expect("prepare");
    stmt.query_map([], |row| {
        Ok(Invite {
            id: row.get(0)?,
            token: row.get(1)?,
            max_uses: row.get(2)?,
            used_count: row.get(3)?,
            max_clients: row.get(4)?,
            bandwidth_up: row.get(5)?,
            bandwidth_down: row.get(6)?,
            quota: row.get(7)?,
            quota_period: row.get(8)?,
            default_role: row.get(9)?,
            expires_at: row.get(10)?,
            created_by: row.get(11)?,
            created_at: row.get(12)?,
        })
    })
    .expect("query")
    .filter_map(|r| r.ok())
    .collect()
}

pub fn get_invite_by_token(db: &Mutex<Connection>, token: &str) -> Option<Invite> {
    let conn = db.lock().expect("db lock poisoned");
    conn.query_row(
        "SELECT id, token, max_uses, used_count, max_clients, bandwidth_up, bandwidth_down, quota, quota_period, default_role, expires_at, created_by, created_at FROM invites WHERE token = ?1",
        [token],
        |row| {
            Ok(Invite {
                id: row.get(0)?,
                token: row.get(1)?,
                max_uses: row.get(2)?,
                used_count: row.get(3)?,
                max_clients: row.get(4)?,
                bandwidth_up: row.get(5)?,
                bandwidth_down: row.get(6)?,
                quota: row.get(7)?,
                quota_period: row.get(8)?,
                default_role: row.get(9)?,
                expires_at: row.get(10)?,
                created_by: row.get(11)?,
                created_at: row.get(12)?,
            })
        },
    )
    .optional()
    .ok()
    .flatten()
}

pub fn increment_invite_usage(db: &Mutex<Connection>, invite_id: i64) {
    let conn = db.lock().expect("db lock poisoned");
    conn.execute(
        "UPDATE invites SET used_count = used_count + 1 WHERE id = ?1",
        [invite_id],
    )
    .ok();
}

pub fn delete_invite(db: &Mutex<Connection>, id: i64) -> bool {
    let conn = db.lock().expect("db lock poisoned");
    let rows = conn
        .execute("DELETE FROM invites WHERE id = ?1", [id])
        .unwrap_or(0);
    rows > 0
}

// ─────────────────────── Subscription status ────────────────────────────

#[derive(Clone, serde::Serialize)]
pub struct SubscriptionInfo {
    pub code: String,
    pub client_id: String,
    pub redeemed_at: String,
    pub bandwidth_up: Option<String>,
    pub bandwidth_down: Option<String>,
    pub quota: Option<String>,
    pub quota_period: Option<String>,
}

pub fn user_subscriptions(db: &Mutex<Connection>, username: &str) -> Vec<SubscriptionInfo> {
    let conn = db.lock().expect("db lock poisoned");
    let mut stmt = conn
        .prepare(
            "SELECT rc.code, r.client_id, r.redeemed_at, rc.bandwidth_up, rc.bandwidth_down, rc.quota, rc.quota_period \
             FROM redemptions r JOIN redemption_codes rc ON r.code_id = rc.id \
             WHERE r.username = ?1 ORDER BY r.id DESC",
        )
        .expect("prepare");
    stmt.query_map([username], |row| {
        Ok(SubscriptionInfo {
            code: row.get(0)?,
            client_id: row.get(1)?,
            redeemed_at: row.get(2)?,
            bandwidth_up: row.get(3)?,
            bandwidth_down: row.get(4)?,
            quota: row.get(5)?,
            quota_period: row.get(6)?,
        })
    })
    .expect("query")
    .filter_map(|r| r.ok())
    .collect()
}

// ─────────────────────── SQLite dump for backup ─────────────────────────

pub fn dump_sql(db: &Mutex<Connection>) -> String {
    let conn = db.lock().expect("db lock poisoned");
    let tables = [
        "users",
        "clients",
        "routing_rules",
        "redemption_codes",
        "redemptions",
        "invites",
        "settings",
        "schema_version",
    ];
    let mut out = String::new();
    for table in tables {
        let mut stmt = match conn.prepare(&format!("SELECT * FROM {table}")) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let col_count = stmt.column_count();
        let col_names: Vec<String> = (0..col_count)
            .map(|i| stmt.column_name(i).unwrap_or("?").to_owned())
            .collect();

        let rows: Vec<Vec<String>> = match stmt.query_map([], |row| {
            let mut vals = Vec::new();
            for i in 0..col_count {
                let val: rusqlite::Result<String> = row.get(i);
                vals.push(match val {
                    Ok(v) => format!("'{}'", v.replace('\'', "''")),
                    Err(_) => "NULL".into(),
                });
            }
            Ok(vals)
        }) {
            Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
            Err(_) => Vec::new(),
        };

        for vals in rows {
            out.push_str(&format!(
                "INSERT OR REPLACE INTO {table} ({}) VALUES ({});\n",
                col_names.join(", "),
                vals.join(", ")
            ));
        }
    }
    out
}

pub fn restore_sql(db: &Mutex<Connection>, sql: &str) -> anyhow::Result<()> {
    let conn = db.lock().expect("db lock poisoned");
    conn.execute_batch(sql)?;
    Ok(())
}

// ─────────────────────── Serialization helpers ──────────────────────────

fn serialize_condition(cond: &RuleCondition) -> (String, Option<String>) {
    match cond {
        RuleCondition::DomainMatch(v) => ("DomainMatch".into(), Some(v.clone())),
        RuleCondition::DomainExact(v) => ("DomainExact".into(), Some(v.clone())),
        RuleCondition::IpCidr(v) => ("IpCidr".into(), Some(v.clone())),
        RuleCondition::PortRange(a, b) => ("PortRange".into(), Some(format!("{a}-{b}"))),
        RuleCondition::All => ("All".into(), None),
        RuleCondition::Unknown => ("Unknown".into(), None),
    }
}

fn deserialize_condition(cond_type: &str, value: Option<&str>) -> RuleCondition {
    match cond_type {
        "DomainMatch" => RuleCondition::DomainMatch(value.unwrap_or_default().to_string()),
        "DomainExact" => RuleCondition::DomainExact(value.unwrap_or_default().to_string()),
        "IpCidr" => RuleCondition::IpCidr(value.unwrap_or_default().to_string()),
        "PortRange" => {
            let v = value.unwrap_or("0-0");
            let (a, b) = v.split_once('-').unwrap_or(("0", "0"));
            RuleCondition::PortRange(a.parse().unwrap_or(0), b.parse().unwrap_or(0))
        }
        "All" => RuleCondition::All,
        _ => RuleCondition::Unknown,
    }
}

fn serialize_action(action: &RuleAction) -> String {
    match action {
        RuleAction::Allow | RuleAction::Unknown => "Allow".into(),
        RuleAction::Direct => "Direct".into(),
        RuleAction::Block => "Block".into(),
    }
}

fn deserialize_action(s: &str) -> RuleAction {
    match s {
        "Allow" => RuleAction::Allow,
        "Direct" => RuleAction::Direct,
        "Block" => RuleAction::Block,
        _ => RuleAction::Allow,
    }
}

pub fn parse_role(s: &str) -> UserRole {
    match s {
        "admin" => UserRole::Admin,
        "operator" => UserRole::Operator,
        _ => UserRole::Client,
    }
}

/// Check whether an optional expiry timestamp string is in the past.
/// Returns `true` when the timestamp is present AND has already elapsed.
pub fn is_expired(expires_at: Option<&str>) -> bool {
    let Some(exp) = expires_at else {
        return false;
    };
    let Ok(exp_dt) = chrono::NaiveDateTime::parse_from_str(exp, "%Y-%m-%d %H:%M:%S") else {
        return false;
    };
    chrono::Utc::now() > exp_dt.and_utc()
}

/// Generate a 32-byte random secret and return `(raw_bytes, hex_string)`.
pub fn generate_client_secret() -> ([u8; 32], String) {
    let mut secret = [0u8; 32];
    rand::Rng::fill(&mut rand::thread_rng(), &mut secret);
    let hex = prisma_core::util::hex_encode(&secret);
    (secret, hex)
}

/// Hash a password using bcrypt on a blocking thread.
pub async fn hash_password(password: String) -> Result<String, axum::http::StatusCode> {
    tokio::task::spawn_blocking(move || bcrypt::hash(password, 10))
        .await
        .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?
        .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)
}

/// Retrieve the configured session expiry in hours, falling back to 24.
pub fn session_expiry_hours(db: Option<&Db>) -> i64 {
    let hours = db
        .map(|d| get_setting_i64(d, "session_expiry_hours"))
        .unwrap_or(24);
    if hours > 0 {
        hours
    } else {
        24
    }
}
