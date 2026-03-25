CREATE TABLE payment_order (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'doku',
  external_order_no TEXT NOT NULL,
  external_invoice_no TEXT,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_url TEXT,
  raw_response TEXT,
  raw_callback TEXT,
  paid_at INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
