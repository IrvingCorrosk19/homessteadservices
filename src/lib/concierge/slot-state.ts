/**
 * Deterministic slot availability state machine.
 */
import { randomUUID } from "crypto";
import type { ConversationState, OfferedSlot } from "@/lib/concierge-store";
import { formatPanamaSlot } from "@/lib/concierge-datetime";
import { isSlotConfirmed, lockSelectedSlot } from "@/lib/concierge/canonical-state";
import { logInfo } from "@/lib/log";

export type AvailabilityState =
  | "NONE"
  | "REQUESTED"
  | "QUERYING"
  | "OFFERED"
  | "SELECTED"
  | "REVALIDATING"
  | "BOOKED";

export function withSlotIds(slots: OfferedSlot[], queryId: string): OfferedSlot[] {
  return slots.map((slot, index) => ({
    ...slot,
    slotId: slot.slotId || `${queryId}-${index}-${slot.date}-${slot.time}`,
  }));
}

export function getAvailabilityState(state: ConversationState): AvailabilityState {
  const explicit = state.facts?.availabilityState as AvailabilityState | undefined;
  if (state.appointmentId) return "BOOKED";
  if (isSlotConfirmed(state)) return explicit === "REVALIDATING" ? "REVALIDATING" : "SELECTED";
  if (state.awaitingSlotSelection && state.offeredSlots?.length) return "OFFERED";
  if (state.facts?.lastAvailabilityQuery) return "REQUESTED";
  return explicit || "NONE";
}

export function markAvailabilityState(state: ConversationState, next: AvailabilityState): ConversationState {
  return {
    ...state,
    facts: {
      ...(state.facts || {}),
      availabilityState: next,
    },
  };
}

export function activateOfferedSlotsWithState(
  state: ConversationState,
  slots: OfferedSlot[],
): ConversationState {
  const queryId = randomUUID().slice(0, 8);
  const withIds = withSlotIds(slots, queryId);
  return markAvailabilityState(
    {
      ...state,
      offeredSlots: withIds,
      pendingSlot: null,
      awaitingSlotSelection: withIds.length > 0,
      slotOfferToken: randomUUID(),
      lastAvailabilityAt: new Date().toISOString(),
      funnelStage: "BOOKING",
      bookingSuspended: false,
      facts: {
        ...(state.facts || {}),
        availabilityQueryId: queryId,
        slotConfirmed: "",
        slotStatus: "",
        selectedDate: "",
        selectedTime: "",
        selectedSlotLabel: "",
      },
    },
    "OFFERED",
  );
}

export function selectOfferedSlot(state: ConversationState, slot: OfferedSlot): ConversationState {
  let next = lockSelectedSlot(state, slot);
  next = {
    ...next,
    offeredSlots: [],
    awaitingSlotSelection: false,
    slotOfferToken: "",
    facts: {
      ...(next.facts || {}),
      selectedSlotId: slot.slotId || "",
      availabilityState: "SELECTED",
    },
  };
  return next;
}

export function formatSlotSelectionConfirmation(state: ConversationState): string {
  const slot = state.pendingSlot;
  if (!slot?.date || !slot?.time) {
    return "Anoto ese horario. Reviso que siga libre en la agenda.";
  }
  const label = slot.label || formatPanamaSlot(slot.date, slot.time);
  return `${label} queda seleccionado. Reviso que siga libre y confirmo la visita.`;
}

export function shouldBlockStaleSlotOffer(
  state: ConversationState,
  action: string,
  userJustSelectedSlot: boolean,
): boolean {
  if (!userJustSelectedSlot) return false;
  if (getAvailabilityState(state) !== "SELECTED" && !isSlotConfirmed(state)) return false;
  return /OFFER|QUERY_AVAILABILITY|ASK_SLOT/i.test(action) || /estos horarios|cu[aá]l te queda mejor/i.test(action);
}

export function logStaleNextActionBlocked(conversationId: string, action: string) {
  logInfo("STALE_NEXT_ACTION_BLOCKED", {
    contentJobId: conversationId.slice(0, 8),
    stage: action.slice(0, 40),
  });
}
