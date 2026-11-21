CREATE TABLE garage_file_cleanup (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  PRIMARY KEY (owner, id)
);
--> statement-breakpoint
CREATE TRIGGER garage_file_cleanup_insert
AFTER DELETE ON garage_files
BEGIN
  INSERT OR IGNORE INTO garage_file_cleanup(owner, id) VALUES (OLD.owner, OLD.id);
END;
