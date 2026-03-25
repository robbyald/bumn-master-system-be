CREATE TABLE feature_toggle (
  id TEXT PRIMARY KEY,
  tryout integer NOT NULL DEFAULT 1,
  leaderboard integer NOT NULL DEFAULT 1,
  materials integer NOT NULL DEFAULT 1,
  daily_challenge integer NOT NULL DEFAULT 1,
  community integer NOT NULL DEFAULT 1,
  payment integer NOT NULL DEFAULT 1,
  maintenance integer NOT NULL DEFAULT 0,
  updated_at integer NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
