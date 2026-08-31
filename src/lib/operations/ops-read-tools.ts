/**
 * Typed read helpers for Operations AI tools (no raw SQL from LLM).
 */
import { outboxSnapshot } from "@/lib/automation-outbox";
import { getAttentionItems, getBusinessBriefCounts, getExecutiveSummary, resolveAnalyticsRange } from "@/lib/analytics-service";
import { listAgenda, listPendingRequests, commandCenterSummary } from "@/lib/ops-store";
import { businessYmd } from "@/lib/appointment-time";
import { getHomesteadDb } from "@/lib/service-requests";
import { getAppointment } from "@/lib/revenue-store";

export function buildOperationsSummary(rangeKey: "today" | "7d" | "30d" | "month" = "today") {
  const range = resolveAnalyticsRange(rangeKey);
  const summary = getExecutiveSummary(range, false);
  const brief = getBusinessBriefCounts(false);
  const attention = getAttentionItems(false, 8);
  return {
    range: summary.range,
    openRequests: brief.pendingRequests,
    scheduledVisits: brief.appointmentsToday,
    completedToday: summary.operational.jobsActive,
    cancelled: null,
    unassigned: brief.rescue,
    overdue: attention.filter((a) => a.kind === "SLA").length,
    waitingCustomer: null,
    waitingOperator: brief.pendingRequests,
    failedAutomations: outboxSnapshot().failed,
    importantAlerts: attention.slice(0, 5).map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      detail: a.detail,
    })),
    brief,
    funnel: summary.funnel,
    revenueAvailable: false,
  };
}

export function buildWorkloadSummary(range: "today" | "week" | "7d" | "30d" = "week") {
  const key = range === "week" ? "7d" : range === "today" ? "today" : range;
  const r = resolveAnalyticsRange(key as "today" | "7d" | "30d");
  const snap = commandCenterSummary(false);
  const upcoming = listAgenda(businessYmd(new Date(), 1), false);
  return {
    range: r.label,
    pendingRequests: snap.pendingRequests,
    appointmentsTomorrow: upcoming.length,
    rescue: snap.rescue,
    jobsActive: snap.jobsActive || 0,
  };
}

export function listOverdueRequests(limit = 10) {
  const db = getHomesteadDb();
  const rows = db
    .prepare(
      `SELECT r.public_id, r.name, r.service, r.status, r.created_at
       FROM service_requests r
       LEFT JOIN revenue_leads l ON l.lead_id = r.public_id
       WHERE r.status IN ('NEW','OPEN','PENDING','IN_PROGRESS')
         AND COALESCE(l.is_test, 0) = 0
         AND datetime(r.created_at) < datetime('now', '-24 hours')
       ORDER BY r.created_at ASC
       LIMIT ?`,
    )
    .all(Math.min(20, Math.max(1, limit))) as Array<{
    public_id: string;
    name: string;
    service: string;
    status: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    publicId: r.public_id,
    name: r.name,
    service: r.service,
    status: r.status,
    createdAt: r.created_at,
    ageHours: Math.round((Date.now() - Date.parse(r.created_at)) / 3600000),
  }));
}

export function listRequestsByLocation(location: string, limit = 15) {
  const needle = location.trim().toLowerCase();
  if (!needle) return [];
  const db = getHomesteadDb();
  const rows = db
    .prepare(
      `SELECT r.public_id, r.name, r.service, r.status, r.created_at, r.message, r.property
       FROM service_requests r
       LEFT JOIN revenue_leads l ON l.lead_id = r.public_id
       WHERE COALESCE(l.is_test, 0) = 0
         AND (
           lower(coalesce(r.property,'')) LIKE ?
           OR lower(coalesce(r.message,'')) LIKE ?
         )
       ORDER BY r.created_at DESC
       LIMIT ?`,
    )
    .all(`%${needle}%`, `%${needle}%`, Math.min(25, Math.max(1, limit))) as Array<{
    public_id: string;
    name: string;
    service: string;
    status: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    publicId: r.public_id,
    name: r.name,
    service: r.service,
    status: r.status,
    createdAt: r.created_at,
  }));
}

export function listRequestsByService(service: string, rangeDays = 30, limit = 20) {
  const db = getHomesteadDb();
  const rows = db
    .prepare(
      `SELECT r.public_id, r.name, r.service, r.status, r.created_at
       FROM service_requests r
       LEFT JOIN revenue_leads l ON l.lead_id = r.public_id
       WHERE COALESCE(l.is_test, 0) = 0
         AND lower(r.service) LIKE ?
         AND datetime(r.created_at) >= datetime('now', ?)
       ORDER BY r.created_at DESC
       LIMIT ?`,
    )
    .all(`%${service.toLowerCase()}%`, `-${rangeDays} days`, Math.min(30, Math.max(1, limit))) as Array<{
    public_id: string;
    name: string;
    service: string;
    status: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    publicId: r.public_id,
    name: r.name,
    service: r.service,
    status: r.status,
    createdAt: r.created_at,
  }));
}

export function readOutboxStatus() {
  const box = outboxSnapshot();
  return {
    pending: box.pending,
    failed: box.failed,
    delivered: box.delivered,
    oldestPendingAt: box.oldestPendingAt,
    oldestPendingAgeMs: box.oldestPendingAgeMs,
    lastDispatchOkAt: box.lastDispatchOkAt,
  };
}

export function readAppointmentDetail(appointmentId: string) {
  const ap = getAppointment(appointmentId);
  if (!ap) return null;
  return {
    appointmentId: ap.appointmentId,
    leadId: ap.leadId,
    date: ap.date,
    startTime: ap.startTime,
    status: ap.status,
    service: ap.service,
    version: ap.version,
    customerName: ap.customerName || "",
  };
}

export function listCalendarRange(fromOffsetDays: number, toOffsetDays: number) {
  const days: Array<{ ymd: string; count: number; appointments: ReturnType<typeof listAgenda> }> = [];
  for (let d = fromOffsetDays; d <= toOffsetDays; d += 1) {
    const ymd = businessYmd(new Date(), d);
    const appts = listAgenda(ymd, false);
    days.push({ ymd, count: appts.length, appointments: appts.slice(0, 8) });
  }
  return days;
}

export function explainRequestStuck(publicId: string) {
  const db = getHomesteadDb();
  const req = db
    .prepare("SELECT public_id, status, snoozed_until, created_at FROM service_requests WHERE public_id = ?")
    .get(publicId) as { public_id: string; status: string; snoozed_until: string | null; created_at: string } | undefined;
  if (!req) return { error: "not_found" as const };
  const appt = db
    .prepare(
      `SELECT appointment_id, status, date, start_time FROM revenue_appointments
       WHERE lead_id = ? AND status NOT IN ('CANCELLED','COMPLETED') ORDER BY created_at DESC LIMIT 1`,
    )
    .get(publicId) as { appointment_id: string; status: string; date: string; start_time: string } | undefined;
  const reasons: string[] = [];
  if (req.snoozed_until && req.snoozed_until > new Date().toISOString()) {
    reasons.push(`Pospuesta hasta ${req.snoozed_until}`);
  }
  if (!appt && ["NEW", "OPEN", "PENDING"].includes(req.status)) {
    reasons.push("Sin cita activa vinculada");
  }
  if (req.status === "CONTACTED") {
    reasons.push("Marcada como atendida; puede estar esperando siguiente paso operativo");
  }
  const failedOutbox = db
    .prepare(
      `SELECT COUNT(*) AS c FROM automation_outbox WHERE status = 'FAILED' AND payload_json LIKE ?`,
    )
    .get(`%${publicId}%`) as { c: number };
  if (failedOutbox.c > 0) reasons.push("Hay eventos de automatización fallidos relacionados");
  return {
    publicId,
    status: req.status,
    createdAt: req.created_at,
    appointment: appt || null,
    supportedReasons: reasons,
    insufficientEvidence: reasons.length === 0,
  };
}
