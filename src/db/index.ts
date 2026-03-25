import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { env } from "../env.js";

try {
  mkdirSync(dirname(env.DATABASE_URL), { recursive: true });
} catch {
  // Ignore if path has no directory or cannot be created
}

export const sqlite = new Database(env.DATABASE_URL);
export const db = drizzle(sqlite);

sqlite.exec(`
CREATE TABLE IF NOT EXISTS support_ticket (
  id TEXT PRIMARY KEY,
  ticket_no TEXT NOT NULL,
  user_id TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  closed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX IF NOT EXISTS support_ticket_ticketNo_idx ON support_ticket(ticket_no);
CREATE INDEX IF NOT EXISTS support_ticket_status_idx ON support_ticket(status);
CREATE INDEX IF NOT EXISTS support_ticket_createdAt_idx ON support_ticket(created_at);
`);

sqlite.exec(`
CREATE TABLE IF NOT EXISTS latsol_set (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  title TEXT NOT NULL,
  total_questions INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  is_premium INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX IF NOT EXISTS latsol_set_categoryId_idx ON latsol_set(category_id);
CREATE INDEX IF NOT EXISTS latsol_set_category_idx ON latsol_set(category);
CREATE INDEX IF NOT EXISTS latsol_set_subcategory_idx ON latsol_set(subcategory);
`);

sqlite.exec(`
CREATE TABLE IF NOT EXISTS latsol_set_question (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  "order" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS latsol_set_question_setId_idx ON latsol_set_question(set_id);
CREATE INDEX IF NOT EXISTS latsol_set_question_questionId_idx ON latsol_set_question(question_id);
`);

sqlite.exec(`
CREATE TABLE IF NOT EXISTS latsol_progress (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  set_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  score INTEGER,
  completed_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX IF NOT EXISTS latsol_progress_userId_idx ON latsol_progress(user_id);
CREATE INDEX IF NOT EXISTS latsol_progress_setId_idx ON latsol_progress(set_id);
CREATE INDEX IF NOT EXISTS latsol_progress_categoryId_idx ON latsol_progress(category_id);
`);

sqlite.exec(`
CREATE TABLE IF NOT EXISTS promo_banner (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  type TEXT NOT NULL DEFAULT 'text',
  title TEXT,
  message TEXT,
  code TEXT,
  cta_text TEXT,
  cta_link TEXT,
  image_url TEXT,
  version TEXT NOT NULL DEFAULT 'v1',
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX IF NOT EXISTS promo_banner_enabled_idx ON promo_banner(enabled);
`);

// Seed default promo banner if empty
try {
  const promoRows = sqlite.prepare("SELECT id FROM promo_banner LIMIT 1").all() as Array<{ id: string }>;
  if (!promoRows || promoRows.length === 0) {
    sqlite.exec(`
      INSERT INTO promo_banner (
        id, enabled, type, title, message, code, cta_text, cta_link, image_url, version, created_at, updated_at
      ) VALUES (
        'default', 1, 'text', 'Promo Spesial Ramadhan! 🌙',
        'Dapatkan diskon 50% untuk semua paket Premium dengan kode',
        'LOLOSBUMN2024', 'Ambil Promo Sekarang', '/catalog', NULL, 'v1',
        cast(unixepoch('subsecond') * 1000 as integer),
        cast(unixepoch('subsecond') * 1000 as integer)
      );
    `);
  }
} catch {
  // ignore
}

// Backfill column for older DBs
try {
  const cols = sqlite.prepare("PRAGMA table_info('support_ticket')").all() as Array<{ name: string }>;
  const hasTicketNo = cols.some((c) => c.name === "ticket_no");
  const hasClosedAt = cols.some((c) => c.name === "closed_at");
  if (!hasTicketNo) {
    sqlite.exec("ALTER TABLE support_ticket ADD COLUMN ticket_no TEXT;");
  }
  if (!hasClosedAt) {
    sqlite.exec("ALTER TABLE support_ticket ADD COLUMN closed_at INTEGER;");
  }
} catch {
  // ignore if table does not exist yet
}
