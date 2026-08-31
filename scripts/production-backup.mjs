#!/usr/bin/env node
/**
 * Production-safe online SQLite backup + durable business files.
 * Uses SQLite backup API (WAL-safe). Never claims success on failure.
 *
 * Usage:
 *   node scripts/production-backup.mjs [--dest DIR] [--retain N]
 *
 * Env: DATA_DIR (default ./data)
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const root = fileURLToPath(new URL("..", import.meta.url));
const dataDir = resolve(process.env.DATA_DIR?.trim() || join(root, "data"));
const dbPath = join(dataDir, "homestead.sqlite");

function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(require("node:fs").readFileSync(path));
  return hash.digest("hex");
}

function parseArgs() {
  const args = process.argv.slice(2);
  let dest = "";
  let retain = Number(process.env.BACKUP_RETAIN_COUNT || "7");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dest" && args[i + 1]) dest = resolve(args[++i]);
    if (args[i] === "--retain" && args[i + 1]) retain = Number(args[++i]);
  }
  if (!dest) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    dest = resolve(process.env.BACKUP_DIR?.trim() || join(dataDir, "backups"), stamp);
  }
  return { dest, retain: Math.max(1, retain) };
}

function countRows(db, table) {
  try {
    return Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get()?.c ?? 0);
  } catch {
    return -1;
  }
}

function copyTree(src, dst) {
  if (!existsSync(src)) return { copied: false, files: 0 };
  cpSync(src, dst, { recursive: true, force: true });
  let files = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else files += 1;
    }
  };
  walk(dst);
  return { copied: true, files };
}

function recordBackupSuccess(iso) {
  if (!existsSync(dbPath)) return;
  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO automation_engine_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run("last_backup_at", iso, iso);
  db.close();
}

function pruneOldBackups(parentDir, retain, keepDest) {
  if (!existsSync(parentDir)) return;
  const entries = readdirSync(parentDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const full = join(parentDir, e.name);
      return { full, mtime: statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  if (entries.length <= retain) return;
  const toDelete = entries.slice(retain).filter((e) => resolve(e.full) !== resolve(keepDest));
  for (const entry of toDelete) {
    rmSync(entry.full, { recursive: true, force: true });
  }
}

function fail(msg) {
  console.error("BACKUP_FAIL", msg);
  process.exit(1);
}

const { dest, retain } = parseArgs();

if (!existsSync(dbPath)) fail("database_missing");

try {
  mkdirSync(dest, { recursive: true });
} catch {
  fail("destination_unavailable");
}

const backupDbPath = join(dest, "homestead.sqlite");
let srcDb;
try {
  srcDb = new Database(dbPath, { readonly: true });
  await srcDb.backup(backupDbPath);
} catch {
  fail("sqlite_backup_failed");
} finally {
  try {
    srcDb?.close();
  } catch {}
}

const verify = new Database(backupDbPath, { readonly: true });
const integrity = verify.prepare("PRAGMA integrity_check").get();
const integrityOk = String(integrity?.integrity_check ?? integrity) === "ok";
if (!integrityOk) {
  verify.close();
  fail("integrity_check_failed");
}

const manifest = {
  at: new Date().toISOString(),
  sourceDataDir: dataDir,
  backupDir: dest,
  database: {
    path: backupDbPath,
    sha256: sha256File(backupDbPath),
    integrity: "ok",
    counts: {
      service_requests: countRows(verify, "service_requests"),
      revenue_leads: countRows(verify, "revenue_leads"),
      revenue_appointments: countRows(verify, "revenue_appointments"),
      automation_outbox: countRows(verify, "automation_outbox"),
      operational_signals: countRows(verify, "operational_signals"),
    },
  },
  files: {},
};
verify.close();

for (const sub of ["photos", "content", "concierge", "jobs"]) {
  const src = join(dataDir, sub);
  const dst = join(dest, sub);
  manifest.files[sub] = copyTree(src, dst);
}

writeFileSync(join(dest, "manifest.json"), JSON.stringify(manifest, null, 2));

try {
  recordBackupSuccess(manifest.at);
} catch {
  // non-fatal for isolated drill dirs without engine_state table yet
}

const parent = join(dest, "..");
try {
  pruneOldBackups(parent, retain, dest);
} catch {
  // retention must not fail backup
}

console.log("BACKUP_OK", dest);
console.log(JSON.stringify(manifest, null, 2));
