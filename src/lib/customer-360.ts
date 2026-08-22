import { getHomesteadDb } from "@/lib/service-requests";
import { classifyPhone } from "@/lib/phone";
import { SATISFACTION_LABELS } from "@/lib/job-config";
import { appointmentServiceLabel } from "@/lib/appointment-time";

export type Customer360 = {
  customerId: number;
  name: string;
  phone: string;
  email: string;
  location: string;
  doNotContact: boolean;
  marketingOptIn: boolean;
  isTest: boolean;
  requests: number;
  appointments: number;
  jobsCompleted: number;
  lastService: { jobId: string; service: string; completedAt: string } | null;
  satisfaction: string;
  history: Array<{
    kind: "request" | "appointment" | "job";
    id: string;
    label: string;
    at: string;
    status: string;
  }>;
};

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

export function getCustomer360(customerId: number): Customer360 | null {
  if (!Number.isInteger(customerId) || customerId <= 0) return null;
  const customer = getHomesteadDb()
    .prepare(
      "SELECT id, name, phone, email, general_location, do_not_contact, is_test, COALESCE(marketing_opt_in,0) as marketing_opt_in FROM revenue_customers WHERE id = ?",
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
      }
    | undefined;
  if (!customer) return null;
  const db = getHomesteadDb();
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
  const jobsCompleted = (
    db
      .prepare("SELECT COUNT(*) as n FROM revenue_jobs WHERE customer_id = ? AND status = 'COMPLETED'")
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
  return {
    customerId: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    location: customer.general_location,
    doNotContact: Boolean(customer.do_not_contact),
    marketingOptIn: Boolean(customer.marketing_opt_in),
    isTest: Boolean(customer.is_test),
    requests,
    appointments,
    jobsCompleted,
    lastService: last
      ? {
          jobId: last.job_id,
          service: appointmentServiceLabel(last.service),
          completedAt: last.completed_at,
        }
      : null,
    satisfaction: sat?.satisfaction_response
      ? SATISFACTION_LABELS[sat.satisfaction_response as keyof typeof SATISFACTION_LABELS] || sat.satisfaction_response
      : "",
    history: history.slice(0, 40),
  };
}

export function findCustomerIdByContact(phone: string, email: string) {
  const digits = classifyPhone(phone).digits;
  const mail = email.trim().toLowerCase();
  if (digits && digits.length >= 8) {
    const row = getHomesteadDb()
      .prepare(
        `SELECT id FROM revenue_customers
         WHERE replace(replace(replace(phone,'+',''),' ',''),'-','') LIKE ?
         ORDER BY id ASC LIMIT 2`,
      )
      .all(`%${digits.slice(-8)}`) as Array<{ id: number }>;
    if (row.length === 1) return row[0].id;
  }
  if (mail.includes("@")) {
    const row = getHomesteadDb()
      .prepare("SELECT id FROM revenue_customers WHERE lower(email) = ? ORDER BY id ASC LIMIT 2")
      .all(mail) as Array<{ id: number }>;
    if (row.length === 1) return row[0].id;
  }
  return null;
}
