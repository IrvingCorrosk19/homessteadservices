/**
 * Wave E — Retention & reputation helpers.
 * Evolves Wave C post-service / recovery / maintenance. No parallel CRM.
 */
import type Database from "better-sqlite3";
import { getHomesteadDb } from "@/lib/service-requests";
import { isQuietHours, nextQuietEndIso } from "@/lib/ops-config";
import { logInfo } from "@/lib/log";

export type RetentionPref =
  | "pref_aftercare"
  | "pref_review"
  | "pref_maintenance"
  | "pref_reactivation"
  | "pref_marketing";

export type RecoveryPriority = "NORMAL" | "HIGH" | "URGENT";

const AFTERCARE_DELAY_BY_SERVICE: Record<string, number> = {
  locksmith: 60,
  electrical: 180,
  plumbing: 180,
  ac: 240,
  painting: 1440,
  repairs: 180,
  remodeling: 1440,
};

function nowIso() {
  return new Date().toISOString();
}

function positiveInt(value: string | undefined, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function retentionConfig() {
  return {
    marketingMinSpacingHours: positiveInt(process.env.RETENTION_MARKETING_SPACING_HOURS, 168),
    reactivationIdleDays: positiveInt(process.env.RETENTION_REACTIVATION_IDLE_DAYS, 180),
    maintenanceLookaheadDays: positiveInt(process.env.RETENTION_MAINTENANCE_LOOKAHEAD_DAYS, 7),
    defaultAftercareMinutes: positiveInt(process.env.POST_SERVICE_FOLLOWUP_DELAY_MINUTES, 120),
  };
}

export function aftercareDelayMinutesForService(service: string) {
  const key = String(service || "").toLowerCase();
  if (AFTERCARE_DELAY_BY_SERVICE[key] != null) return AFTERCARE_DELAY_BY_SERVICE[key];
  return retentionConfig().defaultAftercareMinutes;
}

export function migrateRetentionWaveE(database: Database.Database) {
  const custCols = database.prepare("PRAGMA table_info(revenue_customers)").all() as Array<{ name: string }>;
  const names = new Set(custCols.map((c) => c.name));
  const addCust = (name: string, ddl: string) => {
    if (names.has(name)) return;
    database.exec(`ALTER TABLE revenue_customers ADD COLUMN ${ddl}`);
    names.add(name);
  };
  addCust("pref_aftercare", "pref_aftercare INTEGER NOT NULL DEFAULT 1");
  addCust("pref_review", "pref_review INTEGER NOT NULL DEFAULT 1");
  addCust("pref_maintenance", "pref_maintenance INTEGER NOT NULL DEFAULT 1");
  addCust("pref_reactivation", "pref_reactivation INTEGER NOT NULL DEFAULT 1");
  addCust("pref_marketing", "pref_marketing INTEGER NOT NULL DEFAULT 0");
  addCust("last_marketing_contact_at", "last_marketing_contact_at TEXT");
  addCust("marketing_contact_count", "marketing_contact_count INTEGER NOT NULL DEFAULT 0");
  addCust("suppressed_at", "suppressed_at TEXT");
  addCust("suppression_reason", "suppression_reason TEXT NOT NULL DEFAULT ''");

  const jobCols = database.prepare("PRAGMA table_info(revenue_jobs)").all() as Array<{ name: string }>;
  const jnames = new Set(jobCols.map((c) => c.name));
  const addJob = (name: string, ddl: string) => {
    if (jnames.has(name)) return;
    database.exec(`ALTER TABLE revenue_jobs ADD COLUMN ${ddl}`);
    jnames.add(name);
  };
  addJob("recovery_priority", "recovery_priority TEXT NOT NULL DEFAULT ''");
  addJob("recovery_assigned_operator_id", "recovery_assigned_operator_id INTEGER");
  addJob("recovery_resolved_at", "recovery_resolved_at TEXT");
  addJob("recovery_resolved_by", "recovery_resolved_by TEXT NOT NULL DEFAULT ''");
  addJob("recovery_resolution_type", "recovery_resolution_type TEXT NOT NULL DEFAULT ''");
  addJob("recovery_notes", "recovery_notes TEXT NOT NULL DEFAULT ''");
  addJob("aftercare_source", "aftercare_source TEXT NOT NULL DEFAULT ''");

  database.exec(`
    CREATE TABLE IF NOT EXISTS retention_actions (
      action_id TEXT PRIMARY KEY,
      customer_id INTEGER NOT NULL,
      job_id TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      channel TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT NOT NULL UNIQUE,
      scheduled_at TEXT,
      sent_at TEXT,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_retention_actions_due
      ON retention_actions (status, kind, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_retention_actions_customer
      ON retention_actions (customer_id, kind, created_at);
  `);

  const maintCols = database.prepare("PRAGMA table_info(revenue_maintenance)").all() as Array<{ name: string }>;
  if (maintCols.length) {
    const mnames = new Set(maintCols.map((c) => c.name));
    if (!mnames.has("contacted_at")) {
      database.exec("ALTER TABLE revenue_maintenance ADD COLUMN contacted_at TEXT");
    }
    if (!mnames.has("source_job_id")) {
      database.exec("ALTER TABLE revenue_maintenance ADD COLUMN source_job_id TEXT NOT NULL DEFAULT ''");
    }
  }
}

export function getCustomerRetentionPrefs(customerId: number) {
  const row = getHomesteadDb()
    .prepare(
      `SELECT id, do_not_contact, COALESCE(pref_aftercare,1) as pref_aftercare,
        COALESCE(pref_review,1) as pref_review, COALESCE(pref_maintenance,1) as pref_maintenance,
        COALESCE(pref_reactivation,1) as pref_reactivation, COALESCE(pref_marketing,0) as pref_marketing,
        last_marketing_contact_at, COALESCE(marketing_contact_count,0) as marketing_contact_count,
        suppressed_at, COALESCE(suppression_reason,'') as suppression_reason
       FROM revenue_customers WHERE id = ?`,
    )
    .get(customerId) as
    | {
        id: number;
        do_not_contact: number;
        pref_aftercare: number;
        pref_review: number;
        pref_maintenance: number;
        pref_reactivation: number;
        pref_marketing: number;
        last_marketing_contact_at: string | null;
        marketing_contact_count: number;
        suppressed_at: string | null;
        suppression_reason: string;
      }
    | undefined;
  if (!row) return null;
  return {
    customerId: row.id,
    doNotContact: row.do_not_contact === 1,
    aftercare: row.pref_aftercare === 1,
    review: row.pref_review === 1,
    maintenance: row.pref_maintenance === 1,
    reactivation: row.pref_reactivation === 1,
    marketing: row.pref_marketing === 1,
    lastMarketingContactAt: row.last_marketing_contact_at,
    marketingContactCount: row.marketing_contact_count,
    suppressedAt: row.suppressed_at,
    suppressionReason: row.suppression_reason,
  };
}

export function applyMarketingSuppression(customerId: number, reason: string) {
  const now = nowIso();
  getHomesteadDb()
    .prepare(
      `UPDATE revenue_customers SET
        pref_marketing = 0, pref_reactivation = 0, pref_maintenance = 0, pref_review = 0,
        suppressed_at = ?, suppression_reason = ?, do_not_contact = CASE WHEN ? = 'hard' THEN 1 ELSE do_not_contact END
       WHERE id = ?`,
    )
    .run(now, reason.slice(0, 80), reason === "hard" ? "hard" : "", customerId);
  logInfo("SUPPRESSION_APPLIED", { correlationId: String(customerId), stage: reason.slice(0, 40) });
}

export function recordMarketingContact(customerId: number) {
  const now = nowIso();
  getHomesteadDb()
    .prepare(
      `UPDATE revenue_customers SET
        last_marketing_contact_at = ?,
        marketing_contact_count = COALESCE(marketing_contact_count,0) + 1
       WHERE id = ?`,
    )
    .run(now, customerId);
}

export function hasOpenRecovery(customerId: number) {
  const row = getHomesteadDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM revenue_jobs
       WHERE customer_id = ? AND recovery_status IN ('OPEN','CONTACTED')`,
    )
    .get(customerId) as { c: number };
  return row.c > 0;
}

/** Marketing/reactivation/maintenance reminders — not transactional aftercare. */
export function canSendMarketingRetention(customerId: number, kind: "review" | "maintenance" | "reactivation") {
  const prefs = getCustomerRetentionPrefs(customerId);
  if (!prefs || prefs.doNotContact) return { ok: false as const, reason: "do_not_contact" };
  if (prefs.suppressedAt) return { ok: false as const, reason: "suppressed" };
  if (hasOpenRecovery(customerId)) return { ok: false as const, reason: "open_recovery" };
  if (kind === "review" && !prefs.review) return { ok: false as const, reason: "pref_review" };
  if (kind === "maintenance" && !prefs.maintenance) return { ok: false as const, reason: "pref_maintenance" };
  if (kind === "reactivation" && !prefs.reactivation) return { ok: false as const, reason: "pref_reactivation" };
  if (kind === "reactivation" && !prefs.marketing && !prefs.reactivation) {
    return { ok: false as const, reason: "pref_marketing" };
  }
  const spacingMs = retentionConfig().marketingMinSpacingHours * 3600_000;
  if (prefs.lastMarketingContactAt) {
    const last = Date.parse(prefs.lastMarketingContactAt);
    if (Number.isFinite(last) && Date.now() - last < spacingMs) {
      return { ok: false as const, reason: "frequency_cap" };
    }
  }
  if (isQuietHours()) {
    return { ok: false as const, reason: "quiet_hours", deferUntil: nextQuietEndIso() };
  }
  return { ok: true as const };
}

export function canSendTransactionalAftercare(customerId: number) {
  const prefs = getCustomerRetentionPrefs(customerId);
  if (!prefs) return { ok: false as const, reason: "missing_customer" };
  if (prefs.doNotContact) return { ok: false as const, reason: "do_not_contact" };
  if (!prefs.aftercare) return { ok: false as const, reason: "pref_aftercare" };
  return { ok: true as const };
}

const SAFETY_HINTS =
  /\b(chispas?|spark|humo|smoke|gas|explos|electroc|incendio|fuego|fire|corto\s*circuito)\b/i;

export function classifyRecoveryPriority(text: string): RecoveryPriority {
  if (SAFETY_HINTS.test(text || "")) return "URGENT";
  if (/\b(sigue|todav[ií]a|no\s+(enfr[ií]a|funciona|sirve)|fuga|inund)/i.test(text || "")) return "HIGH";
  return "NORMAL";
}

/** Free-text satisfaction hints — deterministic first; AI optional later. */
export function classifySatisfactionText(text: string): "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "UNCLEAR" {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return "UNCLEAR";
  if (SAFETY_HINTS.test(t) || /\b(problema|malo|pésimo|no\s+sirve|reclam|queja|ayuda)\b/i.test(t)) {
    return "NEGATIVE";
  }
  if (/\b(excelente|perfecto|qued[oó]\s+bien|todo\s+bien|gracias|satisfech|genial|buen[oa]\s+trabajo)\b/i.test(t)) {
    return "POSITIVE";
  }
  if (/\b(m[aá]s\s+o\s+menos|regular|probando|veremos|no\s+s[eé])\b/i.test(t)) return "NEUTRAL";
  return "UNCLEAR";
}

export function claimRetentionAction(input: {
  actionId: string;
  customerId: number;
  jobId?: string;
  kind: string;
  idempotencyKey: string;
  scheduledAt?: string;
  channel?: string;
  detail?: string;
}) {
  const now = nowIso();
  try {
    getHomesteadDb()
      .prepare(
        `INSERT INTO retention_actions
          (action_id, customer_id, job_id, kind, status, channel, idempotency_key, scheduled_at, detail, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.actionId,
        input.customerId,
        input.jobId || "",
        input.kind,
        input.channel || "email",
        input.idempotencyKey,
        input.scheduledAt || now,
        (input.detail || "").slice(0, 180),
        now,
        now,
      );
    return { ok: true as const, created: true };
  } catch {
    return { ok: true as const, created: false };
  }
}

export function markRetentionActionSent(actionId: string) {
  getHomesteadDb()
    .prepare(`UPDATE retention_actions SET status = 'SENT', sent_at = ?, updated_at = ? WHERE action_id = ? AND status = 'PENDING'`)
    .run(nowIso(), nowIso(), actionId);
}

export function markRetentionActionSkipped(actionId: string, reason: string) {
  getHomesteadDb()
    .prepare(`UPDATE retention_actions SET status = 'SKIPPED', detail = ?, updated_at = ? WHERE action_id = ?`)
    .run(reason.slice(0, 180), nowIso(), actionId);
}

export type RetentionDashboard = {
  aftercarePending: number;
  satisfiedRecent: number;
  recoveryOpen: number;
  recoveryContacted: number;
  reviewsRequested: number;
  maintenanceDue: number;
  reactivationEligible: number;
};

export function retentionDashboard(includeTest = false): RetentionDashboard {
  const test = includeTest ? "1=1" : "j.is_test = 0";
  const db = getHomesteadDb();
  const aftercarePending = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM revenue_jobs j WHERE ${test} AND j.status = 'COMPLETED'
         AND j.followup_status = 'PENDING' AND (j.satisfaction_response = '' OR j.satisfaction_response IS NULL)`,
      )
      .get() as { c: number }
  ).c;
  const satisfiedRecent = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM revenue_jobs j WHERE ${test}
         AND j.satisfaction_response IN ('EXCELLENT','GOOD')
         AND j.satisfaction_received_at >= datetime('now','-30 day')`,
      )
      .get() as { c: number }
  ).c;
  const recoveryOpen = (
    db.prepare(`SELECT COUNT(*) AS c FROM revenue_jobs j WHERE ${test} AND j.recovery_status = 'OPEN'`).get() as {
      c: number;
    }
  ).c;
  const recoveryContacted = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM revenue_jobs j WHERE ${test} AND j.recovery_status = 'CONTACTED'`)
      .get() as { c: number }
  ).c;
  const reviewsRequested = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM revenue_jobs j WHERE ${test}
         AND j.review_requested_at IS NOT NULL AND j.review_requested_at != ''`,
      )
      .get() as { c: number }
  ).c;
  const maintenanceDue = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM revenue_maintenance m
         LEFT JOIN revenue_customers c ON c.id = m.customer_id
         WHERE m.status = 'OPEN' AND m.eligible_at <= datetime('now','+7 day')
           AND (c.do_not_contact = 0 OR c.do_not_contact IS NULL)`,
      )
      .get() as { c: number }
  ).c;
  const idleDays = retentionConfig().reactivationIdleDays;
  const reactivationEligible = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM revenue_customers c
         WHERE c.do_not_contact = 0
           AND COALESCE(c.pref_reactivation,1) = 1
           AND (c.suppressed_at IS NULL OR c.suppressed_at = '')
           AND COALESCE(c.is_test,0) = ${includeTest ? "c.is_test" : "0"}
           AND NOT EXISTS (
             SELECT 1 FROM revenue_jobs j
             WHERE j.customer_id = c.id AND j.recovery_status IN ('OPEN','CONTACTED')
           )
           AND EXISTS (
             SELECT 1 FROM revenue_jobs j
             WHERE j.customer_id = c.id AND j.status = 'COMPLETED'
               AND j.completed_at <= datetime('now', ?)
           )
           AND NOT EXISTS (
             SELECT 1 FROM revenue_jobs j
             WHERE j.customer_id = c.id AND j.status = 'COMPLETED'
               AND j.completed_at > datetime('now', ?)
           )`,
      )
      .get(`-${idleDays} day`, `-${Math.floor(idleDays / 2)} day`) as { c: number }
  ).c;
  return {
    aftercarePending,
    satisfiedRecent,
    recoveryOpen,
    recoveryContacted,
    reviewsRequested,
    maintenanceDue,
    reactivationEligible,
  };
}

export function listRecoveryQueue(includeTest = false, limit = 40) {
  const test = includeTest ? "1=1" : "j.is_test = 0";
  return getHomesteadDb()
    .prepare(
      `SELECT j.job_id, j.job_number, j.service, j.recovery_status, j.recovery_priority, j.recovery_at,
              j.customer_id, c.name as customer_name, c.phone
       FROM revenue_jobs j
       LEFT JOIN revenue_customers c ON c.id = j.customer_id
       WHERE ${test} AND j.recovery_status IN ('OPEN','CONTACTED')
       ORDER BY
         CASE j.recovery_priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,
         j.recovery_at ASC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    job_id: string;
    job_number: string;
    service: string;
    recovery_status: string;
    recovery_priority: string;
    recovery_at: string | null;
    customer_id: number;
    customer_name: string;
    phone: string;
  }>;
}
