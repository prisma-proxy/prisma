-- v3: Database-first configuration
-- Moves server config sections from TOML to SQLite.

CREATE TABLE IF NOT EXISTS server_config (
    section    TEXT PRIMARY KEY,
    config     TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS certificates (
    name        TEXT PRIMARY KEY,
    cert_path   TEXT NOT NULL,
    key_path    TEXT NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    fingerprint TEXT,
    not_after   TEXT
);

CREATE TABLE IF NOT EXISTS acls (
    client_id  TEXT PRIMARY KEY,
    rules      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Add permissions column to clients for DB-stored permissions
ALTER TABLE clients ADD COLUMN permissions TEXT;
