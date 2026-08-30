import { randomUUID } from "crypto";
import type { ConversationState, OfferedSlot } from "@/lib/concierge-store";
import { parseClock } from "@/lib/concierge-datetime";
import type { AvailabilitySlot } from "@/lib/concierge-availability";
import type { SlotGroup } from "@/lib/concierge-turn-routing";
import { buildSlotGroups, serviceContextLabel } from "@/lib/concierge-turn-routing";
import { getPlaybook } from "@/lib/concierge/service-playbooks";
import { resolvePrimaryFromMessage } from "@/lib/concierge/service-intent";
import { buildRequestCard } from "@/lib/concierge/service-request-lifecycle";
import { photosRemainingFromCount } from "@/lib/concierge-photo-cta";
import {
  emptyDigitalLockChecklist,
  getDigitalLockChecklist,
  setDigitalLockChecklist,
} from "@/lib/concierge/digital-lock-vision";
import { detectReprogramAppointmentIntent, REPROGRAM_APPOINTMENT_RE } from "@/lib/concierge/appointment-reprogram";
import {
  isSlotConfirmed,
  lockSelectedSlot,
  hasRescheduleSignal,
} from "@/lib/concierge/canonical-state";

/** Business TTL: offered horarios dejan de ser accionables. */
export const OFFERED_SLOTS_TTL_MS = 45 * 60 * 1000;

export type ActiveSessionSnapshot = {
  chips: string[];
  historicalChips: string[];
  leadBanner: string | null;
  requestCard: {
    publicId: string;
    serviceLabel: string;
    status: "open" | "scheduled";
    when: string;
  } | null;
  awaitingSlotSelection: boolean;
  bookingPending: boolean;
  slotGroups: SlotGroup[];
  serviceContext: string | null;
  showResumeBooking: boolean;
  showPhotoCta: boolean;
  photosRemaining: number;
};

const SLOT_PICK =
  /\b(me sirve|ese horario|la de las|confirmo|agendar|visita|ese d[ií]a|a las)\b/i;
const TIME_HINT = /\d{1,2}(:\d{2})?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?/i;
const NEW_NEED =
  /\b(ahora|mejor|en realidad|otra cosa|tambi[eé]n necesito|diferente|en vez|cambiar de|primero necesito|nuevo|otra solicitud)\b/i;
const RESCHEDULE = /\b(reprogram|cambiar (la )?cita|mover (la )?cita|otro horario)\b/i;

function normalizeLabel(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasSlotSelectionSignal(text: string) {
  return SLOT_PICK.test(text) || TIME_HINT.test(text);
}

export function isReturningGreeting(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (hasSlotSelectionSignal(trimmed)) return false;
  if (/^(hola|buenas|buenos d[ií]as|hey)[\s!.?]*$/i.test(trimmed)) return true;
  if (/hola.*(otra vez|de nuevo|volv[ií])/i.test(trimmed)) return true;
  if (/^(soy yo|volv[ií]|aqu[ií] estoy)[\s!.?]*$/i.test(trimmed)) return true;
  return false;
}

export function slotsAreExpired(state: ConversationState, now = Date.now()) {
  if (!state.lastAvailabilityAt) return true;
  const age = now - Date.parse(state.lastAvailabilityAt);
  return !Number.isFinite(age) || age > OFFERED_SLOTS_TTL_MS;
}

export function areOfferedSlotsActive(state: ConversationState, now = Date.now()) {
  if (!state.awaitingSlotSelection) return false;
  if (!state.offeredSlots?.length) return false;
  if (slotsAreExpired(state, now)) return false;
  return true;
}

export function isActiveTransaction(state: ConversationState, now = Date.now()) {
  if (areOfferedSlotsActive(state, now)) return true;
  if (state.awaitingSlotSelection && state.activeLeadId) return true;
  if (state.funnelStage === "BOOKING" || state.funnelStage === "HANDOFF") return true;
  return false;
}

export function clearActiveTransactionState(state: ConversationState, archiveSlots = false): ConversationState {
  const archived = archiveSlots
    ? [...new Set([...(state.historicalSlotLabels || []), ...state.offeredSlots.map((slot) => slot.label)])].slice(-6)
    : state.historicalSlotLabels || [];
  return {
    ...state,
    offeredSlots: [],
    pendingSlot: null,
    awaitingSlotSelection: false,
    slotOfferToken: "",
    bookingIntent: false,
    bookingSuspended: false,
    historicalSlotLabels: archived,
    funnelStage: state.appointmentId ? "BOOKED" : state.funnelStage || "DISCOVERY",
  };
}

export { isSlotConfirmed, lockSelectedSlot, hasRescheduleSignal };

export function activateOfferedSlots(state: ConversationState, slots: OfferedSlot[]): ConversationState {
  const confirmed = isSlotConfirmed(state);
  return {
    ...state,
    offeredSlots: slots,
    pendingSlot: confirmed ? state.pendingSlot : null,
    awaitingSlotSelection: confirmed ? false : slots.length > 0,
    slotOfferToken: randomUUID(),
    lastAvailabilityAt: new Date().toISOString(),
    funnelStage: "BOOKING",
    bookingSuspended: false,
  };
}

export function consumeOfferedSlots(state: ConversationState, slot: OfferedSlot): ConversationState {
  return {
    ...state,
    offeredSlots: [],
    pendingSlot: slot,
    awaitingSlotSelection: false,
    slotOfferToken: "",
    funnelStage: "BOOKED",
  };
}

function isTimeRescheduleMessage(text: string, state: ConversationState) {
  if (REPROGRAM_APPOINTMENT_RE.test(text)) return true;
  if (hasRescheduleSignal(text) && /\d/.test(text)) return true;
  if (detectReprogramAppointmentIntent(text, state)) return true;
  return false;
}

export function detectNewTransactionSignal(state: ConversationState, text: string, nextPrimary = "") {
  if (state.appointmentId && isTimeRescheduleMessage(text, state)) {
    return false;
  }
  if (state.activeLeadId && isTimeRescheduleMessage(text, state)) {
    return false;
  }
  const latest = nextPrimary || resolvePrimaryFromMessage(text);
  if (latest && state.primaryService && latest !== state.primaryService) return true;
  if (nextPrimary && state.primaryService && nextPrimary !== state.primaryService) return true;
  if (NEW_NEED.test(text) && text.trim().length > 12) return true;
  return false;
}

export function reconcileTransactionState(
  state: ConversationState,
  text: string,
  conversationLeadId: string,
): ConversationState {
  let next: ConversationState = {
    ...state,
    activeLeadId: state.activeLeadId || "",
  };

  // lead_public_id column mirrors state at end of turn — never rehydrate (prevents zombie HS).

  if (!areOfferedSlotsActive(next) && next.offeredSlots.length && !isSlotConfirmed(next)) {
    next = clearActiveTransactionState(next);
  }

  if (isReturningGreeting(text) && (next.offeredSlots.length || next.awaitingSlotSelection)) {
    next = clearActiveTransactionState(next, true);
    next.activeLeadId = "";
    next.funnelStage = "DISCOVERY";
  }

  if (detectNewTransactionSignal(next, text, resolvePrimaryFromMessage(text) || next.primaryService)) {
    next = clearActiveTransactionState(next, true);
    next.activeLeadId = "";
    next.appointmentId = "";
    next.funnelStage = "DISCOVERY";
    // CRITICAL: evidence from a prior request must not satisfy a new digital-lock case
    const prior = getDigitalLockChecklist(next);
    if (prior.active || prior.front || prior.inside || prior.edge) {
      next = setDigitalLockChecklist(next, emptyDigitalLockChecklist());
    }
  }

  return next;
}

export function matchOfferedSlotLabel(text: string, slots: OfferedSlot[]) {
  const needle = normalizeLabel(text);
  if (!needle) return null;
  return (
    slots.find((slot) => normalizeLabel(slot.label) === needle) ||
    slots.find((slot) => needle.includes(normalizeLabel(slot.label)) || normalizeLabel(slot.label).includes(needle)) ||
    null
  );
}

export function resolveSlotFromMessage(text: string, slots: AvailabilitySlot[], preferredDate = "") {
  const direct = matchOfferedSlotLabel(text, slots as OfferedSlot[]);
  if (direct) return direct;
  const lower = text.toLowerCase();
  const deLas = lower.match(/la de las (\d{1,2})/);
  if (deLas) {
    const hour = Number(deLas[1]);
    const match = slots.find((slot) => {
      const h = Number(slot.time.split(":")[0]);
      return h === hour || h === hour + 12;
    });
    if (match) return match;
  }
  const parsedTime = parseClock(text);
  if (parsedTime) {
    const sameDate = preferredDate
      ? slots.filter((s) => s.date === preferredDate && s.time === parsedTime)
      : slots.filter((s) => s.time === parsedTime);
    if (sameDate.length === 1) return sameDate[0];
    if (sameDate.length > 1) return sameDate[0];
    const any = slots.find((s) => s.time === parsedTime);
    if (any) return any;
  }
  const meSirve = lower.match(/(?:me sirve|prefiero|el de|a las|confirmo)\s+(\d{1,2})(?:\s*(?:a\.?\s*m|p\.?\s*m|am|pm))?/);
  if (meSirve) {
    let hour = Number(meSirve[1]);
    const afternoon = /p\.?\s*m|pm/.test(lower) || (hour >= 1 && hour <= 7 && !/a\.?\s*m|am/.test(lower));
    if (/p\.?\s*m|pm/.test(meSirve[0] || lower)) {
      if (hour < 12) hour += 12;
    } else if (hour >= 1 && hour <= 7 && !/a\.?\s*m|am/.test(lower)) {
      hour += 12;
    }
    const target = padTimeFromHour(hour);
    const match = slots.find((s) => s.time === target || Number(s.time.split(":")[0]) === hour);
    if (match) return match;
  }
  return null;
}

function padTimeFromHour(hours: number) {
  return `${String(hours).padStart(2, "0")}:00`;
}

export function validateActiveSlotBooking(state: ConversationState, date: string, time: string) {
  const slotStillValid =
    state.pendingSlot?.date === date && state.pendingSlot?.time === time && isSlotConfirmed(state);
  if (!areOfferedSlotsActive(state) && !slotStillValid) {
    return {
      ok: false as const,
      reason: "stale_offers" as const,
      message: "Esos horarios ya no están vigentes. Déjame revisar la agenda nuevamente.",
    };
  }
  if (!state.offeredSlots.some((slot) => slot.date === date && slot.time === time) && !slotStillValid) {
    return {
      ok: false as const,
      reason: "slot_not_offered" as const,
      message: "Ese horario ya no está disponible para esta solicitud. Puedo revisar opciones actuales.",
    };
  }
  return { ok: true as const };
}

export function shouldShowPhotoCta(state: ConversationState) {
  const checklist = getDigitalLockChecklist(state);
  if (checklist.active) {
    const missing =
      checklist.front?.status !== "PASS" ||
      checklist.inside?.status !== "PASS" ||
      checklist.edge?.status !== "PASS";
    return missing;
  }
  const service = state.primaryService || state.service;
  if (!service) return false;
  const playbook = getPlaybook(service);
  if (!playbook) return false;
  if (playbook.bookingStrategy === "PHOTO_REVIEW_FIRST" && (state.photoCount || 0) < 1) return true;
  return false;
}

export function buildSessionSnapshot(
  state: ConversationState,
  now = Date.now(),
  requestPublicId = "",
): ActiveSessionSnapshot {
  const active = areOfferedSlotsActive(state, now);
  const slotLocked = isSlotConfirmed(state);
  const showChips = active && !state.bookingSuspended && !slotLocked;
  const chips = showChips ? state.offeredSlots.slice(0, 6).map((item) => item.label) : [];
  const digitalLock = getDigitalLockChecklist(state);
  const maxPhotos = digitalLock.active ? 8 : 4;
  const photosRemaining = photosRemainingFromCount(state.photoCount || 0, maxPhotos);
  const hsId = state.activeLeadId || "";
  return {
    chips,
    historicalChips: state.historicalSlotLabels || [],
    leadBanner: null,
    requestCard: buildRequestCard(state, hsId),
    awaitingSlotSelection: active,
    bookingPending: active && Boolean(state.bookingSuspended),
    slotGroups: active ? buildSlotGroups(state.offeredSlots) : [],
    serviceContext: serviceContextLabel(state),
    showResumeBooking: active && Boolean(state.bookingSuspended),
    showPhotoCta: shouldShowPhotoCta(state) && photosRemaining > 0,
    photosRemaining,
  };
}

export function shouldShowLeadBanner(state: ConversationState, requestPublicId = "") {
  const id = requestPublicId || state.activeLeadId || "";
  return id && !id.startsWith("DRY-") ? id : null;
}
