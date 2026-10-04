/**
 * Homestead Control push (FCM via n8n).
 * Server decides recipients. Client may only register/unregister its own token
 * while authenticated as admin; it cannot bind a token to another subject.
 */
import { createHash, randomBytes, randomUUID } from "crypto";
import type { Database } from "better-sqlite3";
import {
  appointmentNoticeKey,
  businessTimezone,
  formatAppointmentClock,
  formatAppointmentDay,
  parseDurationMs,
  reminderEligibleStatus,
  zonedLocalToUtcMs,
} from "@/lib/appointment-time";
import { isControlIsolated, recordSimulatedCall } from "@/lib/control-isolation";
import { signHomesteadPayload } from "@/lib/homestead-signature";
import { logError, logInfo } from "@/lib/log";
import { postN8nPayload } from "@/lib/n8n";
import { claimAppointmentNotice, getAppointment, getLead } from "@/lib/revenue-store";
import { getHomesteadDb } from "@/lib/service-requests";

const PUSH_OUTBOX_MAX = 8;
const PUSH_LEASE_MS = 45_000;
const PUSH_BACKOFF_MS = [0, 30_000, 120_000, 300_000, 900_000];
const DEFAULT_REMINDER_OFFSET = "30m";

export type ControlPushEnv = "production" | "isolated";

export function migrateControlPush(database: Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS control_push_devices (
      token_hash TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      subject_id TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'android',
      env TEXT NOT NULL,
      session_nonce TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_control_push_devices_subject
      ON control_push_devices (subject_id, env, revoked_at);
    CREATE TABLE IF NOT EXISTS control_push_outbox (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 8,
      next_attempt_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_attempt_at TEXT,
      delivered_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      processing_until TEXT,
      claim_token TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_control_push_outbox_due
      ON control_push_outbox (status, next_attempt_at);
    CREATE TABLE IF NOT EXISTS control_push_reminders (
      reminder_id TEXT PRIMARY KEY,
      appointment_id TEXT NOT NULL,
      revision_key TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      fire_at TEXT NOT NULL,
      status TEXT NOT NULL,
      offset_label TEXT NOT NULL,
      claim_token TEXT,
      claimed_until TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sent_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      UNIQUE(appointment_id, revision_key, offset_label)
    );
    CREATE INDEX IF NOT EXISTS idx_control_push_reminders_due
      ON control_push_reminders (status, fire_at);
  `);
}

export function controlPushEnv(): ControlPushEnv {
  return isControlIsolated() ? "isolated" : "production";
}

/** Authorized Control push subject — never falls back to OWNER/first admin. */
export function controlPushSubjectId(): string {
  const fromEnv = process.env.CONTROL_PUSH_SUBJECT_ID?.trim();
  if (fromEnv) return fromEnv;
  // telegram_operators id=2 ADMIN "Irving CORRO" (not OWNER id=1 "Owner")
  return "op:2";
}

export function controlPushAssigneeAliases(): string[] {
  const raw = process.env.CONTROL_PUSH_ASSIGNEE_ALIASES?.trim();
  const list = (raw || "Irving CORRO,Irvin,op:2")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const subject = controlPushSubjectId();
  if (!list.includes(subject)) list.push(subject);
  return list;
}

export function controlPushReminderOffsetLabel() {
  return process.env.CONTROL_PUSH_REMINDER_OFFSET?.trim() || DEFAULT_REMINDER_OFFSET;
}

export function controlPushReminderOffsetMs() {
  return parseDurationMs(controlPushReminderOffsetLabel()) || 30 * 60 * 1000;
}

export function isControlPushEnabled() {
  if (process.env.CONTROL_PUSH_ENABLED === "false") return false;
  return Boolean(controlPushSubjectId());
}

export function assigneeMatchesPushSubject(assignedTo: string) {
  const value = String(assignedTo || "").trim().toLowerCase();
  if (!value) return false;
  return controlPushAssigneeAliases().some((alias) => alias.trim().toLowerCase() === value);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function backoffMs(attempts: number) {
  return PUSH_BACKOFF_MS[Math.min(Math.max(attempts, 0), PUSH_BACKOFF_MS.length - 1)];
}

export function registerControlPushDevice(input: {
  token: string;
  platform?: string;
  sessionNonce?: string;
}) {
  const token = String(input.token || "").trim();
  if (!token || token.length < 32 || token.length > 4096) {
    return { ok: false as const, error: "invalid_token" };
  }
  if (!isControlPushEnabled()) return { ok: false as const, error: "push_disabled" };
  const subjectId = controlPushSubjectId();
  const env = controlPushEnv();
  const now = nowIso();
  const tokenHash = hashToken(token);
  const db = getHomesteadDb();
  db.prepare(
    `INSERT INTO control_push_devices
      (token_hash, token, subject_id, platform, env, session_nonce, created_at, updated_at, last_seen_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(token_hash) DO UPDATE SET
       token = excluded.token,
       subject_id = excluded.subject_id,
       platform = excluded.platform,
       env = excluded.env,
       session_nonce = excluded.session_nonce,
       updated_at = excluded.updated_at,
       last_seen_at = excluded.last_seen_at,
       revoked_at = NULL`,
  ).run(
    tokenHash,
    token,
    subjectId,
    String(input.platform || "android").slice(0, 32),
    env,
    String(input.sessionNonce || "").slice(0, 128),
    now,
    now,
    now,
  );
  logInfo("ControlPushDeviceRegistered", { subjectId, env, tokenHash: tokenHash.slice(0, 12) });
  return { ok: true as const, subjectId, env };
}

export function revokeControlPushDevice(token: string) {
  const value = String(token || "").trim();
  if (!value) return { ok: true as const };
  const now = nowIso();
  getHomesteadDb()
    .prepare(
      `UPDATE control_push_devices
       SET revoked_at = ?, updated_at = ?
       WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .run(now, now, hashToken(value));
  return { ok: true as const };
}

export function revokeControlPushSession(sessionNonce: string) {
  const nonce = String(sessionNonce || "").trim();
  if (!nonce) return { ok: true as const, count: 0 };
  const now = nowIso();
  const result = getHomesteadDb()
    .prepare(
      `UPDATE control_push_devices
       SET revoked_at = ?, updated_at = ?
       WHERE session_nonce = ? AND revoked_at IS NULL`,
    )
    .run(now, now, nonce);
  return { ok: true as const, count: result.changes };
}

export function listActivePushTokensForSubject(subjectId: string, env = controlPushEnv()) {
  return getHomesteadDb()
    .prepare(
      `SELECT token, token_hash FROM control_push_devices
       WHERE subject_id = ? AND env = ? AND revoked_at IS NULL`,
    )
    .all(subjectId, env) as Array<{ token: string; token_hash: string }>;
}

function enqueuePushOutbox(input: {
  eventType: string;
  correlationId: string;
  idempotencyKey: string;
  data: Record<string, unknown>;
  nextAttemptAt?: string;
}) {
  const db = getHomesteadDb();
  const existing = db
    .prepare("SELECT event_id FROM control_push_outbox WHERE idempotency_key = ?")
    .get(input.idempotencyKey) as { event_id: string } | undefined;
  if (existing) return existing.event_id;
  const now = nowIso();
  const eventId = randomUUID();
  db.prepare(
    `INSERT INTO control_push_outbox (
      event_id, event_type, correlation_id, idempotency_key, payload_json,
      status, attempts, max_attempts, next_attempt_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'PENDING', 0, 8, ?, ?, ?)`,
  ).run(
    eventId,
    input.eventType,
    input.correlationId,
    input.idempotencyKey,
    JSON.stringify({
      eventId,
      eventType: input.eventType,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      occurredAt: now,
      data: input.data,
    }),
    input.nextAttemptAt || now,
    now,
    now,
  );
  return eventId;
}

/** Lock-screen safe copy — no names, phones, addresses, or security reasons. */
export function buildNewRequestPushCopy(requestId: string) {
  return {
    title: "Nueva solicitud",
    body: `Homestead · ${requestId}`,
    data: {
      type: "service_request",
      id: requestId,
      route: `/solicitudes/${requestId}`,
    },
  };
}

export function buildAppointmentReminderPushCopy(input: {
  appointmentId: string;
  date: string;
  startTime: string;
}) {
  const when = `${formatAppointmentDay(input.date)} · ${formatAppointmentClock(input.startTime)}`;
  return {
    title: "Recordatorio de cita",
    body: `Homestead · ${when} (Panamá)`,
    data: {
      type: "appointment",
      id: input.appointmentId,
      route: `/citas/${input.appointmentId}`,
    },
  };
}

export function enqueueNewRequestPush(requestId: string, opts?: { isTest?: boolean }) {
  if (!isControlPushEnabled()) return null;
  if (opts?.isTest) return null;
  const subjectId = controlPushSubjectId();
  const copy = buildNewRequestPushCopy(requestId);
  return enqueuePushOutbox({
    eventType: "control.push.new_request",
    correlationId: requestId,
    idempotencyKey: `control.push.new_request:${requestId}:${subjectId}`,
    data: {
      subjectId,
      requestId,
      env: controlPushEnv(),
      notification: copy,
    },
  });
}

function revisionKey(appointment: {
  appointmentId: string;
  version: number;
  date: string;
  startTime: string;
  assignedTo: string;
}) {
  return [
    appointment.appointmentId,
    appointment.version,
    appointment.date,
    appointment.startTime,
    String(appointment.assignedTo || "").trim().toLowerCase(),
  ].join("|");
}

export function syncAppointmentPushReminder(appointmentId: string) {
  const appointment = getAppointment(appointmentId);
  const db = getHomesteadDb();
  const now = nowIso();
  if (!appointment) return { ok: false as const, reason: "missing" };

  // Cancel prior pending/claimed for this appointment
  db.prepare(
    `UPDATE control_push_reminders
     SET status = 'CANCELLED', updated_at = ?
     WHERE appointment_id = ? AND status IN ('PENDING','CLAIMED')`,
  ).run(now, appointmentId);

  if (!isControlPushEnabled()) return { ok: true as const, scheduled: false, reason: "disabled" };
  if (getLead(appointment.leadId)?.isTest) return { ok: true as const, scheduled: false, reason: "is_test" };
  if (!reminderEligibleStatus(appointment.status)) {
    return { ok: true as const, scheduled: false, reason: "status" };
  }
  if (!assigneeMatchesPushSubject(appointment.assignedTo)) {
    return { ok: true as const, scheduled: false, reason: "not_assigned_to_subject" };
  }

  const startMs = zonedLocalToUtcMs(appointment.date, appointment.startTime, businessTimezone());
  if (!Number.isFinite(startMs)) return { ok: false as const, reason: "bad_time" };
  const nowMs = Date.now();
  if (startMs <= nowMs) return { ok: true as const, scheduled: false, reason: "already_started" };

  const offsetMs = controlPushReminderOffsetMs();
  const offsetLabel = controlPushReminderOffsetLabel();
  let fireMs = startMs - offsetMs;
  // Late create/reschedule: one timely reminder if still before start
  if (fireMs < nowMs) fireMs = nowMs;

  const rev = revisionKey(appointment);
  const reminderId = randomUUID();
  const fireAt = new Date(fireMs).toISOString();
  try {
    db.prepare(
      `INSERT INTO control_push_reminders (
        reminder_id, appointment_id, revision_key, subject_id, fire_at, status,
        offset_label, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
    ).run(
      reminderId,
      appointment.appointmentId,
      rev,
      controlPushSubjectId(),
      fireAt,
      offsetLabel,
      now,
      now,
    );
  } catch {
    db.prepare(
      `UPDATE control_push_reminders
       SET reminder_id = ?, subject_id = ?, fire_at = ?, status = 'PENDING',
           claim_token = NULL, claimed_until = NULL, updated_at = ?, sent_at = NULL, last_error = ''
       WHERE appointment_id = ? AND revision_key = ? AND offset_label = ?`,
    ).run(reminderId, controlPushSubjectId(), fireAt, now, appointment.appointmentId, rev, offsetLabel);
  }
  return { ok: true as const, scheduled: true, fireAt, reminderId };
}

export function cancelAppointmentPushReminders(appointmentId: string, reason = "cancelled") {
  const now = nowIso();
  getHomesteadDb()
    .prepare(
      `UPDATE control_push_reminders
       SET status = 'CANCELLED', updated_at = ?, last_error = ?
       WHERE appointment_id = ? AND status IN ('PENDING','CLAIMED')`,
    )
    .run(now, reason.slice(0, 120), appointmentId);
}

export function setAppointmentAssignee(appointmentId: string, assignedTo: string) {
  const value = String(assignedTo || "").trim().slice(0, 120);
  const result = getHomesteadDb()
    .prepare(
      `UPDATE revenue_appointments
       SET assigned_to = ?, version = version + 1
       WHERE appointment_id = ? AND status NOT IN ('CANCELLED','COMPLETED')`,
    )
    .run(value, appointmentId);
  if (!result.changes) return { ok: false as const, reason: "not_updatable" };
  syncAppointmentPushReminder(appointmentId);
  return { ok: true as const, assignedTo: value };
}

function claimReminderRows(limit = 16) {
  const db = getHomesteadDb();
  const now = nowIso();
  const due = db
    .prepare(
      `SELECT reminder_id FROM control_push_reminders
       WHERE status = 'PENDING' AND fire_at <= ?
       ORDER BY fire_at ASC LIMIT ?`,
    )
    .all(now, limit) as Array<{ reminder_id: string }>;
  const claimed: string[] = [];
  for (const row of due) {
    const token = randomBytes(12).toString("hex");
    const until = new Date(Date.now() + PUSH_LEASE_MS).toISOString();
    const updated = db
      .prepare(
        `UPDATE control_push_reminders
         SET status = 'CLAIMED', claim_token = ?, claimed_until = ?, updated_at = ?
         WHERE reminder_id = ? AND status = 'PENDING'`,
      )
      .run(token, until, now, row.reminder_id);
    if (updated.changes) claimed.push(row.reminder_id);
  }
  // Reclaim expired leases
  const expired = db
    .prepare(
      `SELECT reminder_id FROM control_push_reminders
       WHERE status = 'CLAIMED' AND claimed_until IS NOT NULL AND claimed_until < ?
       LIMIT ?`,
    )
    .all(now, limit) as Array<{ reminder_id: string }>;
  for (const row of expired) {
    const token = randomBytes(12).toString("hex");
    const until = new Date(Date.now() + PUSH_LEASE_MS).toISOString();
    const updated = db
      .prepare(
        `UPDATE control_push_reminders
         SET claim_token = ?, claimed_until = ?, updated_at = ?
         WHERE reminder_id = ? AND status = 'CLAIMED' AND claimed_until < ?`,
      )
      .run(token, until, now, row.reminder_id, now);
    if (updated.changes) claimed.push(row.reminder_id);
  }
  return claimed;
}

export async function processDuePushReminders(nowMs = Date.now()) {
  if (!isControlPushEnabled()) return { checked: 0, enqueued: 0, skipped: 0 };
  const ids = claimReminderRows();
  let enqueued = 0;
  let skipped = 0;
  const db = getHomesteadDb();
  const now = nowIso();
  for (const reminderId of ids) {
    const row = db
      .prepare(
        `SELECT reminder_id, appointment_id, revision_key, subject_id, offset_label, status, claim_token
         FROM control_push_reminders WHERE reminder_id = ?`,
      )
      .get(reminderId) as
      | {
          reminder_id: string;
          appointment_id: string;
          revision_key: string;
          subject_id: string;
          offset_label: string;
          status: string;
          claim_token: string | null;
        }
      | undefined;
    if (!row || row.status !== "CLAIMED") {
      skipped += 1;
      continue;
    }
    const appointment = getAppointment(row.appointment_id);
    const fail = (reason: string) => {
      db.prepare(
        `UPDATE control_push_reminders
         SET status = 'SKIPPED', updated_at = ?, last_error = ?, claim_token = NULL, claimed_until = NULL
         WHERE reminder_id = ?`,
      ).run(now, reason.slice(0, 160), reminderId);
      skipped += 1;
    };
    if (!appointment) {
      fail("missing_appointment");
      continue;
    }
    if (getLead(appointment.leadId)?.isTest) {
      fail("is_test");
      continue;
    }
    if (!reminderEligibleStatus(appointment.status)) {
      fail(`status_${appointment.status}`);
      continue;
    }
    if (!assigneeMatchesPushSubject(appointment.assignedTo)) {
      fail("assignee_mismatch");
      continue;
    }
    if (revisionKey(appointment) !== row.revision_key) {
      fail("stale_revision");
      continue;
    }
    const startMs = zonedLocalToUtcMs(appointment.date, appointment.startTime, businessTimezone());
    if (!Number.isFinite(startMs) || startMs <= nowMs) {
      fail("already_started_or_bad_time");
      continue;
    }
    const noticeKey = appointmentNoticeKey(
      appointment.appointmentId,
      "PUSH_REMINDER",
      appointment.version,
      `${row.offset_label}:${appointment.date}:${appointment.startTime}`,
    );
    if (!claimAppointmentNotice(noticeKey, appointment.appointmentId, "PUSH_REMINDER", appointment.version)) {
      fail("duplicate_notice");
      continue;
    }
    const copy = buildAppointmentReminderPushCopy({
      appointmentId: appointment.appointmentId,
      date: appointment.date,
      startTime: appointment.startTime,
    });
    enqueuePushOutbox({
      eventType: "control.push.appointment_reminder",
      correlationId: appointment.appointmentId,
      idempotencyKey: `control.push.appointment_reminder:${noticeKey}`,
      data: {
        subjectId: row.subject_id,
        appointmentId: appointment.appointmentId,
        env: controlPushEnv(),
        notification: copy,
        timezone: businessTimezone(),
      },
    });
    db.prepare(
      `UPDATE control_push_reminders
       SET status = 'SENT', sent_at = ?, updated_at = ?, claim_token = NULL, claimed_until = NULL
       WHERE reminder_id = ?`,
    ).run(now, now, reminderId);
    enqueued += 1;
  }
  return { checked: ids.length, enqueued, skipped };
}

function markInvalidToken(tokenHash: string) {
  const now = nowIso();
  getHomesteadDb()
    .prepare(`UPDATE control_push_devices SET revoked_at = ?, updated_at = ? WHERE token_hash = ?`)
    .run(now, now, tokenHash);
}

export function controlPushWebhookUrl() {
  return (
    process.env.N8N_CONTROL_PUSH_WEBHOOK_URL?.trim() ||
    process.env.N8N_HOMESTEAD_WEBHOOK_URL?.trim() ||
    ""
  );
}

async function deliverPushEnvelope(envelope: {
  eventType: string;
  idempotencyKey: string;
  correlationId: string;
  data: Record<string, unknown>;
}) {
  const subjectId = String(envelope.data.subjectId || controlPushSubjectId());
  const env = String(envelope.data.env || controlPushEnv()) as ControlPushEnv;
  const notification = envelope.data.notification as {
    title: string;
    body: string;
    data: Record<string, string>;
  };
  const devices = listActivePushTokensForSubject(subjectId, env === "isolated" ? "isolated" : "production");
  if (!devices.length) {
    return { ok: true as const, cause: "no_devices", httpStatus: 200 };
  }
  const payload = {
    event: "control.push.send",
    eventType: envelope.eventType,
    idempotencyKey: envelope.idempotencyKey,
    correlationId: envelope.correlationId,
    subjectId,
    env,
    android: {
      priority: "high",
      notification: {
        channelId: "homestead_control_alerts",
        sound: "default",
        title: notification.title,
        body: notification.body,
      },
    },
    data: notification.data,
    tokens: devices.map((d) => ({ token: d.token, tokenHash: d.token_hash.slice(0, 12) })),
    // Full tokens only for n8n FCM send — never logged
    fcmTokens: devices.map((d) => d.token),
  };

  if (isControlIsolated()) {
    recordSimulatedCall("n8n", envelope.idempotencyKey);
    logInfo("ControlPushSimulated", {
      eventType: envelope.eventType,
      correlationId: envelope.correlationId,
      deviceCount: devices.length,
    });
    return { ok: true as const, cause: "isolated", httpStatus: 200 };
  }

  const url = controlPushWebhookUrl();
  const secret = process.env.N8N_HOMESTEAD_WEBHOOK_SECRET?.trim();
  if (!url || !secret) {
    logInfo("ControlPushSkipped", {
      eventType: envelope.eventType,
      correlationId: envelope.correlationId,
      reason: "not_configured",
    });
    return { ok: true as const, cause: "not_configured", httpStatus: 200 };
  }

  // Prefer dedicated push webhook; fall back to generic postN8nPayload path shape
  if (process.env.N8N_CONTROL_PUSH_WEBHOOK_URL?.trim()) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signHomesteadPayload(secret, timestamp, payload);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Homestead-Timestamp": timestamp,
          "X-Homestead-Signature": `sha256=${signature}`,
          "X-Homestead-Webhook-Secret": secret,
          "X-Homestead-Idempotency-Key": envelope.idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) {
        return { ok: false as const, cause: `http_${response.status}`, httpStatus: response.status };
      }
      const body = (await response.json().catch(() => ({}))) as {
        invalidTokenHashes?: string[];
        accepted?: number;
      };
      for (const hashPrefix of body.invalidTokenHashes || []) {
        const match = devices.find((d) => d.token_hash.startsWith(hashPrefix));
        if (match) markInvalidToken(match.token_hash);
      }
      // FCM accept ≠ phone delivery
      logInfo("ControlPushN8nAccepted", {
        eventType: envelope.eventType,
        correlationId: envelope.correlationId,
        accepted: body.accepted ?? devices.length,
      });
      return { ok: true as const, cause: "n8n_accepted", httpStatus: response.status };
    } catch (error) {
      logError("ControlPushN8nFailed", {
        cause: error instanceof Error ? error.name : "network",
        eventType: envelope.eventType,
      });
      return { ok: false as const, cause: "network_error", httpStatus: 0 };
    }
  }

  const result = await postN8nPayload(payload, {
    idempotencyKey: envelope.idempotencyKey,
    correlationId: envelope.correlationId,
  });
  return result;
}

export async function drainControlPushOutbox(limit = PUSH_OUTBOX_MAX) {
  if (!isControlPushEnabled()) return { claimed: 0, delivered: 0, failed: 0 };
  const db = getHomesteadDb();
  const now = nowIso();
  const due = db
    .prepare(
      `SELECT event_id FROM control_push_outbox
       WHERE status = 'PENDING' AND next_attempt_at <= ?
       ORDER BY created_at ASC LIMIT ?`,
    )
    .all(now, limit) as Array<{ event_id: string }>;

  let claimed = 0;
  let delivered = 0;
  let failed = 0;

  for (const item of due) {
    const claimToken = randomBytes(10).toString("hex");
    const until = new Date(Date.now() + PUSH_LEASE_MS).toISOString();
    const locked = db
      .prepare(
        `UPDATE control_push_outbox
         SET status = 'PROCESSING', claim_token = ?, processing_until = ?, updated_at = ?, last_attempt_at = ?
         WHERE event_id = ? AND status = 'PENDING'`,
      )
      .run(claimToken, until, now, now, item.event_id);
    if (!locked.changes) continue;
    claimed += 1;
    const row = db
      .prepare(`SELECT * FROM control_push_outbox WHERE event_id = ? AND claim_token = ?`)
      .get(item.event_id, claimToken) as
      | {
          event_id: string;
          event_type: string;
          correlation_id: string;
          idempotency_key: string;
          payload_json: string;
          attempts: number;
          max_attempts: number;
        }
      | undefined;
    if (!row) continue;
    let envelope: {
      eventType: string;
      idempotencyKey: string;
      correlationId: string;
      data: Record<string, unknown>;
    };
    try {
      const parsed = JSON.parse(row.payload_json) as {
        eventType: string;
        idempotencyKey: string;
        correlationId: string;
        data: Record<string, unknown>;
      };
      envelope = {
        eventType: parsed.eventType || row.event_type,
        idempotencyKey: parsed.idempotencyKey || row.idempotency_key,
        correlationId: parsed.correlationId || row.correlation_id,
        data: parsed.data || {},
      };
    } catch {
      db.prepare(
        `UPDATE control_push_outbox SET status = 'FAILED', last_error = 'bad_payload', updated_at = ? WHERE event_id = ?`,
      ).run(nowIso(), row.event_id);
      failed += 1;
      continue;
    }

    const result = await deliverPushEnvelope(envelope);
    const stamp = nowIso();
    if (result.ok) {
      db.prepare(
        `UPDATE control_push_outbox
         SET status = 'DELIVERED', delivered_at = ?, updated_at = ?, claim_token = NULL, processing_until = NULL, last_error = ?
         WHERE event_id = ? AND claim_token = ?`,
      ).run(stamp, stamp, result.cause, row.event_id, claimToken);
      delivered += 1;
    } else {
      const attempts = row.attempts + 1;
      if (attempts >= row.max_attempts) {
        db.prepare(
          `UPDATE control_push_outbox
           SET status = 'FAILED', attempts = ?, last_error = ?, updated_at = ?, claim_token = NULL, processing_until = NULL
           WHERE event_id = ? AND claim_token = ?`,
        ).run(attempts, result.cause, stamp, row.event_id, claimToken);
        failed += 1;
      } else {
        const next = new Date(Date.now() + backoffMs(attempts)).toISOString();
        db.prepare(
          `UPDATE control_push_outbox
           SET status = 'PENDING', attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?,
               claim_token = NULL, processing_until = NULL
           WHERE event_id = ? AND claim_token = ?`,
        ).run(attempts, next, result.cause, stamp, row.event_id, claimToken);
        failed += 1;
      }
    }
  }
  return { claimed, delivered, failed };
}

export function controlPushStatusPublic() {
  return {
    enabled: isControlPushEnabled(),
    subjectConfigured: Boolean(controlPushSubjectId()),
    subjectId: controlPushSubjectId(),
    reminderOffset: controlPushReminderOffsetLabel(),
    timezone: businessTimezone(),
    env: controlPushEnv(),
    webhookConfigured: Boolean(
      process.env.N8N_CONTROL_PUSH_WEBHOOK_URL?.trim() || process.env.N8N_HOMESTEAD_WEBHOOK_URL?.trim(),
    ),
  };
}
