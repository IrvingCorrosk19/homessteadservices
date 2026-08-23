/**
 * Wave E daily retention processor — maintenance due + reactivation.
 * Deterministic eligibility. No auto-booking.
 */
import { randomBytes } from "crypto";
import { getHomesteadDb } from "@/lib/service-requests";
import { enqueueOutbox } from "@/lib/automation-outbox";
import { isMailConfigured, sendTransactionalEmail } from "@/lib/mail";
import { firstNameOf } from "@/lib/job-store";
import {
  canSendMarketingRetention,
  claimRetentionAction,
  markRetentionActionSent,
  markRetentionActionSkipped,
  recordMarketingContact,
  retentionConfig,
} from "@/lib/retention-engine";
import { logInfo } from "@/lib/log";
import { site } from "@/lib/site";

function nowIso() {
  return new Date().toISOString();
}

function actionId(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

export async function runRetentionEngine(limit = 12) {
  const maintenance = await processMaintenanceDue(limit);
  const reactivation = await processReactivation(Math.max(1, Math.floor(limit / 2)));
  logInfo("RetentionEngineRan", {
    stage: `m:${maintenance.sent}/r:${reactivation.sent}`,
    attempt: maintenance.scanned + reactivation.scanned,
  });
  return { maintenance, reactivation };
}

async function processMaintenanceDue(limit: number) {
  const lookahead = retentionConfig().maintenanceLookaheadDays;
  const rows = getHomesteadDb()
    .prepare(
      `SELECT m.opportunity_id, m.customer_id, m.service, m.eligible_at, m.lead_id,
              c.name, c.email, c.do_not_contact
       FROM revenue_maintenance m
       JOIN revenue_customers c ON c.id = m.customer_id
       WHERE m.status = 'OPEN'
         AND m.eligible_at <= datetime('now', ?)
         AND (m.contacted_at IS NULL OR m.contacted_at = '')
         AND c.do_not_contact = 0
       ORDER BY m.eligible_at ASC
       LIMIT ?`,
    )
    .all(`+${lookahead} day`, limit) as Array<{
    opportunity_id: string;
    customer_id: number;
    service: string;
    eligible_at: string;
    lead_id: string;
    name: string;
    email: string;
    do_not_contact: number;
  }>;

  let sent = 0;
  let skipped = 0;
  for (const row of rows) {
    const gate = canSendMarketingRetention(row.customer_id, "maintenance");
    const idem = `retention.maintenance:${row.opportunity_id}`;
    const id = actionId("RM");
    const claimed = claimRetentionAction({
      actionId: id,
      customerId: row.customer_id,
      kind: "MAINTENANCE",
      idempotencyKey: idem,
      detail: row.service,
    });
    if (!claimed.created) {
      skipped += 1;
      continue;
    }
    if (!gate.ok) {
      markRetentionActionSkipped(id, gate.reason);
      skipped += 1;
      continue;
    }
    const email = (row.email || "").trim();
    if (!email.includes("@") || !isMailConfigured()) {
      markRetentionActionSkipped(id, "no_email");
      skipped += 1;
      continue;
    }
    const first = firstNameOf(row.name);
    const bookUrl = `${site.url.replace(/\/$/, "")}/contact?intent=maintenance&service=${encodeURIComponent(row.service)}&src=RETENTION_MAINTENANCE&oid=${encodeURIComponent(row.opportunity_id)}`;
    const text = [
      `Hola ${first}.`,
      "",
      "Hace un tiempo realizamos un servicio con Homestead.",
      "Según nuestro recordatorio de mantenimiento, ya es un buen momento para planificar la próxima revisión.",
      "",
      "Si quieres, puedes solicitar disponibilidad aquí (sin crear cita automática):",
      bookUrl,
      "",
      "Si prefieres no recibir estos recordatorios, responde a este correo con la palabra BAJA.",
    ].join("\n");
    const result = await sendTransactionalEmail({
      to: email,
      subject: "Recordatorio de mantenimiento — Homestead Services",
      text,
      html: text.replace(/\n/g, "<br/>"),
    });
    if (!result.ok) {
      markRetentionActionSkipped(id, result.error);
      skipped += 1;
      continue;
    }
    getHomesteadDb()
      .prepare(`UPDATE revenue_maintenance SET contacted_at = ?, status = 'CONTACTED' WHERE opportunity_id = ? AND status = 'OPEN'`)
      .run(nowIso(), row.opportunity_id);
    markRetentionActionSent(id);
    recordMarketingContact(row.customer_id);
    sent += 1;
  }
  return { scanned: rows.length, sent, skipped };
}

async function processReactivation(limit: number) {
  const idleDays = retentionConfig().reactivationIdleDays;
  const rows = getHomesteadDb()
    .prepare(
      `SELECT c.id as customer_id, c.name, c.email,
              (SELECT j.service FROM revenue_jobs j
               WHERE j.customer_id = c.id AND j.status = 'COMPLETED'
               ORDER BY j.completed_at DESC LIMIT 1) as last_service,
              (SELECT j.completed_at FROM revenue_jobs j
               WHERE j.customer_id = c.id AND j.status = 'COMPLETED'
               ORDER BY j.completed_at DESC LIMIT 1) as last_completed
       FROM revenue_customers c
       WHERE c.do_not_contact = 0
         AND COALESCE(c.is_test, 0) = 0
         AND COALESCE(c.pref_reactivation, 1) = 1
         AND (c.suppressed_at IS NULL OR c.suppressed_at = '')
         AND NOT EXISTS (
           SELECT 1 FROM revenue_jobs j
           WHERE j.customer_id = c.id AND j.recovery_status IN ('OPEN','CONTACTED')
         )
         AND EXISTS (
           SELECT 1 FROM revenue_jobs j
           WHERE j.customer_id = c.id AND j.status = 'COMPLETED'
             AND j.completed_at <= datetime('now', ?)
         )
         AND NOT EXISTS (
           SELECT 1 FROM revenue_jobs j
           WHERE j.customer_id = c.id AND j.status = 'COMPLETED'
             AND j.completed_at > datetime('now', ?)
         )
         AND NOT EXISTS (
           SELECT 1 FROM retention_actions a
           WHERE a.customer_id = c.id AND a.kind = 'REACTIVATION' AND a.status = 'SENT'
             AND a.sent_at >= datetime('now', '-90 day')
         )
       ORDER BY last_completed ASC
       LIMIT ?`,
    )
    .all(`-${idleDays} day`, `-${Math.floor(idleDays / 2)} day`, limit) as Array<{
    customer_id: number;
    name: string;
    email: string;
    last_service: string | null;
    last_completed: string | null;
  }>;

  let sent = 0;
  let skipped = 0;
  for (const row of rows) {
    // Service-aware: skip one-off locksmith for reactivation blasts
    if (row.last_service === "locksmith") {
      skipped += 1;
      continue;
    }
    const gate = canSendMarketingRetention(row.customer_id, "reactivation");
    const idem = `retention.reactivation:${row.customer_id}:${(row.last_completed || "").slice(0, 10)}`;
    const id = actionId("RR");
    const claimed = claimRetentionAction({
      actionId: id,
      customerId: row.customer_id,
      kind: "REACTIVATION",
      idempotencyKey: idem,
      detail: row.last_service || "",
    });
    if (!claimed.created) {
      skipped += 1;
      continue;
    }
    if (!gate.ok) {
      markRetentionActionSkipped(id, gate.reason);
      skipped += 1;
      continue;
    }
    const email = (row.email || "").trim();
    if (!email.includes("@") || !isMailConfigured()) {
      markRetentionActionSkipped(id, "no_email");
      skipped += 1;
      continue;
    }
    const first = firstNameOf(row.name);
    const url = `${site.url.replace(/\/$/, "")}/contact?src=RETENTION_REACTIVATION&cid=${row.customer_id}`;
    const text = [
      `Hola ${first}.`,
      "",
      "Queríamos saludarte de parte de Homestead Services.",
      "Si necesitas ayuda con un servicio en casa, estamos disponibles para evaluarlo.",
      "",
      url,
      "",
      "Si no deseas recibir este tipo de mensajes, responde BAJA.",
    ].join("\n");
    const result = await sendTransactionalEmail({
      to: email,
      subject: "Homestead Services — ¿Necesitas ayuda en casa?",
      text,
      html: text.replace(/\n/g, "<br/>"),
    });
    if (!result.ok) {
      markRetentionActionSkipped(id, result.error);
      skipped += 1;
      continue;
    }
    markRetentionActionSent(id);
    recordMarketingContact(row.customer_id);
    // Soft signal in outbox for ops visibility (no duplicate HS)
    enqueueOutbox(getHomesteadDb(), {
      eventType: "retention.reactivation_sent",
      correlationId: String(row.customer_id),
      idempotencyKey: idem,
      data: { event: "retention.reactivation_sent", customerId: row.customer_id },
    });
    sent += 1;
  }
  return { scanned: rows.length, sent, skipped };
}

export function suppressFromEmailReply(customerId: number) {
  const { applyMarketingSuppression } = require("@/lib/retention-engine") as typeof import("@/lib/retention-engine");
  applyMarketingSuppression(customerId, "email_baja");
}
