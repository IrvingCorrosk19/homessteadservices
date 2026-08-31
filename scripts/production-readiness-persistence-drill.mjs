#!/usr/bin/env node
/** Persistence drill: data survives process-level DB reopen (simulates container restart). */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const dir = mkdtempSync(join(tmpdir(), "hs-persist-"));
const dbPath = join(dir, "homestead.sqlite");
mkdirSync(join(dir, "photos"), { recursive: true });

const db1 = new Database(dbPath);
db1.pragma("journal_mode = WAL");
db1.exec(`
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
`);
db1.prepare(
  `INSERT INTO service_requests (public_id, created_at, name, phone, email, property, service, message, photos_json)
   VALUES ('HS-2026-PERSIST1', datetime('now'), 'Persist', '6000', 'p@test.local', 'X', 'Plumbing', 'm', '[]')`,
).run();
db1.close();

writeFileSync(join(dir, "photos", "marker.txt"), "persist");

const db2 = new Database(dbPath, { readonly: true });
const count = Number(db2.prepare("SELECT COUNT(*) AS c FROM service_requests WHERE public_id = 'HS-2026-PERSIST1'").get()?.c ?? 0);
const integrity = String(db2.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "");
db2.close();

rmSync(dir, { recursive: true, force: true });

if (count !== 1 || integrity !== "ok") {
  console.error("PERSISTENCE_DRILL_FAIL", { count, integrity });
  process.exit(1);
}
console.log("PERSISTENCE_DRILL_PASS");
