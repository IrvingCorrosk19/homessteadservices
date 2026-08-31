#!/usr/bin/env node
/**
 * Safe restore from production-backup.mjs output.
 * Requires explicit --dest DATA_DIR. Never overwrites production by default.
 *
 * Usage:
 *   node scripts/production-restore.mjs --from BACKUP_DIR --dest NEW_DATA_DIR [--force]
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const root = fileURLToPath(new URL("..", import.meta.url));
const defaultData = resolve(process.env.DATA_DIR?.trim() || join(root, "data"));

function fail(msg) {
  console.error("RESTORE_FAIL", msg);
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let from = "";
  let dest = "";
  let force = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from" && args[i + 1]) from = resolve(args[++i]);
    if (args[i] === "--dest" && args[i + 1]) dest = resolve(args[++i]);
    if (args[i] === "--force") force = true;
  }
  return { from, dest, force };
}

const { from, dest, force } = parseArgs();
if (!from) fail("missing --from BACKUP_DIR");
if (!dest) fail("missing --dest DATA_DIR (explicit destination required)");

const backupDb = join(from, "homestead.sqlite");
const manifestPath = join(from, "manifest.json");
if (!existsSync(backupDb)) fail("backup_database_missing");

if (existsSync(dest) && !force) {
  fail("destination_exists_use_force");
}

if (existsSync(dest) && force) {
  rmSync(dest, { recursive: true, force: true });
}
mkdirSync(dest, { recursive: true });

const restoredDb = join(dest, "homestead.sqlite");
cpSync(backupDb, restoredDb);

const db = new Database(restoredDb, { readonly: true });
const integrity = db.prepare("PRAGMA integrity_check").get();
const ok = String(integrity?.integrity_check ?? integrity) === "ok";
if (!ok) {
  db.close();
  fail("integrity_check_failed");
}

const counts = {
  service_requests: Number(db.prepare("SELECT COUNT(*) AS c FROM service_requests").get()?.c ?? 0),
  revenue_leads: Number(db.prepare("SELECT COUNT(*) AS c FROM revenue_leads").get()?.c ?? 0),
  revenue_appointments: Number(db.prepare("SELECT COUNT(*) AS c FROM revenue_appointments").get()?.c ?? 0),
  automation_outbox: Number(db.prepare("SELECT COUNT(*) AS c FROM automation_outbox").get()?.c ?? 0),
  operational_signals: Number(db.prepare("SELECT COUNT(*) AS c FROM operational_signals").get()?.c ?? 0),
};
db.close();

for (const sub of ["photos", "content", "concierge", "jobs"]) {
  const src = join(from, sub);
  if (existsSync(src)) cpSync(src, join(dest, sub), { recursive: true, force: true });
}

let expected = null;
if (existsSync(manifestPath)) {
  try {
    expected = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    // ignore
  }
}

if (expected?.database?.counts) {
  for (const [table, n] of Object.entries(expected.database.counts)) {
    if (n >= 0 && counts[table] !== n) {
      fail(`count_mismatch_${table}`);
    }
  }
}

console.log("RESTORE_OK", dest);
console.log(JSON.stringify({ dest, counts, source: from, productionDefaultBlocked: dest === defaultData && !force }, null, 2));
