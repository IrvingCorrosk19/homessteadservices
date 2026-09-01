/**
 * Authoritative customer/ops HS cancellation.
 * Soft-status only. Linked open HA cancelled in the same transaction.
 */
import { getHomesteadDb, getRequestByPublicId, isRequestEligibleForAppointment } from "@/lib/service-requests";
import { enqueueOutbox } from "@/lib/automation-outbox";
import { logInfo, logError } from "@/lib/log";
import {
  addRevenueEvent,
  getLead,
  setAppointmentStatus,
  setPipeline,
} from "@/lib/revenue-store";
import { isConciergeDryRun } from "@/lib/concierge-flags";
import { PUBLIC_ID_PATTERN } from "@/lib/admin-format";
import {
  classifyCancellationReason,
  type CancellationReasonCategory,
} from "@/lib/concierge/cancellation-intent";

export const CANCELLATION_SOURCES = [
  "CUSTOMER_AI",
  "ADMIN",
  "OPERATIONS_AI",
  "TELEGRAM",
  "SYSTEM",
] as const;

export type CancellationSource = (typeof CANCELLATION_SOURCES)[number];

export type { CancellationReasonCategory };

export type CancelServiceRequestInput = {
  requestId: string;
  actor: string;
  source: CancellationSource;
  reason?: string;
  reasonCategory?: CancellationReasonCategory;
  conversationId?: string;
  idempotencyKey?: string;
  notify?: boolean;
};

export type CancelServiceRequestResult = {
  success: boolean;
  requestId: string;
  previousStatus: string;
  newStatus: string;
  cancelledAppointmentIds: string[];
  calendarReleased: boolean;
  alreadyCancelled: boolean;
  auditEventId: string;
  errorCode?: string;
  reasonStored: string;
  reasonCategory: CancellationReasonCategory;
};

export type CancelAppointmentOnlyInput = {
  appointmentId: string;
  actor: string;
  source: CancellationSource;
  reason?: string;
  requestId?: string;
};

export type CancelAppointmentOnlyResult = {
  success: boolean;
  appointmentId: string;
  requestId: string;
  requestStillActive: boolean;
  alreadyCancelled: boolean;
  calendarReleased: boolean;
  errorCode?: string;
};

const OPEN_HA = ["REQUESTED", "PROPOSED", "CONFIRMED", "RESCHEDULED"] as const;

function sanitizeReason(raw: string) {
  return raw.replace(/\s+/g, " ").trim().slice(0, 280);
}

export function listOpenAppointmentsForLead(leadId: string) {
  return getHomesteadDb()
    .prepare(
      `SELECT appointment_id, date, start_time, status FROM revenue_appointments
       WHERE lead_id = ? AND status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED')
       ORDER BY date ASC, start_time ASC`,
    )
    .all(leadId) as Array<{ appointment_id: string; date: string; start_time: string; status: string }>;
}

function resolveCancelledSignals(database: ReturnType<typeof getHomesteadDb>, requestId: string) {
  try {
    database
      .prepare(
        `UPDATE operational_signals
         SET status = 'RESOLVED', resolved_at = datetime('now'), updated_at = datetime('now')
         WHERE request_id = ?
           AND status NOT IN ('RESOLVED','EXPIRED','SUPERSEDED')
           AND signal_type IN (
             'APPOINTMENT_UPCOMING','APPOINTMENT_TODAY','CUSTOMER_WAITING',
             'REQUEST_WITHOUT_NEXT_STEP','REQUEST_AGING','REQUIREMENT_MISSING_BEFORE_VISIT'
           )`,
      )
      .run(requestId);
  } catch {
    // operational_signals may not exist in a fresh partial schema
  }
}

export function cancelServiceRequest(input: CancelServiceRequestInput): CancelServiceRequestResult {
  const requestId = String(input.requestId || "").trim().toUpperCase();
  const empty: CancelServiceRequestResult = {
    success: false,
    requestId,
    previousStatus: "",
    newStatus: "",
    cancelledAppointmentIds: [],
    calendarReleased: false,
    alreadyCancelled: false,
    auditEventId: "",
    reasonStored: "",
    reasonCategory: "NOT_PROVIDED",
  };
  if (!PUBLIC_ID_PATTERN.test(requestId)) {
    return { ...empty, errorCode: "INVALID_ID" };
  }

  const classified =
    input.reasonCategory && input.reason
      ? { category: input.reasonCategory, reason: sanitizeReason(input.reason) }
      : input.reason
        ? classifyCancellationReason(input.reason)
        : { category: (input.reasonCategory || "NOT_PROVIDED") as CancellationReasonCategory, reason: sanitizeReason(input.reason || "") };
  const notify = input.notify !== false;
  const idempotencyKey = input.idempotencyKey || `service_request.cancelled:${requestId}`;
  const actor = (input.actor || input.source || "SYSTEM").slice(0, 80);
  const source = CANCELLATION_SOURCES.includes(input.source) ? input.source : "SYSTEM";

  try {
    const database = getHomesteadDb();
    const result = database.transaction((): CancelServiceRequestResult => {
      const current = getRequestByPublicId(requestId);
      if (!current) {
        return { ...empty, errorCode: "NOT_FOUND" };
      }
      if (current.status === "COMPLETED") {
        return {
          ...empty,
          previousStatus: "COMPLETED",
          newStatus: "COMPLETED",
          errorCode: "NOT_CANCELLABLE",
        };
      }
      if (current.status === "CANCELLED") {
        return {
          success: true,
          requestId,
          previousStatus: "CANCELLED",
          newStatus: "CANCELLED",
          cancelledAppointmentIds: [],
          calendarReleased: true,
          alreadyCancelled: true,
          auditEventId: idempotencyKey,
          reasonStored: current.cancellationReason || "",
          reasonCategory: (current.cancellationReasonCategory as CancellationReasonCategory) || "NOT_PROVIDED",
        };
      }

      const openHa = listOpenAppointmentsForLead(requestId);
      const cancelledAppointmentIds: string[] = [];
      for (const row of openHa) {
        setAppointmentStatus(row.appointment_id, "CANCELLED");
        cancelledAppointmentIds.push(row.appointment_id);
      }

      const now = new Date().toISOString();
      const update = database.prepare(
        `UPDATE service_requests
         SET status = 'CANCELLED',
             updated_at = ?,
             cancelled_at = ?,
             cancelled_by = ?,
             cancellation_reason = ?,
             cancellation_source = ?,
             cancellation_reason_category = ?,
             cancellation_idempotency_key = COALESCE(cancellation_idempotency_key, ?)
         WHERE public_id = ? AND status NOT IN ('CANCELLED','COMPLETED')`,
      );
      const info = update.run(
        now,
        now,
        actor,
        classified.reason,
        source,
        classified.category,
        idempotencyKey,
        requestId,
      );
      if (info.changes !== 1) {
        const raced = getRequestByPublicId(requestId);
        if (raced?.status === "CANCELLED") {
          return {
            success: true,
            requestId,
            previousStatus: current.status,
            newStatus: "CANCELLED",
            cancelledAppointmentIds,
            calendarReleased: true,
            alreadyCancelled: true,
            auditEventId: idempotencyKey,
            reasonStored: raced.cancellationReason || classified.reason,
            reasonCategory: (raced.cancellationReasonCategory as CancellationReasonCategory) || classified.category,
          };
        }
        return { ...empty, previousStatus: current.status, errorCode: "FAILED" };
      }

      if (getLead(requestId)) {
        setPipeline(requestId, "CANCELLED", { lostReason: classified.reason || "customer_cancelled" });
      }
      addRevenueEvent(requestId, "SERVICE_REQUEST_CANCELLED");
      for (const haId of cancelledAppointmentIds) {
        addRevenueEvent(requestId, "APPOINTMENT_CANCELLED_WITH_REQUEST");
        void haId;
      }
      resolveCancelledSignals(database, requestId);

      if (notify) {
        enqueueOutbox(database, {
          eventType: "service_request.cancelled",
          correlationId: requestId,
          idempotencyKey,
          data: {
            event: "SERVICE_REQUEST_CANCELLED",
            requestId,
            service: current.service,
            actor,
            source,
            reasonCategory: classified.category,
            reason: classified.reason.slice(0, 160),
            cancelledAppointmentIds,
            conversationId: input.conversationId || "",
            occurredAt: now,
          },
        });
      }

      return {
        success: true,
        requestId,
        previousStatus: current.status,
        newStatus: "CANCELLED",
        cancelledAppointmentIds,
        calendarReleased: true,
        alreadyCancelled: false,
        auditEventId: idempotencyKey,
        reasonStored: classified.reason,
        reasonCategory: classified.category,
      };
    })();

    if (result.success) {
      logInfo("SERVICE_REQUEST_CANCELLED", {
        contentJobId: requestId,
        stage: `${result.alreadyCancelled ? "idempotent" : "ok"}:${result.cancelledAppointmentIds.length}`,
      });
    }
    return result;
  } catch (error) {
    logError("SERVICE_REQUEST_CANCEL_FAILED", {
      contentJobId: requestId,
      cause: error instanceof Error ? error.message.slice(0, 80) : "unknown",
    });
    return { ...empty, errorCode: "FAILED" };
  }
}

export function cancelAppointmentOnly(input: CancelAppointmentOnlyInput): CancelAppointmentOnlyResult {
  const appointmentId = String(input.appointmentId || "").trim();
  if (!appointmentId) {
    return {
      success: false,
      appointmentId: "",
      requestId: "",
      requestStillActive: true,
      alreadyCancelled: false,
      calendarReleased: false,
      errorCode: "NOT_FOUND",
    };
  }
  const database = getHomesteadDb();
  const row = database
    .prepare(
      `SELECT appointment_id, lead_id, status FROM revenue_appointments WHERE appointment_id = ?`,
    )
    .get(appointmentId) as { appointment_id: string; lead_id: string; status: string } | undefined;
  if (!row) {
    return {
      success: false,
      appointmentId,
      requestId: "",
      requestStillActive: true,
      alreadyCancelled: false,
      calendarReleased: false,
      errorCode: "NOT_FOUND",
    };
  }
  const request = getRequestByPublicId(row.lead_id);
  const requestStillActive = Boolean(request && request.status !== "CANCELLED" && request.status !== "COMPLETED");
  if (row.status === "CANCELLED") {
    return {
      success: true,
      appointmentId,
      requestId: row.lead_id,
      requestStillActive,
      alreadyCancelled: true,
      calendarReleased: true,
    };
  }
  if (row.status === "COMPLETED" || !OPEN_HA.includes(row.status as (typeof OPEN_HA)[number])) {
    return {
      success: false,
      appointmentId,
      requestId: row.lead_id,
      requestStillActive,
      alreadyCancelled: false,
      calendarReleased: false,
      errorCode: "NOT_CANCELLABLE",
    };
  }
  setAppointmentStatus(appointmentId, "CANCELLED");
  enqueueOutbox(database, {
    eventType: "appointment.cancelled",
    correlationId: row.lead_id,
    idempotencyKey: `appointment.cancelled:${appointmentId}`,
    data: {
      event: "APPOINTMENT_CANCELLED",
      requestId: row.lead_id,
      appointmentId,
      actor: input.actor,
      source: input.source,
      requestStillActive: true,
      reason: sanitizeReason(input.reason || "").slice(0, 160),
    },
  });
  return {
    success: true,
    appointmentId,
    requestId: row.lead_id,
    requestStillActive,
    alreadyCancelled: false,
    calendarReleased: true,
  };
}

export function requestStillBookable(requestId: string) {
  return isRequestEligibleForAppointment(requestId);
}

export function shouldNotifyCancellation(dryRun = isConciergeDryRun()) {
  return !dryRun;
}
