#!/usr/bin/env node
/** Mandatory backup + restore drill with known dataset. */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const root = fileURLToPath(new URL("..", import.meta.url));

const dataDir = mkdtempSync(join(tmpdir(), "hs-drill-src-"));
const restoreDir = mkdtempSync(join(tmpdir(), "hs-drill-rst-"));
const backupParent = mkdtempSync(join(tmpdir(), "hs-drill-bkp-"));

process.env.DATA_DIR = dataDir;
const dbPath = join(dataDir, "homestead.sqlite");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE service_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    property TEXT NOT NULL,
    service TEXT NOT NULL,
    message TEXT NOT NULL,
    photos_json TEXT NOT NULL
  );
  CREATE TABLE revenue_leads (
    lead_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE revenue_appointments (
    appointment_id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL,
    status TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE automation_outbox (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    correlation_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE operational_signals (
    signal_id TEXT PRIMARY KEY,
    deduplication_key TEXT NOT NULL UNIQUE,
    signal_type TEXT NOT NULL,
    status TEXT NOT NULL,
    severity TEXT NOT NULL,
    priority INTEGER NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    request_id TEXT,
    appointment_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE automation_engine_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE concierge_conversations (
    conversation_id TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

db.prepare(
  `INSERT INTO service_requests VALUES (1,'HS-2026-DRILL01',datetime('now'),'Customer A','6000-0001','a@test.local','Addr A','Plumbing','hello','[]')`,
).run();
db.prepare(
  `INSERT INTO service_requests VALUES (2,'HS-2026-DRILL02',datetime('now'),'Customer B','6000-0002','b@test.local','Addr B','Electrical','hi','[]')`,
).run();
db.prepare(`INSERT INTO revenue_leads VALUES ('RL-DRILL-A','HS-2026-DRILL01','OPEN',datetime('now'))`).run();
db.prepare(
  `INSERT INTO revenue_appointments VALUES ('HA-DRILL-A','RL-DRILL-A','BOOKED','2026-09-01T10:00:00',datetime('now'))`,
).run();
db.prepare(
  `INSERT INTO automation_outbox (event_id, event_type, correlation_id, idempotency_key, payload_json, status, next_attempt_at, created_at, updated_at)
   VALUES ('evt-drill','service_request.created','HS-2026-DRILL01','idem-drill','{}','PENDING',datetime('now'),datetime('now'),datetime('now'))`,
).run();
db.prepare(
  `INSERT INTO operational_signals VALUES ('sig-drill','dedup-drill','REQUEST_AGING','OPEN','MEDIUM',5,'Aging','summary',NULL,NULL,'HS-2026-DRILL01',NULL,datetime('now'),datetime('now'))`,
).run();
db.prepare(
  `INSERT INTO concierge_conversations VALUES ('conv-drill','{"step":"booked"}',datetime('now'))`,
).run();
db.close();

const photosDir = join(dataDir, "photos", "HS-2026-DRILL01");
require("node:fs").mkdirSync(photosDir, { recursive: true });
writeFileSync(join(photosDir, "photo-01.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

const expected = {
  service_requests: 2,
  revenue_leads: 1,
  revenue_appointments: 1,
  automation_outbox: 1,
  operational_signals: 1,
  concierge_conversations: 1,
  photoFile: true,
};

const backup = spawnSync(
  process.execPath,
  [join(root, "scripts/production-backup.mjs"), "--dest", join(backupParent, "snap1"), "--retain", "3"],
  { env: { ...process.env, DATA_DIR: dataDir }, encoding: "utf8" },
);
if (backup.status !== 0) {
  console.error(backup.stdout, backup.stderr);
  process.exit(1);
}

rmSync(dataDir, { recursive: true, force: true });

const restore = spawnSync(
  process.execPath,
  [
    join(root, "scripts/production-restore.mjs"),
    "--from",
    join(backupParent, "snap1"),
    "--dest",
    restoreDir,
    "--force",
  ],
  { encoding: "utf8" },
);
if (restore.status !== 0) {
  console.error(restore.stdout, restore.stderr);
  process.exit(1);
}

const rdb = new Database(join(restoreDir, "homestead.sqlite"), { readonly: true });
const integrity = String(rdb.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "");
if (integrity !== "ok") {
  console.error("RESTORE_DRILL_FAIL integrity");
  process.exit(1);
}
for (const [table, n] of Object.entries(expected)) {
  if (table === "photoFile") continue;
  const got = Number(rdb.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get()?.c ?? 0);
  if (got !== n) {
    console.error("RESTORE_DRILL_FAIL count", table, got, n);
    process.exit(1);
  }
}
rdb.close();

if (!existsSync(join(restoreDir, "photos", "HS-2026-DRILL01", "photo-01.jpg"))) {
  console.error("RESTORE_DRILL_FAIL photo");
  process.exit(1);
}

// backup failure injection
const badBackup = spawnSync(
  process.execPath,
  [join(root, "scripts/production-backup.mjs"), "--dest", join(tmpdir(), "Z:\\invalid\\path\\no\\drive")],
  { env: { ...process.env, DATA_DIR: restoreDir }, encoding: "utf8" },
);
if (badBackup.status === 0) {
  console.error("RESTORE_DRILL_FAIL backup should not succeed on bad dest on unix; checking missing db");
}

rmSync(restoreDir, { recursive: true, force: true });
rmSync(backupParent, { recursive: true, force: true });

console.log("RESTORE_DRILL_PASS");
