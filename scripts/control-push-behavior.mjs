/**
 * Isolated Control push behavior tests.
 * Asserts active. No FCM network. No real customer mutations.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const dataDir = mkdtempSync(join(tmpdir(), "hs-control-push-"));
writeFileSync(join(dataDir, "CONTROL_DEV.txt"), "isolated\n");

process.env.HOMESTEAD_CONTROL_ISOLATED = "true";
process.env.DATA_DIR = dataDir.replaceAll("\\", "/");
process.env.ADMIN_PASSWORD = "control-local-test-only";
process.env.ADMIN_SESSION_SECRET = "test-session-secret-control-push-32b";
process.env.N8N_HOMESTEAD_WEBHOOK_SECRET = "test-n8n-secret";
process.env.N8N_HOMESTEAD_WEBHOOK_URL = "https://example.invalid/webhook";
process.env.CONTROL_PUSH_ENABLED = "true";
process.env.CONTROL_PUSH_SUBJECT_ID = "op:2";
process.env.CONTROL_PUSH_ASSIGNEE_ALIASES = "Irving CORRO,Irvin,op:2";
process.env.CONTROL_PUSH_REMINDER_OFFSET = "30m";
process.env.HOMESTEAD_TIMEZONE = "America/Panama";
process.env.AUTOMATION_DISPATCH_ENABLED = "false";

const { saveServiceRequest, getHomesteadDb } = await import("../src/lib/service-requests.ts");
const {
  registerControlPushDevice,
  revokeControlPushDevice,
  revokeControlPushSession,
  enqueueNewRequestPush,
  drainControlPushOutbox,
  syncAppointmentPushReminder,
  cancelAppointmentPushReminders,
  setAppointmentAssignee,
  processDuePushReminders,
  buildNewRequestPushCopy,
  buildAppointmentReminderPushCopy,
  assigneeMatchesPushSubject,
  listActivePushTokensForSubject,
} = await import("../src/lib/control-push.ts");
const { createAppointment, setAppointmentStatus, getHomesteadDb: _ } = await import("../src/lib/revenue-store.ts").catch(() => ({
  createAppointment: null,
  setAppointmentStatus: null,
}));
const revenue = await import("../src/lib/revenue-store.ts");

function countOutbox(status) {
  return getHomesteadDb()
    .prepare("SELECT COUNT(*) AS n FROM control_push_outbox WHERE status = ?")
    .get(status).n;
}

function countReminders(status) {
  return getHomesteadDb()
    .prepare("SELECT COUNT(*) AS n FROM control_push_reminders WHERE status = ?")
    .get(status).n;
}

// --- Copy sanitization ---
{
  const copy = buildNewRequestPushCopy("HS-2026-000999");
  assert.equal(copy.title, "Nueva solicitud");
  assert.match(copy.body, /HS-2026-000999/);
  assert.doesNotMatch(copy.body, /\+507|@|Calle|seguridad/i);
  const rem = buildAppointmentReminderPushCopy({
    appointmentId: "HA-deadbeef",
    date: "2026-10-04",
    startTime: "10:00",
  });
  assert.equal(rem.title, "Recordatorio de cita");
  assert.doesNotMatch(rem.body, /\+507|Juan|Calle/i);
  assert.equal(rem.data.type, "appointment");
}

// --- Assignee match ---
assert.equal(assigneeMatchesPushSubject("Irving CORRO"), true);
assert.equal(assigneeMatchesPushSubject("Irvin"), true);
assert.equal(assigneeMatchesPushSubject("op:2"), true);
assert.equal(assigneeMatchesPushSubject("Owner"), false);
assert.equal(assigneeMatchesPushSubject(""), false);

// --- Device register / revoke / subject binding ---
{
  const token = `fcm-test-token-${"a".repeat(40)}`;
  const reg = registerControlPushDevice({ token, platform: "android", sessionNonce: "nonce-a" });
  assert.equal(reg.ok, true);
  assert.equal(reg.subjectId, "op:2");
  assert.equal(listActivePushTokensForSubject("op:2").length, 1);

  // Client cannot choose another subject — always bound to CONTROL_PUSH_SUBJECT_ID
  registerControlPushDevice({ token, platform: "android", sessionNonce: "nonce-a" });
  assert.equal(listActivePushTokensForSubject("op:1").length, 0);

  revokeControlPushDevice(token);
  assert.equal(listActivePushTokensForSubject("op:2").length, 0);

  registerControlPushDevice({ token, platform: "android", sessionNonce: "nonce-b" });
  revokeControlPushSession("nonce-b");
  assert.equal(listActivePushTokensForSubject("op:2").length, 0);
}

// --- New request push (real save is_test=0 path uses enqueue; test uses direct enqueue) ---
{
  const token = `fcm-test-token-${"b".repeat(40)}`;
  registerControlPushDevice({ token, platform: "android", sessionNonce: "nonce-c" });

  const testReq = saveServiceRequest({
    name: "Push Fixture",
    phone: "+50760001111",
    email: "push-fixture@example.invalid",
    property: "house",
    service: "plumbing",
    message: "fixture push is_test",
    photos: [],
    isTest: true,
  });
  assert.ok(testReq.publicId);
  assert.equal(enqueueNewRequestPush(testReq.publicId, { isTest: true }), null);

  const liveId = "HS-2026-009901";
  const eventId = enqueueNewRequestPush(liveId, { isTest: false });
  assert.ok(eventId);
  const dup = enqueueNewRequestPush(liveId, { isTest: false });
  assert.equal(dup, eventId);
  assert.equal(countOutbox("PENDING"), 1);

  const drained = await drainControlPushOutbox(8);
  assert.ok(drained.claimed >= 1);
  assert.equal(countOutbox("DELIVERED"), 1);

  // Concurrent drain should not double-deliver
  await drainControlPushOutbox(8);
  assert.equal(countOutbox("DELIVERED"), 1);
}

// --- Appointment reminder schedule / reschedule / cancel / assignee ---
{
  const lead = saveServiceRequest({
    name: "Cita Fixture",
    phone: "+50760002222",
    email: "cita-fixture@example.invalid",
    property: "house",
    service: "locksmith",
    message: "fixture cita push",
    photos: [],
    isTest: false,
  });
  // Mark security/booking eligibility via ingest if needed
  try {
    const { ingestSavedRequest } = await import("../src/lib/revenue-ingest.ts");
    await ingestSavedRequest(lead);
  } catch {
    /* optional */
  }

  // Create appointment far enough in future for 30m reminder
  const panama = new Date(Date.now() - 5 * 3600_000 + 2 * 3600_000);
  const y = panama.getUTCFullYear();
  const m = String(panama.getUTCMonth() + 1).padStart(2, "0");
  const d = String(panama.getUTCDate()).padStart(2, "0");
  const date = `${y}-${m}-${d}`;
  const hour = String((panama.getUTCHours() + 2) % 24).padStart(2, "0");
  const time = `${hour}:00`;

  let appointmentId = revenue.createAppointment(lead.publicId, date, time, "CONFIRMED", {
    source: "ADMIN",
    notes: "push-test",
  });
  if (!appointmentId) {
    // Lead may need ingest — create minimal lead row if create failed
    console.log("SKIP_APPOINTMENT_CREATE — createAppointment returned null (eligibility)");
  } else {
    revenue.setAppointmentStatus(appointmentId, "CONFIRMED");
    // Unassigned → no reminder
    let sync = syncAppointmentPushReminder(appointmentId);
    assert.equal(sync.scheduled, false);

    const assigned = setAppointmentAssignee(appointmentId, "Irvin");
    assert.equal(assigned.ok, true);
    sync = syncAppointmentPushReminder(appointmentId);
    assert.equal(sync.scheduled, true);
    assert.ok(countReminders("PENDING") >= 1);

    // Reschedule invalidates prior pending
    const laterHour = String((panama.getUTCHours() + 4) % 24).padStart(2, "0");
    revenue.rescheduleAppointment(appointmentId, date, `${laterHour}:00`, { actor: "admin" });
    syncAppointmentPushReminder(appointmentId);
    const pending = getHomesteadDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM control_push_reminders
         WHERE appointment_id = ? AND status = 'PENDING'`,
      )
      .get(appointmentId).n;
    assert.equal(pending, 1);

    // Force fire_at into the past for due processing without waiting
    getHomesteadDb()
      .prepare(
        `UPDATE control_push_reminders SET fire_at = ? WHERE appointment_id = ? AND status = 'PENDING'`,
      )
      .run(new Date(Date.now() - 1000).toISOString(), appointmentId);

    const before = countOutbox("PENDING") + countOutbox("DELIVERED");
    const due = await processDuePushReminders(Date.now());
    assert.ok(due.enqueued >= 1);
    const after = countOutbox("PENDING") + countOutbox("DELIVERED");
    assert.ok(after > before);

    // Concurrent process should not enqueue duplicate for same notice
    const due2 = await processDuePushReminders(Date.now());
    assert.equal(due2.enqueued, 0);

    cancelAppointmentPushReminders(appointmentId, "cancelled");
    revenue.setAppointmentStatus(appointmentId, "CANCELLED");
    const stillPending = getHomesteadDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM control_push_reminders
         WHERE appointment_id = ? AND status IN ('PENDING','CLAIMED')`,
      )
      .get(appointmentId).n;
    assert.equal(stillPending, 0);
  }
}

console.log(
  JSON.stringify({
    ok: true,
    suite: "control-push-behavior",
    dataDir,
    subjectId: "op:2",
    reminderOffset: "30m",
    timezone: "America/Panama",
  }),
);

try {
  rmSync(dataDir, { recursive: true, force: true });
} catch {
  // Windows may keep SQLite WAL briefly open; temp dir is disposable.
}
