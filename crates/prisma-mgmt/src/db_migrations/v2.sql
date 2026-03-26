-- Migration v2: Subscription plans + permission fields on codes/invites.

CREATE TABLE IF NOT EXISTS subscription_plans (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  bandwidth_up TEXT,
  bandwidth_down TEXT,
  quota TEXT,
  quota_period TEXT,
  max_connections INTEGER DEFAULT 0,
  max_clients INTEGER DEFAULT 1,
  allow_port_forwarding INTEGER DEFAULT 1,
  allow_udp INTEGER DEFAULT 1,
  allowed_destinations TEXT DEFAULT '',
  blocked_destinations TEXT DEFAULT '',
  expiry_days INTEGER DEFAULT 30,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Add plan_id and permission columns to redemption_codes
ALTER TABLE redemption_codes ADD COLUMN plan_id INTEGER REFERENCES subscription_plans(id);
ALTER TABLE redemption_codes ADD COLUMN allow_port_forwarding INTEGER DEFAULT 1;
ALTER TABLE redemption_codes ADD COLUMN allow_udp INTEGER DEFAULT 1;
ALTER TABLE redemption_codes ADD COLUMN max_connections INTEGER DEFAULT 0;
ALTER TABLE redemption_codes ADD COLUMN allowed_destinations TEXT DEFAULT '';
ALTER TABLE redemption_codes ADD COLUMN blocked_destinations TEXT DEFAULT '';

-- Add plan_id and permission columns to invites
ALTER TABLE invites ADD COLUMN plan_id INTEGER REFERENCES subscription_plans(id);
ALTER TABLE invites ADD COLUMN allow_port_forwarding INTEGER DEFAULT 1;
ALTER TABLE invites ADD COLUMN allow_udp INTEGER DEFAULT 1;
ALTER TABLE invites ADD COLUMN max_connections INTEGER DEFAULT 0;
ALTER TABLE invites ADD COLUMN allowed_destinations TEXT DEFAULT '';
ALTER TABLE invites ADD COLUMN blocked_destinations TEXT DEFAULT '';
