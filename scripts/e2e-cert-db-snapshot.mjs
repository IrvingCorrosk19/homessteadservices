#!/usr/bin/env node
/**
 * DB snapshot for Browser Tab E2E certification.
 * Usage: node scripts/e2e-cert-db-snapshot.mjs [label] [--phone 61234567] [--hs HS-2026-000106]
 */
import Database from "better-sqlite3";
import { join } from "node:path";

const root = process.cwd();
const dataDir = process.env.DATA_DIR || join(root, "data");
const dbPath = join(dataDir, "homestead.sqlite");

const args = process.argv.slice(2);
const label = args.find((a) => !a.startsWith("--")) || "snapshot";
const phoneArg = args.includes("--phone")
  ? args[args.indexOf("--phone") + 1]
  : "";
const hsArg = args.includes("--hs") ? args[args.indexOf("--hs") + 1] : "";

let db;
try {
  db = new Database(dbPath, { readonly: true });
} catch (err) {
  console.log(JSON.stringify({ label, error: `Cannot open ${dbPath}: ${err.message}` }, null, 2));
  process.exit(1);
}

const tableExists = (name) => {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
  return Boolean(row);
};

const serviceRequestCount = db
  .prepare("SELECT COUNT(*) AS c FROM service_requests")
  .get().c;
const appointmentCount = tableExists("revenue_appointments")
  ? db.prepare("SELECT COUNT(*) AS c FROM revenue_appointments").get().c
  : 0;
const activeAppointments = tableExists("revenue_appointments")
  ? db
      .prepare(
        "SELECT COUNT(*) AS c FROM revenue_appointments WHERE status NOT IN ('CANCELLED','COMPLETED')",
      )
      .get().c
  : 0;

const appointments = tableExists("revenue_appointments")
  ? db
      .prepare(
        `SELECT a.appointment_id, a.lead_id, a.date, a.start_time, a.status, sr.public_id, sr.name
         FROM revenue_appointments a
         LEFT JOIN service_requests sr ON sr.public_id = a.lead_id
         ORDER BY a.created_at DESC LIMIT 20`,
      )
      .all()
  : [];

const activeRequests = db
  .prepare(
    "SELECT public_id, service, name, phone, message, status, created_at FROM service_requests WHERE status NOT IN ('cancelled','closed') ORDER BY created_at DESC LIMIT 20",
  )
  .all();

let customerRequests = [];
if (phoneArg) {
  customerRequests = db
    .prepare(
      "SELECT public_id, service, name, phone, message, status FROM service_requests WHERE phone LIKE ? ORDER BY created_at DESC",
    )
    .all(`%${phoneArg.replace(/\D/g, "")}%`);
}

let hsDetail = null;
if (hsArg) {
  const sr = db
    .prepare(
      "SELECT public_id, service, name, phone, message, status, facts_json FROM service_requests WHERE public_id = ?",
    )
    .get(hsArg);
  const appts = tableExists("revenue_appointments")
    ? db
        .prepare(
          "SELECT appointment_id, lead_id, date, start_time, status, created_at FROM revenue_appointments WHERE lead_id = ? ORDER BY created_at",
        )
        .all(hsArg)
    : [];
  hsDetail = { serviceRequest: sr, appointments: appts };
}

let outboxRows = [];
try {
  outboxRows = db
    .prepare(
      "SELECT event_id, event_type, payload_json, status, created_at FROM automation_outbox ORDER BY created_at DESC LIMIT 10",
    )
    .all();
} catch {
  outboxRows = [];
}

console.log(
  JSON.stringify(
    {
      label,
      dbPath,
      timestamp: new Date().toISOString(),
      counts: {
        serviceRequests: serviceRequestCount,
        appointments: appointmentCount,
        activeAppointments,
      },
      activeRequests,
      recentAppointments: appointments,
      customerRequests,
      hsDetail,
      outbox: outboxRows,
    },
    null,
    2,
  ),
);

db.close();
