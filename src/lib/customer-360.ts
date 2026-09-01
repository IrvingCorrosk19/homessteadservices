/**
 * Wave F — Customer 360 (evolves Wave C lite).
 * ONE customer = revenue_customers.id. No customers_v2. No name-only merge.
 */
import { getHomesteadDb } from "@/lib/service-requests";
import { classifyPhone } from "@/lib/phone";
import { SATISFACTION_LABELS } from "@/lib/job-config";
import { appointmentServiceLabel } from "@/lib/appointment-time";
import { migrateCustomerIdentityWaveF, backfillCustomerNormalization } from "@/lib/analytics-service";

export type CustomerSegment = "NEW" | "REPEAT" | "RECOVERY_OPEN" | "MAINTENANCE_DUE" | "INACTIVE" | "LEAD";

export type TimelineEvent = {
  at: string;
  type: string;
  entityType: string;
  entityId: string;
  label: string;
  status?: string;
};

export type Customer360 = {
  customerId: number;
  name: string;
  phone: string;
  email: string;
  location: string;
  doNotContact: boolean;
  marketingOptIn: boolean;
  isTest: boolean;
  sourceFirst: string;
  sourceLast: string;
  createdAt: string;
  normalizedPhone: string;
  emailNormalized: string;
  requests: number;
  appointments: number;
  jobs: number;
  jobsCompleted: number;
  isRepeat: boolean;
  segment: CustomerSegment;
  lastActivityAt: string;
  lastService: { jobId: string; service: string; completedAt: string } | null;
  satisfaction: string;
  recoveryOpen: number;
  reviewRequested: number;
  attribution: {
    firstTouch: string;
    lastTouch: string;
    retentionHint: string;
    contentId: string;
  };
  history: Array<{
    kind: "request" | "appointment" | "job";
    id: string;
    label: string;
    at: string;
    status: string;
  }>;
  timeline: TimelineEvent[];
  possibleDuplicates: Array<{ id: number; name: string; phone: string; match: "CONFIDENT_MATCH" | "POSSIBLE_DUPLICATE" }>;
};

function ensureIdentityMigrated() {
  const db = getHomesteadDb();
  migrateCustomerIdentityWaveF(db);
}

export function listCustomers(input: {
  q?: string;
  segment?: string;
  includeTest?: boolean;
  limit?: number;
  offset?: number;
}) {
  ensureIdentityMigrated();
  backfillCustomerNormalization(200);
  const limit = Math.min(Math.max(input.limit ?? 40, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const includeTest = Boolean(input.includeTest);
  const q = (input.q || "").trim();
  const db = getHomesteadDb();
  const where: string[] = [includeTest ? "1=1" : "c.is_test = 0"];
  const params: Array<string | number> = [];
  if (q) {
    const digits = classifyPhone(q).digits || q.replace(/\D/g, "");
    where.push(
      `(c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR c.normalized_phone LIKE ? OR EXISTS (
         SELECT 1 FROM revenue_leads l WHERE l.customer_id = c.id AND l.lead_id LIKE ?
       ) OR EXISTS (
         SELECT 1 FROM service_requests r
         JOIN revenue_leads l2 ON l2.lead_id = r.public_id
         WHERE l2.customer_id = c.id AND r.public_id LIKE ?
       ))`,
    );
    const like = `%${q}%`;
    params.push(like, like, like, digits ? `%${digits.slice(-8)}%` : like, like, like);
  }
  if (input.segment === "REPEAT") {
    where.push(
      `(SELECT COUNT(*) FROM revenue_jobs j WHERE j.customer_id = c.id AND j.status='COMPLETED') >= 2`,
    );
  } else if (input.segment === "RECOVERY_OPEN") {
    where.push(`EXISTS (SELECT 1 FROM revenue_jobs j WHERE j.customer_id = c.id AND j.recovery_status IN ('OPEN','CONTACTED'))`);
  }
  const sql = `
    SELECT c.id, c.name, c.phone, c.email, c.created_at, c.is_test,
      (SELECT COUNT(*) FROM revenue_jobs j WHERE j.customer_id = c.id AND j.status='COMPLETED') AS jobs_completed,
      (SELECT MAX(x.at) FROM (
         SELECT r.created_at AS at FROM service_requests r JOIN revenue_leads l ON l.lead_id = r.public_id WHERE l.customer_id = c.id
         UNION ALL SELECT a.created_at FROM revenue_appointments a WHERE a.customer_id = c.id
         UNION ALL SELECT j.created_at FROM revenue_jobs j WHERE j.customer_id = c.id
         UNION ALL SELECT j.completed_at FROM revenue_jobs j WHERE j.customer_id = c.id AND j.completed_at IS NOT NULL
       ) x) AS last_activity_at
    FROM revenue_customers c
    WHERE ${where.join(" AND ")}
    ORDER BY COALESCE(last_activity_at, c.created_at) DESC
    LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...params, limit, offset) as Array<{
    id: number;
    name: string;
    phone: string;
    email: string;
    created_at: string;
    is_test: number;
    jobs_completed: number;
    last_activity_at: string | null;
  }>;
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM revenue_customers c WHERE ${where.join(" AND ")}`).get(...params) as {
      n: number;
    }
  ).n;
  return {
    total,
    limit,
    offset,
    rows: rows.map((row) => ({
      customerId: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      createdAt: row.created_at,
      isTest: row.is_test === 1,
      jobsCompleted: row.jobs_completed,
      isRepeat: row.jobs_completed >= 2,
      lastActivityAt: row.last_activity_at || row.created_at,
    })),
  };
}

function mapHistory(
  rows: Array<{ kind: string; id: string; label: string; at: string; status: string }>,
) {
  return rows.map((row) => ({
    kind: row.kind as "request" | "appointment" | "job",
    id: row.id,
    label: row.label,
    at: row.at,
    status: row.status,
  }));
}

function buildTimeline(customerId: number): TimelineEvent[] {
  const db = getHomesteadDb();
  const events: TimelineEvent[] = [];
  const requests = db
    .prepare(
      `SELECT r.public_id, r.created_at, r.service, r.status
       FROM service_requests r
       JOIN revenue_leads l ON l.lead_id = r.public_id
       WHERE l.customer_id = ?`,
    )
    .all(customerId) as Array<{ public_id: string; created_at: string; service: string; status: string }>;
  for (const row of requests) {
    events.push({
      at: row.created_at,
      type: "REQUEST_CREATED",
      entityType: "HS",
      entityId: row.public_id,
      label: appointmentServiceLabel(row.service),
      status: row.status,
    });
  }
  const cancelledRequests = db
    .prepare(
      `SELECT r.public_id, COALESCE(r.cancelled_at, r.updated_at) AS cancelled_at, r.service, r.cancellation_reason, r.cancellation_source, r.status
       FROM service_requests r
       JOIN revenue_leads l ON l.lead_id = r.public_id
       WHERE l.customer_id = ? AND r.status = 'CANCELLED' AND COALESCE(r.cancelled_at, r.updated_at) != ''`,
    )
    .all(customerId) as Array<{
    public_id: string;
    cancelled_at: string;
    service: string;
    cancellation_reason: string;
    cancellation_source: string;
    status: string;
  }>;
  for (const row of cancelledRequests) {
    const reason = (row.cancellation_reason || "").trim();
    events.push({
      at: row.cancelled_at,
      type: "REQUEST_CANCELLED",
      entityType: "HS",
      entityId: row.public_id,
      label: reason
        ? `Solicitud ${row.public_id} cancelada. ${reason.slice(0, 80)}`
        : `Solicitud ${row.public_id} cancelada.`,
      status: row.status,
    });
  }
  const appts = db
    .prepare(
      `SELECT appointment_id, created_at, service, status, date, start_time
       FROM revenue_appointments WHERE customer_id = ?`,
    )
    .all(customerId) as Array<{
    appointment_id: string;
    created_at: string;
    service: string;
    status: string;
    date: string;
    start_time: string;
  }>;
  for (const row of appts) {
    events.push({
      at: row.created_at,
      type: "APPOINTMENT_BOOKED",
      entityType: "HA",
      entityId: row.appointment_id,
      label: `${appointmentServiceLabel(row.service)} · ${row.date} ${row.start_time}`,
      status: row.status,
    });
    if (row.status === "CANCELLED") {
      events.push({
        at: row.created_at,
        type: "APPOINTMENT_CANCELLED",
        entityType: "HA",
        entityId: row.appointment_id,
        label: `Cita ${row.appointment_id} cancelada`,
        status: row.status,
      });
    }
  }
  const jobs = db
    .prepare(
      `SELECT job_id, job_number, created_at, completed_at, service, status,
              followup_sent_at, satisfaction_received_at, satisfaction_response,
              recovery_at, recovery_status, review_requested_at
       FROM revenue_jobs WHERE customer_id = ?`,
    )
    .all(customerId) as Array<{
    job_id: string;
    job_number: string;
    created_at: string;
    completed_at: string | null;
    service: string;
    status: string;
    followup_sent_at: string | null;
    satisfaction_received_at: string | null;
    satisfaction_response: string;
    recovery_at: string | null;
    recovery_status: string;
    review_requested_at: string | null;
  }>;
  for (const row of jobs) {
    events.push({
      at: row.created_at,
      type: "JOB_CREATED",
      entityType: "JOB",
      entityId: row.job_id,
      label: row.job_number,
      status: row.status,
    });
    if (row.completed_at) {
      events.push({
        at: row.completed_at,
        type: "JOB_COMPLETED",
        entityType: "JOB",
        entityId: row.job_id,
        label: appointmentServiceLabel(row.service),
        status: "COMPLETED",
      });
    }
    if (row.followup_sent_at) {
      events.push({
        at: row.followup_sent_at,
        type: "AFTERCARE_SENT",
        entityType: "JOB",
        entityId: row.job_id,
        label: "Aftercare enviado",
      });
    }
    if (row.satisfaction_received_at) {
      events.push({
        at: row.satisfaction_received_at,
        type: "SATISFACTION",
        entityType: "JOB",
        entityId: row.job_id,
        label: row.satisfaction_response || "respuesta",
      });
    }
    if (row.recovery_at && row.recovery_status) {
      events.push({
        at: row.recovery_at,
        type: "RECOVERY",
        entityType: "JOB",
        entityId: row.job_id,
        label: row.recovery_status,
        status: row.recovery_status,
      });
    }
    if (row.review_requested_at) {
      events.push({
        at: row.review_requested_at,
        type: "REVIEW_REQUESTED",
        entityType: "JOB",
        entityId: row.job_id,
        label: "Reseña solicitada",
      });
    }
  }
  const actions = db
    .prepare(
      `SELECT action_id, kind, status, created_at, sent_at, job_id
       FROM retention_actions WHERE customer_id = ?`,
    )
    .all(customerId) as Array<{
    action_id: string;
    kind: string;
    status: string;
    created_at: string;
    sent_at: string | null;
    job_id: string;
  }>;
  for (const row of actions) {
    events.push({
      at: row.sent_at || row.created_at,
      type: `RETENTION_${row.kind.toUpperCase()}`,
      entityType: "RETENTION",
      entityId: row.action_id,
      label: row.kind,
      status: row.status,
    });
  }
  return events
    .filter((e) => e.at)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, 80);
}

function detectDuplicates(customerId: number, normalizedPhone: string, emailNormalized: string) {
  const db = getHomesteadDb();
  const out: Customer360["possibleDuplicates"] = [];
  if (normalizedPhone.length >= 8) {
    const rows = db
      .prepare(
        `SELECT id, name, phone FROM revenue_customers
         WHERE id != ? AND normalized_phone = ? LIMIT 5`,
      )
      .all(customerId, normalizedPhone) as Array<{ id: number; name: string; phone: string }>;
    for (const row of rows) {
      out.push({ id: row.id, name: row.name, phone: row.phone, match: "CONFIDENT_MATCH" });
    }
  }
  if (emailNormalized.includes("@")) {
    const rows = db
      .prepare(
        `SELECT id, name, phone FROM revenue_customers
         WHERE id != ? AND email_normalized = ? LIMIT 5`,
      )
      .all(customerId, emailNormalized) as Array<{ id: number; name: string; phone: string }>;
    for (const row of rows) {
      if (out.some((x) => x.id === row.id)) continue;
      out.push({ id: row.id, name: row.name, phone: row.phone, match: "POSSIBLE_DUPLICATE" });
    }
  }
  return out;
}

function deriveSegment(input: {
  jobsCompleted: number;
  recoveryOpen: number;
  lastActivityAt: string;
  requests: number;
}): CustomerSegment {
  if (input.recoveryOpen > 0) return "RECOVERY_OPEN";
  if (input.jobsCompleted >= 2) return "REPEAT";
  if (input.jobsCompleted === 1) return "NEW";
  if (input.requests > 0) return "LEAD";
  const ageMs = Date.now() - Date.parse(input.lastActivityAt);
  if (Number.isFinite(ageMs) && ageMs > 180 * 86400000) return "INACTIVE";
  return "LEAD";
}

export function getCustomer360(customerId: number): Customer360 | null {
  if (!Number.isInteger(customerId) || customerId <= 0) return null;
  ensureIdentityMigrated();
  const customer = getHomesteadDb()
    .prepare(
      `SELECT id, name, phone, email, general_location, do_not_contact, is_test,
              COALESCE(marketing_opt_in,0) as marketing_opt_in,
              COALESCE(source_first,'') as source_first,
              COALESCE(source_last,'') as source_last,
              created_at,
              COALESCE(normalized_phone,'') as normalized_phone,
              COALESCE(email_normalized,'') as email_normalized
       FROM revenue_customers WHERE id = ?`,
    )
    .get(customerId) as
    | {
        id: number;
        name: string;
        phone: string;
        email: string;
        general_location: string;
        do_not_contact: number;
        is_test: number;
        marketing_opt_in: number;
        source_first: string;
        source_last: string;
        created_at: string;
        normalized_phone: string;
        email_normalized: string;
      }
    | undefined;
  if (!customer) return null;
  const db = getHomesteadDb();
  let normalizedPhone = customer.normalized_phone;
  let emailNormalized = customer.email_normalized;
  if (!normalizedPhone || !emailNormalized) {
    normalizedPhone = classifyPhone(customer.phone).digits || customer.phone.replace(/\D/g, "");
    emailNormalized = customer.email.trim().toLowerCase();
    db.prepare("UPDATE revenue_customers SET normalized_phone = ?, email_normalized = ? WHERE id = ?").run(
      normalizedPhone,
      emailNormalized,
      customerId,
    );
  }
  const requests = (
    db
      .prepare(
        `SELECT COUNT(*) as n FROM service_requests r
         JOIN revenue_leads l ON l.lead_id = r.public_id
         WHERE l.customer_id = ?`,
      )
      .get(customerId) as { n: number }
  ).n;
  const appointments = (
    db.prepare("SELECT COUNT(*) as n FROM revenue_appointments WHERE customer_id = ?").get(customerId) as { n: number }
  ).n;
  const jobs = (
    db.prepare("SELECT COUNT(*) as n FROM revenue_jobs WHERE customer_id = ?").get(customerId) as { n: number }
  ).n;
  const jobsCompleted = (
    db
      .prepare("SELECT COUNT(*) as n FROM revenue_jobs WHERE customer_id = ? AND status = 'COMPLETED'")
      .get(customerId) as { n: number }
  ).n;
  const recoveryOpen = (
    db
      .prepare(
        `SELECT COUNT(*) as n FROM revenue_jobs
         WHERE customer_id = ? AND recovery_status IN ('OPEN','CONTACTED')`,
      )
      .get(customerId) as { n: number }
  ).n;
  const reviewRequested = (
    db
      .prepare(
        `SELECT COUNT(*) as n FROM revenue_jobs
         WHERE customer_id = ? AND review_requested_at IS NOT NULL AND review_requested_at != ''`,
      )
      .get(customerId) as { n: number }
  ).n;
  const last = db
    .prepare(
      `SELECT job_id, service, completed_at FROM revenue_jobs
       WHERE customer_id = ? AND status = 'COMPLETED' AND completed_at IS NOT NULL
       ORDER BY completed_at DESC LIMIT 1`,
    )
    .get(customerId) as { job_id: string; service: string; completed_at: string } | undefined;
  const sat = db
    .prepare(
      `SELECT satisfaction_response FROM revenue_jobs
       WHERE customer_id = ? AND satisfaction_response != '' AND satisfaction_response IS NOT NULL
       ORDER BY satisfaction_received_at DESC LIMIT 1`,
    )
    .get(customerId) as { satisfaction_response: string } | undefined;
  const leadAttr = db
    .prepare(
      `SELECT source, source_detail, content_id, utm_json
       FROM revenue_leads WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(customerId) as
    | { source: string; source_detail: string; content_id: string; utm_json: string }
    | undefined;
  const retentionHint =
    leadAttr?.source_detail?.includes("RETENTION_") || leadAttr?.source?.startsWith("RETENTION_")
      ? leadAttr.source_detail || leadAttr.source
      : leadAttr?.utm_json?.includes("RETENTION_")
        ? "RETENTION (utm)"
        : "";
  const requestRows = db
    .prepare(
      `SELECT r.public_id as id, r.service as label, r.created_at as at, r.status
       FROM service_requests r
       JOIN revenue_leads l ON l.lead_id = r.public_id
       WHERE l.customer_id = ?
       ORDER BY r.created_at DESC LIMIT 20`,
    )
    .all(customerId) as Array<{ id: string; label: string; at: string; status: string }>;
  const apptRows = db
    .prepare(
      `SELECT appointment_id as id, service as label, created_at as at, status
       FROM revenue_appointments WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20`,
    )
    .all(customerId) as Array<{ id: string; label: string; at: string; status: string }>;
  const jobRows = db
    .prepare(
      `SELECT job_id as id, service as label, created_at as at, status
       FROM revenue_jobs WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20`,
    )
    .all(customerId) as Array<{ id: string; label: string; at: string; status: string }>;
  const history = mapHistory([
    ...requestRows.map((row) => ({ kind: "request", ...row, label: appointmentServiceLabel(row.label) })),
    ...apptRows.map((row) => ({ kind: "appointment", ...row, label: appointmentServiceLabel(row.label) })),
    ...jobRows.map((row) => ({ kind: "job", ...row, label: appointmentServiceLabel(row.label) })),
  ]).sort((a, b) => (a.at < b.at ? 1 : -1));
  const timeline = buildTimeline(customerId);
  const lastActivityAt = timeline[0]?.at || customer.created_at;
  const isRepeat = jobsCompleted >= 2;
  return {
    customerId: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    location: customer.general_location,
    doNotContact: Boolean(customer.do_not_contact),
    marketingOptIn: Boolean(customer.marketing_opt_in),
    isTest: Boolean(customer.is_test),
    sourceFirst: customer.source_first,
    sourceLast: customer.source_last,
    createdAt: customer.created_at,
    normalizedPhone,
    emailNormalized,
    requests,
    appointments,
    jobs,
    jobsCompleted,
    isRepeat,
    segment: deriveSegment({ jobsCompleted, recoveryOpen, lastActivityAt, requests }),
    lastActivityAt,
    lastService: last
      ? {
          jobId: last.job_id,
          service: appointmentServiceLabel(last.service),
          completedAt: last.completed_at,
        }
      : null,
    satisfaction: sat?.satisfaction_response
      ? SATISFACTION_LABELS[sat.satisfaction_response as keyof typeof SATISFACTION_LABELS] ||
        sat.satisfaction_response
      : "",
    recoveryOpen,
    reviewRequested,
    attribution: {
      firstTouch: customer.source_first || "UNKNOWN",
      lastTouch: leadAttr?.source || customer.source_last || "UNKNOWN",
      retentionHint,
      contentId: leadAttr?.content_id || "",
    },
    history: history.slice(0, 40),
    timeline,
    possibleDuplicates: detectDuplicates(customerId, normalizedPhone, emailNormalized),
  };
}

export function findCustomerIdByContact(phone: string, email: string) {
  ensureIdentityMigrated();
  const digits = classifyPhone(phone).digits;
  const mail = email.trim().toLowerCase();
  if (digits && digits.length >= 8) {
    const row = getHomesteadDb()
      .prepare(
        `SELECT id FROM revenue_customers
         WHERE normalized_phone = ? OR replace(replace(replace(phone,'+',''),' ',''),'-','') LIKE ?
         ORDER BY id ASC LIMIT 2`,
      )
      .all(digits, `%${digits.slice(-8)}`) as Array<{ id: number }>;
    if (row.length === 1) return row[0].id;
  }
  if (mail.includes("@")) {
    const row = getHomesteadDb()
      .prepare(
        "SELECT id FROM revenue_customers WHERE email_normalized = ? OR lower(email) = ? ORDER BY id ASC LIMIT 2",
      )
      .all(mail, mail) as Array<{ id: number }>;
    if (row.length === 1) return row[0].id;
  }
  return null;
}

export function searchCustomersForTelegram(query: string, limit = 5) {
  const list = listCustomers({ q: query, includeTest: false, limit, offset: 0 });
  return list.rows;
}

/** Manual merge is intentionally NOT auto. Stub documents policy. */
export function customerMergePolicy() {
  return {
    autoMerge: false as const,
    manualMergeImplemented: false as const,
    reason: "Ambiguous merges require OWNER review in a later controlled change — Wave F detects only.",
  };
}
