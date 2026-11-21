ALTER TABLE garage_accounts ADD COLUMN recovery_hash TEXT;
--> statement-breakpoint
ALTER TABLE garage_accounts ADD COLUMN assisted_recovery_hash TEXT;
--> statement-breakpoint
ALTER TABLE garage_accounts ADD COLUMN assisted_recovery_expires INTEGER;
--> statement-breakpoint
CREATE TRIGGER garage_revoke_sessions_on_password_change
AFTER UPDATE OF verifier ON garage_accounts
WHEN OLD.verifier != NEW.verifier
BEGIN
  DELETE FROM garage_sessions WHERE account_id = NEW.id;
END;
