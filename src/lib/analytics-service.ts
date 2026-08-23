/**
 * Wave F — Analytics / BI query layer.
 * Deterministic SQL only. No OpenAI. No text-to-SQL.
 * Revenue monetary metrics are NOT AVAILABLE unless paid data is proven.
 */
import { classifyPhone } from "@/lib/phone";
import { getHomesteadDb } from "@/lib/service-requests";
import { commandCenterSummary } from "@/lib/ops-store";
import { opsConfig, panamaParts } from "@/lib/ops-config";
import { appointmentServiceLabel } from "@/lib/appointment-time";
import { retentionDashboard } from "@/lib/retention-engine";

export type AnalyticsRangeKey = "today" | "7d" | "30d" | "month" | "custom";

export type AnalyticsRange = {
  key: AnalyticsRangeKey;
  fromIso: string;
  toIso: string;
  label: string;
};

const TEST = (alias: string, includeTest: boolean) =>
  includeTest ? "1=1" : `${alias}.is_test = 0`;

function panamaYmd(date = new Date()) {
  return panamaParts(date).ymd;
}

/** Inclusive Panama calendar day → UTC ISO bounds (approx via local midnight interpretation). */
export function resolveAnalyticsRange(
  key: AnalyticsRangeKey,
  customFrom?: string,
  customTo?: string,
): AnalyticsRange {
  const tz = opsConfig().timezone;
  void tz;
  const today = panamaYmd();
  const dayStart = (ymd: string) => {
    // Store as Panama local midnight as ISO-like string comparable to our created_at values.
    return `${ymd}T00:00:00.000-05:00`;
  };
  const dayEnd = (ymd: string) => `${ymd}T23:59:59.999-05:00`;
  const addDays = (ymd: string, delta: number) => {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + delta));
    return dt.toISOString().slice(0, 10);
  };
  if (key === "custom" && customFrom && customTo && /^\d{4}-\d{2}-\d{2}$/.test(customFrom) && /^\d{4}-\d{2}-\d{2}$/.test(customTo)) {
    const from = customFrom <= customTo ? customFrom : customTo;
    const to = customFrom <= customTo ? customTo : customFrom;
    // Cap range to 366 days
    const span = (Date.parse(to) - Date.parse(from)) / 86400000;
    const cappedTo = span > 366 ? addDays(from, 366) : to;
    return { key, fromIso: dayStart(from), toIso: dayEnd(cappedTo), label: `${from} → ${cappedTo}` };
  }
  if (key === "today") {
    return { key, fromIso: dayStart(today), toIso: dayEnd(today), label: `Hoy (${today})` };
  }
  if (key === "7d") {
    const from = addDays(today, -6);
    return { key, fromIso: dayStart(from), toIso: dayEnd(today), label: "Últimos 7 días" };
  }
  if (key === "month") {
    const from = `${today.slice(0, 7)}-01`;
    return { key, fromIso: dayStart(from), toIso: dayEnd(today), label: `Mes ${today.slice(0, 7)}` };
  }
  // default 30d
  const from = addDays(today, -29);
  return { key: "30d", fromIso: dayStart(from), toIso: dayEnd(today), label: "Últimos 30 días" };
}

function rate(num: number, den: number): number | null {
  if (den <= 0) return null;
  return Math.round((num / den) * 1000) / 10;
}

export function migrateCustomerIdentityWaveF(database: import("better-sqlite3").Database) {
  const cols = database.prepare("PRAGMA table_info(revenue_customers)").all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("normalized_phone")) {
    database.exec("ALTER TABLE revenue_customers ADD COLUMN normalized_phone TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has("email_normalized")) {
    database.exec("ALTER TABLE revenue_customers ADD COLUMN email_normalized TEXT NOT NULL DEFAULT ''");
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_rev_cust_norm_phone ON revenue_customers (normalized_phone);
    CREATE INDEX IF NOT EXISTS idx_rev_cust_email_norm ON revenue_customers (email_normalized);
    CREATE INDEX IF NOT EXISTS idx_rev_leads_created ON revenue_leads (created_at, is_test);
    CREATE INDEX IF NOT EXISTS idx_rev_appt_created ON revenue_appointments (created_at);
    CREATE INDEX IF NOT EXISTS idx_rev_jobs_created ON revenue_jobs (created_at, is_test, status);
  `);
}

export function backfillCustomerNormalization(limit = 500) {
  const db = getHomesteadDb();
  const rows = db
    .prepare(
      `SELECT id, phone, email FROM revenue_customers
       WHERE normalized_phone = '' OR email_normalized = ''
       LIMIT ?`,
    )
    .all(limit) as Array<{ id: number; phone: string; email: string }>;
  const upd = db.prepare(
    "UPDATE revenue_customers SET normalized_phone = ?, email_normalized = ? WHERE id = ?",
  );
  for (const row of rows) {
    const phone = classifyPhone(row.phone).digits || String(row.phone || "").replace(/\D/g, "");
    const email = String(row.email || "").trim().toLowerCase();
    upd.run(phone, email, row.id);
  }
  return rows.length;
}

export function getFunnel(range: AnalyticsRange, includeTest = false) {
  const db = getHomesteadDb();
  const leads = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM revenue_leads l
         WHERE ${TEST("l", includeTest)}
           AND l.created_at >= ? AND l.created_at <= ?`,
      )
      .get(range.fromIso, range.toIso) as { n: number }
  ).n;
  const hs = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM service_requests r
         LEFT JOIN revenue_leads l ON l.lead_id = r.public_id
         WHERE r.created_at >= ? AND r.created_at <= ?
           AND (${includeTest ? "1=1" : "COALESCE(l.is_test,0)=0"})`,
      )
      .get(range.fromIso, range.toIso) as { n: number }
  ).n;
  const ha = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM revenue_appointments a
         JOIN revenue_leads l ON l.lead_id = a.lead_id
         WHERE ${TEST("l", includeTest)}
           AND a.created_at >= ? AND a.created_at <= ?`,
      )
      .get(range.fromIso, range.toIso) as { n: number }
  ).n;
  const jobs = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM revenue_jobs j
         WHERE ${TEST("j", includeTest)}
           AND j.created_at >= ? AND j.created_at <= ?`,
      )
      .get(range.fromIso, range.toIso) as { n: number }
  ).n;
  const completed = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM revenue_jobs j
         WHERE ${TEST("j", includeTest)}
           AND j.status = 'COMPLETED'
           AND j.completed_at IS NOT NULL
           AND j.completed_at >= ? AND j.completed_at <= ?`,
      )
      .get(range.fromIso, range.toIso) as { n: number }
  ).n;
  return {
    firstReliableStage: "LEAD" as const,
    leads,
    hs,
    ha,
    jobs,
    completed,
    leadToHs: rate(hs, leads),
    hsToHa: rate(ha, hs),
    haToJob: rate(jobs, ha),
    jobToCompleted: rate(completed, jobs),
    definitions: {
      lead: "revenue_leads row created in range (is_test filtered)",
      hs: "service_requests created in range linked or unlinked (test filtered via lead)",
      ha: "revenue_appointments created in range",
      job: "revenue_jobs created in range",
      completed: "revenue_jobs COMPLETED with completed_at in range",
    },
  };
}

export function getServicePerformance(range: AnalyticsRange, includeTest = false) {
  const db = getHomesteadDb();
  const rows = db
    .prepare(
      `SELECT COALESCE(NULLIF(r.service,''),'unknown') AS service,
              COUNT(*) AS requests
       FROM service_requests r
       LEFT JOIN revenue_leads l ON l.lead_id = r.public_id
       WHERE r.created_at >= ? AND r.created_at <= ?
         AND (${includeTest ? "1=1" : "COALESCE(l.is_test,0)=0"})
       GROUP BY 1
       ORDER BY requests DESC
       LIMIT 20`,
    )
    .all(range.fromIso, range.toIso) as Array<{ service: string; requests: number }>;
  return rows.map((row) => {
    const appts = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM revenue_appointments a
           JOIN revenue_leads l ON l.lead_id = a.lead_id
           WHERE ${TEST("l", includeTest)}
             AND a.service = ?
             AND a.created_at >= ? AND a.created_at <= ?`,
        )
        .get(row.service, range.fromIso, range.toIso) as { n: number }
    ).n;
    const jobs = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM revenue_jobs j
           WHERE ${TEST("j", includeTest)} AND j.service = ?
             AND j.created_at >= ? AND j.created_at <= ?`,
        )
        .get(row.service, range.fromIso, range.toIso) as { n: number }
    ).n;
    const completed = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM revenue_jobs j
           WHERE ${TEST("j", includeTest)} AND j.service = ? AND j.status = 'COMPLETED'
             AND j.completed_at >= ? AND j.completed_at <= ?`,
        )
        .get(row.service, range.fromIso, range.toIso) as { n: number }
    ).n;
    return {
      service: row.service,
      label: appointmentServiceLabel(row.service),
      requests: row.requests,
      appointments: appts,
      jobs,
      completed,
    };
  });
}

export function getSourcePerformance(range: AnalyticsRange, includeTest = false) {
  const db = getHomesteadDb();
  // First-touch: customer.source_first for leads created in range
  const first = db
    .prepare(
      `SELECT COALESCE(NULLIF(c.source_first,''),'UNKNOWN') AS source, COUNT(*) AS n
       FROM revenue_leads l
       JOIN revenue_customers c ON c.id = l.customer_id
       WHERE ${TEST("l", includeTest)}
         AND l.created_at >= ? AND l.created_at <= ?
       GROUP BY 1 ORDER BY n DESC LIMIT 20`,
    )
    .all(range.fromIso, range.toIso) as Array<{ source: string; n: number }>;
  const last = db
    .prepare(
      `SELECT COALESCE(NULLIF(l.source,''),NULLIF(c.source_last,''),'UNKNOWN') AS source, COUNT(*) AS n
       FROM revenue_leads l
       JOIN revenue_customers c ON c.id = l.customer_id
       WHERE ${TEST("l", includeTest)}
         AND l.created_at >= ? AND l.created_at <= ?
       GROUP BY 1 ORDER BY n DESC LIMIT 20`,
    )
    .all(range.fromIso, range.toIso) as Array<{ source: string; n: number }>;
  const retention = db
    .prepare(
      `SELECT COUNT(*) AS n FROM revenue_leads l
       WHERE ${TEST("l", includeTest)}
         AND l.created_at >= ? AND l.created_at <= ?
         AND (l.source_detail LIKE '%RETENTION_%' OR l.source LIKE 'RETENTION_%' OR l.utm_json LIKE '%RETENTION_%')`,
    )
    .get(range.fromIso, range.toIso) as { n: number };
  return {
    firstTouch: first,
    lastTouch: last,
    retentionAttributedLeads: retention.n,
    waveDPublishing: "N/A_NOT_CERTIFIED" as const,
  };
}

export function getRetentionMetrics(includeTest = false) {
  const dash = retentionDashboard(includeTest);
  const db = getHomesteadDb();
  const repeatCustomers = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT customer_id FROM revenue_jobs
           WHERE status = 'COMPLETED' AND (${includeTest ? "1=1" : "is_test = 0"})
           GROUP BY customer_id HAVING COUNT(*) >= 2
         )`,
      )
      .get() as { n: number }
  ).n;
  return { ...dash, repeatCustomers };
}

export type AttentionItem = {
  id: string;
  kind: "SAFETY" | "RECOVERY" | "SLA" | "APPOINTMENT" | "HOT_LEAD" | "SYSTEM" | "CONTENT";
  priority: number;
  title: string;
  href: string;
  detail: string;
};

export function getAttentionItems(includeTest = false, limit = 40): AttentionItem[] {
  const db = getHomesteadDb();
  const items: AttentionItem[] = [];
  const recovery = db
    .prepare(
      `SELECT j.job_id, j.job_number, j.recovery_priority, j.recovery_status, c.name
       FROM revenue_jobs j
       LEFT JOIN revenue_customers c ON c.id = j.customer_id
       WHERE j.recovery_status IN ('OPEN','CONTACTED')
         AND (${includeTest ? "1=1" : "j.is_test = 0"})
       ORDER BY CASE j.recovery_priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END, j.recovery_at ASC
       LIMIT 20`,
    )
    .all() as Array<{
    job_id: string;
    job_number: string;
    recovery_priority: string;
    recovery_status: string;
    name: string;
  }>;
  for (const row of recovery) {
    const urgent = row.recovery_priority === "URGENT";
    items.push({
      id: `recovery:${row.job_id}`,
      kind: urgent ? "SAFETY" : "RECOVERY",
      priority: urgent ? 0 : 1,
      title: `${row.job_number} · recovery ${row.recovery_status}`,
      href: `/admin/trabajos/${row.job_id}`,
      detail: row.name || "",
    });
  }
  const snap = commandCenterSummary(includeTest);
  if (snap.overdueFollowups > 0) {
    items.push({
      id: "sla:overdue",
      kind: "SLA",
      priority: 2,
      title: `${snap.overdueFollowups} seguimientos SLA vencidos`,
      href: "/admin",
      detail: "Smart SLA / followups PENDING",
    });
  }
  if (snap.rescue > 0) {
    items.push({
      id: "lead:rescue",
      kind: "HOT_LEAD",
      priority: 3,
      title: `${snap.rescue} oportunidades sin contacto`,
      href: "/admin/solicitudes?status=NEW",
      detail: "Lead Rescue",
    });
  }
  if (snap.appointmentsToday > 0) {
    items.push({
      id: "appt:today",
      kind: "APPOINTMENT",
      priority: 4,
      title: `${snap.appointmentsToday} citas hoy`,
      href: "/admin/citas",
      detail: "Agenda del día",
    });
  }
  const failed = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM automation_outbox
         WHERE status = 'FAILED'`,
      )
      .get() as { n: number }
  ).n;
  if (failed > 0) {
    items.push({
      id: "sys:outbox",
      kind: "SYSTEM",
      priority: 5,
      title: `${failed} eventos outbox FAILED`,
      href: "/admin",
      detail: "automation_outbox",
    });
  }
  if (snap.contentPending + snap.contentCandidates > 0) {
    items.push({
      id: "content:pending",
      kind: "CONTENT",
      priority: 6,
      title: `${snap.contentPending + snap.contentCandidates} contenidos pendientes`,
      href: "/admin",
      detail: "Content Studio (human approval)",
    });
  }
  return items.sort((a, b) => a.priority - b.priority).slice(0, limit);
}

export function getExecutiveSummary(range: AnalyticsRange, includeTest = false) {
  const funnel = getFunnel(range, includeTest);
  const snap = commandCenterSummary(includeTest);
  const retention = getRetentionMetrics(includeTest);
  const attention = getAttentionItems(includeTest, 12);
  const sources = getSourcePerformance(range, includeTest);
  const services = getServicePerformance(range, includeTest);
  return {
    generatedAt: new Date().toISOString(),
    timezone: opsConfig().timezone,
    range,
    funnel,
    operational: snap,
    retention,
    attention,
    sources,
    services,
    revenueAvailable: false as const,
    revenueReason: "No reliable paid/invoiced operational dataset — monetary LTV/revenue NOT AVAILABLE",
    waveD: "N/A_NOT_CERTIFIED" as const,
  };
}

export function getBusinessBriefCounts(includeTest = false) {
  const range = resolveAnalyticsRange("today");
  const funnel = getFunnel(range, includeTest);
  const snap = commandCenterSummary(includeTest);
  return {
    ymd: panamaYmd(),
    requestsToday: funnel.hs,
    appointmentsToday: snap.appointmentsToday,
    pendingRequests: snap.pendingRequests,
    rescue: snap.rescue,
    recoveryOpen: snap.serviceRecovery,
    jobsActive: snap.jobsActive,
    contentPending: snap.contentPending + snap.contentCandidates,
  };
}

export function dataQualityChecks(includeTest = false) {
  const db = getHomesteadDb();
  const orphanHs = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM service_requests r
         LEFT JOIN revenue_leads l ON l.lead_id = r.public_id
         WHERE l.lead_id IS NULL`,
      )
      .get() as { n: number }
  ).n;
  const orphanHa = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM revenue_appointments a
         LEFT JOIN revenue_customers c ON c.id = a.customer_id
         WHERE c.id IS NULL`,
      )
      .get() as { n: number }
  ).n;
  const orphanJob = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM revenue_jobs j
         LEFT JOIN revenue_customers c ON c.id = j.customer_id
         WHERE c.id IS NULL`,
      )
      .get() as { n: number }
  ).n;
  const possibleDupPhones = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT normalized_phone FROM revenue_customers
           WHERE normalized_phone != '' AND (${includeTest ? "1=1" : "is_test = 0"})
           GROUP BY normalized_phone HAVING COUNT(*) > 1
         )`,
      )
      .get() as { n: number }
  ).n;
  return { orphanHs, orphanHa, orphanJob, possibleDuplicatePhoneGroups: possibleDupPhones };
}
