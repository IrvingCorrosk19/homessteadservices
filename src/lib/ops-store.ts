import { classifyPhone } from "@/lib/phone";
import {
  getHomesteadDb,
  getRequestByPublicId,
  updateRequestStatus,
} from "@/lib/service-requests";
import { addRevenueEvent, getLead, listAppointments, markLeadHumanAction, setPipeline } from "@/lib/revenue-store";
import { opsConfig } from "@/lib/ops-config";
import { businessYmd, reminderEligibleStatus } from "@/lib/appointment-time";
import { logInfo } from "@/lib/log";
import {
  countActiveJobs,
  countContentCandidates,
  countFollowups,
  countServiceRecovery,
} from "@/lib/job-store";

const OPEN_APPT = "('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED')";
const BOOKED_STAGES = "('SCHEDULED','JOB_IN_PROGRESS','JOB_COMPLETED','WON')";
const CLOSED_STAGES = "('LOST','NO_RESPONSE','NOT_QUALIFIED','CANCELLED','WON','JOB_COMPLETED')";
const COMMERCIAL_INTENT = `(l.temperature IN ('HOT','WARM') OR length(trim(l.problem_summary)) >= 20 OR (l.service_category IS NOT NULL AND l.service_category NOT IN ('','unknown','other')))`;
const REACHABLE_PHONE = `length(replace(replace(replace(c.phone,'+',''),' ',''),'-','')) >= 8`;

function nowIso() {
  return new Date().toISOString();
}

function testClause(alias: string, includeTest: boolean) {
  return includeTest ? "1=1" : `${alias}.is_test = 0`;
}

export function recordOpsAudit(input: {
  action: string;
  actor?: string;
  entityType: string;
  entityId: string;
  detail?: string;
}) {
  getHomesteadDb()
    .prepare(
      "INSERT INTO ops_audit (action, actor, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      input.action,
      (input.actor || "telegram").slice(0, 40),
      input.entityType,
      input.entityId,
      (input.detail || "").slice(0, 180),
      nowIso(),
    );
  logInfo(input.action, { correlationId: input.entityId, stage: input.entityType });
}

export function commandCenterSummary(includeTest = false) {
  const db = getHomesteadDb();
  const testLead = testClause("l", includeTest);
  const rescue = db
    .prepare(
      `SELECT COUNT(*) as n FROM revenue_leads l
       JOIN revenue_customers c ON c.id = l.customer_id
       WHERE ${testLead}
         AND l.dismissed_at IS NULL
         AND l.first_human_action_at IS NULL
         AND l.pipeline_stage NOT IN ${CLOSED_STAGES}
         AND l.pipeline_stage NOT IN ${BOOKED_STAGES}
         AND c.do_not_contact = 0
         AND ${COMMERCIAL_INTENT}
         AND ${REACHABLE_PHONE}
         AND NOT EXISTS (
           SELECT 1 FROM revenue_appointments a
           WHERE a.lead_id = l.lead_id AND a.status IN ${OPEN_APPT}
         )`,
    )
    .get() as { n: number };
  const pending = db
    .prepare(
      `SELECT COUNT(*) as n FROM service_requests r
       LEFT JOIN revenue_leads l ON l.lead_id = r.public_id
       WHERE r.status = 'NEW' AND (${includeTest ? "1=1" : "COALESCE(l.is_test,0)=0"})`,
    )
    .get() as { n: number };
  const { ymd } = panamaToday();
  const todayAppt = db
    .prepare(
      `SELECT COUNT(*) as n FROM revenue_appointments a
       JOIN revenue_leads l ON l.lead_id = a.lead_id
       WHERE a.date = ? AND a.status IN ${OPEN_APPT} AND ${testClause("l", includeTest)}`,
    )
    .get(ymd) as { n: number };
  const overdue = db
    .prepare(
      `SELECT COUNT(*) as n FROM revenue_followups f
       JOIN revenue_leads l ON l.lead_id = f.lead_id
       WHERE f.status = 'PENDING' AND f.scheduled_at <= ? AND ${testClause("l", includeTest)}`,
    )
    .get(nowIso()) as { n: number };
  const content = db
    .prepare(
      `SELECT COUNT(*) as n FROM content_jobs
       WHERE status IN ('AWAITING_APPROVAL','READY_FOR_REVIEW','RECEIVING')`,
    )
    .get() as { n: number };
  return {
    rescue: rescue.n,
    pendingRequests: pending.n,
    appointmentsToday: todayAppt.n,
    overdueFollowups: overdue.n,
    contentPending: content.n,
    jobsActive: countActiveJobs(includeTest),
    serviceRecovery: countServiceRecovery(includeTest),
    followupsOpen: countFollowups(includeTest),
    contentCandidates: countContentCandidates(includeTest),
    includeTest,
  };
}

function panamaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: opsConfig().timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const read = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return { ymd: `${read("year")}-${read("month")}-${read("day")}` };
}

export function listPendingRequests(includeTest = false, offset = 0, limit = opsConfig().pageSize) {
  return getHomesteadDb()
    .prepare(
      `SELECT r.public_id, r.created_at, r.name, r.service, r.message, r.status, r.phone
       FROM service_requests r
       LEFT JOIN revenue_leads l ON l.lead_id = r.public_id
       WHERE r.status = 'NEW' AND (${includeTest ? "1=1" : "COALESCE(l.is_test,0)=0"})
         AND (r.snoozed_until IS NULL OR r.snoozed_until <= ?)
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(nowIso(), limit, offset) as Array<{
    public_id: string;
    created_at: string;
    name: string;
    service: string;
    message: string;
    status: string;
    phone: string;
  }>;
}

export function countPendingRequests(includeTest = false) {
  const row = getHomesteadDb()
    .prepare(
      `SELECT COUNT(*) as n FROM service_requests r
       LEFT JOIN revenue_leads l ON l.lead_id = r.public_id
       WHERE r.status = 'NEW' AND (${includeTest ? "1=1" : "COALESCE(l.is_test,0)=0"})
         AND (r.snoozed_until IS NULL OR r.snoozed_until <= ?)`,
    )
    .get(nowIso()) as { n: number };
  return row.n;
}

function lastActivityIso(leadId: string, conversationId: string, fallback: string) {
  if (!conversationId) return fallback;
  const row = getHomesteadDb()
    .prepare("SELECT MAX(created_at) as ts FROM concierge_messages WHERE conversation_id = ?")
    .get(conversationId) as { ts: string | null } | undefined;
  const ts = row?.ts;
  if (!ts) return fallback;
  return ts > fallback ? ts : fallback;
}

export function listRescueLeads(includeTest = false, offset = 0, limit = opsConfig().pageSize) {
  const ids = getHomesteadDb()
    .prepare(
      `SELECT l.lead_id FROM revenue_leads l
       JOIN revenue_customers c ON c.id = l.customer_id
       WHERE ${testClause("l", includeTest)}
         AND l.dismissed_at IS NULL
         AND l.first_human_action_at IS NULL
         AND l.pipeline_stage NOT IN ${CLOSED_STAGES}
         AND l.pipeline_stage NOT IN ${BOOKED_STAGES}
         AND c.do_not_contact = 0
         AND ${COMMERCIAL_INTENT}
         AND ${REACHABLE_PHONE}
         AND (l.snoozed_until IS NULL OR l.snoozed_until <= ?)
         AND NOT EXISTS (
           SELECT 1 FROM revenue_appointments a
           WHERE a.lead_id = l.lead_id AND a.status IN ${OPEN_APPT}
         )
       ORDER BY l.created_at ASC
       LIMIT ? OFFSET ?`,
    )
    .all(nowIso(), limit, offset) as Array<{ lead_id: string }>;
  return ids.map((row) => getLead(row.lead_id)).filter(Boolean);
}

export function countRescueLeads(includeTest = false) {
  const row = getHomesteadDb()
    .prepare(
      `SELECT COUNT(*) as n FROM revenue_leads l
       JOIN revenue_customers c ON c.id = l.customer_id
       WHERE ${testClause("l", includeTest)}
         AND l.dismissed_at IS NULL
         AND l.first_human_action_at IS NULL
         AND l.pipeline_stage NOT IN ${CLOSED_STAGES}
         AND l.pipeline_stage NOT IN ${BOOKED_STAGES}
         AND c.do_not_contact = 0
         AND ${COMMERCIAL_INTENT}
         AND ${REACHABLE_PHONE}
         AND (l.snoozed_until IS NULL OR l.snoozed_until <= ?)
         AND NOT EXISTS (
           SELECT 1 FROM revenue_appointments a
           WHERE a.lead_id = l.lead_id AND a.status IN ${OPEN_APPT}
         )`,
    )
    .get(nowIso()) as { n: number };
  return row.n;
}

export function countLeadPhotos(leadId: string, conversationId = "") {
  let n = 0;
  try {
    if (conversationId) {
      const row = getHomesteadDb()
        .prepare("SELECT COUNT(*) as n FROM concierge_photos WHERE conversation_id = ?")
        .get(conversationId) as { n: number } | undefined;
      n = Math.max(n, Number(row?.n || 0));
    }
  } catch {
    n = n;
  }
  try {
    const req = getHomesteadDb()
      .prepare("SELECT photos_json FROM service_requests WHERE public_id = ?")
      .get(leadId) as { photos_json: string } | undefined;
    const photos = JSON.parse(req?.photos_json || "[]") as unknown;
    if (Array.isArray(photos)) n = Math.max(n, photos.length);
  } catch {
    n = n;
  }
  return n;
}

export function isRescueEligible(leadId: string, attentionMs: number) {
  const lead = getLead(leadId);
  if (!lead) return false;
  if (lead.doNotContact) return false;
  if (lead.firstHumanActionAt) return false;
  if (["LOST", "NO_RESPONSE", "NOT_QUALIFIED", "CANCELLED", "WON", "JOB_COMPLETED", "SCHEDULED", "JOB_IN_PROGRESS"].includes(lead.stage)) {
    return false;
  }
  const row = getHomesteadDb()
    .prepare("SELECT dismissed_at, snoozed_until, conversation_id, updated_at, created_at FROM revenue_leads WHERE lead_id = ?")
    .get(leadId) as { dismissed_at: string | null; snoozed_until: string | null; conversation_id: string; updated_at: string; created_at: string } | undefined;
  if (!row) return false;
  if (row.dismissed_at) return false;
  if (row.snoozed_until && row.snoozed_until > nowIso()) return false;
  const open = getHomesteadDb()
    .prepare(`SELECT appointment_id FROM revenue_appointments WHERE lead_id = ? AND status IN ${OPEN_APPT} LIMIT 1`)
    .get(leadId) as { appointment_id: string } | undefined;
  if (open) return false;
  const phone = classifyPhone(lead.phone);
  if (phone.status !== "VALID") return false;
  const photosPresent = countLeadPhotos(leadId, row.conversation_id) > 0;
  const hasIntent =
    lead.temperature === "HOT" ||
    lead.temperature === "WARM" ||
    (lead.service && lead.service !== "unknown" && lead.service !== "other") ||
    (lead.problem || "").trim().length >= 20 ||
    photosPresent;
  if (!hasIntent) return false;
  const activity = lastActivityIso(leadId, row.conversation_id, row.updated_at || row.created_at);
  const activityMs = Date.parse(activity);
  if (!Number.isFinite(activityMs)) return false;
  const lookbackMs = opsConfig().rescueLookbackHours * 3600_000;
  if (activityMs < Date.now() - lookbackMs) return false;
  return activityMs <= Date.now() - attentionMs;
}

export function listRescueDue(attentionMs: number) {
  const ids = getHomesteadDb()
    .prepare(
      `SELECT l.lead_id FROM revenue_leads l
       JOIN revenue_customers c ON c.id = l.customer_id
       WHERE l.dismissed_at IS NULL
         AND l.first_human_action_at IS NULL
         AND l.pipeline_stage NOT IN ${CLOSED_STAGES}
         AND l.pipeline_stage NOT IN ${BOOKED_STAGES}
         AND c.do_not_contact = 0
         AND (l.snoozed_until IS NULL OR l.snoozed_until <= ?)
         AND (l.rescue_alerted_at IS NULL OR l.rescue_alerted_at = '')
         AND NOT EXISTS (
           SELECT 1 FROM revenue_appointments a
           WHERE a.lead_id = l.lead_id AND a.status IN ${OPEN_APPT}
         )
       LIMIT 20`,
    )
    .all(nowIso()) as Array<{ lead_id: string }>;
  return ids.map((row) => getLead(row.lead_id)).filter((lead) => lead && isRescueEligible(lead.leadId, attentionMs));
}

export function markRescueAlerted(leadId: string) {
  const db = getHomesteadDb();
  const row = db.prepare("SELECT rescue_cycle FROM revenue_leads WHERE lead_id = ?").get(leadId) as { rescue_cycle: number } | undefined;
  const cycle = Number(row?.rescue_cycle || 0) + 1;
  const result = db
    .prepare(
      "UPDATE revenue_leads SET rescue_alerted_at = ?, rescue_cycle = ?, updated_at = ? WHERE lead_id = ? AND (rescue_alerted_at IS NULL OR rescue_alerted_at = '')",
    )
    .run(nowIso(), cycle, nowIso(), leadId);
  if (result.changes !== 1) return 0;
  addRevenueEvent(leadId, "LEAD_RESCUE_ELIGIBLE");
  recordOpsAudit({ action: "LEAD_RESCUE_ALERTED", entityType: "lead", entityId: leadId, detail: String(cycle) });
  return cycle;
}

export function markRescuedToBooking(leadId: string) {
  const row = getHomesteadDb()
    .prepare("SELECT rescue_alerted_at, rescued_to_booking FROM revenue_leads WHERE lead_id = ?")
    .get(leadId) as { rescue_alerted_at: string | null; rescued_to_booking: number } | undefined;
  if (!row?.rescue_alerted_at || row.rescued_to_booking) return false;
  getHomesteadDb()
    .prepare("UPDATE revenue_leads SET rescued_to_booking = 1, updated_at = ? WHERE lead_id = ?")
    .run(nowIso(), leadId);
  addRevenueEvent(leadId, "LEAD_RESCUE_BOOKED");
  return true;
}

export function listSlaDue(kind: "first" | "escalation") {
  const cfg = opsConfig();
  const minutes = kind === "first" ? cfg.slaFirstMinutes : cfg.slaEscalationMinutes;
  const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
  const lookback = new Date(Date.now() - cfg.slaLookbackHours * 3600_000).toISOString();
  const extra =
    kind === "first"
      ? "(r.sla_first_alerted_at IS NULL OR r.sla_first_alerted_at = '')"
      : "(r.sla_first_alerted_at IS NOT NULL AND r.sla_first_alerted_at != '' AND (r.sla_escalated_at IS NULL OR r.sla_escalated_at = ''))";
  return getHomesteadDb()
    .prepare(
      `SELECT r.public_id, r.created_at, r.name, r.service, r.message, r.phone, r.photos_json, COALESCE(l.is_test,0) as is_test
       FROM service_requests r
       LEFT JOIN revenue_leads l ON l.lead_id = r.public_id
       WHERE r.status = 'NEW'
         AND r.created_at <= ?
         AND r.created_at >= ?
         AND (r.snoozed_until IS NULL OR r.snoozed_until <= ?)
         AND ${extra}
       LIMIT 20`,
    )
    .all(cutoff, lookback, nowIso()) as Array<{
    public_id: string;
    created_at: string;
    name: string;
    service: string;
    message: string;
    phone: string;
    photos_json: string;
    is_test: number;
  }>;
}

export function markSlaAlerted(publicId: string, kind: "first" | "escalation") {
  const col = kind === "first" ? "sla_first_alerted_at" : "sla_escalated_at";
  const result = getHomesteadDb()
    .prepare(`UPDATE service_requests SET ${col} = ?, updated_at = ? WHERE public_id = ? AND (${col} IS NULL OR ${col} = '')`)
    .run(nowIso(), nowIso(), publicId);
  if (result.changes !== 1) return false;
  recordOpsAudit({
    action: kind === "first" ? "SLA_BREACHED" : "SLA_ESCALATED",
    entityType: "request",
    entityId: publicId,
  });
  if (getLead(publicId)) addRevenueEvent(publicId, kind === "first" ? "SLA_BREACHED" : "SLA_ESCALATED");
  return true;
}

export function markEntityContacted(entityId: string, actor = "telegram") {
  const request = getRequestByPublicId(entityId);
  const slaRow = getHomesteadDb()
    .prepare("SELECT sla_first_alerted_at, status FROM service_requests WHERE public_id = ?")
    .get(entityId) as { sla_first_alerted_at: string | null; status: string } | undefined;
  let already = false;
  if (request) {
    if (request.status !== "NEW") already = true;
    else updateRequestStatus(entityId, "CONTACTED");
  }
  const lead = getLead(entityId);
  const rescueRow = lead
    ? (getHomesteadDb()
        .prepare("SELECT rescue_alerted_at FROM revenue_leads WHERE lead_id = ?")
        .get(entityId) as { rescue_alerted_at: string | null } | undefined)
    : undefined;
  if (lead) {
    if (lead.firstHumanActionAt) already = true;
    markLeadHumanAction(entityId);
    if (lead.stage === "NEW" || lead.stage === "QUALIFIED") setPipeline(entityId, "CONTACTED");
    if (rescueRow?.rescue_alerted_at) addRevenueEvent(entityId, "LEAD_RESCUE_CONTACTED");
  }
  if (!request && !lead) return { ok: false as const, reason: "missing", already: false };
  if (!already && slaRow?.sla_first_alerted_at && slaRow.status === "NEW") {
    recordOpsAudit({ action: "SLA_RECOVERED", actor, entityType: "request", entityId });
    if (lead) addRevenueEvent(entityId, "SLA_RECOVERED");
  }
  recordOpsAudit({
    action: "REQUEST_MARKED_CONTACTED",
    actor,
    entityType: request ? "request" : "lead",
    entityId,
    detail: already ? "already" : "updated",
  });
  return { ok: true as const, already, status: already ? "already_updated" : "contacted" };
}

export function snoozeEntity(entityId: string, minutes: number, actor = "telegram") {
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  const db = getHomesteadDb();
  db.prepare("UPDATE service_requests SET snoozed_until = ?, updated_at = ? WHERE public_id = ?").run(until, nowIso(), entityId);
  db.prepare("UPDATE revenue_leads SET snoozed_until = ?, rescue_alerted_at = NULL, updated_at = ? WHERE lead_id = ?").run(
    until,
    nowIso(),
    entityId,
  );
  recordOpsAudit({ action: "LEAD_SNOOZED", actor, entityType: "lead", entityId, detail: String(minutes) });
  return until;
}

export function dismissLead(entityId: string, actor = "telegram") {
  const lead = getLead(entityId);
  if (!lead) return { ok: false as const, reason: "missing" };
  if (["LOST", "CANCELLED", "WON"].includes(lead.stage)) return { ok: true as const, already: true };
  getHomesteadDb()
    .prepare("UPDATE revenue_leads SET dismissed_at = ?, pipeline_stage = 'LOST', lost_reason = 'DISMISSED_TELEGRAM', next_action = 'NO_ACTION', updated_at = ? WHERE lead_id = ?")
    .run(nowIso(), nowIso(), entityId);
  addRevenueEvent(entityId, "LEAD_RESCUE_DISMISSED");
  recordOpsAudit({ action: "LEAD_DISMISSED", actor, entityType: "lead", entityId });
  return { ok: true as const, already: false };
}

export function listAgenda(ymd: string, includeTest = false) {
  return listAppointments({ from: ymd, to: ymd }).filter(
    (item) => reminderEligibleStatus(item.status) && (includeTest || !getLead(item.leadId)?.isTest),
  );
}

export function upcomingAgenda(includeTest = false) {
  const from = panamaToday().ymd;
  const to = businessYmd(new Date(), 7);
  return listAppointments({ from, to })
    .filter((item) => reminderEligibleStatus(item.status) && (includeTest || !getLead(item.leadId)?.isTest))
    .slice(0, 10);
}

export function todayMetrics(includeTest = false) {
  const { ymd } = panamaToday();
  const start = `${ymd}T00:00:00.000Z`;
  const db = getHomesteadDb();
  const testLead = includeTest ? "1=1" : "COALESCE(l.is_test,0)=0";
  const requests = db
    .prepare(
      `SELECT COUNT(*) as n FROM service_requests r
       LEFT JOIN revenue_leads l ON l.lead_id = r.public_id
       WHERE r.created_at >= ? AND ${testLead}`,
    )
    .get(start) as { n: number };
  const pending = db
    .prepare(
      `SELECT COUNT(*) as n FROM service_requests r
       LEFT JOIN revenue_leads l ON l.lead_id = r.public_id
       WHERE r.status = 'NEW' AND ${testLead}`,
    )
    .get() as { n: number };
  const contacted = db
    .prepare(
      `SELECT COUNT(*) as n FROM service_requests r
       LEFT JOIN revenue_leads l ON l.lead_id = r.public_id
       WHERE r.status IN ('CONTACTED','IN_PROGRESS','COMPLETED') AND r.updated_at >= ? AND ${testLead}`,
    )
    .get(start) as { n: number };
  const createdAppt = db
    .prepare(
      `SELECT COUNT(*) as n FROM revenue_appointments a
       JOIN revenue_leads l ON l.lead_id = a.lead_id
       WHERE a.created_at >= ? AND ${testClause("l", includeTest)}`,
    )
    .get(start) as { n: number };
  const todayAppt = db
    .prepare(
      `SELECT COUNT(*) as n FROM revenue_appointments a
       JOIN revenue_leads l ON l.lead_id = a.lead_id
       WHERE a.date = ? AND a.status IN ${OPEN_APPT} AND ${testClause("l", includeTest)}`,
    )
    .get(ymd) as { n: number };
  const conversion =
    requests.n >= 3 ? Math.round((createdAppt.n / requests.n) * 100) : null;
  return {
    ymd,
    requests: requests.n,
    pending: pending.n,
    contacted: contacted.n,
    appointmentsCreated: createdAppt.n,
    appointmentsToday: todayAppt.n,
    conversionPct: conversion,
  };
}

export function opsEventCounts() {
  const db = getHomesteadDb();
  const count = (event: string) =>
    (db.prepare("SELECT COUNT(*) as n FROM revenue_events WHERE event = ?").get(event) as { n: number }).n;
  return {
    rescueEligible: count("LEAD_RESCUE_ELIGIBLE"),
    rescueContacted: count("LEAD_RESCUE_CONTACTED"),
    rescueBooked: count("LEAD_RESCUE_BOOKED"),
    rescueDismissed: count("LEAD_RESCUE_DISMISSED"),
    slaBreached: count("SLA_BREACHED"),
    slaEscalated: count("SLA_ESCALATED"),
    slaRecovered: count("SLA_RECOVERED"),
  };
}

export { panamaToday };
