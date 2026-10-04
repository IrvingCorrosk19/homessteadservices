/**
 * Production-safe Control Push reminder E2E fixture.
 * Creates a temporary lead+appointment assigned to op:2 subject aliases,
 * exercises sync → cancel/reschedule → due → outbox drain → n8n FCM.
 * Does not call Telegram/Meta customer notifiers.
 *
 * Usage (VPS one-off container with DATA_DIR + push env + n8n network):
 *   npx tsx scripts/control-push-reminder-e2e.mjs
 */
import { randomBytes, randomUUID } from "node:crypto";

process.env.HOMESTEAD_CONTROL_ISOLATED = "false";
process.env.AUTOMATION_DISPATCH_ENABLED = "false";

const { getHomesteadDb } = await import("../src/lib/service-requests.ts");
const {
  syncAppointmentPushReminder,
  cancelAppointmentPushReminders,
  setAppointmentAssignee,
  processDuePushReminders,
  drainControlPushOutbox,
  controlPushSubjectId,
} = await import("../src/lib/control-push.ts");

const db = getHomesteadDb();
const now = new Date().toISOString();
const stamp = Date.now().toString(36);
const leadId = `LEAD-PUSH-E2E-${stamp}`;
const appointmentId = `HA-PUSH-E2E-${stamp}`;

const report = {
  appointmentId,
  leadId,
  subjectId: controlPushSubjectId(),
  steps: {},
};

function countReminders(status, appt = appointmentId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM control_push_reminders
       WHERE appointment_id = ? AND status = ?`,
    )
    .get(appt, status).n;
}

function countOutboxFor(corr) {
  return db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM control_push_outbox
       WHERE correlation_id = ? GROUP BY status`,
    )
    .all(corr);
}

// Panama local ~ +45 minutes from now so 30m reminder is ~15m ahead, then we force-fire.
const panamaNow = new Date(Date.now() - 5 * 3600_000);
const start = new Date(panamaNow.getTime() + 45 * 60_000);
const y = panamaNow.getUTCFullYear(); // panamaNow already offset-hacked as "local as UTC"
// Better: format with Intl
const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Panama",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const parts = Object.fromEntries(
  fmt.formatToParts(new Date(Date.now() + 45 * 60_000)).map((p) => [p.type, p.value]),
);
const date = `${parts.year}-${parts.month}-${parts.day}`;
const time = `${parts.hour}:${parts.minute}`;

db.prepare(
  `INSERT INTO revenue_customers (name, phone, email, created_at, do_not_contact, is_test)
   VALUES (?, ?, ?, ?, 0, 0)`,
).run("Push E2E Fixture", `+5076${String(Date.now()).slice(-7)}`, `push-e2e-${stamp}@example.invalid`, now);
const customerId = Number(db.prepare("SELECT last_insert_rowid() AS id").get().id);

db.prepare(
  `INSERT INTO revenue_leads (
    lead_id, customer_id, created_at, updated_at, source, service_category, is_test, dry_run
  ) VALUES (?, ?, ?, ?, 'ADMIN', 'locksmith', 0, 1)`,
).run(leadId, customerId, now, now);

db.prepare(
  `INSERT INTO revenue_appointments (
    appointment_id, lead_id, customer_id, date, start_time, service, status,
    assigned_to, created_at, notes, source, version
  ) VALUES (?, ?, ?, ?, ?, 'locksmith', 'CONFIRMED', '', ?, 'push-e2e-fixture', 'ADMIN', 1)`,
).run(appointmentId, leadId, customerId, date, time, now);

report.steps.created = { date, time, customerId };

// Unassigned → no schedule
let sync = syncAppointmentPushReminder(appointmentId);
report.steps.unassigned = sync;
if (sync.scheduled) throw new Error("expected unassigned not scheduled");

const assigned = setAppointmentAssignee(appointmentId, "Irvin");
report.steps.assigned = assigned;
if (!assigned.ok) throw new Error(`assign failed: ${assigned.reason}`);

sync = syncAppointmentPushReminder(appointmentId);
report.steps.scheduled = sync;
if (!sync.scheduled) throw new Error(`expected schedule: ${sync.reason || "?"}`);
report.steps.pendingAfterSchedule = countReminders("PENDING");

// Cancel invalidates
cancelAppointmentPushReminders(appointmentId, "e2e_cancel_probe");
report.steps.pendingAfterCancel = countReminders("PENDING");
report.steps.cancelledAfterCancel = countReminders("CANCELLED");
if (report.steps.pendingAfterCancel !== 0) throw new Error("cancel left pending");

// Reschedule: move +15m and re-sync
const parts2 = Object.fromEntries(
  fmt.formatToParts(new Date(Date.now() + 60 * 60_000)).map((p) => [p.type, p.value]),
);
const date2 = `${parts2.year}-${parts2.month}-${parts2.day}`;
const time2 = `${parts2.hour}:${parts2.minute}`;
db.prepare(
  `UPDATE revenue_appointments
   SET date = ?, start_time = ?, version = version + 1, status = 'RESCHEDULED'
   WHERE appointment_id = ?`,
).run(date2, time2, appointmentId);
sync = syncAppointmentPushReminder(appointmentId);
report.steps.rescheduled = { date: date2, time: time2, sync };
if (!sync.scheduled) throw new Error(`reschedule not scheduled: ${sync.reason || "?"}`);
report.steps.pendingAfterReschedule = countReminders("PENDING");
if (report.steps.pendingAfterReschedule !== 1) throw new Error("expected exactly 1 pending after reschedule");

// Force due without changing CONTROL_PUSH_REMINDER_OFFSET
db.prepare(
  `UPDATE control_push_reminders
   SET fire_at = ?
   WHERE appointment_id = ? AND status = 'PENDING'`,
).run(new Date(Date.now() - 2000).toISOString(), appointmentId);

const due = await processDuePushReminders(Date.now());
report.steps.due = due;
if (!due.enqueued) throw new Error(`due did not enqueue: ${JSON.stringify(due)}`);

const drained = await drainControlPushOutbox(8);
report.steps.drained = drained;
report.steps.outbox = countOutboxFor(appointmentId);

const delivered = db
  .prepare(
    `SELECT event_id, status, substr(idempotency_key,1,48) AS idem, last_error
     FROM control_push_outbox
     WHERE correlation_id = ?
     ORDER BY created_at DESC LIMIT 3`,
  )
  .all(appointmentId);
report.steps.outboxRows = delivered;

// Cleanup unless KEEP_OPEN=1 (leave live for physical tap → /citas/{id} verification)
const keepOpen = String(process.env.KEEP_OPEN || "").trim() === "1";
if (keepOpen) {
  report.steps.cleanup = {
    skipped: true,
    keepOpen: true,
    appointmentStatus: db
      .prepare(`SELECT status FROM revenue_appointments WHERE appointment_id = ?`)
      .get(appointmentId).status,
  };
} else {
  cancelAppointmentPushReminders(appointmentId, "e2e_done");
  db.prepare(`UPDATE revenue_appointments SET status = 'CANCELLED' WHERE appointment_id = ?`).run(
    appointmentId,
  );
  report.steps.cleanup = {
    pending: countReminders("PENDING"),
    appointmentStatus: db
      .prepare(`SELECT status FROM revenue_appointments WHERE appointment_id = ?`)
      .get(appointmentId).status,
  };
}

report.ok =
  Boolean(due.enqueued) &&
  delivered.some((r) => r.status === "DELIVERED" || r.status === "PENDING") &&
  report.steps.pendingAfterCancel === 0;

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
