-- v3 down: Remove database-first configuration tables.

DROP TABLE IF EXISTS server_config;
DROP TABLE IF EXISTS certificates;
DROP TABLE IF EXISTS acls;

-- SQLite doesn't support DROP COLUMN before 3.35.0, so we recreate the table.
-- The clients table from v1 schema:
CREATE TABLE IF NOT EXISTS clients_backup AS SELECT id, auth_secret, name, enabled, owner, bandwidth_up, bandwidth_down, quota, quota_period, tags FROM clients;
DROP TABLE clients;
CREATE TABLE clients (
    id             TEXT PRIMARY KEY,
    auth_secret    TEXT NOT NULL,
    name           TEXT,
    enabled        INTEGER NOT NULL DEFAULT 1,
    owner          TEXT,
    bandwidth_up   TEXT,
    bandwidth_down TEXT,
    quota          TEXT,
    quota_period   TEXT,
    tags           TEXT NOT NULL DEFAULT '[]'
);
INSERT INTO clients SELECT * FROM clients_backup;
DROP TABLE clients_backup;
