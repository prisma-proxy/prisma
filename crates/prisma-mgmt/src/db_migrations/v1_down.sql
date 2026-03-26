-- Down migration v1 -> v0: drop all tables created by v1.sql
-- Safe because the TOML config is the fallback for static data.
-- NOTE: schema_version is NOT dropped here; it is managed by the migration system.
DROP TABLE IF EXISTS redemptions;
DROP TABLE IF EXISTS redemption_codes;
DROP TABLE IF EXISTS invites;
DROP TABLE IF EXISTS routing_rules;
DROP TABLE IF EXISTS clients;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS settings;
