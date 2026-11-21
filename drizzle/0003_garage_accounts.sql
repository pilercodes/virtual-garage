CREATE TABLE garage_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  verifier TEXT NOT NULL,
  starter_vehicles INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE garage_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES garage_accounts(id),
  expires INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX garage_sessions_expires ON garage_sessions(expires);
--> statement-breakpoint
CREATE TABLE garage_invites (
  token_hash TEXT PRIMARY KEY,
  garage_id TEXT NOT NULL REFERENCES garage_accounts(id),
  expires INTEGER NOT NULL,
  claimed_by TEXT REFERENCES garage_accounts(id)
);
--> statement-breakpoint
CREATE INDEX garage_invites_claimed ON garage_invites(claimed_by, garage_id);
--> statement-breakpoint
CREATE TABLE garage_rate_limits (
  key TEXT PRIMARY KEY,
  window INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX garage_rate_window ON garage_rate_limits(window);
--> statement-breakpoint
CREATE TABLE garage_legacy_claims (
  legacy_id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL UNIQUE REFERENCES garage_accounts(id)
);
