process.env.DATA_DIR = process.env.DATA_DIR || "data/e2e-cert";
process.env.AUTONOMOUS_OPERATIONS_ENABLED = "true";

const { getHomesteadDb } = await import("../src/lib/service-requests.ts");
const { runAutonomousOpsScan } = await import("../src/lib/autonomous/engine.ts");

const hsId = "HS-2026-420711";
getHomesteadDb()
  .prepare("UPDATE service_requests SET status = 'CONTACTED', updated_at = datetime('now') WHERE public_id = ?")
  .run(hsId);

const db = getHomesteadDb();
const lead = db.prepare("SELECT customer_id FROM revenue_leads WHERE lead_id = ?").get(hsId);
if (lead?.customer_id) {
  db.prepare(
    `INSERT OR IGNORE INTO revenue_appointments (appointment_id, lead_id, customer_id, date, start_time, end_time, service, status, created_at, version)
     VALUES (?, ?, ?, date('now', '+1 day'), '10:00', '11:00', 'plumbing', 'CONFIRMED', datetime('now'), 1)`,
  ).run(`HA-BUI-${hsId.slice(-6)}`, hsId, lead.customer_id);
}

await runAutonomousOpsScan(false);

const rows = getHomesteadDb()
  .prepare("SELECT signal_id, status, signal_type FROM operational_signals WHERE facts_json LIKE ?")
  .all(`%${hsId}%`);
console.log(JSON.stringify(rows, null, 2));
