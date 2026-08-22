import { randomBytes } from "crypto";
import { getHomesteadDb } from "@/lib/service-requests";
import { classifyPhone } from "@/lib/phone";
import {
  homesteadLeadScore,
  inboxToPipeline,
  isRevenueDryRun,
  nextActionFor,
  revenueConfig,
  type PipelineStage,
} from "@/lib/revenue-score";
import {
  appointmentServiceLabel,
  businessTimezone,
  firstName,
  isAppointmentStatus,
  reminderEligibleStatus,
} from "@/lib/appointment-time";
import { completeServiceJob, createServiceJob } from "@/lib/job-store";

function nowIso() {
  return new Date().toISOString();
}

function yearPanama() {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: businessTimezone(), year: "numeric" }).format(new Date()));
}

function nextNumber(table: "revenue_quote_counters" | "revenue_job_counters", prefix: string) {
  const database = getHomesteadDb();
  const year = yearPanama();
  const row = database.prepare(`SELECT last FROM ${table} WHERE year = ?`).get(year) as { last: number } | undefined;
  const last = row ? row.last + 1 : 1;
  if (row) database.prepare(`UPDATE ${table} SET last = ? WHERE year = ?`).run(last, year);
  else database.prepare(`INSERT INTO ${table} (year, last) VALUES (?, ?)`).run(year, last);
  return `${prefix}-${year}-${String(last).padStart(6, "0")}`;
}

function normalizePhone(phone: string) {
  const assessed = classifyPhone(phone);
  return assessed.digits || phone.replace(/\D/g, "");
}

export function addRevenueEvent(leadId: string, event: string) {
  getHomesteadDb()
    .prepare("INSERT INTO revenue_events (lead_id, event, created_at) VALUES (?, ?, ?)")
    .run(leadId, event, nowIso());
}

export function upsertCustomer(input: {
  name: string;
  phone: string;
  email: string;
  location?: string;
  source: string;
  isTest?: boolean;
}) {
  const digits = normalizePhone(input.phone);
  const national = digits.length === 11 && digits.startsWith("507") ? digits.slice(3) : digits.length === 8 ? digits : "";
  const database = getHomesteadDb();
  const existing = database
    .prepare(
      "SELECT id FROM revenue_customers WHERE phone = ? OR phone = ? OR phone = ? OR phone = ? ORDER BY id ASC LIMIT 1",
    )
    .get(
      digits || input.phone,
      national,
      national ? `507${national}` : digits,
      national ? `+507${national}` : digits,
    ) as { id: number } | undefined;
  if (existing) {
    database
      .prepare(
        "UPDATE revenue_customers SET name = ?, email = ?, general_location = CASE WHEN general_location = '' THEN ? ELSE general_location END, source_last = ? WHERE id = ?",
      )
      .run(input.name, input.email, input.location || "", input.source, existing.id);
    return existing.id;
  }
  const info = database
    .prepare(
      `INSERT INTO revenue_customers
        (created_at, name, phone, email, general_location, preferred_channel, source_first, source_last, do_not_contact, is_test)
       VALUES (?, ?, ?, ?, ?, '', ?, ?, 0, ?)`,
    )
    .run(
      nowIso(),
      input.name,
      classifyPhone(input.phone).e164 || digits || input.phone,
      input.email,
      input.location || "",
      input.source,
      input.source,
      input.isTest ? 1 : 0,
    );
  return Number(info.lastInsertRowid);
}

export function ingestCanonicalLead(input: {
  leadId: string;
  name: string;
  phone: string;
  email: string;
  service: string;
  problem: string;
  photoCount: number;
  source?: string;
  contentId?: string;
  conversationId?: string;
  location?: string;
  preferredDate?: string;
  preferredTimeWindow?: string;
  utm?: Record<string, string>;
  inboxStatus?: string;
  isTest?: boolean;
  skipFollowUp?: boolean;
}) {
  const source = input.source || "WEBSITE_FORM";
  const customerId = upsertCustomer({
    name: input.name,
    phone: input.phone,
    email: input.email,
    location: input.location,
    source,
    isTest: input.isTest,
  });
  const jobs = getHomesteadDb()
    .prepare("SELECT COUNT(*) as n FROM revenue_jobs WHERE customer_id = ?")
    .get(customerId) as { n: number };
  const scored = homesteadLeadScore({
    service: input.service,
    problem: input.problem,
    phone: input.phone,
    location: input.location || "",
    photoCount: input.photoCount,
    returning: jobs.n > 0,
    referral: source === "REFERRAL",
  });
  const stage = inboxToPipeline(input.inboxStatus || "NEW");
  const nextAction = nextActionFor(stage, scored.temperature, false, input.service);
  const database = getHomesteadDb();
  const existing = database.prepare("SELECT lead_id FROM revenue_leads WHERE lead_id = ?").get(input.leadId) as
    | { lead_id: string }
    | undefined;
  const followHours = scored.temperature === "HOT" ? 4 : scored.temperature === "WARM" ? 24 : 72;
  const nextFollow = new Date(Date.now() + followHours * 3600 * 1000).toISOString();
  if (existing) {
    database
      .prepare(
        `UPDATE revenue_leads SET updated_at = ?, temperature = ?, lead_score = ?, next_action = ?, next_follow_up_at = ?,
          general_location = CASE WHEN general_location = '' THEN ? ELSE general_location END,
          conversation_id = CASE WHEN conversation_id = '' THEN ? ELSE conversation_id END,
          preferred_date = CASE WHEN preferred_date = '' THEN ? ELSE preferred_date END,
          preferred_time_window = CASE WHEN preferred_time_window = '' THEN ? ELSE preferred_time_window END
         WHERE lead_id = ?`,
      )
      .run(
        nowIso(),
        scored.temperature,
        scored.score,
        nextAction,
        nextFollow,
        input.location || "",
        input.conversationId || "",
        input.preferredDate || "",
        input.preferredTimeWindow || "",
        input.leadId,
      );
    return { leadId: input.leadId, customerId, ...scored, stage, nextAction, created: false };
  }
  const createdAt = nowIso();
  database
    .prepare(
      `INSERT INTO revenue_leads
        (lead_id, customer_id, created_at, updated_at, source, source_detail, utm_json, content_id, conversation_id,
         service_category, problem_summary, general_location, temperature, lead_score, pipeline_stage, next_action, next_follow_up_at,
         is_test, dry_run, phone_normalized, preferred_date, preferred_time_window, contact_captured_at, lead_created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.leadId,
      customerId,
      createdAt,
      createdAt,
      source,
      "",
      JSON.stringify(input.utm || {}),
      input.contentId || "",
      input.conversationId || "",
      input.service,
      input.problem,
      input.location || "",
      scored.temperature,
      scored.score,
      stage,
      nextAction,
      nextFollow,
      input.isTest ? 1 : 0,
      isRevenueDryRun() ? 1 : 0,
      input.phone.replace(/\D/g, ""),
      input.preferredDate || "",
      input.preferredTimeWindow || "",
      createdAt,
      createdAt,
    );
  addRevenueEvent(input.leadId, "LEAD_CREATED");
  if (scored.temperature === "HOT") addRevenueEvent(input.leadId, "LEAD_QUALIFIED");
  if (!input.skipFollowUp) {
    scheduleFollowUp(input.leadId, "NEW_LEAD", nextFollow, suggestedFollowUp(input.name, input.service));
  }
  return { leadId: input.leadId, customerId, ...scored, stage, nextAction, created: true };
}

export function suggestedFollowUp(name: string, service: string) {
  const who = name.split(" ")[0] || "hola";
  const svc = service && service !== "other" ? ` sobre ${service}` : "";
  return `Hola ${who}, te escribimos de Homestead Services para dar seguimiento${svc}. ¿Pudiste revisar lo que conversamos?`;
}

export function scheduleFollowUp(leadId: string, reason: string, scheduledAt: string, message: string) {
  const open = getHomesteadDb()
    .prepare(
      "SELECT followup_id FROM revenue_followups WHERE lead_id = ? AND reason = ? AND status = 'PENDING' LIMIT 1",
    )
    .get(leadId, reason) as { followup_id: string } | undefined;
  if (open) return open.followup_id;
  const count = getHomesteadDb()
    .prepare("SELECT COUNT(*) as n FROM revenue_followups WHERE lead_id = ?")
    .get(leadId) as { n: number };
  if (count.n >= revenueConfig.maxFollowUps) return "";
  const id = `FU-${randomBytes(4).toString("hex")}`;
  getHomesteadDb()
    .prepare(
      `INSERT INTO revenue_followups
        (followup_id, lead_id, reason, scheduled_at, channel, status, attempt, suggested_message, created_at)
       VALUES (?, ?, ?, ?, 'TELEGRAM_INTERNAL', 'PENDING', 1, ?, ?)`,
    )
    .run(id, leadId, reason, scheduledAt, message, nowIso());
  addRevenueEvent(leadId, "FOLLOWUP_SCHEDULED");
  return id;
}

export function stopFollowUps(leadId: string, reason = "STOP") {
  getHomesteadDb()
    .prepare("UPDATE revenue_followups SET status = 'STOPPED', completed_at = ? WHERE lead_id = ? AND status = 'PENDING'")
    .run(nowIso(), leadId);
  getHomesteadDb()
    .prepare("UPDATE revenue_leads SET next_action = 'NO_ACTION', pipeline_stage = CASE WHEN pipeline_stage IN ('WON','JOB_COMPLETED') THEN pipeline_stage ELSE 'LOST' END, lost_reason = ?, updated_at = ? WHERE lead_id = ?")
    .run(reason, nowIso(), leadId);
  getHomesteadDb().prepare("UPDATE revenue_customers SET do_not_contact = 1 WHERE id = (SELECT customer_id FROM revenue_leads WHERE lead_id = ?)").run(leadId);
  addRevenueEvent(leadId, "FOLLOWUP_STOPPED");
}

export function setPipeline(leadId: string, stage: PipelineStage, extra?: { lostReason?: string; quoteId?: string; jobId?: string }) {
  const current = getLead(leadId);
  if (!current) return;
  getHomesteadDb()
    .prepare(
      "UPDATE revenue_leads SET pipeline_stage = ?, next_action = ?, lost_reason = ?, quote_id = ?, job_id = ?, updated_at = ? WHERE lead_id = ?",
    )
    .run(
      stage,
      nextActionFor(stage, current.temperature, current.doNotContact, current.service),
      extra?.lostReason || current.lostReason,
      extra?.quoteId ?? current.quoteId,
      extra?.jobId ?? current.jobId,
      nowIso(),
      leadId,
    );
  addRevenueEvent(leadId, `PIPELINE_${stage}`);
}

export function getLead(leadId: string) {
  const row = getHomesteadDb()
    .prepare(
      `SELECT l.*, c.name, c.phone, c.email, c.do_not_contact
       FROM revenue_leads l JOIN revenue_customers c ON c.id = l.customer_id
       WHERE l.lead_id = ?`,
    )
    .get(leadId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    leadId: String(row.lead_id),
    customerId: Number(row.customer_id),
    name: String(row.name),
    phone: String(row.phone),
    email: String(row.email),
    source: String(row.source),
    service: String(row.service_category),
    problem: String(row.problem_summary),
    temperature: String(row.temperature),
    score: Number(row.lead_score),
    stage: String(row.pipeline_stage) as PipelineStage,
    nextAction: String(row.next_action),
    nextFollowUpAt: row.next_follow_up_at ? String(row.next_follow_up_at) : null,
    quoteId: String(row.quote_id || ""),
    jobId: String(row.job_id || ""),
    lostReason: String(row.lost_reason || ""),
    doNotContact: Boolean(row.do_not_contact),
    isTest: Boolean(row.is_test),
    contentId: String(row.content_id || ""),
    conversationId: String(row.conversation_id || ""),
    location: String(row.general_location || ""),
    preferredDate: String(row.preferred_date || ""),
    preferredTimeWindow: String(row.preferred_time_window || ""),
    contactCapturedAt: row.contact_captured_at ? String(row.contact_captured_at) : null,
    leadCreatedAt: row.lead_created_at ? String(row.lead_created_at) : String(row.created_at),
    internalAlertAt: row.internal_alert_at ? String(row.internal_alert_at) : null,
    firstHumanActionAt: row.first_human_action_at ? String(row.first_human_action_at) : null,
    visitProposedAt: row.visit_proposed_at ? String(row.visit_proposed_at) : null,
    visitConfirmedAt: row.visit_confirmed_at ? String(row.visit_confirmed_at) : null,
    hotRemindedAt: row.hot_reminded_at ? String(row.hot_reminded_at) : null,
  };
}

export function markLeadHumanAction(leadId: string) {
  getHomesteadDb()
    .prepare(
      "UPDATE revenue_leads SET first_human_action_at = COALESCE(first_human_action_at, ?), hot_reminded_at = ?, updated_at = ? WHERE lead_id = ?",
    )
    .run(nowIso(), nowIso(), nowIso(), leadId);
}

export function markLeadAlerted(leadId: string) {
  const current = getLead(leadId);
  if (!current || current.internalAlertAt) return false;
  getHomesteadDb()
    .prepare("UPDATE revenue_leads SET internal_alert_at = ?, updated_at = ? WHERE lead_id = ? AND internal_alert_at IS NULL")
    .run(nowIso(), nowIso(), leadId);
  addRevenueEvent(leadId, "TELEGRAM_ALERTED");
  return true;
}

export function saveLeadPreference(leadId: string, preferredDate: string, preferredTimeWindow: string) {
  getHomesteadDb()
    .prepare(
      "UPDATE revenue_leads SET preferred_date = ?, preferred_time_window = ?, updated_at = ? WHERE lead_id = ?",
    )
    .run(preferredDate, preferredTimeWindow, nowIso(), leadId);
  addRevenueEvent(leadId, "SCHEDULING_PREFERENCE");
}

export function setOperatorPending(chatId: string, leadId: string, expect: string) {
  getHomesteadDb()
    .prepare(
      `INSERT INTO revenue_operator_pending (chat_id, lead_id, expect, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET lead_id = excluded.lead_id, expect = excluded.expect, created_at = excluded.created_at`,
    )
    .run(chatId, leadId, expect, nowIso());
}

export function getOperatorPending(chatId: string) {
  return getHomesteadDb()
    .prepare("SELECT chat_id, lead_id, expect FROM revenue_operator_pending WHERE chat_id = ?")
    .get(chatId) as { chat_id: string; lead_id: string; expect: string } | undefined;
}

export function clearOperatorPending(chatId: string) {
  getHomesteadDb().prepare("DELETE FROM revenue_operator_pending WHERE chat_id = ?").run(chatId);
}

export function listUnattendedHotLeads(attentionMs: number) {
  const cutoff = new Date(Date.now() - attentionMs).toISOString();
  const rows = getHomesteadDb()
    .prepare(
      `SELECT l.lead_id FROM revenue_leads l
       JOIN revenue_customers c ON c.id = l.customer_id
       WHERE l.temperature = 'HOT'
         AND l.pipeline_stage IN ('NEW','QUALIFIED')
         AND l.next_action != 'NO_ACTION'
         AND l.first_human_action_at IS NULL
         AND l.created_at <= ?
         AND (l.hot_reminded_at IS NULL OR l.hot_reminded_at = '')
         AND c.do_not_contact = 0`,
    )
    .all(cutoff) as Array<{ lead_id: string }>;
  return rows.map((row) => getLead(row.lead_id)).filter(Boolean);
}

export function markHotReminded(leadId: string) {
  getHomesteadDb()
    .prepare("UPDATE revenue_leads SET hot_reminded_at = ?, updated_at = ? WHERE lead_id = ?")
    .run(nowIso(), nowIso(), leadId);
}

export function snoozeHotLead(leadId: string, minutes: number) {
  const when = new Date(Date.now() + minutes * 60_000).toISOString();
  getHomesteadDb()
    .prepare("UPDATE revenue_leads SET next_follow_up_at = ?, hot_reminded_at = NULL, updated_at = ? WHERE lead_id = ?")
    .run(when, nowIso(), leadId);
}

export function listLeads(filter?: { temperature?: string; stage?: string; limit?: number }) {
  let sql = `SELECT l.lead_id FROM revenue_leads l WHERE l.is_test = 0`;
  const args: Array<string | number> = [];
  if (filter?.temperature) {
    sql += " AND l.temperature = ?";
    args.push(filter.temperature);
  }
  if (filter?.stage) {
    sql += " AND l.pipeline_stage = ?";
    args.push(filter.stage);
  }
  sql += " ORDER BY l.lead_score DESC, l.created_at DESC LIMIT ?";
  args.push(filter?.limit ?? 20);
  const ids = getHomesteadDb().prepare(sql).all(...args) as Array<{ lead_id: string }>;
  return ids.map((row) => getLead(row.lead_id)).filter(Boolean);
}

export function pendingFollowUps() {
  return getHomesteadDb()
    .prepare(
      `SELECT f.*, l.service_category, c.name FROM revenue_followups f
       JOIN revenue_leads l ON l.lead_id = f.lead_id
       JOIN revenue_customers c ON c.id = l.customer_id
       WHERE f.status = 'PENDING' AND l.is_test = 0
       ORDER BY f.scheduled_at ASC LIMIT 20`,
    )
    .all() as Array<{
    followup_id: string;
    lead_id: string;
    reason: string;
    scheduled_at: string;
    suggested_message: string;
    name: string;
    service_category: string;
  }>;
}

export function createQuoteDraft(leadId: string) {
  const lead = getLead(leadId);
  if (!lead) return null;
  if (lead.quoteId) {
    const existing = getHomesteadDb()
      .prepare("SELECT quote_id, quote_number, pricing_status, status FROM revenue_quotes WHERE quote_id = ?")
      .get(lead.quoteId) as { quote_id: string; quote_number: string; pricing_status: string; status: string } | undefined;
    if (existing) return existing;
  }
  const quoteNumber = nextNumber("revenue_quote_counters", "HQ");
  const quoteId = quoteNumber;
  const valid = new Date(Date.now() + revenueConfig.quoteValidityDays * 86400000).toISOString();
  getHomesteadDb()
    .prepare(
      `INSERT INTO revenue_quotes
        (quote_id, quote_number, lead_id, customer_id, created_at, valid_until, items_json, status, pricing_status, notes, version)
       VALUES (?, ?, ?, ?, ?, ?, '[]', 'DRAFT', 'NEEDS_MANUAL_PRICING', ?, 1)`,
    )
    .run(
      quoteId,
      quoteNumber,
      leadId,
      lead.customerId,
      nowIso(),
      valid,
      `Alcance: ${lead.problem || lead.service}. Precio pendiente de captura manual. La IA no define tarifas.`,
    );
  setPipeline(leadId, "QUOTE_PREPARATION", { quoteId });
  addRevenueEvent(leadId, "QUOTE_CREATED");
  return { quote_id: quoteId, quote_number: quoteNumber, pricing_status: "NEEDS_MANUAL_PRICING", status: "DRAFT" };
}

export function markQuoteSent(quoteId: string) {
  const row = getHomesteadDb()
    .prepare("SELECT lead_id, pricing_status FROM revenue_quotes WHERE quote_id = ?")
    .get(quoteId) as { lead_id: string; pricing_status: string } | undefined;
  if (!row) return null;
  if (row.pricing_status === "NEEDS_MANUAL_PRICING") return { error: "NEEDS_MANUAL_PRICING" as const };
  getHomesteadDb()
    .prepare("UPDATE revenue_quotes SET status = 'SENT', sent_at = ? WHERE quote_id = ?")
    .run(nowIso(), quoteId);
  setPipeline(row.lead_id, "QUOTE_SENT");
  const lead = getLead(row.lead_id);
  if (lead) scheduleFollowUp(row.lead_id, "QUOTE_SENT", new Date(Date.now() + 48 * 3600 * 1000).toISOString(), suggestedFollowUp(lead.name, lead.service));
  addRevenueEvent(row.lead_id, "QUOTE_SENT");
  return { ok: true };
}

export function acceptQuote(quoteId: string) {
  const row = getHomesteadDb()
    .prepare("SELECT lead_id FROM revenue_quotes WHERE quote_id = ?")
    .get(quoteId) as { lead_id: string } | undefined;
  if (!row) return null;
  getHomesteadDb()
    .prepare("UPDATE revenue_quotes SET status = 'ACCEPTED', accepted_at = ? WHERE quote_id = ?")
    .run(nowIso(), quoteId);
  getHomesteadDb()
    .prepare("UPDATE revenue_followups SET status = 'STOPPED', completed_at = ? WHERE lead_id = ? AND status = 'PENDING'")
    .run(nowIso(), row.lead_id);
  setPipeline(row.lead_id, "SCHEDULED");
  addRevenueEvent(row.lead_id, "QUOTE_ACCEPTED");
  return row.lead_id;
}

export function latestAppointment(leadId: string) {
  return getHomesteadDb()
    .prepare(
      `SELECT appointment_id, date, start_time, status FROM revenue_appointments
       WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(leadId) as { appointment_id: string; date: string; start_time: string; status: string } | undefined;
}

const APPOINTMENT_SELECT = `a.appointment_id, a.lead_id, a.customer_id, a.job_id, a.date, a.start_time, a.end_time,
  a.service, a.status, a.assigned_to, a.created_at, a.confirmed_at, a.version, a.notes, a.source,
  l.conversation_id, l.quote_id, l.problem_summary, l.general_location as lead_location,
  l.pipeline_stage, l.source as lead_source, c.name, c.phone, c.email, c.general_location as customer_location`;

export type AppointmentRecord = {
  appointmentId: string;
  leadId: string;
  customerId: number;
  jobId: string;
  date: string;
  startTime: string;
  endTime: string;
  service: string;
  serviceLabel: string;
  status: string;
  assignedTo: string;
  createdAt: string;
  confirmedAt: string | null;
  version: number;
  notes: string;
  source: string;
  originLabel: string;
  conversationId: string;
  quoteId: string;
  problem: string;
  zone: string;
  stage: string;
  customerName: string;
  customerFirst: string;
  phone: string;
  email: string;
};

function originLabel(source: string, leadSource: string) {
  const value = source || leadSource || "";
  if (value === "CHAT" || value === "WEBSITE_AI_CHAT") return "Chatbot";
  if (value === "FORM" || value === "WEBSITE_FORM") return "Formulario";
  if (value === "TELEGRAM") return "Telegram";
  if (value === "ADMIN") return "Admin";
  return value || "Homestead";
}

function mapAppointment(row: Record<string, unknown>): AppointmentRecord {
  const name = String(row.name || "");
  const service = String(row.service || "");
  const problem = String(row.problem_summary || "");
  const source = String(row.source || "");
  return {
    appointmentId: String(row.appointment_id),
    leadId: String(row.lead_id),
    customerId: Number(row.customer_id),
    jobId: String(row.job_id || ""),
    date: String(row.date),
    startTime: String(row.start_time),
    endTime: String(row.end_time || ""),
    service,
    serviceLabel: appointmentServiceLabel(service, problem),
    status: String(row.status),
    assignedTo: String(row.assigned_to || ""),
    createdAt: String(row.created_at),
    confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null,
    version: Number(row.version || 1),
    notes: String(row.notes || ""),
    source,
    originLabel: originLabel(source, String(row.lead_source || "")),
    conversationId: String(row.conversation_id || ""),
    quoteId: String(row.quote_id || ""),
    problem,
    zone: String(row.lead_location || row.customer_location || ""),
    stage: String(row.pipeline_stage || ""),
    customerName: name,
    customerFirst: firstName(name),
    phone: String(row.phone || ""),
    email: String(row.email || ""),
  };
}

export function createAppointment(
  leadId: string,
  date: string,
  startTime: string,
  status = "PROPOSED",
  extra: { notes?: string; source?: string } = {},
) {
  const lead = getLead(leadId);
  if (!lead) return null;
  const normalized = isAppointmentStatus(status) ? status : "PROPOSED";
  const database = getHomesteadDb();
  const openSameLead = database
    .prepare(
      `SELECT appointment_id FROM revenue_appointments
       WHERE lead_id = ? AND date = ? AND start_time = ? AND status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED') LIMIT 1`,
    )
    .get(leadId, date, startTime) as { appointment_id: string } | undefined;
  if (openSameLead) return openSameLead.appointment_id;
  const taken = database
    .prepare(
      `SELECT appointment_id, lead_id FROM revenue_appointments
       WHERE date = ? AND start_time = ? AND status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED') LIMIT 1`,
    )
    .get(date, startTime) as { appointment_id: string; lead_id: string } | undefined;
  if (taken) return null;
  const id = `HA-${randomBytes(4).toString("hex")}`;
  try {
    database
      .prepare(
        `INSERT INTO revenue_appointments
          (appointment_id, lead_id, customer_id, date, start_time, service, status, created_at, notes, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        leadId,
        lead.customerId,
        date,
        startTime,
        lead.service,
        normalized,
        nowIso(),
        extra.notes || "",
        extra.source || "",
      );
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
    if (code === "SQLITE_CONSTRAINT_UNIQUE" || /UNIQUE/i.test(String(error))) return null;
    throw error;
  }
  database
    .prepare("UPDATE revenue_leads SET visit_proposed_at = COALESCE(visit_proposed_at, ?), updated_at = ? WHERE lead_id = ?")
    .run(nowIso(), nowIso(), leadId);
  addRevenueEvent(leadId, normalized === "REQUESTED" ? "APPOINTMENT_REQUESTED" : "APPOINTMENT_CREATED");
  void import("@/lib/ops-store").then((mod) => mod.markRescuedToBooking(leadId)).catch(() => undefined);
  return id;
}

export function getAppointment(appointmentId: string) {
  const row = getHomesteadDb()
    .prepare(
      `SELECT ${APPOINTMENT_SELECT}
       FROM revenue_appointments a
       JOIN revenue_leads l ON l.lead_id = a.lead_id
       JOIN revenue_customers c ON c.id = a.customer_id
       WHERE a.appointment_id = ?`,
    )
    .get(appointmentId) as Record<string, unknown> | undefined;
  return row ? mapAppointment(row) : null;
}

export function listAppointments(input: { from?: string; to?: string; status?: string; service?: string; assignedTo?: string } = {}) {
  const clauses = ["1=1"];
  const params: Array<string> = [];
  if (input.from) {
    clauses.push("a.date >= ?");
    params.push(input.from);
  }
  if (input.to) {
    clauses.push("a.date <= ?");
    params.push(input.to);
  }
  if (input.status && input.status !== "ALL") {
    clauses.push("a.status = ?");
    params.push(input.status);
  }
  if (input.service) {
    clauses.push("a.service = ?");
    params.push(input.service);
  }
  if (input.assignedTo) {
    clauses.push("a.assigned_to = ?");
    params.push(input.assignedTo);
  }
  const rows = getHomesteadDb()
    .prepare(
      `SELECT ${APPOINTMENT_SELECT}
       FROM revenue_appointments a
       JOIN revenue_leads l ON l.lead_id = a.lead_id
       JOIN revenue_customers c ON c.id = a.customer_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY a.date ASC, a.start_time ASC`,
    )
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map(mapAppointment);
}

export function listReminderAppointments() {
  return listAppointments().filter((item) => reminderEligibleStatus(item.status));
}

export function setAppointmentStatus(appointmentId: string, status: string) {
  if (!isAppointmentStatus(status)) return null;
  const current = getAppointment(appointmentId);
  if (!current) return null;
  getHomesteadDb()
    .prepare("UPDATE revenue_appointments SET status = ?, confirmed_at = CASE WHEN ? = 'CONFIRMED' THEN ? ELSE confirmed_at END WHERE appointment_id = ?")
    .run(status, status, nowIso(), appointmentId);
  if (status === "CONFIRMED") {
    getHomesteadDb()
      .prepare("UPDATE revenue_leads SET visit_confirmed_at = ?, pipeline_stage = 'SCHEDULED', updated_at = ? WHERE lead_id = ?")
      .run(nowIso(), nowIso(), current.leadId);
  }
  addRevenueEvent(current.leadId, `APPOINTMENT_${status}`);
  return current.leadId;
}

export function rescheduleAppointment(appointmentId: string, date: string, startTime: string) {
  const current = getAppointment(appointmentId);
  if (!current) return null;
  if (current.status === "CANCELLED" || current.status === "COMPLETED") return null;
  const nextStatus = current.status === "CONFIRMED" || current.status === "RESCHEDULED" ? "RESCHEDULED" : current.status;
  getHomesteadDb()
    .prepare(
      `UPDATE revenue_appointments
       SET date = ?, start_time = ?, status = ?, version = version + 1
       WHERE appointment_id = ?`,
    )
    .run(date, startTime, nextStatus, appointmentId);
  addRevenueEvent(current.leadId, "APPOINTMENT_RESCHEDULED");
  return { ...current, date, startTime, status: nextStatus, version: current.version + 1, previousDate: current.date, previousTime: current.startTime };
}

export function releaseAppointmentNotice(noticeKey: string) {
  getHomesteadDb().prepare("DELETE FROM revenue_appointment_notices WHERE notice_key = ?").run(noticeKey);
}

export function claimAppointmentNotice(noticeKey: string, appointmentId: string, eventType: string, version: number) {
  const result = getHomesteadDb()
    .prepare(
      `INSERT OR IGNORE INTO revenue_appointment_notices
        (notice_key, appointment_id, event_type, version, sent_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(noticeKey, appointmentId, eventType, version, nowIso());
  return result.changes === 1;
}

export function createJobFromLead(leadId: string) {
  const created = createServiceJob({ leadId, actor: "revenue" });
  return created.jobId || null;
}

export function completeJob(jobId: string, input: { satisfaction: "YES" | "NO" | "UNKNOWN"; photoPermission?: boolean; finalAmount?: number }) {
  const job = getHomesteadDb()
    .prepare("SELECT * FROM revenue_jobs WHERE job_id = ?")
    .get(jobId) as { lead_id: string; customer_id: number; service: string; status: string } | undefined;
  if (!job) return null;
  completeServiceJob(jobId, "revenue", { skipFollowup: input.satisfaction !== "UNKNOWN" });
  getHomesteadDb()
    .prepare("UPDATE revenue_jobs SET satisfaction = ?, photo_permission = ?, final_amount = COALESCE(?, final_amount) WHERE job_id = ?")
    .run(input.satisfaction, input.photoPermission ? 1 : 0, input.finalAmount ?? null, jobId);
  if (input.finalAmount && input.finalAmount > 0) {
    getHomesteadDb().prepare("UPDATE revenue_jobs SET payment_status = 'PAID' WHERE job_id = ?").run(jobId);
    addRevenueEvent(job.lead_id, "PAYMENT_RECORDED");
    setPipeline(job.lead_id, "WON");
    addRevenueEvent(job.lead_id, "JOB_WON");
  }
  if (input.satisfaction === "NO") {
    getHomesteadDb()
      .prepare("UPDATE revenue_leads SET next_action = 'SERVICE_RECOVERY', updated_at = ? WHERE lead_id = ?")
      .run(nowIso(), job.lead_id);
    getHomesteadDb()
      .prepare(
        "UPDATE revenue_jobs SET satisfaction_response = CASE WHEN satisfaction_response = '' THEN 'NEEDS_HELP' ELSE satisfaction_response END, recovery_status = CASE WHEN recovery_status = '' THEN 'OPEN' ELSE recovery_status END, recovery_at = COALESCE(recovery_at, ?) WHERE job_id = ?",
      )
      .run(nowIso(), jobId);
    addRevenueEvent(job.lead_id, "SERVICE_RECOVERY");
    return { recovery: true, review: false };
  }
  if (input.satisfaction === "YES") {
    getHomesteadDb()
      .prepare(
        "UPDATE revenue_jobs SET satisfaction_response = CASE WHEN satisfaction_response = '' THEN 'GOOD' ELSE satisfaction_response END WHERE job_id = ?",
      )
      .run(jobId);
    const reviewId = `RR-${randomBytes(4).toString("hex")}`;
    getHomesteadDb()
      .prepare(
        "INSERT OR IGNORE INTO revenue_reviews (review_id, customer_id, job_id, platform, status, created_at) VALUES (?, ?, ?, '', 'ELIGIBLE', ?)",
      )
      .run(reviewId, job.customer_id, jobId, nowIso());
    addRevenueEvent(job.lead_id, "REVIEW_ELIGIBLE");
    return { recovery: false, review: true };
  }
  return { recovery: false, review: false };
}

export function revenueSnapshot() {
  const database = getHomesteadDb();
  const count = (sql: string) => (database.prepare(sql).get() as { n: number }).n;
  return {
    hot: count("SELECT COUNT(*) as n FROM revenue_leads WHERE temperature = 'HOT' AND pipeline_stage NOT IN ('WON','LOST','CANCELLED') AND is_test = 0"),
    followups: count("SELECT COUNT(*) as n FROM revenue_followups WHERE status = 'PENDING'"),
    quotes: count("SELECT COUNT(*) as n FROM revenue_quotes WHERE status IN ('DRAFT','READY_FOR_REVIEW','SENT')"),
    scheduled: count("SELECT COUNT(*) as n FROM revenue_appointments WHERE status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED')"),
    reviews: count("SELECT COUNT(*) as n FROM revenue_reviews WHERE status = 'ELIGIBLE'"),
    maintenance: count("SELECT COUNT(*) as n FROM revenue_maintenance WHERE status = 'OPEN'"),
    leads: count("SELECT COUNT(*) as n FROM revenue_leads WHERE is_test = 0"),
    won: count("SELECT COUNT(*) as n FROM revenue_leads WHERE pipeline_stage = 'WON' AND is_test = 0"),
    quotedRevenue: (database.prepare("SELECT COALESCE(SUM(total),0) as n FROM revenue_quotes WHERE total IS NOT NULL").get() as { n: number }).n,
    collectedRevenue: (database.prepare("SELECT COALESCE(SUM(final_amount),0) as n FROM revenue_jobs WHERE payment_status = 'PAID'").get() as { n: number }).n,
  };
}

export function nextBestActions() {
  const recovery = getHomesteadDb()
    .prepare(
      `SELECT lead_id FROM revenue_leads WHERE next_action = 'SERVICE_RECOVERY' AND is_test = 0 LIMIT 3`,
    )
    .all() as Array<{ lead_id: string }>;
  const hot = listLeads({ temperature: "HOT", limit: 5 }).filter(
    (lead) => lead && ["NEW", "QUALIFIED", "CONTACTED"].includes(lead.stage),
  );
  const quotes = getHomesteadDb()
    .prepare("SELECT lead_id FROM revenue_leads WHERE pipeline_stage = 'QUOTE_SENT' AND is_test = 0 LIMIT 5")
    .all() as Array<{ lead_id: string }>;
  const actions: Array<{ type: string; leadId: string; why: string; ifWait: string }> = [];
  for (const row of recovery) {
    const lead = getLead(row.lead_id);
    if (lead) {
      actions.push({
        type: "SERVICE_RECOVERY",
        leadId: lead.leadId,
        why: `${lead.name} quedó insatisfecho. Recuperar el servicio va antes que marketing.`,
        ifWait: "El problema puede empeorar y perderemos reseña y referido.",
      });
    }
  }
  for (const lead of hot) {
    if (!lead) continue;
    actions.push({
      type: "CONTACT_HOT_LEAD",
      leadId: lead.leadId,
      why: `${lead.name} tiene intención alta (${lead.score}) en ${lead.service || "servicio"} y sigue en ${lead.stage}.`,
      ifWait: "Un lead caliente se enfría si no hay contacto el mismo día.",
    });
  }
  for (const row of quotes) {
    const lead = getLead(row.lead_id);
    if (lead) {
      actions.push({
        type: "FOLLOW_UP_QUOTE",
        leadId: lead.leadId,
        why: `Cotización pendiente para ${lead.name}.`,
        ifWait: "Sin seguimiento, cotizaciones abiertas se pierden por silencio.",
      });
    }
  }
  if (!actions.length) {
    actions.push({
      type: "NO_ACTION",
      leadId: "",
      why: "No hay prioridades comerciales abiertas en el pipeline.",
      ifWait: "Sigue captando solicitudes; no hay que forzar actividad.",
    });
  }
  return actions.slice(0, 5);
}

export function backfillFromServiceRequests() {
  const rows = getHomesteadDb()
    .prepare("SELECT public_id, name, phone, email, service, message, photos_json, status FROM service_requests")
    .all() as Array<{
    public_id: string;
    name: string;
    phone: string;
    email: string;
    service: string;
    message: string;
    photos_json: string;
    status: string;
  }>;
  let created = 0;
  for (const row of rows) {
    const photos = JSON.parse(row.photos_json || "[]") as unknown[];
    const source = row.message.includes("[Asistente web") ? "WEBSITE_AI_CHAT" : "WEBSITE_FORM";
    const result = ingestCanonicalLead({
      leadId: row.public_id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      service: row.service,
      problem: row.message,
      photoCount: photos.length,
      source,
      inboxStatus: row.status,
      skipFollowUp: true,
    });
    if (result.created) created += 1;
  }
  return { total: rows.length, created };
}

export function weeklyFunnel() {
  const snap = revenueSnapshot();
  const leads = snap.leads || 0;
  const quotes = snap.quotes || 0;
  const won = snap.won || 0;
  const rate = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 1000) / 10);
  return {
    ...snap,
    leadToQuote: rate(quotes, leads),
    quoteToWon: rate(won, quotes),
    leadToWon: rate(won, leads),
  };
}
