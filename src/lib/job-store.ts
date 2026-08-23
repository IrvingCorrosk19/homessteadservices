import { getHomesteadDb } from "@/lib/service-requests";
import {
  addRevenueEvent,
  getAppointment,
  getLead,
  setPipeline,
} from "@/lib/revenue-store";
import { enqueueOutbox } from "@/lib/automation-outbox";
import { appointmentServiceLabel, businessTimezone, businessYmd } from "@/lib/appointment-time";
import { adminChatIds } from "@/lib/content-telegram";
import { revenueConfig } from "@/lib/revenue-score";
import {
  JOB_ID_PATTERN,
  JOB_STATUS_LABELS,
  configuredReviewUrl,
  isJobStatus,
  jobConfig,
  type JobStatus,
} from "@/lib/job-config";
import { site } from "@/lib/site";
import { aftercareDelayMinutesForService } from "@/lib/retention-engine";
import { isQuietHours, nextQuietEndIso } from "@/lib/ops-config";

export { JOB_ID_PATTERN, JOB_STATUS_LABELS, isJobStatus };
export type { JobStatus };

const OPEN_APPT = "('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED')";
const COMPLETABLE = "('SCHEDULED','IN_PROGRESS')";

function nowIso() {
  return new Date().toISOString();
}

function jobAudit(action: string, jobId: string, actor = "system", detail = "") {
  getHomesteadDb()
    .prepare(
      "INSERT INTO ops_audit (action, actor, entity_type, entity_id, detail, created_at) VALUES (?, ?, 'job', ?, ?, ?)",
    )
    .run(action, actor.slice(0, 40), jobId, detail.slice(0, 180), nowIso());
}

function yearPanama() {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: businessTimezone(), year: "numeric" }).format(new Date()),
  );
}

function nextJobNumber() {
  const database = getHomesteadDb();
  const year = yearPanama();
  const row = database.prepare("SELECT last FROM revenue_job_counters WHERE year = ?").get(year) as
    | { last: number }
    | undefined;
  const last = row ? row.last + 1 : 1;
  if (row) database.prepare("UPDATE revenue_job_counters SET last = ? WHERE year = ?").run(last, year);
  else database.prepare("INSERT INTO revenue_job_counters (year, last) VALUES (?, ?)").run(year, last);
  return `HJ-${year}-${String(last).padStart(6, "0")}`;
}

export type ServiceJob = {
  jobId: string;
  jobNumber: string;
  leadId: string;
  customerId: number;
  customerName: string;
  phone: string;
  email: string;
  appointmentId: string;
  quoteId: string;
  service: string;
  serviceLabel: string;
  scope: string;
  status: JobStatus;
  zone: string;
  appointmentDate: string;
  appointmentTime: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  completedBy: string;
  followupDueAt: string | null;
  followupSentAt: string | null;
  followupStatus: string;
  satisfaction: string;
  satisfactionResponse: string;
  satisfactionReceivedAt: string | null;
    reviewRequestedAt: string | null;
    reviewLinkOpenedAt: string | null;
    reviewReminderAt: string | null;
    marketingUsageApproved: boolean;
  recommendedNextServiceAt: string | null;
  sourceContentId: string;
  photoCount: number;
  isTest: boolean;
  recoveryStatus: string;
  recoveryAt: string | null;
  recoveryContactedAt: string | null;
  feedbackCycle: number;
  contentPromptedAt: string | null;
  contentSkippedAt: string | null;
  doNotContact: boolean;
};

function mapJob(row: Record<string, unknown>): ServiceJob {
  const service = String(row.service || "");
  const scope = String(row.scope || "");
  const status = isJobStatus(String(row.status || "")) ? (row.status as JobStatus) : "SCHEDULED";
  return {
    jobId: String(row.job_id),
    jobNumber: String(row.job_number || row.job_id),
    leadId: String(row.lead_id || ""),
    customerId: Number(row.customer_id || 0),
    customerName: String(row.customer_name || ""),
    phone: String(row.phone || ""),
    email: String(row.email || ""),
    appointmentId: String(row.appointment_id || ""),
    quoteId: String(row.quote_id || ""),
    service,
    serviceLabel: appointmentServiceLabel(service, scope),
    scope,
    status,
    zone: String(row.zone || ""),
    appointmentDate: String(row.appointment_date || ""),
    appointmentTime: String(row.appointment_time || ""),
    createdAt: String(row.created_at || ""),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    completedBy: String(row.completed_by || ""),
    followupDueAt: row.followup_due_at ? String(row.followup_due_at) : null,
    followupSentAt: row.followup_sent_at ? String(row.followup_sent_at) : null,
    followupStatus: String(row.followup_status || ""),
    satisfaction: String(row.satisfaction || ""),
    satisfactionResponse: String(row.satisfaction_response || ""),
    satisfactionReceivedAt: row.satisfaction_received_at ? String(row.satisfaction_received_at) : null,
    reviewRequestedAt: row.review_requested_at ? String(row.review_requested_at) : null,
    reviewLinkOpenedAt: row.review_link_opened_at ? String(row.review_link_opened_at) : null,
    reviewReminderAt: row.review_reminder_at ? String(row.review_reminder_at) : null,
    marketingUsageApproved: Boolean(row.marketing_usage_approved),
    recommendedNextServiceAt: row.recommended_next_service_at ? String(row.recommended_next_service_at) : null,
    sourceContentId: String(row.source_content_id || ""),
    photoCount: Number(row.photo_count || 0),
    isTest: Boolean(row.is_test),
    recoveryStatus: String(row.recovery_status || ""),
    recoveryAt: row.recovery_at ? String(row.recovery_at) : null,
    recoveryContactedAt: row.recovery_contacted_at ? String(row.recovery_contacted_at) : null,
    feedbackCycle: Number(row.feedback_cycle || 0),
    contentPromptedAt: row.content_prompted_at ? String(row.content_prompted_at) : null,
    contentSkippedAt: row.content_skipped_at ? String(row.content_skipped_at) : null,
    doNotContact: Boolean(row.do_not_contact),
  };
}

const JOB_SELECT = `j.job_id, j.job_number, j.lead_id, j.customer_id, j.quote_id, j.appointment_id, j.service, j.scope,
  j.status, j.satisfaction, j.created_at, j.completed_at, j.started_at, j.started_by, j.completed_by,
  j.followup_due_at, j.followup_sent_at, j.followup_status, j.satisfaction_response, j.satisfaction_received_at,
  j.review_requested_at, j.review_link_opened_at, j.review_reminder_at, j.marketing_usage_approved, j.recommended_next_service_at,
  j.source_content_id, j.photo_count, j.is_test, j.recovery_status, j.recovery_at, j.recovery_contacted_at,
  j.feedback_cycle, j.content_prompted_at, j.content_skipped_at,
  c.name as customer_name, c.phone, c.email, c.do_not_contact,
  COALESCE(NULLIF(l.general_location,''), NULLIF(c.general_location,''), '') as zone,
  a.date as appointment_date, a.start_time as appointment_time`;

export function getServiceJob(jobId: string) {
  if (!JOB_ID_PATTERN.test(jobId)) return null;
  const row = getHomesteadDb()
    .prepare(
      `SELECT ${JOB_SELECT}
       FROM revenue_jobs j
       JOIN revenue_customers c ON c.id = j.customer_id
       LEFT JOIN revenue_leads l ON l.lead_id = j.lead_id
       LEFT JOIN revenue_appointments a ON a.appointment_id = j.appointment_id
       WHERE j.job_id = ?`,
    )
    .get(jobId) as Record<string, unknown> | undefined;
  return row ? mapJob(row) : null;
}

export function createServiceJob(input: {
  leadId: string;
  appointmentId?: string;
  actor?: string;
}) {
  const lead = getLead(input.leadId);
  if (!lead) return { ok: false as const, reason: "missing_lead", jobId: "" };
  if (lead.jobId && JOB_ID_PATTERN.test(lead.jobId)) {
    if (input.appointmentId) linkJobToAppointment(lead.jobId, input.appointmentId);
    return { ok: true as const, reason: "existing", jobId: lead.jobId };
  }
  const appointment = input.appointmentId ? getAppointment(input.appointmentId) : null;
  if (appointment?.jobId && JOB_ID_PATTERN.test(appointment.jobId)) {
    getHomesteadDb()
      .prepare("UPDATE revenue_leads SET job_id = ?, updated_at = ? WHERE lead_id = ? AND (job_id IS NULL OR job_id = '')")
      .run(appointment.jobId, nowIso(), input.leadId);
    return { ok: true as const, reason: "existing", jobId: appointment.jobId };
  }
  const jobNumber = nextJobNumber();
  const now = nowIso();
  getHomesteadDb()
    .prepare(
      `INSERT INTO revenue_jobs
        (job_id, job_number, lead_id, customer_id, quote_id, appointment_id, service, scope, status, payment_status, created_at, is_test)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', 'UNPAID', ?, ?)`,
    )
    .run(
      jobNumber,
      jobNumber,
      input.leadId,
      lead.customerId,
      lead.quoteId || "",
      input.appointmentId || appointment?.appointmentId || "",
      lead.service,
      lead.problem.slice(0, 400),
      now,
      lead.isTest ? 1 : 0,
    );
  getHomesteadDb()
    .prepare("UPDATE revenue_leads SET job_id = ?, updated_at = ? WHERE lead_id = ?")
    .run(jobNumber, now, input.leadId);
  if (input.appointmentId) linkJobToAppointment(jobNumber, input.appointmentId);
  setPipeline(input.leadId, "SCHEDULED", { jobId: jobNumber });
  addRevenueEvent(input.leadId, "JOB_CREATED");
  jobAudit("JOB_CREATED", jobNumber, input.actor || "system", input.appointmentId || input.leadId);
  return { ok: true as const, reason: "created", jobId: jobNumber };
}

function linkJobToAppointment(jobId: string, appointmentId: string) {
  getHomesteadDb()
    .prepare("UPDATE revenue_appointments SET job_id = ? WHERE appointment_id = ? AND (job_id = '' OR job_id IS NULL)")
    .run(jobId, appointmentId);
  getHomesteadDb()
    .prepare("UPDATE revenue_jobs SET appointment_id = ? WHERE job_id = ? AND (appointment_id = '' OR appointment_id IS NULL)")
    .run(appointmentId, jobId);
}

export function ensureJobForAppointment(appointmentId: string, actor = "system") {
  const appointment = getAppointment(appointmentId);
  if (!appointment) return { ok: false as const, reason: "missing_appointment", jobId: "" };
  if (appointment.jobId && JOB_ID_PATTERN.test(appointment.jobId)) {
    return { ok: true as const, reason: "existing", jobId: appointment.jobId };
  }
  return createServiceJob({ leadId: appointment.leadId, appointmentId, actor });
}

export function ensureJobsForDay(ymd: string, includeTest = false) {
  const rows = getHomesteadDb()
    .prepare(
      `SELECT a.appointment_id FROM revenue_appointments a
       JOIN revenue_leads l ON l.lead_id = a.lead_id
       WHERE a.date = ? AND a.status IN ${OPEN_APPT} AND (${includeTest ? "1=1" : "l.is_test = 0"})
         AND (a.job_id = '' OR a.job_id IS NULL)`,
    )
    .all(ymd) as Array<{ appointment_id: string }>;
  let created = 0;
  for (const row of rows) {
    const result = ensureJobForAppointment(row.appointment_id, "lazy");
    if (result.ok && result.reason === "created") created += 1;
  }
  return created;
}

export function startServiceJob(jobId: string, actor = "telegram") {
  const job = getServiceJob(jobId);
  if (!job) return { ok: false as const, already: false, reason: "missing" };
  if (job.status === "IN_PROGRESS") return { ok: true as const, already: true, reason: "already", job };
  if (job.status !== "SCHEDULED") return { ok: false as const, already: false, reason: "invalid_status", job };
  const now = nowIso();
  const result = getHomesteadDb()
    .prepare(
      `UPDATE revenue_jobs SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, ?), started_by = ?, completed_at = completed_at
       WHERE job_id = ? AND status = 'SCHEDULED'`,
    )
    .run(now, actor.slice(0, 40), jobId);
  if (result.changes !== 1) {
    const fresh = getServiceJob(jobId);
    return { ok: true as const, already: true, reason: "already", job: fresh || job };
  }
  if (job.leadId) {
    setPipeline(job.leadId, "JOB_IN_PROGRESS");
    addRevenueEvent(job.leadId, "JOB_STARTED");
  }
  jobAudit("JOB_STARTED", jobId, actor);
  return { ok: true as const, already: false, reason: "started", job: getServiceJob(jobId)! };
}

export function completeServiceJob(
  jobId: string,
  actor = "telegram",
  options: { skipFollowup?: boolean } = {},
) {
  const job = getServiceJob(jobId);
  if (!job) return { ok: false as const, already: false, reason: "missing", job: null };
  if (job.status === "COMPLETED") return { ok: true as const, already: true, reason: "already", job };
  if (job.status === "CANCELLED" || job.status === "NO_SHOW") {
    return { ok: false as const, already: false, reason: "invalid_status", job };
  }
  const now = nowIso();
  const result = getHomesteadDb()
    .prepare(
      `UPDATE revenue_jobs SET status = 'COMPLETED', completed_at = ?, completed_by = ?
       WHERE job_id = ? AND status IN ${COMPLETABLE}`,
    )
    .run(now, actor.slice(0, 40), jobId);
  if (result.changes !== 1) {
    const fresh = getServiceJob(jobId);
    return { ok: true as const, already: true, reason: "already", job: fresh };
  }
  if (job.leadId) {
    setPipeline(job.leadId, "JOB_COMPLETED");
    addRevenueEvent(job.leadId, "JOB_COMPLETED");
  }
  applyMaintenanceFoundation(jobId);
  jobAudit("JOB_COMPLETED", jobId, actor);
  enqueueJobCompleted(jobId);
  if (!options.skipFollowup) schedulePostServiceFollowup(jobId);
  return { ok: true as const, already: false, reason: "completed", job: getServiceJob(jobId)! };
}

export function cancelServiceJob(jobId: string, reason: "CANCELLED" | "NO_SHOW", actor = "telegram") {
  const now = nowIso();
  const result = getHomesteadDb()
    .prepare(
      `UPDATE revenue_jobs SET status = ?, cancelled_at = ?, cancel_reason = ?
       WHERE job_id = ? AND status IN ${COMPLETABLE}`,
    )
    .run(reason, now, reason, jobId);
  if (result.changes !== 1) {
    const job = getServiceJob(jobId);
    return { ok: Boolean(job && (job.status === reason || job.status === "COMPLETED")), already: true, job };
  }
  const job = getServiceJob(jobId);
  if (job?.leadId) addRevenueEvent(job.leadId, reason === "NO_SHOW" ? "JOB_NO_SHOW" : "JOB_CANCELLED");
  jobAudit(reason === "NO_SHOW" ? "JOB_NO_SHOW" : "JOB_CANCELLED", jobId, actor);
  return { ok: true as const, already: false, job };
}

function applyMaintenanceFoundation(jobId: string) {
  const job = getServiceJob(jobId);
  if (!job) return;
  const days = (revenueConfig.maintenanceIntervalsDays as Record<string, number>)[job.service] || 0;
  if (days <= 0) return;
  const when = new Date(Date.now() + days * 86400000).toISOString();
  getHomesteadDb()
    .prepare(
      `UPDATE revenue_jobs SET recommended_next_service_at = COALESCE(recommended_next_service_at, ?) WHERE job_id = ?`,
    )
    .run(when, jobId);
  const exists = getHomesteadDb()
    .prepare("SELECT opportunity_id FROM revenue_maintenance WHERE lead_id = ? AND service = ? AND status = 'OPEN' LIMIT 1")
    .get(job.leadId, job.service) as { opportunity_id: string } | undefined;
  if (exists) return;
  getHomesteadDb()
    .prepare(
      `INSERT INTO revenue_maintenance
        (opportunity_id, customer_id, lead_id, service, eligible_at, recommended_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
    )
    .run(`MO-${jobId.slice(-8)}`, job.customerId, job.leadId, job.service, when, when, nowIso());
  if (job.leadId) addRevenueEvent(job.leadId, "MAINTENANCE_CREATED");
}

function enqueueJobCompleted(jobId: string) {
  const job = getServiceJob(jobId);
  if (!job) return "";
  const chats = adminChatIds("content");
  const photos = job.photoCount > 0;
  return enqueueOutbox(getHomesteadDb(), {
    eventType: "job.completed",
    correlationId: jobId,
    idempotencyKey: `job.completed:${jobId}`,
    data: {
      event: photos ? "ops.telegram.alert" : "job.completed.recorded",
      priority: "INFO",
      jobId,
      photoCount: job.photoCount,
      chats,
      text: photos
        ? [
            "📸 CONTENIDO DISPONIBLE",
            "",
            job.isTest ? "TEST · no es un cliente real\n" : "",
            `El trabajo ${job.jobNumber} fue completado y tiene ${job.photoCount} ${job.photoCount === 1 ? "foto" : "fotos"}.`,
            "",
            job.serviceLabel,
            job.zone ? `📍 ${job.zone}` : "",
            "",
            "¿Quieres convertirlo en contenido para Homestead?",
            "Homestead no publicará nada hasta que lo apruebes.",
          ]
            .filter((line) => line !== "")
            .join("\n")
        : "",
      keyboard: photos
        ? [
            [
              { text: "✨ Crear contenido", callback_data: `cc:o:${jobId}` },
              { text: "⏭ Ahora no", callback_data: `cc:u:${jobId}` },
            ],
            [{ text: "🔧 Ver trabajo", callback_data: `cc:k:${jobId}` }],
          ]
        : [],
    },
  });
}

export function schedulePostServiceFollowup(jobId: string) {
  const job = getServiceJob(jobId);
  if (!job || job.status !== "COMPLETED") return "";
  if (job.satisfactionResponse) return "";
  const cycle = Math.max(1, job.feedbackCycle || 1);
  const delayMin = aftercareDelayMinutesForService(job.service);
  let dueMs = Date.now() + delayMin * 60_000;
  if (isQuietHours()) {
    const quietEnd = Date.parse(nextQuietEndIso());
    if (Number.isFinite(quietEnd) && quietEnd > dueMs) dueMs = quietEnd;
  }
  const due = new Date(dueMs).toISOString();
  getHomesteadDb()
    .prepare(
      `UPDATE revenue_jobs SET followup_due_at = ?, followup_status = 'PENDING', followup_cycle = CASE WHEN followup_cycle < 1 THEN 1 ELSE followup_cycle END
       WHERE job_id = ? AND (followup_status = '' OR followup_status IS NULL)`,
    )
    .run(due, jobId);
  return enqueueOutbox(getHomesteadDb(), {
    eventType: "post_service.followup_due",
    correlationId: jobId,
    idempotencyKey: `post_service.followup_due:${jobId}:${cycle}`,
    nextAttemptAt: due,
    data: {
      event: "post_service.followup_due",
      jobId,
      cycle,
    },
  });
}

export function markFollowupSent(jobId: string) {
  getHomesteadDb()
    .prepare("UPDATE revenue_jobs SET followup_sent_at = ?, followup_status = 'SENT' WHERE job_id = ?")
    .run(nowIso(), jobId);
  jobAudit("POST_SERVICE_SENT", jobId);
  const job = getServiceJob(jobId);
  if (job?.leadId) addRevenueEvent(job.leadId, "POST_SERVICE_SENT");
}

export function markFollowupFailed(jobId: string, cause: string) {
  getHomesteadDb()
    .prepare("UPDATE revenue_jobs SET followup_status = 'FAILED' WHERE job_id = ? AND followup_status != 'SENT'")
    .run(jobId);
  jobAudit("POST_SERVICE_FAILED", jobId, "system", cause.slice(0, 80));
}

export function markFollowupSkipped(jobId: string, cause: string) {
  getHomesteadDb()
    .prepare("UPDATE revenue_jobs SET followup_status = 'SKIPPED' WHERE job_id = ? AND followup_status != 'SENT'")
    .run(jobId);
  jobAudit("POST_SERVICE_SKIPPED", jobId, "system", cause.slice(0, 80));
}

export function approveMarketingUsage(jobId: string, actor = "telegram") {
  const result = getHomesteadDb()
    .prepare(
      "UPDATE revenue_jobs SET marketing_usage_approved = 1, marketing_usage_approved_at = ? WHERE job_id = ?",
    )
    .run(nowIso(), jobId);
  if (result.changes === 1) {
    jobAudit("JOB_MARKETING_APPROVED", jobId, actor);
  }
  return result.changes === 1;
}

export function markContentPrompted(jobId: string) {
  getHomesteadDb()
    .prepare("UPDATE revenue_jobs SET content_prompted_at = COALESCE(content_prompted_at, ?) WHERE job_id = ?")
    .run(nowIso(), jobId);
}

export function skipJobContent(jobId: string, actor = "telegram") {
  getHomesteadDb()
    .prepare("UPDATE revenue_jobs SET content_skipped_at = COALESCE(content_skipped_at, ?) WHERE job_id = ?")
    .run(nowIso(), jobId);
  jobAudit("JOB_CONTENT_SKIPPED", jobId, actor);
}

export function attachContentJob(jobId: string, contentId: string) {
  getHomesteadDb()
    .prepare("UPDATE revenue_jobs SET source_content_id = ? WHERE job_id = ? AND (source_content_id = '' OR source_content_id IS NULL)")
    .run(contentId, jobId);
}

export function bumpPhotoCount(jobId: string, count: number) {
  getHomesteadDb().prepare("UPDATE revenue_jobs SET photo_count = ? WHERE job_id = ?").run(count, jobId);
  const job = getServiceJob(jobId);
  if (job?.status === "COMPLETED" && count > 0 && !job.sourceContentId && !job.contentSkippedAt && !job.contentPromptedAt) {
    enqueueJobCompleted(jobId);
  }
}

export function listActiveJobs(includeTest = false, offset = 0, limit = jobConfig().pageSize) {
  const ymd = businessYmd(new Date());
  ensureJobsForDay(ymd, includeTest);
  const test = includeTest ? "1=1" : "j.is_test = 0";
  const rows = getHomesteadDb()
    .prepare(
      `SELECT ${JOB_SELECT}
       FROM revenue_jobs j
       JOIN revenue_customers c ON c.id = j.customer_id
       LEFT JOIN revenue_leads l ON l.lead_id = j.lead_id
       LEFT JOIN revenue_appointments a ON a.appointment_id = j.appointment_id
       WHERE ${test}
         AND j.status IN ('SCHEDULED','IN_PROGRESS')
       ORDER BY CASE j.status WHEN 'IN_PROGRESS' THEN 0 ELSE 1 END,
         COALESCE(a.date, '9999-12-31'), COALESCE(a.start_time, '99:99'), j.created_at
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as Array<Record<string, unknown>>;
  return rows.map(mapJob);
}

export function countActiveJobs(includeTest = false) {
  const test = includeTest ? "1=1" : "j.is_test = 0";
  const row = getHomesteadDb()
    .prepare(
      `SELECT COUNT(*) as n FROM revenue_jobs j WHERE ${test} AND j.status IN ('SCHEDULED','IN_PROGRESS')`,
    )
    .get() as { n: number };
  return row.n;
}

export function listAdminJobs(filter: { status?: string; includeTest?: boolean; limit?: number } = {}) {
  const test = filter.includeTest ? "1=1" : "j.is_test = 0";
  const status = filter.status && isJobStatus(filter.status) ? "AND j.status = ?" : "";
  const args: Array<string | number> = [];
  if (status) args.push(filter.status as string);
  args.push(filter.limit ?? 80);
  return (
    getHomesteadDb()
      .prepare(
        `SELECT ${JOB_SELECT}
         FROM revenue_jobs j
         JOIN revenue_customers c ON c.id = j.customer_id
         LEFT JOIN revenue_leads l ON l.lead_id = j.lead_id
         LEFT JOIN revenue_appointments a ON a.appointment_id = j.appointment_id
         WHERE ${test} ${status}
         ORDER BY j.created_at DESC
         LIMIT ?`,
      )
      .all(...args) as Array<Record<string, unknown>>
  ).map(mapJob);
}

export function listFollowups(includeTest = false, offset = 0, limit = jobConfig().pageSize) {
  const test = includeTest ? "1=1" : "j.is_test = 0";
  const rows = getHomesteadDb()
    .prepare(
      `SELECT ${JOB_SELECT}
       FROM revenue_jobs j
       JOIN revenue_customers c ON c.id = j.customer_id
       LEFT JOIN revenue_leads l ON l.lead_id = j.lead_id
       LEFT JOIN revenue_appointments a ON a.appointment_id = j.appointment_id
       WHERE ${test} AND (
         j.recovery_status = 'OPEN'
         OR (j.status = 'COMPLETED' AND j.followup_status IN ('PENDING','FAILED') AND (j.satisfaction_response = '' OR j.satisfaction_response IS NULL))
         OR (j.satisfaction_response IN ('EXCELLENT','GOOD') AND (j.review_requested_at IS NULL OR j.review_requested_at = '') AND ? != '')
       )
       ORDER BY CASE j.recovery_status WHEN 'OPEN' THEN 0 ELSE 1 END, j.completed_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(configuredReviewUrl(), limit, offset) as Array<Record<string, unknown>>;
  return rows.map(mapJob);
}

export function countFollowups(includeTest = false) {
  const test = includeTest ? "1=1" : "j.is_test = 0";
  const row = getHomesteadDb()
    .prepare(
      `SELECT COUNT(*) as n FROM revenue_jobs j WHERE ${test} AND (
         j.recovery_status = 'OPEN'
         OR (j.status = 'COMPLETED' AND j.followup_status IN ('PENDING','FAILED') AND (j.satisfaction_response = '' OR j.satisfaction_response IS NULL))
         OR (j.satisfaction_response IN ('EXCELLENT','GOOD') AND (j.review_requested_at IS NULL OR j.review_requested_at = '') AND ? != '')
       )`,
    )
    .get(configuredReviewUrl()) as { n: number };
  return row.n;
}

export function countServiceRecovery(includeTest = false) {
  const test = includeTest ? "1=1" : "j.is_test = 0";
  const row = getHomesteadDb()
    .prepare(`SELECT COUNT(*) as n FROM revenue_jobs j WHERE ${test} AND j.recovery_status = 'OPEN'`)
    .get() as { n: number };
  return row.n;
}

export function countContentCandidates(includeTest = false) {
  const test = includeTest ? "1=1" : "j.is_test = 0";
  const row = getHomesteadDb()
    .prepare(
      `SELECT COUNT(*) as n FROM revenue_jobs j
       WHERE ${test} AND j.status = 'COMPLETED' AND j.photo_count > 0
         AND (j.source_content_id = '' OR j.source_content_id IS NULL)
         AND (j.content_skipped_at IS NULL OR j.content_skipped_at = '')`,
    )
    .get() as { n: number };
  return row.n;
}

export function jobMetrics(includeTest = false) {
  const test = includeTest ? "1=1" : "is_test = 0";
  const db = getHomesteadDb();
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    jobsPending: count(`SELECT COUNT(*) as n FROM revenue_jobs WHERE ${test} AND status = 'SCHEDULED'`),
    jobsInProgress: count(`SELECT COUNT(*) as n FROM revenue_jobs WHERE ${test} AND status = 'IN_PROGRESS'`),
    jobsCompleted: count(`SELECT COUNT(*) as n FROM revenue_jobs WHERE ${test} AND status = 'COMPLETED'`),
    postServiceDue: count(
      `SELECT COUNT(*) as n FROM revenue_jobs WHERE ${test} AND followup_status = 'PENDING' AND (satisfaction_response = '' OR satisfaction_response IS NULL)`,
    ),
    postServiceSent: count(`SELECT COUNT(*) as n FROM revenue_jobs WHERE ${test} AND followup_status = 'SENT'`),
    serviceRecoveryOpen: count(`SELECT COUNT(*) as n FROM revenue_jobs WHERE ${test} AND recovery_status = 'OPEN'`),
    satisfactionPositive: count(
      `SELECT COUNT(*) as n FROM revenue_jobs WHERE ${test} AND satisfaction_response IN ('EXCELLENT','GOOD')`,
    ),
    reviewRequested: count(
      `SELECT COUNT(*) as n FROM revenue_jobs WHERE ${test} AND review_requested_at IS NOT NULL AND review_requested_at != ''`,
    ),
    reviewLinksOpened: count(
      `SELECT COUNT(*) as n FROM revenue_jobs WHERE ${test} AND review_link_opened_at IS NOT NULL AND review_link_opened_at != ''`,
    ),
    jobContentCreated: count(
      `SELECT COUNT(*) as n FROM revenue_jobs WHERE ${test} AND source_content_id != '' AND source_content_id IS NOT NULL`,
    ),
    jobContentApproved: count(
      `SELECT COUNT(*) as n FROM revenue_jobs j
       JOIN content_jobs c ON c.public_id = j.source_content_id
       WHERE ${test.replace("is_test", "j.is_test")} AND c.status IN ('APPROVED','SCHEDULED','AWAITING_APPROVAL')`,
    ),
    contentCandidates: countContentCandidates(includeTest),
  };
}

export function failedWaveCOutbox() {
  const row = getHomesteadDb()
    .prepare(
      `SELECT COUNT(*) as n FROM automation_outbox
       WHERE status IN ('FAILED','PENDING')
         AND event_type IN ('job.completed','post_service.followup_due','customer.service_recovery_requested','review.request_due','job.content.candidate')`,
    )
    .get() as { n: number };
  return row.n;
}

export function adminJobUrl(jobId: string) {
  return `${site.url.replace(/\/$/, "")}/admin/trabajos/${jobId}`;
}

export function firstNameOf(name: string) {
  const first = name.trim().split(/\s+/)[0] || "";
  if (!first || first.toLowerCase() === "cliente") return "";
  return first;
}
