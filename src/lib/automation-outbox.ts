import { randomUUID } from "crypto";
import type { Database } from "better-sqlite3";
import { getHomesteadDb } from "@/lib/service-requests";
import { logError, logInfo } from "@/lib/log";

export type OutboxStatus = "PENDING" | "PROCESSING" | "DELIVERED" | "FAILED" | "SKIPPED";

export type AutomationEnvelope = {
  eventId: string;
  eventType: string;
  version: number;
  occurredAt: string;
  correlationId: string;
  idempotencyKey: string;
  data: Record<string, unknown>;
};

export type OutboxRow = {
  eventId: string;
  eventType: string;
  version: number;
  correlationId: string;
  idempotencyKey: string;
  payloadJson: string;
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  lastError: string;
  processingUntil: string | null;
};

const BACKOFF_MS = [0, 30_000, 120_000, 300_000, 900_000];
const LEASE_MS = 45_000;
const MAX_ATTEMPTS = 8;
const OPEN_CLAIM = "PENDING";

export function migrateAutomationOutbox(database: Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS automation_outbox (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      correlation_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT ${MAX_ATTEMPTS},
      next_attempt_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_attempt_at TEXT,
      delivered_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      processing_until TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_status_next
      ON automation_outbox (status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_outbox_correlation
      ON automation_outbox (correlation_id);
    CREATE TABLE IF NOT EXISTS automation_engine_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS automation_outbox_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);
}

export function setEngineState(key: string, value: string) {
  const now = new Date().toISOString();
  getHomesteadDb()
    .prepare(
      `INSERT INTO automation_engine_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, now);
}

export function getEngineState(key: string) {
  const row = getHomesteadDb()
    .prepare("SELECT value, updated_at FROM automation_engine_state WHERE key = ?")
    .get(key) as { value: string; updated_at: string } | undefined;
  return row || null;
}

export function backoffMs(attempts: number) {
  const index = Math.min(Math.max(attempts, 0), BACKOFF_MS.length - 1);
  return BACKOFF_MS[index];
}

export function enqueueOutbox(
  database: Database,
  input: {
    eventType: string;
    correlationId: string;
    idempotencyKey: string;
    data: Record<string, unknown>;
    status?: OutboxStatus;
    nextAttemptAt?: string;
  },
) {
  const existing = database
    .prepare("SELECT event_id FROM automation_outbox WHERE idempotency_key = ?")
    .get(input.idempotencyKey) as { event_id: string } | undefined;
  if (existing) return existing.event_id;
  const now = new Date().toISOString();
  const eventId = randomUUID();
  const envelope: AutomationEnvelope = {
    eventId,
    eventType: input.eventType,
    version: 1,
    occurredAt: now,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    data: input.data,
  };
  database
    .prepare(
      `INSERT INTO automation_outbox (
        event_id, event_type, version, correlation_id, idempotency_key, payload_json,
        status, attempts, max_attempts, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .run(
      eventId,
      input.eventType,
      input.correlationId,
      input.idempotencyKey,
      JSON.stringify(envelope),
      input.status || OPEN_CLAIM,
      MAX_ATTEMPTS,
      input.nextAttemptAt || now,
      now,
      now,
    );
  logInfo("AutomationOutboxCreated", {
    eventId,
    eventType: input.eventType,
    correlationId: input.correlationId,
  });
  return eventId;
}

function mapRow(row: Record<string, unknown>): OutboxRow {
  return {
    eventId: String(row.event_id),
    eventType: String(row.event_type),
    version: Number(row.version || 1),
    correlationId: String(row.correlation_id),
    idempotencyKey: String(row.idempotency_key),
    payloadJson: String(row.payload_json),
    status: String(row.status) as OutboxStatus,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || MAX_ATTEMPTS),
    nextAttemptAt: String(row.next_attempt_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastAttemptAt: row.last_attempt_at ? String(row.last_attempt_at) : null,
    deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
    lastError: String(row.last_error || ""),
    processingUntil: row.processing_until ? String(row.processing_until) : null,
  };
}

export function getOutboxById(eventId: string) {
  const row = getHomesteadDb()
    .prepare("SELECT * FROM automation_outbox WHERE event_id = ?")
    .get(eventId) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export function getOutboxByIdempotency(key: string) {
  const row = getHomesteadDb()
    .prepare("SELECT * FROM automation_outbox WHERE idempotency_key = ?")
    .get(key) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export function listDueOutbox(limit = 10) {
  const now = new Date().toISOString();
  const rows = getHomesteadDb()
    .prepare(
      `SELECT * FROM automation_outbox
       WHERE next_attempt_at <= ?
         AND (
           status = 'PENDING'
           OR (status = 'PROCESSING' AND (processing_until IS NULL OR processing_until <= ?))
         )
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(now, now, limit) as Array<Record<string, unknown>>;
  return rows.map(mapRow);
}

export function claimOutboxEvent(eventId: string) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const lease = new Date(now + LEASE_MS).toISOString();
  const result = getHomesteadDb()
    .prepare(
      `UPDATE automation_outbox
       SET status = 'PROCESSING',
           attempts = attempts + 1,
           last_attempt_at = ?,
           updated_at = ?,
           processing_until = ?
       WHERE event_id = ?
         AND next_attempt_at <= ?
         AND (
           status = 'PENDING'
           OR (status = 'PROCESSING' AND (processing_until IS NULL OR processing_until <= ?))
         )`,
    )
    .run(nowIso, nowIso, lease, eventId, nowIso, nowIso);
  if (result.changes !== 1) return null;
  return getOutboxById(eventId);
}

export function markOutboxDelivered(eventId: string) {
  const now = new Date().toISOString();
  getHomesteadDb()
    .prepare(
      `UPDATE automation_outbox
       SET status = 'DELIVERED', delivered_at = ?, updated_at = ?, last_error = '', processing_until = NULL
       WHERE event_id = ?`,
    )
    .run(now, now, eventId);
  setEngineState("last_dispatch_ok_at", now);
}

export function markOutboxRetry(eventId: string, cause: string) {
  const row = getOutboxById(eventId);
  if (!row) return;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const nextStatus: OutboxStatus = row.attempts >= row.maxAttempts ? "FAILED" : "PENDING";
  const nextAt = new Date(now + backoffMs(row.attempts)).toISOString();
  getHomesteadDb()
    .prepare(
      `UPDATE automation_outbox
       SET status = ?, next_attempt_at = ?, updated_at = ?, last_error = ?, processing_until = NULL
       WHERE event_id = ?`,
    )
    .run(nextStatus, nextStatus === "FAILED" ? nowIso : nextAt, nowIso, cause.slice(0, 180), eventId);
  if (nextStatus === "FAILED") {
    logError("AutomationDeadLettered", { eventId, eventType: row.eventType, correlationId: row.correlationId, attempt: row.attempts });
  } else {
    logInfo("AutomationRetryScheduled", {
      eventId,
      eventType: row.eventType,
      correlationId: row.correlationId,
      attempt: row.attempts,
    });
  }
}

export function replayOutboxEvent(eventId: string, actor = "admin") {
  const row = getOutboxById(eventId);
  if (!row) return { ok: false as const, reason: "missing" };
  if (row.status === "DELIVERED") return { ok: false as const, reason: "already_delivered" };
  const now = new Date().toISOString();
  getHomesteadDb()
    .prepare(
      `UPDATE automation_outbox
       SET status = 'PENDING', next_attempt_at = ?, updated_at = ?, last_error = '', processing_until = NULL
       WHERE event_id = ? AND status IN ('FAILED','PENDING','PROCESSING')`,
    )
    .run(now, now, eventId);
  getHomesteadDb()
    .prepare(
      "INSERT INTO automation_outbox_audit (event_id, action, detail, created_at) VALUES (?, 'REPLAY', ?, ?)",
    )
    .run(eventId, actor.slice(0, 40), now);
  logInfo("AutomationReplayRequested", { eventId, eventType: row.eventType, correlationId: row.correlationId });
  return { ok: true as const, correlationId: row.correlationId };
}

export function skipOutboxForCorrelation(correlationId: string, reason: string) {
  const now = new Date().toISOString();
  getHomesteadDb()
    .prepare(
      `UPDATE automation_outbox
       SET status = 'SKIPPED', updated_at = ?, last_error = ?, processing_until = NULL
       WHERE correlation_id = ? AND status = 'PENDING'`,
    )
    .run(now, reason.slice(0, 80), correlationId);
}

export function markOutboxSkipped(eventId: string, reason: string) {
  const now = new Date().toISOString();
  getHomesteadDb()
    .prepare(
      `UPDATE automation_outbox
       SET status = 'SKIPPED', updated_at = ?, last_error = ?, processing_until = NULL
       WHERE event_id = ?`,
    )
    .run(now, reason.slice(0, 80), eventId);
}

export function outboxSnapshot() {
  const db = getHomesteadDb();
  const counts = db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM automation_outbox GROUP BY status`,
    )
    .all() as Array<{ status: string; n: number }>;
  const oldest = db
    .prepare(
      `SELECT event_id, created_at FROM automation_outbox WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 1`,
    )
    .get() as { event_id: string; created_at: string } | undefined;
  const last = getEngineState("last_dispatch_ok_at");
  const scheduler = getEngineState("last_scheduler_at");
  const byStatus: Record<string, number> = {};
  for (const row of counts) byStatus[row.status] = row.n;
  return {
    pending: byStatus.PENDING || 0,
    processing: byStatus.PROCESSING || 0,
    delivered: byStatus.DELIVERED || 0,
    failed: byStatus.FAILED || 0,
    skipped: byStatus.SKIPPED || 0,
    oldestPendingAt: oldest?.created_at || null,
    oldestPendingAgeMs: oldest ? Date.now() - Date.parse(oldest.created_at) : 0,
    lastDispatchOkAt: last?.value || null,
    lastSchedulerAt: scheduler?.value || null,
  };
}
