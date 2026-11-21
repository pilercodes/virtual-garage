CREATE TABLE vehicles (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  color TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (owner, id)
);
