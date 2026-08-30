/**
 * Full conversational reset — transactional invalidation of active business context.
 * Preserves customer/property facts; ends active service, HS, photos, slots, pending actions.
 */
import type { ConversationState } from "@/lib/concierge-store";
import { logInfo } from "@/lib/log";
import { updateRequestStatus } from "@/lib/service-requests";
import { clearServiceScopedState } from "@/lib/concierge/service-transition";
import { bumpStateVersion } from "@/lib/concierge/turn-context-guards";

/** Typo-tolerant full reset (not jailbreak "olvida instrucciones"). */
export const RESET_CONVERSATION_RE =
  /\b(olv[ií]?d(a|e)\s+todo|olvidemos\s+todo|dejemos\s+todo|cancela\s+todo|empecemos\s+de\s+nuevo|quiero\s+empezar\s+de\s+cero|nueva\s+consulta|reinici(ar|emos)\s+(la\s+)?(charla|conversaci[oó]n)|oldida\s+todo)\b/i;

export function detectFullConversationReset(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/instrucciones|system prompt|api key/i.test(trimmed)) return false;
  return RESET_CONVERSATION_RE.test(trimmed);
}

export type ConversationResetResult = {
  state: ConversationState;
  clearedLeadId: string;
  conversationGeneration: string;
};

/**
 * Transactionally end active conversational context.
 * Historical messages remain in DB; active UI state must clear.
 */
export function applyFullConversationReset(
  state: ConversationState,
  opts: { cancelExistingHs?: boolean; conversationId?: string } = {},
): ConversationResetResult {
  const oldHs = state.activeLeadId || state.facts?.lastActiveRequestId || "";
  if (opts.cancelExistingHs !== false && oldHs && !oldHs.startsWith("DRY-")) {
    try {
      updateRequestStatus(oldHs, "CANCELLED");
      logInfo("CONVERSATION_RESET_HS_CANCELLED", {
        contentJobId: (opts.conversationId || oldHs).slice(0, 16),
        stage: oldHs.slice(0, 16),
      });
    } catch {
      // best-effort
    }
  }

  const generation = String(Number(state.facts?.conversationGeneration || "0") + 1);
  let next = clearServiceScopedState({
    ...state,
    activeLeadId: "",
    primaryService: "",
    service: "",
    problem: "",
    detectedServices: [],
    secondaryServices: [],
    appointmentId: "",
    photoCount: 0,
    bookingIntent: false,
    bookingStrategy: "",
    bookingSuspended: false,
    funnelStage: "DISCOVERY",
    historicalSlotLabels: [],
    humanRequested: false,
    humanHandoffRequested: false,
    needsReview: false,
  });

  next = bumpStateVersion({
    ...next,
    facts: {
      ...(next.facts || {}),
      conversationGeneration: generation,
      activeRequestCleared: "1",
      lastActiveRequestId: oldHs,
      resetAt: new Date().toISOString(),
      pendingAction: "",
      pendingQuestion: "",
      pendingPhotoRequirement: "",
      pendingActionService: "",
      pendingActionServiceContextId: "",
      digitalLockAbandoned: "1",
      slotConfirmed: "",
      slotStatus: "",
      selectedDate: "",
      selectedTime: "",
      selectedSlotLabel: "",
      availabilityState: "NONE",
    },
  });

  logInfo("CONVERSATION_RESET_APPLIED", {
    contentJobId: (opts.conversationId || "conv").slice(0, 8),
    stage: generation,
  });

  return { state: next, clearedLeadId: oldHs, conversationGeneration: generation };
}

export function markActiveRequest(state: ConversationState, publicId: string): ConversationState {
  if (!publicId) return state;
  return {
    ...state,
    activeLeadId: publicId,
    facts: {
      ...(state.facts || {}),
      activeRequestCleared: "",
      lastActiveRequestId: publicId,
    },
  };
}

export function shouldRehydrateLeadFromColumn(state: ConversationState, columnLeadId: string): boolean {
  if (!columnLeadId || columnLeadId.startsWith("DRY-")) return false;
  if (state.activeLeadId) return false;
  if (state.facts?.activeRequestCleared === "1") return false;
  if (state.funnelStage === "BOOKED" && state.appointmentId) return true;
  const hasActiveService = Boolean(state.primaryService || state.service);
  const hasActiveTransaction =
    Boolean(state.awaitingSlotSelection && state.offeredSlots?.length) ||
    Boolean(state.pendingSlot) ||
    state.funnelStage === "BOOKING" ||
    state.funnelStage === "HANDOFF";
  return hasActiveService || hasActiveTransaction;
}
