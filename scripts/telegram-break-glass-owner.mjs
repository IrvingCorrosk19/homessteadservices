#!/usr/bin/env node
/**
 * Break-glass: restore / seed OWNER from server without a public endpoint.
 * Usage (on host with DATA_DIR or inside container):
 *   node scripts/telegram-break-glass-owner.mjs <telegram_user_id> [display_name]
 *
 * Requires HOMESTEAD_TELEGRAM_ADMIN_CHAT_IDS or explicit user id argument.
 * Never expose this as an HTTP route.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const userId = String(process.argv[2] || "").trim();
const displayName = String(process.argv[3] || "Break-glass Owner").slice(0, 80);
if (!userId || !/^\d+$/.test(userId)) {
  console.error("Usage: node scripts/telegram-break-glass-owner.mjs <telegram_user_id> [display_name]");
  process.exit(1);
}

const dataDir = process.env.DATA_DIR || join(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });
const db = new Database(join(dataDir, "homestead.sqlite"));
db.pragma("journal_mode = WAL");
const now = new Date().toISOString();
db.exec(`
  CREATE TABLE IF NOT EXISTS telegram_operators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_user_id TEXT NOT NULL UNIQUE,
    telegram_chat_id TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'PENDING',
    is_active INTEGER NOT NULL DEFAULT 0,
    notify_requests INTEGER NOT NULL DEFAULT 0,
    notify_appointments INTEGER NOT NULL DEFAULT 0,
    notify_leads INTEGER NOT NULL DEFAULT 0,
    notify_sla INTEGER NOT NULL DEFAULT 0,
    notify_content INTEGER NOT NULL DEFAULT 0,
    notify_daily_brief INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_seen_at TEXT,
    approved_at TEXT,
    approved_by_operator_id INTEGER,
    deactivated_at TEXT
  );
`);
const existing = db.prepare("SELECT id FROM telegram_operators WHERE telegram_user_id = ?").get(userId);
if (existing) {
  db.prepare(
    `UPDATE telegram_operators SET role='OWNER', is_active=1, deactivated_at=NULL, approved_at=?, updated_at=?,
      notify_requests=1, notify_appointments=1, notify_leads=1, notify_sla=1, notify_content=1, notify_daily_brief=1,
      display_name=COALESCE(NULLIF(display_name,''), ?)
     WHERE telegram_user_id = ?`,
  ).run(now, now, displayName, userId);
  console.log("UPDATED_OWNER", userId);
} else {
  db.prepare(
    `INSERT INTO telegram_operators (
      telegram_user_id, telegram_chat_id, display_name, role, is_active,
      notify_requests, notify_appointments, notify_leads, notify_sla, notify_content, notify_daily_brief,
      created_at, updated_at, approved_at
    ) VALUES (?, ?, ?, 'OWNER', 1, 1, 1, 1, 1, 1, 1, ?, ?, ?)`,
  ).run(userId, userId, displayName, now, now, now);
  console.log("INSERTED_OWNER", userId);
}
console.log("BREAK_GLASS_OK");
