-- Down migration v2 -> v1: drop subscription_plans table.
-- SQLite does not support DROP COLUMN, so the extra columns on
-- redemption_codes and invites remain but are harmless (ignored by v1 code).
DROP TABLE IF EXISTS subscription_plans;
