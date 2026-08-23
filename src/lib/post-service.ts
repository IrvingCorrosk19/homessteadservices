import { randomBytes } from "crypto";
import { getHomesteadDb, customerWhatsAppUrl } from "@/lib/service-requests";
import { addRevenueEvent, getLead } from "@/lib/revenue-store";
import { enqueueOutbox } from "@/lib/automation-outbox";
import { adminChatIds } from "@/lib/content-telegram";
import { isMailConfigured, sendTransactionalEmail } from "@/lib/mail";
import {
  configuredReviewUrl,
  isPositiveSatisfaction,
  isSatisfactionResponse,
  jobConfig,
  type SatisfactionResponse,
} from "@/lib/job-config";
import {
  adminJobUrl,
  firstNameOf,
  getServiceJob,
  markFollowupFailed,
  markFollowupSent,
  markFollowupSkipped,
  type ServiceJob,
} from "@/lib/job-store";
import { buildPostServiceEmail, buildReviewRequestEmail } from "@/lib/post-service-email";
import { site } from "@/lib/site";
import {
  canSendMarketingRetention,
  canSendTransactionalAftercare,
  classifyRecoveryPriority,
  recordMarketingContact,
} from "@/lib/retention-engine";

const TOKEN_RE = /^[a-f0-9]{64}$/;

function nowIso() {
  return new Date().toISOString();
}

function audit(action: string, jobId: string, actor = "system", detail = "") {
  getHomesteadDb()
    .prepare(
      "INSERT INTO ops_audit (action, actor, entity_type, entity_id, detail, created_at) VALUES (?, ?, 'job', ?, ?, ?)",
    )
    .run(action, actor.slice(0, 40), jobId, detail.slice(0, 180), nowIso());
}

function issueToken(jobId: string, cycle: number) {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + jobConfig().tokenTtlHours * 3600_000).toISOString();
  getHomesteadDb()
    .prepare(
      `INSERT INTO job_feedback_tokens (token, job_id, cycle, expires_at, used_at, response, created_at)
       VALUES (?, ?, ?, ?, NULL, '', ?)`,
    )
    .run(token, jobId, cycle, expires, nowIso());
  return token;
}

export function feedbackUrl(token: string) {
  return `${site.url.replace(/\/$/, "")}/experiencia/${token}`;
}

export function reviewRedirectUrl(token: string) {
  return `${site.url.replace(/\/$/, "")}/experiencia/${token}/resena`;
}

export function getFeedbackToken(token: string) {
  if (!TOKEN_RE.test(token)) return null;
  const row = getHomesteadDb()
    .prepare(
      "SELECT token, job_id, cycle, expires_at, used_at, response, created_at FROM job_feedback_tokens WHERE token = ?",
    )
    .get(token) as
    | {
        token: string;
        job_id: string;
        cycle: number;
        expires_at: string;
        used_at: string | null;
        response: string;
        created_at: string;
      }
    | undefined;
  return row || null;
}

export function getSatisfactionPage(token: string) {
  const row = getFeedbackToken(token);
  if (!row) return { ok: false as const, reason: "invalid" };
  if (row.expires_at < nowIso()) return { ok: false as const, reason: "expired" };
  const job = getServiceJob(row.job_id);
  if (!job) return { ok: false as const, reason: "missing" };
  return {
    ok: true as const,
    token: row.token,
    job,
    already: Boolean(row.used_at || job.satisfactionResponse),
    response: row.response || job.satisfactionResponse,
    expired: false,
  };
}

export async function deliverPostServiceFollowup(jobId: string) {
  const job = getServiceJob(jobId);
  if (!job) return { ok: false as const, cause: "missing_job" };
  if (job.followupStatus === "SENT") return { ok: true as const, cause: "already_sent" };
  if (job.satisfactionResponse) {
    markFollowupSkipped(jobId, "already_answered");
    return { ok: true as const, cause: "already_answered" };
  }
  if (job.doNotContact) {
    markFollowupSkipped(jobId, "do_not_contact");
    return { ok: true as const, cause: "do_not_contact" };
  }
  const aftercareGate = canSendTransactionalAftercare(job.customerId);
  if (!aftercareGate.ok) {
    markFollowupSkipped(jobId, aftercareGate.reason);
    return { ok: true as const, cause: aftercareGate.reason };
  }
  const email = job.email.trim();
  if (!email || !email.includes("@")) {
    markFollowupSkipped(jobId, "no_email");
    return { ok: true as const, cause: "no_email" };
  }
  if (!isMailConfigured()) {
    markFollowupFailed(jobId, "smtp_not_configured");
    return { ok: false as const, cause: "smtp_not_configured" };
  }
  const cycle = Math.max(1, job.feedbackCycle || 1);
  const existing = getHomesteadDb()
    .prepare(
      "SELECT token FROM job_feedback_tokens WHERE job_id = ? AND cycle = ? AND (used_at IS NULL OR used_at = '') ORDER BY created_at DESC LIMIT 1",
    )
    .get(jobId, cycle) as { token: string } | undefined;
  const token = existing?.token || issueToken(jobId, cycle);
  const first = firstNameOf(job.customerName);
  const emailBody = buildPostServiceEmail({
    firstName: first,
    serviceLabel: job.serviceLabel,
    feedbackUrl: feedbackUrl(token),
    jobNumber: job.jobNumber,
  });
  const sent = await sendTransactionalEmail({
    to: email,
    subject: emailBody.subject,
    text: emailBody.text,
    html: emailBody.html,
  });
  if (!sent.ok) {
    markFollowupFailed(jobId, sent.error);
    return { ok: false as const, cause: sent.error };
  }
  markFollowupSent(jobId);
  return { ok: true as const, cause: "sent" };
}

export function recordSatisfaction(token: string, response: string) {
  if (!isSatisfactionResponse(response)) return { ok: false as const, reason: "invalid_response" };
  const row = getFeedbackToken(token);
  if (!row) return { ok: false as const, reason: "invalid" };
  if (row.expires_at < nowIso()) return { ok: false as const, reason: "expired" };
  const job = getServiceJob(row.job_id);
  if (!job) return { ok: false as const, reason: "missing" };
  if (row.used_at || job.satisfactionResponse) {
    return {
      ok: true as const,
      already: true,
      response: (row.response || job.satisfactionResponse) as SatisfactionResponse,
      reviewUrl: isPositiveSatisfaction(row.response || job.satisfactionResponse) ? configuredReviewUrl() : "",
      needsHelp: (row.response || job.satisfactionResponse) === "NEEDS_HELP",
    };
  }
  const now = nowIso();
  const claimed = getHomesteadDb()
    .prepare(
      "UPDATE job_feedback_tokens SET used_at = ?, response = ? WHERE token = ? AND (used_at IS NULL OR used_at = '')",
    )
    .run(now, response, token);
  if (claimed.changes !== 1) {
    const fresh = getFeedbackToken(token);
    return {
      ok: true as const,
      already: true,
      response: (fresh?.response || job.satisfactionResponse) as SatisfactionResponse,
      reviewUrl: "",
      needsHelp: false,
    };
  }
  const jobClaim = getHomesteadDb()
    .prepare(
      `UPDATE revenue_jobs SET
        satisfaction_response = ?,
        satisfaction_received_at = ?,
        satisfaction = ?,
        feedback_cycle = CASE WHEN feedback_cycle < 1 THEN 1 ELSE feedback_cycle END
       WHERE job_id = ? AND (satisfaction_response = '' OR satisfaction_response IS NULL)`,
    )
    .run(response, now, response === "NEEDS_HELP" ? "NO" : "YES", job.jobId);
  if (jobClaim.changes !== 1) {
    return {
      ok: true as const,
      already: true,
      response: (getServiceJob(job.jobId)?.satisfactionResponse || response) as SatisfactionResponse,
      reviewUrl: "",
      needsHelp: false,
    };
  }
  if (job.leadId) addRevenueEvent(job.leadId, "SATISFACTION_RECEIVED");
  audit("SATISFACTION_RECEIVED", job.jobId, "customer", response);
  if (response === "NEEDS_HELP") {
    openServiceRecovery(job.jobId, "customer indicated needs help");
    return { ok: true as const, already: false, response, reviewUrl: "", needsHelp: true };
  }
  if (response === "NEUTRAL") {
    audit("SATISFACTION_NEUTRAL", job.jobId, "customer");
    return { ok: true as const, already: false, response, reviewUrl: "", needsHelp: false };
  }
  const reviewUrl = maybeRequestReview(job.jobId);
  return { ok: true as const, already: false, response, reviewUrl, needsHelp: false };
}

function openServiceRecovery(jobId: string, problemText = "") {
  const job = getServiceJob(jobId);
  if (!job) return;
  const priority = classifyRecoveryPriority(problemText);
  const opened = getHomesteadDb()
    .prepare(
      `UPDATE revenue_jobs SET recovery_status = 'OPEN', recovery_at = ?, recovery_priority = ?
       WHERE job_id = ? AND (recovery_status = '' OR recovery_status IS NULL)`,
    )
    .run(nowIso(), priority, jobId);
  if (opened.changes !== 1) return;
  if (job.leadId) {
    getHomesteadDb()
      .prepare("UPDATE revenue_leads SET next_action = 'SERVICE_RECOVERY', updated_at = ? WHERE lead_id = ?")
      .run(nowIso(), job.leadId);
    addRevenueEvent(job.leadId, "SERVICE_RECOVERY_REQUESTED");
  }
  audit("SERVICE_RECOVERY_REQUESTED", jobId, "customer", priority);
  const cycle = Math.max(1, job.feedbackCycle || 1);
  const wa = customerWhatsAppUrl(job.phone);
  const chats = adminChatIds("recovery");
  const priorityLabel = priority === "URGENT" ? "🚨 URGENTE" : priority === "HIGH" ? "⚠️ ALTA" : "NORMAL";
  enqueueOutbox(getHomesteadDb(), {
    eventType: "customer.service_recovery_requested",
    correlationId: jobId,
    idempotencyKey: `customer.service_recovery:${jobId}:${cycle}`,
    data: {
      event: "ops.telegram.alert",
      priority: priority === "URGENT" ? "CRITICAL" : "ACTION",
      jobId,
      chats,
      text: [
        "⚠️ CLIENTE REQUIERE ATENCIÓN",
        "",
        job.isTest ? "TEST · no es un cliente real\n" : "",
        `Prioridad: ${priorityLabel}`,
        job.jobNumber,
        job.serviceLabel,
        job.zone ? `📍 ${job.zone}` : "",
        "",
        job.customerName ? `👤 ${job.customerName}` : "",
        job.phone ? `📞 ${job.phone}` : "",
        "",
        "El cliente indicó que necesita ayuda después del servicio.",
        "No se le pidió una reseña.",
      ]
        .filter((line) => line !== "")
        .join("\n"),
      keyboard: [
        [
          ...(wa ? [{ text: "💬 WhatsApp", url: wa }] : []),
          { text: "🌐 Ver trabajo", url: adminJobUrl(jobId) },
        ],
        [
          { text: "✅ Atender", callback_data: `cc:t:${jobId}` },
          { text: "✅ Resolver", callback_data: `cc:rr:${jobId}` },
        ],
        [{ text: "🔧 Detalle", callback_data: `cc:k:${jobId}` }],
      ],
    },
  });
}

function maybeRequestReview(jobId: string) {
  const job = getServiceJob(jobId);
  if (!job) return "";
  if (job.reviewRequestedAt) return configuredReviewUrl();
  if (job.recoveryStatus === "OPEN" || job.recoveryStatus === "CONTACTED") return "";
  const gate = canSendMarketingRetention(job.customerId, "review");
  if (!gate.ok) return "";
  const url = configuredReviewUrl();
  if (!url) return "";
  const now = nowIso();
  const claimed = getHomesteadDb()
    .prepare(
      "UPDATE revenue_jobs SET review_requested_at = ? WHERE job_id = ? AND (review_requested_at IS NULL OR review_requested_at = '')",
    )
    .run(now, jobId);
  if (claimed.changes !== 1) return url;
  const reviewId = `RR-${jobId.slice(-8)}`;
  getHomesteadDb()
    .prepare(
      "INSERT OR IGNORE INTO revenue_reviews (review_id, customer_id, job_id, platform, status, requested_at, created_at) VALUES (?, ?, ?, 'google', 'REQUESTED', ?, ?)",
    )
    .run(reviewId, job.customerId, jobId, now, now);
  if (job.leadId) addRevenueEvent(job.leadId, "REVIEW_REQUESTED");
  audit("REVIEW_REQUESTED", jobId, "system");
  recordMarketingContact(job.customerId);
  const hours = jobConfig().reviewReminderHours;
  if (hours > 0) {
    enqueueOutbox(getHomesteadDb(), {
      eventType: "review.request_due",
      correlationId: jobId,
      idempotencyKey: `review.reminder:${jobId}:1`,
      nextAttemptAt: new Date(Date.now() + hours * 3600_000).toISOString(),
      data: { event: "review.reminder", jobId },
    });
  }
  return url;
}

export async function deliverReviewReminder(jobId: string) {
  const job = getServiceJob(jobId);
  if (!job) return { ok: true as const, cause: "missing" };
  if (job.recoveryStatus === "OPEN" || job.recoveryStatus === "CONTACTED") {
    return { ok: true as const, cause: "recovery_open" };
  }
  if (!isPositiveSatisfaction(job.satisfactionResponse)) return { ok: true as const, cause: "not_positive" };
  if (job.reviewLinkOpenedAt) return { ok: true as const, cause: "already_opened" };
  if (job.reviewReminderAt) return { ok: true as const, cause: "already_reminded" };
  const gate = canSendMarketingRetention(job.customerId, "review");
  if (!gate.ok) return { ok: true as const, cause: gate.reason };
  const url = configuredReviewUrl();
  if (!url || !job.email.includes("@") || !isMailConfigured()) {
    return { ok: true as const, cause: "not_configured" };
  }
  const tokenRow = getHomesteadDb()
    .prepare("SELECT token FROM job_feedback_tokens WHERE job_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(jobId) as { token: string } | undefined;
  if (!tokenRow) return { ok: true as const, cause: "no_token" };
  const emailBody = buildReviewRequestEmail({
    firstName: firstNameOf(job.customerName),
    reviewUrl: reviewRedirectUrl(tokenRow.token),
  });
  const sent = await sendTransactionalEmail({
    to: job.email,
    subject: emailBody.subject,
    text: emailBody.text,
    html: emailBody.html,
  });
  if (!sent.ok) return { ok: false as const, cause: sent.error };
  getHomesteadDb().prepare("UPDATE revenue_jobs SET review_reminder_at = ? WHERE job_id = ?").run(nowIso(), jobId);
  recordMarketingContact(job.customerId);
  return { ok: true as const, cause: "sent" };
}

export function recordReviewLinkOpened(token: string) {
  const row = getFeedbackToken(token);
  if (!row) return { ok: false as const, url: "" };
  const url = configuredReviewUrl();
  if (!url) return { ok: false as const, url: "" };
  getHomesteadDb()
    .prepare(
      "UPDATE revenue_jobs SET review_link_opened_at = COALESCE(review_link_opened_at, ?) WHERE job_id = ?",
    )
    .run(nowIso(), row.job_id);
  audit("REVIEW_LINK_OPENED", row.job_id, "customer");
  const job = getServiceJob(row.job_id);
  if (job?.leadId) addRevenueEvent(job.leadId, "REVIEW_LINK_OPENED");
  return { ok: true as const, url };
}

export function markRecoveryContacted(jobId: string, actor = "telegram") {
  const job = getServiceJob(jobId);
  if (!job) return { ok: false as const, already: false };
  if (job.recoveryStatus === "CONTACTED") return { ok: true as const, already: true };
  if (job.recoveryStatus === "RESOLVED") return { ok: true as const, already: true };
  if (job.recoveryStatus !== "OPEN") return { ok: false as const, already: false };
  const result = getHomesteadDb()
    .prepare(
      "UPDATE revenue_jobs SET recovery_status = 'CONTACTED', recovery_contacted_at = ? WHERE job_id = ? AND recovery_status = 'OPEN'",
    )
    .run(nowIso(), jobId);
  if (result.changes !== 1) return { ok: true as const, already: true };
  if (job.leadId) {
    const lead = getLead(job.leadId);
    if (lead) addRevenueEvent(job.leadId, "SERVICE_RECOVERY_CONTACTED");
  }
  audit("SERVICE_RECOVERY_CONTACTED", jobId, actor);
  return { ok: true as const, already: false };
}

export function markRecoveryResolved(
  jobId: string,
  actor = "telegram",
  input: { resolutionType?: string; notes?: string } = {},
) {
  const job = getServiceJob(jobId);
  if (!job) return { ok: false as const, already: false, reason: "missing" as const };
  if (job.recoveryStatus === "RESOLVED") return { ok: true as const, already: true };
  if (job.recoveryStatus !== "OPEN" && job.recoveryStatus !== "CONTACTED") {
    return { ok: false as const, already: false, reason: "not_open" as const };
  }
  const now = nowIso();
  const result = getHomesteadDb()
    .prepare(
      `UPDATE revenue_jobs SET
        recovery_status = 'RESOLVED',
        recovery_resolved_at = ?,
        recovery_resolved_by = ?,
        recovery_resolution_type = ?,
        recovery_notes = ?
       WHERE job_id = ? AND recovery_status IN ('OPEN','CONTACTED')`,
    )
    .run(
      now,
      actor.slice(0, 40),
      (input.resolutionType || "OPERATOR").slice(0, 40),
      (input.notes || "").slice(0, 180),
      jobId,
    );
  if (result.changes !== 1) return { ok: true as const, already: true };
  if (job.leadId) addRevenueEvent(job.leadId, "SERVICE_RECOVERY_RESOLVED");
  audit("SERVICE_RECOVERY_RESOLVED", jobId, actor, input.resolutionType || "OPERATOR");
  // Schedule recovery follow-up aftercare (cycle+1) — ask if now OK; no auto-review.
  const cycle = Math.max(1, (job.feedbackCycle || 1) + 1);
  getHomesteadDb()
    .prepare(
      `UPDATE revenue_jobs SET
        feedback_cycle = ?,
        followup_status = 'PENDING',
        followup_due_at = ?,
        followup_sent_at = NULL,
        satisfaction_response = '',
        satisfaction_received_at = NULL
       WHERE job_id = ?`,
    )
    .run(cycle, new Date(Date.now() + 120 * 60_000).toISOString(), jobId);
  enqueueOutbox(getHomesteadDb(), {
    eventType: "post_service.followup_due",
    correlationId: jobId,
    idempotencyKey: `post_service.followup_due:${jobId}:${cycle}`,
    nextAttemptAt: new Date(Date.now() + 120 * 60_000).toISOString(),
    data: { event: "post_service.followup_due", jobId, cycle, aftercare_source: "recovery_followup" },
  });
  return { ok: true as const, already: false };
}

export function followupKind(job: ServiceJob) {
  if (job.recoveryStatus === "OPEN" || job.recoveryStatus === "CONTACTED") return "recovery";
  if (job.followupStatus === "PENDING" || job.followupStatus === "FAILED") return "followup";
  if (isPositiveSatisfaction(job.satisfactionResponse) && !job.reviewRequestedAt && configuredReviewUrl()) {
    return "review";
  }
  return "other";
}
