CREATE TABLE garage_file_cleanup (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  due INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, id)
);
--> statement-breakpoint
CREATE TRIGGER garage_file_cleanup_insert
AFTER DELETE ON garage_files
BEGIN
  INSERT INTO garage_file_cleanup(owner, id, due) VALUES (OLD.owner, OLD.id, 0)
  ON CONFLICT(owner, id) DO UPDATE SET due = 0;
END;
