#!/usr/bin/env node
/** SQLite integrity + concurrent write stress for production readiness. */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

if (!isMainThread) {
  const { dbPath, workerId, iterations } = workerData;
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 4000");
  db.pragma("foreign_keys = ON");
  for (let i = 0; i < iterations; i++) {
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO service_requests (public_id, created_at, name, phone, email, property, service, message, photos_json)
         VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, '[]')`,
      ).run(
        `HS-2026-W${workerId}${String(i).padStart(4, "0")}`,
        `Worker${workerId}`,
        "6000-0000",
        `w${workerId}@test.local`,
        "Test",
        "Plumbing",
        "msg",
      );
    });
    tx();
  }
  db.close();
  parentPort.postMessage("ok");
  process.exit(0);
}

let failed = 0;
function check(name, ok) {
  if (!ok) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

const dir = mkdtempSync(join(tmpdir(), "hs-pr-db-"));
const dbPath = join(dir, "homestead.sqlite");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 4000");
db.pragma("foreign_keys = ON");
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
`);
db.close();

const workers = 4;
const iterations = 25;
await Promise.all(
  Array.from({ length: workers }, (_, workerId) =>
    new Promise((resolve, reject) => {
      const w = new Worker(new URL(import.meta.url), {
        workerData: { dbPath, workerId, iterations },
      });
      w.on("message", resolve);
      w.on("error", reject);
    }),
  ),
);

const verify = new Database(dbPath, { readonly: true });
const integrity = String(verify.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "");
check("integrity_check ok", integrity === "ok");
const count = Number(verify.prepare("SELECT COUNT(*) AS c FROM service_requests").get()?.c ?? 0);
check("concurrent inserts preserved", count === workers * iterations);
verify.close();

// idempotency (writable connection)
const writeDb = new Database(dbPath);
writeDb.prepare(
  `INSERT INTO automation_outbox (event_id, event_type, correlation_id, idempotency_key, payload_json, status, next_attempt_at, created_at, updated_at)
   VALUES ('e1', 'test', 'c1', 'idem-1', '{}', 'PENDING', datetime('now'), datetime('now'), datetime('now'))`,
).run();
let dupBlocked = false;
try {
  writeDb.prepare(
    `INSERT INTO automation_outbox (event_id, event_type, correlation_id, idempotency_key, payload_json, status, next_attempt_at, created_at, updated_at)
     VALUES ('e2', 'test', 'c1', 'idem-1', '{}', 'PENDING', datetime('now'), datetime('now'), datetime('now'))`,
  ).run();
} catch {
  dupBlocked = true;
}
check("outbox idempotency unique", dupBlocked);

writeDb.prepare(
  `INSERT INTO operational_signals (signal_id, deduplication_key, signal_type, status, severity, priority, title, summary, created_at, updated_at)
   VALUES ('s1', 'dedup-1', 'TEST', 'OPEN', 'LOW', 1, 't', 's', datetime('now'), datetime('now'))`,
).run();
let sigDup = false;
try {
  writeDb.prepare(
    `INSERT INTO operational_signals (signal_id, deduplication_key, signal_type, status, severity, priority, title, summary, created_at, updated_at)
     VALUES ('s2', 'dedup-1', 'TEST', 'OPEN', 'LOW', 1, 't', 's', datetime('now'), datetime('now'))`,
  ).run();
} catch {
  sigDup = true;
}
check("operational signal dedup unique", sigDup);
writeDb.close();

rmSync(dir, { recursive: true, force: true });

if (failed) process.exit(1);
console.log("DB_INTEGRITY_AUDIT_PASS");
