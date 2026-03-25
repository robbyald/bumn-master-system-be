CREATE TABLE question_usage (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  set_id TEXT,
  user_id TEXT,
  used_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
