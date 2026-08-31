import { randomUUID } from "crypto";
import { getHomesteadDb } from "@/lib/service-requests";
import { autonomousNow } from "@/lib/autonomous/clock";
import type { OperationalSignal, SignalCandidate, SignalStatus } from "@/lib/autonomous/types";

type Row = {
  signal_id: string;
  signal_type: string;
  source: string;
  entity_type: string | null;
  entity_id: string | null;
  customer_id: number | null;
  request_id: string | null;
  appointment_id: string | null;
  detected_at: string;
  business_time: string | null;
  severity: string;
  priority: number;
  facts_json: string;
  evidence_json: string;
  ai_assessment_json: string | null;
  deduplication_key: string;
  state_version: string;
  status: string;
  recommended_action: string | null;
  reasoning_summary: string | null;
  delivery_mode: string;
  notified_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by_operator_id: number | null;
  resolved_at: string | null;
  last_notified_at: string | null;
  notification_count: number;
  cooldown_until: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
};

function rowToSignal(row: Row): OperationalSignal {
  return {
    signalId: row.signal_id,
    signalType: row.signal_type as OperationalSignal["signalType"],
    source: row.source,
    entityType: row.entity_type || undefined,
    entityId: row.entity_id || undefined,
    customerId: row.customer_id ?? undefined,
    requestId: row.request_id || undefined,
    appointmentId: row.appointment_id || undefined,
    detectedAt: row.detected_at,
    businessTime: row.business_time || undefined,
    severity: row.severity as OperationalSignal["severity"],
    priority: row.priority,
    facts: JSON.parse(row.facts_json || "{}"),
    evidence: JSON.parse(row.evidence_json || "{}"),
    aiAssessment: row.ai_assessment_json ? JSON.parse(row.ai_assessment_json) : undefined,
    deduplicationKey: row.deduplication_key,
    stateVersion: row.state_version,
    status: row.status as SignalStatus,
    recommendedAction: row.recommended_action || undefined,
    reasoningSummary: row.reasoning_summary || undefined,
    deliveryMode: row.delivery_mode as OperationalSignal["deliveryMode"],
    notifiedAt: row.notified_at || undefined,
    acknowledgedAt: row.acknowledged_at || undefined,
    acknowledgedByOperatorId: row.acknowledged_by_operator_id ?? undefined,
    resolvedAt: row.resolved_at || undefined,
    lastNotifiedAt: row.last_notified_at || undefined,
    notificationCount: row.notification_count,
    cooldownUntil: row.cooldown_until || undefined,
    supersededBy: row.superseded_by || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function upsertOperationalSignal(candidate: SignalCandidate): OperationalSignal {
  const db = getHomesteadDb();
  const now = autonomousNow().toISOString();
  const existing = db
    .prepare("SELECT * FROM operational_signals WHERE deduplication_key = ?")
    .get(candidate.deduplicationKey) as Row | undefined;

  if (existing) {
    const terminal = new Set(["RESOLVED", "EXPIRED", "SUPERSEDED", "IGNORED"]);
    if (terminal.has(existing.status)) {
      db.prepare(
        `UPDATE operational_signals SET
          signal_type = ?, source = ?, entity_type = ?, entity_id = ?, customer_id = ?,
          request_id = ?, appointment_id = ?, detected_at = ?, business_time = ?,
          severity = ?, priority = ?, facts_json = ?, evidence_json = ?,
          state_version = ?, status = 'DETECTED', recommended_action = ?,
          reasoning_summary = ?, delivery_mode = ?, resolved_at = NULL,
          superseded_by = NULL, updated_at = ?
         WHERE deduplication_key = ?`,
      ).run(
        candidate.signalType,
        candidate.source,
        candidate.entityType || null,
        candidate.entityId || null,
        candidate.customerId ?? null,
        candidate.requestId || null,
        candidate.appointmentId || null,
        candidate.detectedAt,
        candidate.businessTime || null,
        candidate.severity,
        candidate.priority,
        JSON.stringify(candidate.facts),
        JSON.stringify(candidate.evidence),
        candidate.stateVersion,
        candidate.recommendedAction || null,
        candidate.reasoningSummary || null,
        candidate.deliveryMode || "IMMEDIATE",
        now,
        candidate.deduplicationKey,
      );
    } else {
      db.prepare(
        `UPDATE operational_signals SET
          severity = ?, priority = ?, facts_json = ?, evidence_json = ?,
          state_version = ?, recommended_action = ?, reasoning_summary = ?,
          delivery_mode = ?, detected_at = ?, updated_at = ?,
          status = CASE WHEN status IN ('RESOLVED','EXPIRED','SUPERSEDED') THEN status ELSE 'ACTIONABLE' END
         WHERE deduplication_key = ?`,
      ).run(
        candidate.severity,
        candidate.priority,
        JSON.stringify(candidate.facts),
        JSON.stringify(candidate.evidence),
        candidate.stateVersion,
        candidate.recommendedAction || null,
        candidate.reasoningSummary || null,
        candidate.deliveryMode || "IMMEDIATE",
        candidate.detectedAt,
        now,
        candidate.deduplicationKey,
      );
    }
    return getSignalByDedupKey(candidate.deduplicationKey)!;
  }

  const signalId = randomUUID();
  db.prepare(
    `INSERT INTO operational_signals (
      signal_id, signal_type, source, entity_type, entity_id, customer_id,
      request_id, appointment_id, detected_at, business_time, severity, priority,
      facts_json, evidence_json, deduplication_key, state_version, status,
      recommended_action, reasoning_summary, delivery_mode, notification_count,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
  ).run(
    signalId,
    candidate.signalType,
    candidate.source,
    candidate.entityType || null,
    candidate.entityId || null,
    candidate.customerId ?? null,
    candidate.requestId || null,
    candidate.appointmentId || null,
    candidate.detectedAt,
    candidate.businessTime || null,
    candidate.severity,
    candidate.priority,
    JSON.stringify(candidate.facts),
    JSON.stringify(candidate.evidence),
    candidate.deduplicationKey,
    candidate.stateVersion,
    "DETECTED",
    candidate.recommendedAction || null,
    candidate.reasoningSummary || null,
    candidate.deliveryMode || "IMMEDIATE",
    now,
    now,
  );
  return getSignalById(signalId)!;
}

export function getSignalById(signalId: string): OperationalSignal | null {
  const row = getHomesteadDb()
    .prepare("SELECT * FROM operational_signals WHERE signal_id = ?")
    .get(signalId) as Row | undefined;
  return row ? rowToSignal(row) : null;
}

export function getSignalByDedupKey(key: string): OperationalSignal | null {
  const row = getHomesteadDb()
    .prepare("SELECT * FROM operational_signals WHERE deduplication_key = ?")
    .get(key) as Row | undefined;
  return row ? rowToSignal(row) : null;
}

export function listActiveSignals(limit = 50): OperationalSignal[] {
  const rows = getHomesteadDb()
    .prepare(
      `SELECT * FROM operational_signals
       WHERE status IN ('DETECTED','EVALUATING','ACTIONABLE','NOTIFIED','ACKNOWLEDGED')
       ORDER BY priority ASC, detected_at DESC
       LIMIT ?`,
    )
    .all(Math.min(200, Math.max(1, limit))) as Row[];
  return rows.map(rowToSignal);
}

export function listSignalsForInbox(limit = 30): OperationalSignal[] {
  const rows = getHomesteadDb()
    .prepare(
      `SELECT * FROM operational_signals
       WHERE status IN ('ACTIONABLE','NOTIFIED','ACKNOWLEDGED')
       ORDER BY
         CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
         priority ASC,
         detected_at DESC
       LIMIT ?`,
    )
    .all(Math.min(100, Math.max(1, limit))) as Row[];
  return rows.map(rowToSignal);
}

export function resolveSignal(signalId: string, reason = "condition_cleared") {
  const now = autonomousNow().toISOString();
  getHomesteadDb()
    .prepare(
      `UPDATE operational_signals SET status = 'RESOLVED', resolved_at = ?, updated_at = ?,
       reasoning_summary = COALESCE(reasoning_summary, '') || ' [' || ? || ']'
       WHERE signal_id = ? AND status NOT IN ('RESOLVED','EXPIRED','SUPERSEDED')`,
    )
    .run(now, now, reason, signalId);
}

export function resolveSignalsByDedupPrefix(prefix: string, reason = "condition_cleared") {
  const now = autonomousNow().toISOString();
  getHomesteadDb()
    .prepare(
      `UPDATE operational_signals SET status = 'RESOLVED', resolved_at = ?, updated_at = ?
       WHERE deduplication_key LIKE ? AND status NOT IN ('RESOLVED','EXPIRED','SUPERSEDED')`,
    )
    .run(now, now, `${prefix}%`, reason);
}

export function supersedeSignal(signalId: string, supersededBy: string) {
  const now = autonomousNow().toISOString();
  getHomesteadDb()
    .prepare(
      `UPDATE operational_signals SET status = 'SUPERSEDED', superseded_by = ?, updated_at = ?
       WHERE signal_id = ? AND status NOT IN ('RESOLVED','EXPIRED')`,
    )
    .run(supersededBy, now, signalId);
}

export function markSignalNotified(signalId: string, cooldownUntil?: string) {
  const now = autonomousNow().toISOString();
  getHomesteadDb()
    .prepare(
      `UPDATE operational_signals SET
        status = CASE WHEN status = 'ACKNOWLEDGED' THEN status ELSE 'NOTIFIED' END,
        notified_at = COALESCE(notified_at, ?),
        last_notified_at = ?,
        notification_count = notification_count + 1,
        cooldown_until = ?,
        updated_at = ?
       WHERE signal_id = ?`,
    )
    .run(now, now, cooldownUntil || null, now, signalId);
}

export function acknowledgeSignal(signalId: string, operatorId?: number) {
  const now = autonomousNow().toISOString();
  getHomesteadDb()
    .prepare(
      `UPDATE operational_signals SET status = 'ACKNOWLEDGED', acknowledged_at = ?,
        acknowledged_by_operator_id = ?, updated_at = ?
       WHERE signal_id = ? AND status NOT IN ('RESOLVED','EXPIRED','SUPERSEDED')`,
    )
    .run(now, operatorId ?? null, now, signalId);
}

export function updateSignalAssessment(
  signalId: string,
  patch: { aiAssessment?: OperationalSignal["aiAssessment"]; recommendedAction?: string; reasoningSummary?: string; status?: SignalStatus },
) {
  const now = autonomousNow().toISOString();
  const current = getSignalById(signalId);
  if (!current) return;
  getHomesteadDb()
    .prepare(
      `UPDATE operational_signals SET
        ai_assessment_json = ?,
        recommended_action = COALESCE(?, recommended_action),
        reasoning_summary = COALESCE(?, reasoning_summary),
        status = COALESCE(?, status),
        updated_at = ?
       WHERE signal_id = ?`,
    )
    .run(
      patch.aiAssessment ? JSON.stringify(patch.aiAssessment) : JSON.stringify(current.aiAssessment || null),
      patch.recommendedAction || null,
      patch.reasoningSummary || null,
      patch.status || null,
      now,
      signalId,
    );
}

export function recordSignalFeedback(signalId: string, feedback: string, operatorId?: number) {
  getHomesteadDb()
    .prepare(
      `INSERT INTO autonomous_signal_feedback (signal_id, operator_id, feedback, created_at)
       VALUES (?,?,?,?)`,
    )
    .run(signalId, operatorId ?? null, feedback, autonomousNow().toISOString());
}

export function countActiveSignalsByType(signalType: string): number {
  const row = getHomesteadDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM operational_signals
       WHERE signal_type = ? AND status IN ('DETECTED','EVALUATING','ACTIONABLE','NOTIFIED','ACKNOWLEDGED')`,
    )
    .get(signalType) as { c: number };
  return row?.c || 0;
}

export function incrementAutonomousMetric(key: string, delta = 1) {
  const now = autonomousNow().toISOString();
  getHomesteadDb()
    .prepare(
      `INSERT INTO autonomous_metrics (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = value + excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, delta, now);
}

export function getAutonomousMetric(key: string): number {
  const row = getHomesteadDb()
    .prepare("SELECT value FROM autonomous_metrics WHERE key = ?")
    .get(key) as { value: number } | undefined;
  return row?.value || 0;
}
