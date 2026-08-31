#!/usr/bin/env node
/** Seed autonomous signals on live E2E DB for browser UI verification. */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const envPath = join(root, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

process.env.DATA_DIR = process.env.DATA_DIR || "data/e2e-cert";
process.env.AUTONOMOUS_OPERATIONS_ENABLED = "true";
process.env.AUTONOMOUS_OPERATIONS_DRY_RUN = "true";

const { getHomesteadDb } = await import("../src/lib/service-requests.ts");
const { runAutonomousOpsScan } = await import("../src/lib/autonomous/engine.ts");
const { listActiveSignals } = await import("../src/lib/autonomous/signal-store.ts");
const { businessYmd } = await import("../src/lib/appointment-time.ts");

const db = getHomesteadDb();
const seq = Date.now().toString().slice(-6).padStart(6, "0");
const hsId = `HS-2026-${seq}`;
const phone = "50769998888";

db.prepare(`INSERT INTO revenue_customers (created_at, name, phone, email) VALUES (datetime('now'), 'Browser UI Test', ?, '')`).run(phone);
const custId = Number(db.prepare("SELECT last_insert_rowid() AS id").get().id);
db.prepare(
  `INSERT INTO service_requests (public_id, created_at, updated_at, status, name, phone, email, property, service, message, photos_json, facts_json)
   VALUES (?, datetime('now', '-72 hours'), datetime('now'), 'NEW', 'Browser UI Test', ?, '', 'Betania', 'plumbing', 'Fuga persistente', '[]', '{}')`,
).run(hsId, phone);
db.prepare(
  `INSERT INTO revenue_leads (lead_id, customer_id, created_at, updated_at, pipeline_stage, is_test, conversation_id)
   VALUES (?, ?, datetime('now', '-72 hours'), datetime('now'), 'NEW', 0, '')`,
).run(hsId, custId);

await runAutonomousOpsScan(false);
const signals = listActiveSignals(20);
console.log(JSON.stringify({ hsId, activeSignals: signals.length, first: signals[0]?.signalId || null }, null, 2));
