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

sqlite.exec(`
CREATE TABLE IF NOT EXISTS payment_gateway_config (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'doku',
  mode TEXT NOT NULL DEFAULT 'sandbox',
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX IF NOT EXISTS payment_gateway_config_provider_idx ON payment_gateway_config(provider);
`);

sqlite.exec(`
CREATE TABLE IF NOT EXISTS payment_method_config (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'doku',
  method_type TEXT NOT NULL DEFAULT 'virtual_account',
  bank_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_visible INTEGER NOT NULL DEFAULT 1,
  sandbox_partner_service_id TEXT NOT NULL DEFAULT '',
  sandbox_customer_no TEXT NOT NULL DEFAULT '',
  sandbox_channel TEXT NOT NULL DEFAULT '',
  production_partner_service_id TEXT NOT NULL DEFAULT '',
  production_customer_no TEXT NOT NULL DEFAULT '',
  production_channel TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX IF NOT EXISTS payment_method_config_provider_idx ON payment_method_config(provider);
CREATE INDEX IF NOT EXISTS payment_method_config_visible_idx ON payment_method_config(is_visible);
CREATE INDEX IF NOT EXISTS payment_method_config_sortOrder_idx ON payment_method_config(sort_order);
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

// Seed payment gateway mode if empty
try {
  const rows = sqlite
    .prepare("SELECT id FROM payment_gateway_config WHERE id = 'doku' LIMIT 1")
    .all() as Array<{ id: string }>;
  if (!rows || rows.length === 0) {
    sqlite.exec(`
      INSERT INTO payment_gateway_config (id, provider, mode, created_at, updated_at)
      VALUES ('doku', 'doku', 'sandbox', cast(unixepoch('subsecond') * 1000 as integer), cast(unixepoch('subsecond') * 1000 as integer));
    `);
  }
} catch {
  // ignore
}

// Seed default DOKU VA methods if empty
try {
  const rows = sqlite.prepare("SELECT id FROM payment_method_config LIMIT 1").all() as Array<{ id: string }>;
  if (!rows || rows.length === 0) {
    sqlite.exec(`
      INSERT INTO payment_method_config (
        id, provider, method_type, bank_code, display_name, is_visible,
        sandbox_partner_service_id, sandbox_customer_no, sandbox_channel,
        production_partner_service_id, production_customer_no, production_channel,
        sort_order, created_at, updated_at
      ) VALUES
      ('doku_va_bri', 'doku', 'virtual_account', 'BRI', 'Virtual Account BRI', 1, '13925', '6', 'VIRTUAL_ACCOUNT_BRI', '', '', '', 1, cast(unixepoch('subsecond') * 1000 as integer), cast(unixepoch('subsecond') * 1000 as integer)),
      ('doku_va_permata', 'doku', 'virtual_account', 'PERMATA', 'Virtual Account Permata', 1, '8856', '6', 'VIRTUAL_ACCOUNT_BANK_PERMATA', '', '', '', 2, cast(unixepoch('subsecond') * 1000 as integer), cast(unixepoch('subsecond') * 1000 as integer)),
      ('doku_va_cimb', 'doku', 'virtual_account', 'CIMB', 'Virtual Account CIMB', 1, '1899', '0', 'VIRTUAL_ACCOUNT_BANK_CIMB', '', '', '', 3, cast(unixepoch('subsecond') * 1000 as integer), cast(unixepoch('subsecond') * 1000 as integer)),
      ('doku_va_bca', 'doku', 'virtual_account', 'BCA', 'Virtual Account BCA', 1, '19008', '9', 'VIRTUAL_ACCOUNT_BCA', '', '', '', 4, cast(unixepoch('subsecond') * 1000 as integer), cast(unixepoch('subsecond') * 1000 as integer)),
      ('doku_va_bsi', 'doku', 'virtual_account', 'BSI', 'Virtual Account BSI', 1, '2020', '20', 'VIRTUAL_ACCOUNT_BSI', '', '', '', 5, cast(unixepoch('subsecond') * 1000 as integer), cast(unixepoch('subsecond') * 1000 as integer)),
      ('doku_va_bni', 'doku', 'virtual_account', 'BNI', 'Virtual Account BNI', 1, '8492', '3', 'VIRTUAL_ACCOUNT_BNI', '', '', '', 6, cast(unixepoch('subsecond') * 1000 as integer), cast(unixepoch('subsecond') * 1000 as integer)),
      ('doku_va_mandiri', 'doku', 'virtual_account', 'MANDIRI', 'Virtual Account Mandiri', 1, '88899', '4', 'VIRTUAL_ACCOUNT_BANK_MANDIRI', '', '', '', 7, cast(unixepoch('subsecond') * 1000 as integer), cast(unixepoch('subsecond') * 1000 as integer)),
      ('doku_va_btn', 'doku', 'virtual_account', 'BTN', 'Virtual Account BTN', 1, '95962', '6', 'VIRTUAL_ACCOUNT_BTN', '', '', '', 8, cast(unixepoch('subsecond') * 1000 as integer), cast(unixepoch('subsecond') * 1000 as integer));
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

try {
  const cols = sqlite.prepare("PRAGMA table_info('question_bank')").all() as Array<{ name: string }>;
  const hasSourceDetail = cols.some((c) => c.name === "source_detail");
  if (!hasSourceDetail) {
    sqlite.exec("ALTER TABLE question_bank ADD COLUMN source_detail TEXT NOT NULL DEFAULT '';");
  }
} catch {
  // ignore if table does not exist yet
}
