/**
 * Service context transition engine.
 * Distinguishes REFINEMENT (same HS) from SWITCH/CANCEL (new logical job).
 * Pending playbook actions are valid only while their service context remains current.
 */
import type { ConversationState } from "@/lib/concierge-store";
import { resolvePrimaryFromMessage } from "@/lib/concierge/service-intent";
import {
  emptyDigitalLockChecklist,
  getDigitalLockChecklist,
  setDigitalLockChecklist,
} from "@/lib/concierge/digital-lock-vision";
import { logInfo } from "@/lib/log";
import { updateRequestStatus } from "@/lib/service-requests";

export type TransitionKind =
  | "CONTINUE_CURRENT_SERVICE"
  | "REFINE_CURRENT_SERVICE"
  | "SWITCH_SERVICE"
  | "ADD_ANOTHER_SERVICE"
  | "CANCEL_CURRENT_SERVICE"
  | "CORRECT_INFORMATION"
  | "PAUSE_CURRENT_SERVICE"
  | "GENERAL_QUESTION";

export type ConversationTransition = {
  kind: TransitionKind;
  previousService: string;
  nextService: string;
  abandonSignal: boolean;
  addSignal: boolean;
  ack: string;
};

const ABANDON_RE =
  /\b(olvidemos|olvidalo|olv[ií]dalo|dejemos\s+(eso|la|el|lo)|dejalo|ya\s+no\s+quiero(\s+eso)?|no\s+quiero\s+(eso|la\s+cerradura|el\s+aire)|cambiemos(\s+de\s+tema)?|mejor\s+no|eso\s+no|olvida\s+(lo\s+)?anterior|cancel(a|ar|emos)|no\s+sigamos\s+con)\b/i;

const SWITCH_TO_RE =
  /\b(mejor\s+(ayudame|ayuda|quiero|necesito|vamos|pint|plomer|aire|gypsum|repar)|ahora\s+(quiero|necesito|mejor)|vamos\s+con|quiero\s+otra\s+cosa|mejor\s+ayudame\s+con)\b/i;

const ADD_RE =
  /\b(tambi[eé]n\s+(necesito|quiero|ayudame)|adem[aá]s\s+(necesito|quiero)|y\s+tambi[eé]n)\b/i;

const GENERIC_SERVICES = new Set(["repairs", "other", "unknown", "multiple", ""]);

/** Service-scoped facts that must not leak across a true switch. */
const SERVICE_SCOPED_FACT_KEYS = [
  "digitalLockChecklist",
  "digitalLockFlow",
  "serviceIntent",
  "lockedOut",
  "units",
  "symptom",
  "duration",
  "activeLeak",
  "hazard",
  "unitType",
  "need",
  "waterLeak",
  "lastAskedField",
  "lastBotQuestion",
  "requestFolioShown",
  "serviceRefinedFrom",
  "serviceRefinedTo",
  "inferredUnitCandidate",
  "lastAvailabilityQuery",
  "slotConfirmed",
  "slotStatus",
  "selectedDate",
  "selectedTime",
  "selectedSlotLabel",
];

function fold(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function isRefinement(from: string, to: string): boolean {
  if (!from || !to || from === to) return false;
  if (GENERIC_SERVICES.has(from) && !GENERIC_SERVICES.has(to)) return true;
  if (from === "repairs" && ["painting", "gypsum", "ac", "plumbing", "electrical"].includes(to)) {
    return true;
  }
  return false;
}

function isUnrelatedSwitch(from: string, to: string): boolean {
  if (!from || !to || from === to) return false;
  if (isRefinement(from, to)) return false;
  if (GENERIC_SERVICES.has(from) || GENERIC_SERVICES.has(to)) return false;
  return true;
}

function serviceLabel(id: string) {
  const map: Record<string, string> = {
    locksmith: "la cerradura",
    painting: "la pintura",
    ac: "el aire acondicionado",
    plumbing: "la plomería",
    electrical: "lo eléctrico",
    gypsum: "el gypsum / cielo raso",
    repairs: "las reparaciones",
  };
  return map[id] || "eso";
}

export function detectConversationTransition(
  state: ConversationState,
  text: string,
): ConversationTransition {
  const previousService = state.primaryService || state.service || "";
  const nextFromMessage = resolvePrimaryFromMessage(text);
  const abandonSignal = ABANDON_RE.test(text);
  const addSignal = ADD_RE.test(text) && !abandonSignal;
  const switchPhrase = SWITCH_TO_RE.test(text);
  const lockActive = getDigitalLockChecklist(state).active;
  const blob = fold(text);

  // Explicit cancel without replacement
  if (abandonSignal && !nextFromMessage && !switchPhrase) {
    return {
      kind: "CANCEL_CURRENT_SERVICE",
      previousService,
      nextService: "",
      abandonSignal: true,
      addSignal: false,
      ack: previousService
        ? `Claro, dejamos lo de ${serviceLabel(previousService)}.`
        : "Claro, lo dejamos por ahora.",
    };
  }

  // ADD another service (keep current; do not cancel)
  if (addSignal && nextFromMessage && previousService && nextFromMessage !== previousService) {
    return {
      kind: "ADD_ANOTHER_SERVICE",
      previousService,
      nextService: nextFromMessage,
      abandonSignal: false,
      addSignal: true,
      ack: "",
    };
  }

  // Explicit abandon + new service (even if previous was only digital-lock flow)
  if (abandonSignal && nextFromMessage) {
    const effectivePrev = previousService || (lockActive ? "locksmith" : "");
    if (effectivePrev && nextFromMessage !== effectivePrev && !isRefinement(effectivePrev, nextFromMessage)) {
      return {
        kind: "SWITCH_SERVICE",
        previousService: effectivePrev,
        nextService: nextFromMessage,
        abandonSignal: true,
        addSignal: false,
        ack: `Claro, dejamos lo de ${serviceLabel(effectivePrev)}. Te ayudo con ${serviceLabel(nextFromMessage).toLowerCase()}.`,
      };
    }
  }

  // True SWITCH: switch phrase / better-help-with + unrelated services
  if (
    nextFromMessage &&
    previousService &&
    nextFromMessage !== previousService &&
    !isRefinement(previousService, nextFromMessage) &&
    (switchPhrase ||
      (lockActive && /\b(mejor|olvid|deja|cambi|pint|plomer|aire|gypsum)\b/i.test(blob)) ||
      (isUnrelatedSwitch(previousService, nextFromMessage) && /\bmejor\b/i.test(text)))
  ) {
    return {
      kind: "SWITCH_SERVICE",
      previousService,
      nextService: nextFromMessage,
      abandonSignal: true,
      addSignal: false,
      ack: `Claro, dejamos lo de ${serviceLabel(previousService)}. Te ayudo con ${serviceLabel(nextFromMessage).toLowerCase()}.`,
    };
  }

  // REFINEMENT: generic → specific without abandon
  if (
    nextFromMessage &&
    previousService &&
    nextFromMessage !== previousService &&
    isRefinement(previousService, nextFromMessage)
  ) {
    return {
      kind: "REFINE_CURRENT_SERVICE",
      previousService,
      nextService: nextFromMessage,
      abandonSignal: false,
      addSignal: false,
      ack: "",
    };
  }

  if (nextFromMessage && !previousService) {
    return {
      kind: "CONTINUE_CURRENT_SERVICE",
      previousService: "",
      nextService: nextFromMessage,
      abandonSignal: false,
      addSignal: false,
      ack: "",
    };
  }

  return {
    kind: "CONTINUE_CURRENT_SERVICE",
    previousService,
    nextService: previousService || nextFromMessage || "",
    abandonSignal: false,
    addSignal: false,
    ack: "",
  };
}

export function bumpServiceContextVersion(state: ConversationState): ConversationState {
  const current = Number(state.facts?.serviceContextVersion || "0") || 0;
  return {
    ...state,
    facts: {
      ...(state.facts || {}),
      serviceContextVersion: String(current + 1),
      serviceContextId: `${state.primaryService || state.service || "none"}-${current + 1}`,
    },
  };
}

export function clearServiceScopedState(state: ConversationState): ConversationState {
  const facts = { ...(state.facts || {}) };
  for (const key of SERVICE_SCOPED_FACT_KEYS) {
    delete facts[key];
  }
  const prior = getDigitalLockChecklist(state);
  if (prior.active || prior.front || prior.inside || prior.edge || prior.analyzedPhotoIds.length) {
    facts.abandonedDigitalLockChecklist = JSON.stringify({ ...prior, active: false });
  }
  facts.digitalLockAbandoned = "1";
  facts.askCount_photos = "0";

  let next: ConversationState = {
    ...state,
    facts,
    problem: "",
    preferredDate: "",
    preferredTime: "",
    offeredSlots: [],
    pendingSlot: null,
    awaitingSlotSelection: false,
    slotOfferToken: "",
    appointmentId: "",
    bookingIntent: false,
    bookingSuspended: false,
    bookingStrategy: "",
    needsReview: false,
    historicalSlotLabels: [
      ...new Set([...(state.historicalSlotLabels || []), ...(state.offeredSlots || []).map((s) => s.label)]),
    ].slice(-8),
  };
  next = setDigitalLockChecklist(next, emptyDigitalLockChecklist());
  return next;
}

/**
 * Apply transition to conversation state.
 * Preserves customer/property facts; resets service-scoped state on SWITCH/CANCEL.
 */
export function applyConversationTransition(
  state: ConversationState,
  transition: ConversationTransition,
  opts: { cancelExistingHs?: boolean } = {},
): ConversationState {
  const { kind, previousService, nextService } = transition;

  if (
    kind === "CONTINUE_CURRENT_SERVICE" ||
    kind === "GENERAL_QUESTION" ||
    kind === "CORRECT_INFORMATION" ||
    kind === "PAUSE_CURRENT_SERVICE"
  ) {
    return state;
  }

  if (kind === "REFINE_CURRENT_SERVICE" && nextService) {
    logInfo("SERVICE_REFINED", {
      contentJobId: (state.activeLeadId || "").slice(0, 16),
      stage: `${previousService}->${nextService}`,
    });
    return {
      ...state,
      primaryService: nextService,
      service: nextService,
      detectedServices: [...new Set([...(state.detectedServices || []), nextService])],
      facts: {
        ...(state.facts || {}),
        serviceRefinedFrom: previousService,
        serviceRefinedTo: nextService,
      },
    };
  }

  if (kind === "ADD_ANOTHER_SERVICE") {
    logInfo("SERVICE_ADDED", {
      contentJobId: (state.activeLeadId || "").slice(0, 16),
      stage: `${previousService}+${nextService}`,
    });
    return {
      ...state,
      facts: {
        ...(state.facts || {}),
        pendingAddService: nextService,
        lastAskedField: "add_service_clarify",
        lastBotQuestion:
          "Claro. ¿Quieres agregar eso además del servicio actual, o dejamos el actual y seguimos solo con lo nuevo?",
      },
    };
  }

  if (kind === "CANCEL_CURRENT_SERVICE" || kind === "SWITCH_SERVICE") {
    const oldHs = state.activeLeadId || "";
    if (opts.cancelExistingHs !== false && oldHs && !oldHs.startsWith("DRY-")) {
      try {
        updateRequestStatus(oldHs, "CANCELLED");
        logInfo("SERVICE_CANCELLED", {
          contentJobId: oldHs.slice(0, 16),
          stage: previousService || "unknown",
        });
      } catch {
        // best-effort cancel
      }
    }

    let next = clearServiceScopedState(state);
    next = {
      ...next,
      activeLeadId: "",
      primaryService: kind === "SWITCH_SERVICE" ? nextService : "",
      service: kind === "SWITCH_SERVICE" ? nextService : "",
      detectedServices: kind === "SWITCH_SERVICE" && nextService ? [nextService] : [],
      secondaryServices: [],
      facts: {
        ...next.facts,
        abandonedService: previousService,
        abandonedRequestId: oldHs,
        transitionKind: kind,
        ...(kind === "SWITCH_SERVICE" && nextService
          ? { need: nextService === "painting" ? "pintura" : nextService }
          : {}),
      },
      problem:
        kind === "SWITCH_SERVICE" && nextService
          ? nextService === "painting"
            ? "Pintura"
            : nextService
          : "",
    };
    next = bumpServiceContextVersion(next);
    logInfo("SERVICE_SWITCHED", {
      contentJobId: (oldHs || "none").slice(0, 16),
      stage: `${previousService}->${nextService || "none"}`,
    });
    logInfo("PENDING_ACTION_INVALIDATED", {
      contentJobId: (oldHs || "none").slice(0, 16),
      stage: previousService || "unknown",
    });
    return next;
  }

  return state;
}

/** Pending action valid only for matching service context. */
export function isPendingActionStillValid(pendingAction: string, state: ConversationState): boolean {
  const service = state.primaryService || state.service || "";
  const lock = getDigitalLockChecklist(state);
  if (/LOCK|DIGITAL_LOCK|EDGE|CANTO|PESTILLO|FRENTE|INTERIOR/i.test(pendingAction)) {
    return lock.active && (service === "locksmith" || !service);
  }
  if (/PHOTO/i.test(pendingAction) && !lock.active && state.facts?.digitalLockAbandoned === "1") {
    return false;
  }
  if (
    state.facts?.digitalLockAbandoned === "1" &&
    /cerradur|canto|pestillo|frente|interior/i.test(pendingAction)
  ) {
    return false;
  }
  return true;
}

export function responseReferencesStaleService(reply: string, state: ConversationState): boolean {
  if (!reply.trim()) return false;
  const service = state.primaryService || state.service || "";
  if (state.facts?.digitalLockAbandoned === "1" || (service && service !== "locksmith")) {
    if (/canto|pestillo|frente|interior|cerradura digital|foto del canto/i.test(reply)) {
      return true;
    }
  }
  if (service === "painting" && /cerradura|canto|pestillo|aire acondicionado|fuga|plomer/i.test(reply)) {
    if (/falta.*(foto|canto|pestillo|frente|interior)|me sirve como|solo me falta/i.test(reply)) {
      return true;
    }
  }
  return false;
}

export function switchAckPrefix(transition: ConversationTransition): string {
  return transition.ack || "";
}

export function paintingFollowUpQuestion(state: ConversationState): string {
  const known =
    Boolean(state.name) || state.contactStatus === "VALID" || Boolean(state.location);
  if (known) {
    return "¿Quieres pintar toda la sala o necesitas reparar algunas áreas además de pintar?";
  }
  return "Cuéntame un poco más: ¿quieres pintar toda la sala o solo algunas paredes?";
}
