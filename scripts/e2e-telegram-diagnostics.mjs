#!/usr/bin/env node
/**
 * Local Telegram appointment notification diagnostics (no secrets printed).
 */
import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const envPath = join(root, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const dataDir = process.env.DATA_DIR || join(root, "data", "e2e-cert");
const dbPath = join(dataDir, "homestead.sqlite");

const tokenConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
const envAllowlist = (process.env.HOMESTEAD_TELEGRAM_ADMIN_CHAT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let operatorCount = 0;
let appointmentOperators = 0;
if (existsSync(dbPath)) {
  const db = new Database(dbPath, { readonly: true });
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='telegram_operators'")
    .get();
  if (tables) {
    operatorCount = db.prepare("SELECT COUNT(*) AS c FROM telegram_operators WHERE is_active=1").get().c;
    appointmentOperators = db
      .prepare(
        "SELECT COUNT(*) AS c FROM telegram_operators WHERE is_active=1 AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''",
      )
      .get().c;
  }
  db.close();
}

let outboxReschedule = [];
if (existsSync(dbPath)) {
  const db = new Database(dbPath, { readonly: true });
  const hasOutbox = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='automation_outbox'")
    .get();
  if (hasOutbox) {
    outboxReschedule = db
      .prepare(
        `SELECT event_id, event_type, status, payload_json, created_at
         FROM automation_outbox
         WHERE event_type LIKE '%appointment%' OR payload_json LIKE '%RESCHEDUL%'
         ORDER BY created_at DESC LIMIT 10`,
      )
      .all();
  }
  db.close();
}

console.log(
  JSON.stringify(
    {
      tokenConfigured,
      envAllowlistCount: envAllowlist.length,
      dbPath: existsSync(dbPath) ? dbPath : "missing",
      activeOperators: operatorCount,
      operatorsWithChatId: appointmentOperators,
      telegramDeliveryLikely:
        tokenConfigured && (envAllowlist.length > 0 || appointmentOperators > 0)
          ? "configured"
          : "blocked_local",
      appointmentTelegramFailedRootCause:
        !tokenConfigured
          ? "TELEGRAM_BOT_TOKEN missing"
          : envAllowlist.length === 0 && appointmentOperators === 0
            ? "no appointment chat targets (adminChatIds empty → silent skip; failed only if chats exist but send fails)"
            : "chats configured but sendTelegramMessage returned no message_id (token invalid, blocked chat, or network)",
      recentOutboxAppointmentEvents: outboxReschedule.map((r) => ({
        event_id: r.event_id,
        event_type: r.event_type,
        status: r.status,
        created_at: r.created_at,
        payloadPreview: String(r.payload_json || "").slice(0, 120),
      })),
    },
    null,
    2,
  ),
);
