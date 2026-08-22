import { getRequestByPublicId, recordTelegramNotified } from "@/lib/service-requests";
import { postN8nPayload } from "@/lib/n8n";
import { logError, logInfo } from "@/lib/log";
import {
  claimOutboxEvent,
  getOutboxById,
  listDueOutbox,
  markOutboxDelivered,
  markOutboxRetry,
  markOutboxSkipped,
  type AutomationEnvelope,
} from "@/lib/automation-outbox";

export function isAutomationDispatchEnabled() {
  return process.env.AUTOMATION_DISPATCH_ENABLED !== "false";
}

export function shouldForceN8nFailure() {
  return process.env.AUTOMATION_N8N_FAIL === "true";
}

async function deliverOpsEvent(data: Record<string, unknown>, eventType: string) {
  if (String(data.event || "") === "ops.telegram.alert" || eventType.startsWith("lead.") || eventType.startsWith("sla.") || eventType.startsWith("daily.")) {
    const { deliverOpsTelegram } = await import("@/lib/ops-telegram");
    return deliverOpsTelegram(data);
  }
  return { ok: false as const, cause: "unknown_event" };
}

export async function drainAutomationOutbox(limit = 8) {
  if (!isAutomationDispatchEnabled()) return { claimed: 0, delivered: 0, failed: 0 };
  const due = listDueOutbox(limit);
  let delivered = 0;
  let failed = 0;
  let claimed = 0;
  for (const item of due) {
    const row = claimOutboxEvent(item.eventId);
    if (!row) continue;
    claimed += 1;
    const started = Date.now();
    logInfo("AutomationDispatchStarted", {
      eventId: row.eventId,
      eventType: row.eventType,
      correlationId: row.correlationId,
      attempt: row.attempts,
    });
    try {
      if (shouldForceN8nFailure()) {
        throw new Error("forced_n8n_fail");
      }
      const envelope = JSON.parse(row.payloadJson) as AutomationEnvelope;
      const eventType = row.eventType || envelope.eventType;
      const result =
        eventType === "service_request.created"
          ? await postN8nPayload(envelope.data as never, {
              eventId: row.eventId,
              idempotencyKey: row.idempotencyKey,
              correlationId: row.correlationId,
            })
          : await deliverOpsEvent(envelope.data, eventType);
      if (!result.ok) {
        if (result.cause === "not_configured") {
          markOutboxSkipped(row.eventId, "n8n_not_configured");
          failed += 1;
          logInfo("AutomationDispatchFailed", {
            eventId: row.eventId,
            eventType: row.eventType,
            correlationId: row.correlationId,
            attempt: row.attempts,
            durationMs: Date.now() - started,
          });
          continue;
        }
        markOutboxRetry(row.eventId, result.cause);
        failed += 1;
        logError("AutomationDispatchFailed", {
          eventId: row.eventId,
          eventType: row.eventType,
          correlationId: row.correlationId,
          attempt: row.attempts,
          durationMs: Date.now() - started,
        });
        continue;
      }
      markOutboxDelivered(row.eventId);
      if (eventType === "service_request.created") {
        const saved = getRequestByPublicId(row.correlationId);
        if (saved) recordTelegramNotified(saved);
      }
      delivered += 1;
      logInfo("AutomationDispatchSucceeded", {
        eventId: row.eventId,
        eventType: row.eventType,
        correlationId: row.correlationId,
        attempt: row.attempts,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      const cause = error instanceof Error ? error.message.slice(0, 80) : "unknown";
      markOutboxRetry(row.eventId, cause);
      failed += 1;
      logError("AutomationDispatchFailed", {
        eventId: row.eventId,
        eventType: row.eventType,
        correlationId: row.correlationId,
        attempt: row.attempts,
        durationMs: Date.now() - started,
      });
    }
  }
  return { claimed, delivered, failed };
}

export async function replayAndDrain(eventId: string) {
  const { replayOutboxEvent } = await import("@/lib/automation-outbox");
  const replay = replayOutboxEvent(eventId);
  if (!replay.ok) return replay;
  await drainAutomationOutbox(5);
  const fresh = getOutboxById(eventId);
  if (fresh?.status === "DELIVERED") {
    logInfo("AutomationReplaySucceeded", {
      eventId,
      eventType: fresh.eventType,
      correlationId: fresh.correlationId,
    });
  }
  return { ...replay, status: fresh?.status || "" };
}

