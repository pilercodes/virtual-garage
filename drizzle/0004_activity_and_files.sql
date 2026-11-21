ALTER TABLE maintenance ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'maintenance';
--> statement-breakpoint
ALTER TABLE maintenance ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';
--> statement-breakpoint
ALTER TABLE maintenance ADD COLUMN details TEXT NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE maintenance ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE garage_files (
  owner TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  id TEXT NOT NULL,
  target TEXT NOT NULL,
  mime TEXT NOT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, id)
);
--> statement-breakpoint
CREATE INDEX garage_files_parent ON garage_files(owner, vehicle_id, target, position);
