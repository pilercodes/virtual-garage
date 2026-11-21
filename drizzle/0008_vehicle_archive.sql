CREATE TABLE archived_vehicles (
  owner TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  PRIMARY KEY (owner, vehicle_id)
);
