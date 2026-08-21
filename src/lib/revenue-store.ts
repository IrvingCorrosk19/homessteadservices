import { randomBytes } from "crypto";
import { getHomesteadDb } from "@/lib/service-requests";
import {
  homesteadLeadScore,
  inboxToPipeline,
  isRevenueDryRun,
  nextActionFor,
  revenueConfig,
  type PipelineStage,
} from "@/lib/revenue-score";

function nowIso() {
  return new Date().toISOString();
}

function yearPanama() {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Panama", year: "numeric" }).format(new Date()));
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
  return phone.replace(/\D/g, "");
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
  const database = getHomesteadDb();
  const existing = database
    .prepare("SELECT id FROM revenue_customers WHERE phone = ? ORDER BY id ASC LIMIT 1")
    .get(digits || input.phone) as { id: number } | undefined;
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
      digits || input.phone,
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
    location: "",
    photoCount: input.photoCount,
    returning: jobs.n > 0,
    referral: source === "REFERRAL",
  });
  const stage = inboxToPipeline(input.inboxStatus || "NEW");
  const nextAction = nextActionFor(stage, scored.temperature, false);
  const database = getHomesteadDb();
  const existing = database.prepare("SELECT lead_id FROM revenue_leads WHERE lead_id = ?").get(input.leadId) as
    | { lead_id: string }
    | undefined;
  const followHours = scored.temperature === "HOT" ? 4 : scored.temperature === "WARM" ? 24 : 72;
  const nextFollow = new Date(Date.now() + followHours * 3600 * 1000).toISOString();
  if (existing) {
    database
      .prepare(
        `UPDATE revenue_leads SET updated_at = ?, temperature = ?, lead_score = ?, next_action = ?, next_follow_up_at = ?
         WHERE lead_id = ?`,
      )
      .run(nowIso(), scored.temperature, scored.score, nextAction, nextFollow, input.leadId);
    return { leadId: input.leadId, customerId, ...scored, stage, nextAction, created: false };
  }
  database
    .prepare(
      `INSERT INTO revenue_leads
        (lead_id, customer_id, created_at, updated_at, source, source_detail, utm_json, content_id, conversation_id,
         service_category, problem_summary, temperature, lead_score, pipeline_stage, next_action, next_follow_up_at, is_test, dry_run)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.leadId,
      customerId,
      nowIso(),
      nowIso(),
      source,
      "",
      JSON.stringify(input.utm || {}),
      input.contentId || "",
      input.conversationId || "",
      input.service,
      input.problem,
      scored.temperature,
      scored.score,
      stage,
      nextAction,
      nextFollow,
      input.isTest ? 1 : 0,
      isRevenueDryRun() ? 1 : 0,
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
      nextActionFor(stage, current.temperature, current.doNotContact),
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
  };
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

export function createAppointment(leadId: string, date: string, startTime: string) {
  const lead = getLead(leadId);
  if (!lead) return null;
  const id = `HA-${randomBytes(4).toString("hex")}`;
  getHomesteadDb()
    .prepare(
      `INSERT INTO revenue_appointments
        (appointment_id, lead_id, customer_id, date, start_time, service, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PROPOSED', ?)`,
    )
    .run(id, leadId, lead.customerId, date, startTime, lead.service, nowIso());
  addRevenueEvent(leadId, "APPOINTMENT_CREATED");
  return id;
}

export function createJobFromLead(leadId: string) {
  const lead = getLead(leadId);
  if (!lead) return null;
  if (lead.jobId) return lead.jobId;
  const jobNumber = nextNumber("revenue_job_counters", "HJ");
  getHomesteadDb()
    .prepare(
      `INSERT INTO revenue_jobs
        (job_id, job_number, lead_id, customer_id, quote_id, service, scope, status, payment_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', 'UNPAID', ?)`,
    )
    .run(jobNumber, jobNumber, leadId, lead.customerId, lead.quoteId, lead.service, lead.problem, nowIso());
  setPipeline(leadId, "SCHEDULED", { jobId: jobNumber });
  addRevenueEvent(leadId, "JOB_STARTED");
  return jobNumber;
}

export function completeJob(jobId: string, input: { satisfaction: "YES" | "NO" | "UNKNOWN"; photoPermission?: boolean; finalAmount?: number }) {
  const job = getHomesteadDb()
    .prepare("SELECT * FROM revenue_jobs WHERE job_id = ?")
    .get(jobId) as { lead_id: string; customer_id: number; service: string } | undefined;
  if (!job) return null;
  getHomesteadDb()
    .prepare(
      "UPDATE revenue_jobs SET status = 'COMPLETED', satisfaction = ?, photo_permission = ?, final_amount = ?, completed_at = ? WHERE job_id = ?",
    )
    .run(input.satisfaction, input.photoPermission ? 1 : 0, input.finalAmount ?? null, nowIso(), jobId);
  if (input.finalAmount && input.finalAmount > 0) {
    getHomesteadDb().prepare("UPDATE revenue_jobs SET payment_status = 'PAID' WHERE job_id = ?").run(jobId);
    addRevenueEvent(job.lead_id, "PAYMENT_RECORDED");
    setPipeline(job.lead_id, "WON");
    addRevenueEvent(job.lead_id, "JOB_WON");
  } else {
    setPipeline(job.lead_id, "JOB_COMPLETED");
  }
  addRevenueEvent(job.lead_id, "JOB_COMPLETED");
  if (input.satisfaction === "NO") {
    setPipeline(job.lead_id, "JOB_COMPLETED");
    getHomesteadDb()
      .prepare("UPDATE revenue_leads SET next_action = 'SERVICE_RECOVERY', updated_at = ? WHERE lead_id = ?")
      .run(nowIso(), job.lead_id);
    addRevenueEvent(job.lead_id, "SERVICE_RECOVERY");
    return { recovery: true, review: false };
  }
  if (input.satisfaction === "YES") {
    const reviewId = `RR-${randomBytes(4).toString("hex")}`;
    getHomesteadDb()
      .prepare(
        "INSERT INTO revenue_reviews (review_id, customer_id, job_id, platform, status, created_at) VALUES (?, ?, ?, '', 'ELIGIBLE', ?)",
      )
      .run(reviewId, job.customer_id, jobId, nowIso());
    addRevenueEvent(job.lead_id, "REVIEW_ELIGIBLE");
    const days = (revenueConfig.maintenanceIntervalsDays as Record<string, number>)[job.service] || 0;
    if (days > 0) {
      const when = new Date(Date.now() + days * 86400000).toISOString();
      getHomesteadDb()
        .prepare(
          `INSERT INTO revenue_maintenance
            (opportunity_id, customer_id, lead_id, service, eligible_at, recommended_at, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
        )
        .run(`MO-${randomBytes(4).toString("hex")}`, job.customer_id, job.lead_id, job.service, when, when, nowIso());
      addRevenueEvent(job.lead_id, "MAINTENANCE_CREATED");
    }
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
    scheduled: count("SELECT COUNT(*) as n FROM revenue_appointments WHERE status IN ('PROPOSED','CONFIRMED')"),
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
