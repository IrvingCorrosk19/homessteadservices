/**
 * Structured turn-state tracing (sanitized; no raw PII in production logs).
 */
import type { ConversationState } from "@/lib/concierge-store";
import { getDigitalLockChecklist } from "@/lib/concierge/digital-lock-vision";
import { getAvailabilityState } from "@/lib/concierge/slot-state";
import { logInfo } from "@/lib/log";

export type TurnStateSnapshot = {
  conversationId: string;
  messageId: string;
  sequence: string;
  stateVersion: string;
  attachmentCount: number;
  previousActiveService: string;
  previousRequestId: string;
  previousServiceContextId: string;
  previousPendingAction: string;
  previousOfferedSlotCount: number;
  previousSelectedSlot: string;
  detectedTransition: string;
  mergedActiveService: string;
  mergedRequestId: string;
  mergedServiceContextId: string;
  nextAction: string;
  responseSource: string;
  finalResponseServiceContext: string;
};

function mask(value: string) {
  if (!value) return "";
  if (value.length <= 4) return "****";
  return `${value.slice(0, 4)}…`;
}

export function logTurnStateTrace(input: {
  conversationId: string;
  stage: string;
  before: ConversationState;
  after?: ConversationState;
  transition?: string;
  attachmentCount?: number;
  nextAction?: string;
  responseSource?: string;
}) {
  const before = input.before;
  const after = input.after || before;
  const lock = getDigitalLockChecklist(before);
  logInfo("CONVERSATION_STATE_TRACE", {
    contentJobId: input.conversationId.slice(0, 8),
    stage: input.stage,
    sequence: before.facts?.conversationGeneration || "0",
    stateVersion: after.facts?.stateVersion || before.facts?.stateVersion || "0",
    attachmentCount: String(input.attachmentCount ?? 0),
    previousActiveService: before.primaryService || before.service || "",
    previousRequestId: mask(before.activeLeadId || ""),
    previousServiceContextId: before.facts?.serviceContextId || "",
    previousPendingAction: (before.facts?.pendingAction || "").slice(0, 32),
    previousOfferedSlotCount: String(before.offeredSlots?.length || 0),
    previousSelectedSlot: before.pendingSlot?.time || before.facts?.selectedTime || "",
    detectedTransition: input.transition || "",
    mergedActiveService: after.primaryService || after.service || "",
    mergedRequestId: mask(after.activeLeadId || ""),
    mergedServiceContextId: after.facts?.serviceContextId || "",
    availabilityState: getAvailabilityState(after),
    lockActive: lock.active ? "1" : "0",
    lockAbandoned: after.facts?.digitalLockAbandoned === "1" ? "1" : "0",
    nextAction: (input.nextAction || "").slice(0, 32),
    responseSource: input.responseSource || "",
  });
}
