-- Generic collection tables, one per JSON file this replaces. Each mirrors
-- JsonFileStore's shape: a real id and timestamps for ordering and lookup,
-- everything else in `data` as JSONB. This is deliberately not yet a
-- relational model -- `hands` gets redesigned with real columns (a users
-- table, a foreign key, share tokens) once auth exists. `history` and
-- `tournaments` have no per-user concept in this app, so a JSONB blob is an
-- honest fit for them, not a shortcut standing in for something better.

CREATE TABLE IF NOT EXISTS history (
  id UUID PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS history_created_at_idx ON history (created_at DESC);

CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tournaments_created_at_idx ON tournaments (created_at DESC);

CREATE TABLE IF NOT EXISTS hands (
  id UUID PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS hands_created_at_idx ON hands (created_at DESC);
