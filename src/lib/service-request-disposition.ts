/**
 * Admin disposition for service requests: reject, cancel, request info, reopen,
 * security review. Reuses CANCELLED status (no redundant REJECTED enum).
 */
import { PUBLIC_ID_PATTERN, isRequestStatus, type RequestStatus } from "@/lib/admin-format";
import { enqueueOutbox } from "@/lib/automation-outbox";
import { isControlIsolated, maybeThrowSimulatedNotifyFailure, recordSimulatedCall } from "@/lib/control-isolation";
import { logError, logInfo } from "@/lib/log";
import {
  cancelServiceRequest,
  listOpenAppointmentsForLead,
  type CancellationReasonCategory,
} from "@/lib/service-request-cancellation";
import {
  getHomesteadDb,
  getRequestByPublicId,
  updateRequestStatus,
} from "@/lib/service-requests";
import { addRevenueEvent, setPipeline } from "@/lib/revenue-store";

export const REJECT_REASON_CATEGORIES = [
  "SECURITY_RISK",
  "OUT_OF_COVERAGE",
  "SERVICE_NOT_OFFERED",
  "REQUIREMENTS_NOT_MET",
  "NO_AVAILABILITY",
  "OTHER",
] as const;

export type RejectReasonCategory = (typeof REJECT_REASON_CATEGORIES)[number];

export const REJECT_REASON_LABELS: Record<RejectReasonCategory, string> = {
  SECURITY_RISK: "Riesgo de seguridad",
  OUT_OF_COVERAGE: "Fuera de cobertura",
  SERVICE_NOT_OFFERED: "Servicio no ofrecido",
  REQUIREMENTS_NOT_MET: "Condiciones o requisitos incumplidos",
  NO_AVAILABILITY: "Falta de disponibilidad",
  OTHER: "Otro",
};

const CLOSED: RequestStatus[] = ["COMPLETED", "CANCELLED"];
const PENDING_REJECTABLE: RequestStatus[] = ["NEW", "CONTACTED"];
const ACCEPTED_CANCELLABLE: RequestStatus[] = ["IN_PROGRESS"];

function sanitize(raw: string, max = 2000) {
  return raw.replace(/\s+/g, " ").trim().slice(0, max);
}

function assertPublicId(id: string) {
  return PUBLIC_ID_PATTERN.test(id);
}

export function isRejectReasonCategory(value: unknown): value is RejectReasonCategory {
  return typeof value === "string" && (REJECT_REASON_CATEGORIES as readonly string[]).includes(value);
}

export function requestSecurityReviewActive(publicId: string) {
  const row = getHomesteadDb()
    .prepare(
      `SELECT COALESCE(security_review_required, 0) AS flag FROM service_requests WHERE public_id = ?`,
    )
    .get(publicId) as { flag: number } | undefined;
  return Boolean(row?.flag);
}

/** Blocks auto-confirm of appointments while security review is active. */
export function assertSecurityReviewAllowsBooking(publicId: string) {
  if (requestSecurityReviewActive(publicId)) {
    return { ok: false as const, error: "security_review_required" };
  }
  const req = getRequestByPublicId(publicId);
  if (!req) return { ok: false as const, error: "missing" };
  if (req.status === "CANCELLED" || req.status === "COMPLETED") {
    return { ok: false as const, error: "request_closed" };
  }
  return { ok: true as const };
}

function writeAudit(input: {
  publicId: string;
  action: string;
  actor: string;
  previousStatus: string;
  newStatus: string;
  reasonCategory?: string;
  reasonPublic?: string;
  internalNote?: string;
  customerMessage?: string;
  detail?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  getHomesteadDb()
    .prepare(
      `INSERT INTO service_request_audit
        (public_id, action, actor, previous_status, new_status, reason_category, reason_public, internal_note, customer_message, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.publicId,
      input.action,
      input.actor.slice(0, 120),
      input.previousStatus,
      input.newStatus,
      input.reasonCategory || "",
      sanitize(input.reasonPublic || "", 500),
      sanitize(input.internalNote || "", 2000),
      sanitize(input.customerMessage || "", 2000),
      JSON.stringify(input.detail || {}),
      now,
    );
}

export function listRequestAudit(publicId: string) {
  return getHomesteadDb()
    .prepare(
      `SELECT id, action, actor, previous_status, new_status, reason_category, reason_public,
              internal_note, customer_message, detail_json, created_at
       FROM service_request_audit WHERE public_id = ? ORDER BY id DESC LIMIT 50`,
    )
    .all(publicId) as Array<{
    id: number;
    action: string;
    actor: string;
    previous_status: string;
    new_status: string;
    reason_category: string;
    reason_public: string;
    internal_note: string;
    customer_message: string;
    detail_json: string;
    created_at: string;
  }>;
}

export function buildCustomerDispositionMessage(input: {
  kind: "reject" | "cancel" | "request_info";
  reasonCategory: string;
  reasonPublic?: string;
  name?: string;
}) {
  const greeting = input.name?.trim() ? `Hola ${input.name.trim().split(/\s+/)[0]},` : "Hola,";
  if (input.kind === "request_info") {
    return `${greeting}\n\nPara continuar con tu solicitud en Homestead Services necesitamos un poco más de información.${
      input.reasonPublic ? `\n\n${sanitize(input.reasonPublic, 400)}` : ""
    }\n\nPuedes responder a este mensaje o escribirnos por WhatsApp. Gracias.`;
  }
  const label =
    isRejectReasonCategory(input.reasonCategory)
      ? REJECT_REASON_LABELS[input.reasonCategory]
      : "cambio de disponibilidad";
  if (input.kind === "reject") {
    return `${greeting}\n\nRevisamos tu solicitud y por ahora no podemos tomarla (${label}).${
      input.reasonPublic ? `\n\n${sanitize(input.reasonPublic, 400)}` : ""
    }\n\nSi quieres, podemos orientarte sobre alternativas. Gracias por escribirnos.`;
  }
  return `${greeting}\n\nConfirmamos la cancelación del servicio (${label}).${
    input.reasonPublic ? `\n\n${sanitize(input.reasonPublic, 400)}` : ""
  }\n\nSi necesitas reagendar más adelante, con gusto te atendemos.`;
}

function enqueueCustomerNotify(input: {
  publicId: string;
  kind: string;
  channel: "EMAIL" | "WHATSAPP_LINK" | "SIMULATED";
  message: string;
  idempotencyKey: string;
}) {
  const now = new Date().toISOString();
  const existing = getHomesteadDb()
    .prepare(`SELECT id, status FROM service_request_notify_outbox WHERE idempotency_key = ?`)
    .get(input.idempotencyKey) as { id: number; status: string } | undefined;
  if (existing) {
    return { ok: true as const, already: true, id: existing.id, status: existing.status };
  }
  const channel = isControlIsolated() ? "SIMULATED" : input.channel;
  const info = getHomesteadDb()
    .prepare(
      `INSERT INTO service_request_notify_outbox
        (public_id, kind, channel, payload_json, status, idempotency_key, attempts, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'PENDING', ?, 0, '', ?, ?)`,
    )
    .run(
      input.publicId,
      input.kind,
      channel,
      JSON.stringify({ message: input.message, internalExcluded: true }),
      input.idempotencyKey,
      now,
      now,
    );
  getHomesteadDb()
    .prepare(
      `UPDATE service_requests SET customer_notify_status = 'PENDING', customer_notify_channel = ?, updated_at = ? WHERE public_id = ?`,
    )
    .run(channel, now, input.publicId);
  return { ok: true as const, already: false, id: Number(info.lastInsertRowid), status: "PENDING" };
}

export async function drainCustomerNotifyOutbox(limit = 20) {
  const rows = getHomesteadDb()
    .prepare(
      `SELECT id, public_id, kind, channel, payload_json, attempts, idempotency_key
       FROM service_request_notify_outbox WHERE status = 'PENDING' ORDER BY id ASC LIMIT ?`,
    )
    .all(limit) as Array<{
    id: number;
    public_id: string;
    kind: string;
    channel: string;
    payload_json: string;
    attempts: number;
    idempotency_key: string;
  }>;
  const results: Array<{ id: number; ok: boolean; status: string }> = [];
  for (const row of rows) {
    const now = new Date().toISOString();
    try {
      const payload = JSON.parse(row.payload_json || "{}") as { message?: string };
      // Never log the full message body with PII in production paths beyond short hash.
      if (row.channel === "SIMULATED" || isControlIsolated()) {
        maybeThrowSimulatedNotifyFailure();
        recordSimulatedCall("smtp", `customer_notify:${row.public_id}:${row.kind}`);
      } else if (row.channel === "EMAIL") {
        const mail = await import("@/lib/mail");
        const req = getRequestByPublicId(row.public_id);
        if (!req?.email || !mail.isMailConfigured()) {
          throw new Error(req?.email ? "smtp_unavailable" : "no_email");
        }
        // Customer notify uses the same SMTP transport as admin replies, without internal notes.
        await mail.sendCustomerDispositionEmail({
          to: req.email,
          publicId: row.public_id,
          body: String(payload.message || ""),
        });
      } else {
        // WhatsApp remains human-assisted deep link; draft is ready for ops.
        recordSimulatedCall("telegram", `customer_wa_link:${row.public_id}`);
      }
      getHomesteadDb()
        .prepare(
          `UPDATE service_request_notify_outbox SET status = 'SENT', attempts = attempts + 1, updated_at = ?, last_error = '' WHERE id = ?`,
        )
        .run(now, row.id);
      getHomesteadDb()
        .prepare(
          `UPDATE service_requests SET customer_notify_status = 'SENT', customer_notify_last_error = '', updated_at = ? WHERE public_id = ?`,
        )
        .run(now, row.public_id);
      results.push({ id: row.id, ok: true, status: "SENT" });
      void payload;
    } catch (error) {
      const cause = error instanceof Error ? error.message : "notify_failed";
      const attempts = row.attempts + 1;
      const status = attempts >= 5 ? "FAILED" : "PENDING";
      getHomesteadDb()
        .prepare(
          `UPDATE service_request_notify_outbox SET status = ?, attempts = ?, last_error = ?, updated_at = ? WHERE id = ?`,
        )
        .run(status, attempts, cause.slice(0, 180), now, row.id);
      getHomesteadDb()
        .prepare(
          `UPDATE service_requests SET customer_notify_status = ?, customer_notify_attempts = ?, customer_notify_last_error = ?, updated_at = ? WHERE public_id = ?`,
        )
        .run(status, attempts, cause.slice(0, 180), now, row.public_id);
      logError("ServiceRequestNotifyFailed", { stage: row.kind, contentJobId: row.public_id.slice(0, 24) });
      results.push({ id: row.id, ok: false, status });
    }
  }
  return results;
}

export type DispositionAction = "reject" | "cancel" | "request_info" | "reopen";

export async function applyServiceRequestDisposition(input: {
  requestId: string;
  action: DispositionAction;
  actor: string;
  reasonCategory: string;
  reason?: string;
  internalNote?: string;
  customerMessage?: string;
  sendCustomerMessage?: boolean;
  confirm?: boolean;
  idempotencyKey?: string;
}) {
  if (!assertPublicId(input.requestId)) {
    return { ok: false as const, error: "invalid_id", status: 400 };
  }
  if (!input.confirm) {
    return { ok: false as const, error: "confirm_required", status: 400 };
  }
  const request = getRequestByPublicId(input.requestId);
  if (!request) return { ok: false as const, error: "missing", status: 404 };

  const internalNote = sanitize(input.internalNote || "", 2000);
  const reasonPublic = sanitize(input.reason || "", 500);
  const openAppointments = listOpenAppointmentsForLead(input.requestId);

  // Double-tap / replay: same idempotency key on an already-disposed request returns success.
  if (input.idempotencyKey && (input.action === "reject" || input.action === "cancel")) {
    const prior = getHomesteadDb()
      .prepare(
        `SELECT status, disposition_kind, cancellation_idempotency_key, customer_message_draft
         FROM service_requests WHERE public_id = ?`,
      )
      .get(input.requestId) as
      | {
          status: string;
          disposition_kind: string;
          cancellation_idempotency_key: string;
          customer_message_draft: string;
        }
      | undefined;
    const expectedKind = input.action === "reject" ? "REJECT" : "CANCEL";
    if (
      prior?.status === "CANCELLED" &&
      prior.disposition_kind === expectedKind &&
      prior.cancellation_idempotency_key === input.idempotencyKey
    ) {
      return {
        ok: true as const,
        action: input.action,
        already: true as const,
        previousStatus: "CANCELLED",
        newStatus: "CANCELLED",
        cancelledAppointmentIds: [] as string[],
        calendarReleased: true,
        customerMessage: prior.customer_message_draft || "",
        notify: { already: true },
      };
    }
  }

  if (input.action === "reject") {
    if (!PENDING_REJECTABLE.includes(request.status as RequestStatus)) {
      return {
        ok: false as const,
        error: request.status === "IN_PROGRESS" ? "use_cancel" : "not_rejectable",
        status: 409,
        openAppointments,
      };
    }
    if (!isRejectReasonCategory(input.reasonCategory)) {
      return { ok: false as const, error: "reason_required", status: 400 };
    }
    const customerMessage =
      sanitize(input.customerMessage || "", 2000) ||
      buildCustomerDispositionMessage({
        kind: "reject",
        reasonCategory: input.reasonCategory,
        reasonPublic,
        name: request.name,
      });
    // Public customer text must never include internal note.
    if (internalNote && customerMessage.includes(internalNote)) {
      return { ok: false as const, error: "internal_note_leak", status: 400 };
    }
    const cancelled = cancelServiceRequest({
      requestId: input.requestId,
      actor: input.actor,
      source: "ADMIN",
      reason: reasonPublic || REJECT_REASON_LABELS[input.reasonCategory],
      reasonCategory: input.reasonCategory as unknown as CancellationReasonCategory,
      idempotencyKey: input.idempotencyKey || `reject:${input.requestId}:${input.reasonCategory}`,
      notify: true,
    });
    if (!cancelled.success && !cancelled.alreadyCancelled) {
      return { ok: false as const, error: cancelled.errorCode || "cancel_failed", status: 409 };
    }
    const now = new Date().toISOString();
    getHomesteadDb()
      .prepare(
        `UPDATE service_requests SET
           disposition_kind = 'REJECT',
           internal_note = CASE WHEN ? != '' THEN ? ELSE internal_note END,
           customer_message_draft = ?,
           updated_at = ?
         WHERE public_id = ?`,
      )
      .run(internalNote, internalNote, customerMessage, now, input.requestId);
    writeAudit({
      publicId: input.requestId,
      action: "REJECT",
      actor: input.actor,
      previousStatus: cancelled.previousStatus,
      newStatus: "CANCELLED",
      reasonCategory: input.reasonCategory,
      reasonPublic,
      internalNote,
      customerMessage,
      detail: { cancelledAppointmentIds: cancelled.cancelledAppointmentIds },
    });
    let notify = null as ReturnType<typeof enqueueCustomerNotify> | null;
    if (input.sendCustomerMessage) {
      notify = enqueueCustomerNotify({
        publicId: input.requestId,
        kind: "reject",
        channel: request.email ? "EMAIL" : "WHATSAPP_LINK",
        message: customerMessage,
        idempotencyKey: `cust-notify:reject:${input.requestId}:${input.idempotencyKey || input.reasonCategory}`,
      });
      if (isControlIsolated()) await drainCustomerNotifyOutbox(5);
    }
    logInfo("ServiceRequestRejected", { stage: input.reasonCategory, contentJobId: input.requestId.slice(0, 24) });
    return {
      ok: true as const,
      action: "reject",
      previousStatus: cancelled.previousStatus,
      newStatus: "CANCELLED",
      cancelledAppointmentIds: cancelled.cancelledAppointmentIds,
      calendarReleased: cancelled.calendarReleased,
      customerMessage,
      internalNoteStored: Boolean(internalNote),
      notify,
      previewOnly: false,
    };
  }

  if (input.action === "cancel") {
    if (CLOSED.includes(request.status as RequestStatus) && request.status === "COMPLETED") {
      return { ok: false as const, error: "not_cancellable", status: 409 };
    }
    if (request.status === "CANCELLED") {
      return { ok: true as const, action: "cancel", already: true, newStatus: "CANCELLED" };
    }
    if (!ACCEPTED_CANCELLABLE.includes(request.status as RequestStatus) && request.status !== "CONTACTED" && request.status !== "NEW") {
      return { ok: false as const, error: "not_cancellable", status: 409 };
    }
    // Prefer cancel for IN_PROGRESS; allow CONTACTED/NEW as cancel too if operator chose cancel button.
    const customerMessage =
      sanitize(input.customerMessage || "", 2000) ||
      buildCustomerDispositionMessage({
        kind: "cancel",
        reasonCategory: input.reasonCategory || "OTHER",
        reasonPublic,
        name: request.name,
      });
    if (internalNote && customerMessage.includes(internalNote)) {
      return { ok: false as const, error: "internal_note_leak", status: 400 };
    }
    const cancelled = cancelServiceRequest({
      requestId: input.requestId,
      actor: input.actor,
      source: "ADMIN",
      reason: reasonPublic || "Cancelación administrativa",
      reasonCategory: (input.reasonCategory || "OTHER") as CancellationReasonCategory,
      idempotencyKey: input.idempotencyKey || `cancel:${input.requestId}`,
      notify: true,
    });
    if (!cancelled.success && !cancelled.alreadyCancelled) {
      return { ok: false as const, error: cancelled.errorCode || "cancel_failed", status: 409 };
    }
    const now = new Date().toISOString();
    getHomesteadDb()
      .prepare(
        `UPDATE service_requests SET
           disposition_kind = 'CANCEL',
           internal_note = CASE WHEN ? != '' THEN ? ELSE internal_note END,
           customer_message_draft = ?,
           updated_at = ?
         WHERE public_id = ?`,
      )
      .run(internalNote, internalNote, customerMessage, now, input.requestId);
    writeAudit({
      publicId: input.requestId,
      action: "CANCEL",
      actor: input.actor,
      previousStatus: cancelled.previousStatus,
      newStatus: "CANCELLED",
      reasonCategory: input.reasonCategory || "OTHER",
      reasonPublic,
      internalNote,
      customerMessage,
      detail: { cancelledAppointmentIds: cancelled.cancelledAppointmentIds },
    });
    let notify = null as ReturnType<typeof enqueueCustomerNotify> | null;
    if (input.sendCustomerMessage) {
      notify = enqueueCustomerNotify({
        publicId: input.requestId,
        kind: "cancel",
        channel: request.email ? "EMAIL" : "WHATSAPP_LINK",
        message: customerMessage,
        idempotencyKey: `cust-notify:cancel:${input.requestId}:${input.idempotencyKey || "x"}`,
      });
      if (isControlIsolated()) await drainCustomerNotifyOutbox(5);
    }
    return {
      ok: true as const,
      action: "cancel",
      previousStatus: cancelled.previousStatus,
      newStatus: "CANCELLED",
      cancelledAppointmentIds: cancelled.cancelledAppointmentIds,
      calendarReleased: cancelled.calendarReleased,
      customerMessage,
      notify,
    };
  }

  if (input.action === "request_info") {
    if (CLOSED.includes(request.status as RequestStatus)) {
      return { ok: false as const, error: "request_closed", status: 409 };
    }
    const customerMessage =
      sanitize(input.customerMessage || "", 2000) ||
      buildCustomerDispositionMessage({
        kind: "request_info",
        reasonCategory: input.reasonCategory || "OTHER",
        reasonPublic,
        name: request.name,
      });
    if (internalNote && customerMessage.includes(internalNote)) {
      return { ok: false as const, error: "internal_note_leak", status: 400 };
    }
    const now = new Date().toISOString();
    getHomesteadDb()
      .prepare(
        `UPDATE service_requests SET
           internal_note = CASE WHEN ? != '' THEN ? ELSE internal_note END,
           customer_message_draft = ?,
           updated_at = ?
         WHERE public_id = ?`,
      )
      .run(internalNote, internalNote, customerMessage, now, input.requestId);
    if (request.status === "NEW") {
      updateRequestStatus(input.requestId, "CONTACTED");
    }
    writeAudit({
      publicId: input.requestId,
      action: "REQUEST_INFO",
      actor: input.actor,
      previousStatus: request.status,
      newStatus: request.status === "NEW" ? "CONTACTED" : request.status,
      reasonCategory: input.reasonCategory || "",
      reasonPublic,
      internalNote,
      customerMessage,
    });
    let notify = null as ReturnType<typeof enqueueCustomerNotify> | null;
    if (input.sendCustomerMessage) {
      notify = enqueueCustomerNotify({
        publicId: input.requestId,
        kind: "request_info",
        channel: request.email ? "EMAIL" : "WHATSAPP_LINK",
        message: customerMessage,
        idempotencyKey: `cust-notify:info:${input.requestId}:${input.idempotencyKey || now}`,
      });
      if (isControlIsolated()) await drainCustomerNotifyOutbox(5);
    }
    return { ok: true as const, action: "request_info", customerMessage, notify };
  }

  if (input.action === "reopen") {
    if (request.status !== "CANCELLED") {
      return { ok: false as const, error: "not_cancelled", status: 409 };
    }
    if (requestSecurityReviewActive(input.requestId)) {
      return { ok: false as const, error: "security_review_required", status: 409 };
    }
    const now = new Date().toISOString();
    getHomesteadDb()
      .prepare(
        `UPDATE service_requests SET
           status = 'CONTACTED',
           disposition_kind = '',
           cancelled_at = NULL,
           cancelled_by = '',
           cancellation_reason = '',
           cancellation_source = '',
           cancellation_reason_category = '',
           cancellation_idempotency_key = NULL,
           reopen_count = COALESCE(reopen_count, 0) + 1,
           last_reopened_at = ?,
           last_reopened_by = ?,
           updated_at = ?
         WHERE public_id = ?`,
      )
      .run(now, input.actor.slice(0, 120), now, input.requestId);
    try {
      setPipeline(input.requestId, "CONTACTED");
    } catch {
      /* lead may be absent */
    }
    try {
      addRevenueEvent(input.requestId, "SERVICE_REQUEST_REOPENED", {
        actor: input.actor,
        previousStatus: "CANCELLED",
      });
    } catch {
      /* optional */
    }
    writeAudit({
      publicId: input.requestId,
      action: "REOPEN",
      actor: input.actor,
      previousStatus: "CANCELLED",
      newStatus: "CONTACTED",
      reasonPublic,
      internalNote,
      detail: { note: "Cita anterior no se recupera automáticamente" },
    });
    logInfo("ServiceRequestReopened", { stage: "admin", contentJobId: input.requestId.slice(0, 24) });
    return {
      ok: true as const,
      action: "reopen",
      previousStatus: "CANCELLED",
      newStatus: "CONTACTED",
      appointmentRestored: false,
    };
  }

  return { ok: false as const, error: "unknown_action", status: 400 };
}

export function setSecurityReview(input: {
  requestId: string;
  actor: string;
  action: "set" | "resolve";
  reason?: string;
  confirm?: boolean;
}) {
  if (!assertPublicId(input.requestId)) return { ok: false as const, error: "invalid_id", status: 400 };
  if (!input.confirm) return { ok: false as const, error: "confirm_required", status: 400 };
  const request = getRequestByPublicId(input.requestId);
  if (!request) return { ok: false as const, error: "missing", status: 404 };
  const now = new Date().toISOString();
  if (input.action === "set") {
    const reason = sanitize(input.reason || "", 500);
    if (!reason) return { ok: false as const, error: "reason_required", status: 400 };
    getHomesteadDb()
      .prepare(
        `UPDATE service_requests SET
           security_review_required = 1,
           security_review_reason = ?,
           security_review_set_at = ?,
           security_review_set_by = ?,
           security_review_resolved_at = NULL,
           security_review_resolved_by = '',
           updated_at = ?
         WHERE public_id = ?`,
      )
      .run(reason, now, input.actor.slice(0, 120), now, input.requestId);
    writeAudit({
      publicId: input.requestId,
      action: "SECURITY_REVIEW_SET",
      actor: input.actor,
      previousStatus: request.status,
      newStatus: request.status,
      reasonPublic: reason,
      detail: { blocksAutoConfirm: true },
    });
    return { ok: true as const, securityReviewRequired: true, reason };
  }
  getHomesteadDb()
    .prepare(
      `UPDATE service_requests SET
         security_review_required = 0,
         security_review_resolved_at = ?,
         security_review_resolved_by = ?,
         updated_at = ?
       WHERE public_id = ?`,
    )
    .run(now, input.actor.slice(0, 120), now, input.requestId);
  writeAudit({
    publicId: input.requestId,
    action: "SECURITY_REVIEW_RESOLVED",
    actor: input.actor,
    previousStatus: request.status,
    newStatus: request.status,
  });
  return { ok: true as const, securityReviewRequired: false };
}

export function getServiceRequestDispositionView(publicId: string) {
  if (!assertPublicId(publicId)) return null;
  const row = getHomesteadDb()
    .prepare(
      `SELECT public_id, status, name, phone, email, service, message,
              COALESCE(disposition_kind,'') as disposition_kind,
              COALESCE(internal_note,'') as internal_note,
              COALESCE(customer_message_draft,'') as customer_message_draft,
              COALESCE(customer_notify_status,'NONE') as customer_notify_status,
              COALESCE(customer_notify_channel,'') as customer_notify_channel,
              COALESCE(customer_notify_last_error,'') as customer_notify_last_error,
              COALESCE(security_review_required,0) as security_review_required,
              COALESCE(security_review_reason,'') as security_review_reason,
              security_review_set_at, security_review_set_by,
              security_review_resolved_at, security_review_resolved_by,
              COALESCE(cancellation_reason,'') as cancellation_reason,
              COALESCE(cancellation_reason_category,'') as cancellation_reason_category,
              COALESCE(reopen_count,0) as reopen_count
       FROM service_requests WHERE public_id = ?`,
    )
    .get(publicId) as
    | {
        public_id: string;
        status: string;
        name: string;
        phone: string;
        email: string;
        service: string;
        message: string;
        disposition_kind: string;
        internal_note: string;
        customer_message_draft: string;
        customer_notify_status: string;
        customer_notify_channel: string;
        customer_notify_last_error: string;
        security_review_required: number;
        security_review_reason: string;
        security_review_set_at: string | null;
        security_review_set_by: string;
        security_review_resolved_at: string | null;
        security_review_resolved_by: string;
        cancellation_reason: string;
        cancellation_reason_category: string;
        reopen_count: number;
      }
    | undefined;
  if (!row) return null;
  const openAppointments = listOpenAppointmentsForLead(publicId);
  const relatedAppointment = openAppointments[0]
    ? {
        appointmentId: openAppointments[0].appointment_id,
        date: openAppointments[0].date,
        startTime: openAppointments[0].start_time,
        status: openAppointments[0].status,
      }
    : null;
  const history = listRequestAudit(publicId).map((h) => ({
    id: h.id,
    action: h.action,
    actor: h.actor,
    previousStatus: h.previous_status,
    newStatus: h.new_status,
    reasonCategory: h.reason_category,
    reasonPublic: h.reason_public,
    // Internal note only for admin payloads — never for public/customer serializers.
    internalNote: h.internal_note,
    note: h.reason_public || h.action,
    customerMessage: h.customer_message,
    at: h.created_at,
    createdAt: h.created_at,
    internal: Boolean(h.internal_note),
  }));
  const status = isRequestStatus(row.status) ? row.status : row.status;
  return {
    publicId: row.public_id,
    status,
    name: row.name,
    phone: row.phone,
    email: row.email,
    service: row.service,
    message: row.message,
    dispositionKind: row.disposition_kind,
    internalNote: row.internal_note,
    customerMessageDraft: row.customer_message_draft,
    customerNotifyStatus: row.customer_notify_status,
    customerNotifyChannel: row.customer_notify_channel,
    customerNotifyLastError: row.customer_notify_last_error,
    securityReviewRequired: Boolean(row.security_review_required),
    securityReviewReason: row.security_review_reason,
    securityReviewSetAt: row.security_review_set_at,
    securityReviewSetBy: row.security_review_set_by,
    securityReviewResolvedAt: row.security_review_resolved_at,
    securityReviewResolvedBy: row.security_review_resolved_by,
    cancellationReason: row.cancellation_reason,
    cancellationReasonCategory: row.cancellation_reason_category,
    reopenCount: row.reopen_count,
    openAppointments,
    relatedAppointment,
    history,
    availableActions: {
      reject: PENDING_REJECTABLE.includes(status as RequestStatus),
      cancel: status === "IN_PROGRESS" || status === "CONTACTED" || status === "NEW",
      requestInfo: status !== "CANCELLED" && status !== "COMPLETED",
      reopen: status === "CANCELLED",
      setSecurityReview: !row.security_review_required,
      resolveSecurityReview: Boolean(row.security_review_required),
    },
    rejectReasonCategories: REJECT_REASON_CATEGORIES.map((id) => ({
      id,
      label: REJECT_REASON_LABELS[id],
    })),
  };
}

// silence unused import warning if enqueueOutbox unused in some builds
void enqueueOutbox;
