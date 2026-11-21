CREATE TABLE workshop_records (
  owner TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, vehicle_id, kind, id)
);
