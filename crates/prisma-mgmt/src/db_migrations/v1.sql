-- Migration v1: Initial schema for dynamic management data.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  auth_secret TEXT NOT NULL,
  name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  owner TEXT REFERENCES users(username),
  bandwidth_up TEXT,
  bandwidth_down TEXT,
  quota TEXT,
  quota_period TEXT,
  tags TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS routing_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL,
  condition_type TEXT NOT NULL,
  condition_value TEXT,
  action TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS redemption_codes (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  max_clients INTEGER NOT NULL DEFAULT 1,
  bandwidth_up TEXT,
  bandwidth_down TEXT,
  quota TEXT,
  quota_period TEXT,
  expires_at TEXT,
  created_by TEXT REFERENCES users(username),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS redemptions (
  id INTEGER PRIMARY KEY,
  code_id INTEGER REFERENCES redemption_codes(id),
  username TEXT NOT NULL REFERENCES users(username),
  client_id TEXT REFERENCES clients(id),
  redeemed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  max_clients INTEGER NOT NULL DEFAULT 1,
  bandwidth_up TEXT,
  bandwidth_down TEXT,
  quota TEXT,
  quota_period TEXT,
  default_role TEXT NOT NULL DEFAULT 'client',
  expires_at TEXT,
  created_by TEXT REFERENCES users(username),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
