CREATE TABLE maintenance (
  owner TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  id TEXT NOT NULL,
  description TEXT NOT NULL,
  date TEXT NOT NULL,
  mileage INTEGER NOT NULL,
  cost_cents INTEGER NOT NULL,
  notes TEXT NOT NULL,
  PRIMARY KEY (owner, vehicle_id, id)
);
--> statement-breakpoint
CREATE INDEX maintenance_by_date ON maintenance (owner, vehicle_id, date DESC, id);
