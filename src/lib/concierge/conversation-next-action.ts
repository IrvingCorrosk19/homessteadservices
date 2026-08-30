/**
 * Deterministic conversation next-action engine.
 * LLM drafts language; this layer owns WHAT to ask / whether booking can proceed.
 */
import {
  firstMissingQuestion,
  getAppointmentReadiness,
  hasRequestedExactWhen,
  isLocationSufficient,
  type AppointmentMissingField,
  type AppointmentReadiness,
} from "@/lib/concierge/appointment-readiness";
import { isSlotConfirmed, shouldBlockDuplicateAsk } from "@/lib/concierge/canonical-state";
import { detectReprogramAppointmentIntent } from "@/lib/concierge/appointment-reprogram";
import { classifyPhone } from "@/lib/phone";
import { logInfo } from "@/lib/log";
import type { ConversationState } from "@/lib/concierge-store";

export type ConciergeNextAction =
  | "ASK_NAME"
  | "ASK_PHONE"
  | "ASK_LOCATION"
  | "ASK_PROPERTY_TYPE"
  | "ASK_BUILDING"
  | "ASK_UNIT"
  | "ASK_SERVICE"
  | "ASK_REQUIRED_PHOTO"
  | "CHECK_AVAILABILITY"
  | "ASK_SLOT_SELECTION"
  | "CONFIRM_OR_BOOK"
  | "ANSWER_USER_QUESTION"
  | "UPDATE_SLOT"
  | "REPROGRAM_APPOINTMENT"
  | "COMPLETE"
  | "HANDOFF"
  | "CONTINUE";

export type NextActionDecision = {
  action: ConciergeNextAction;
  missingFields: AppointmentMissingField[];
  requiredMissing: AppointmentMissingField[];
  askField: AppointmentMissingField | "";
  reason: string;
  cannedQuestion: string;
  readiness: AppointmentReadiness;
  locationSufficient: boolean;
  blockInventedAsks: boolean;
};

const DECLINE_RE =
  /\b(no|ninguno|ninguna|nada|no\s+tengo|no\s+hay|no\s+hace\s+falta|eso\s+es\s+todo|no\s+s[eé]|no\s+ning[uú]n\s+detalle|sin\s+m[aá]s|no\s+m[aá]s(\s+detalles?)?)\b/i;

const LOCATION_ASK_RE =
  /\b(zona|ubicaci[oó]n|direcci[oó]n|referencia|detalle\s+(espec[ií]fico|adicional)|d[oó]nde\s+(ser[ií]a|est[aá]|queda)|ph\b|apartamento|edificio)\b/i;

export { isLocationSufficient };

export function isDeclineAnswer(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^(no|ninguno|ninguna|nada)[\s!.?]*$/i.test(trimmed)) return true;
  return DECLINE_RE.test(trimmed) && trimmed.length < 80;
}

export function markOptionalDeclined(state: ConversationState, text: string): ConversationState {
  if (!isDeclineAnswer(text)) return state;
  const lastQ = state.facts?.lastBotQuestion || "";
  if (
    !/referencia|detalle|indicaci|algo m[aá]s|ubicaci|direcci/i.test(lastQ) &&
    state.facts?.lastAskedField !== "reference" &&
    !isLocationSufficient(state)
  ) {
    return state;
  }
  return {
    ...state,
    facts: {
      ...(state.facts || {}),
      additionalReference: "DECLINED",
      referenceStatus: "DECLINED",
      lastAskedField: "",
    },
  };
}

function askCount(state: ConversationState, field: string) {
  const raw = state.facts?.[`askCount_${field}`];
  const n = Number(raw || 0);
  return Number.isFinite(n) ? n : 0;
}

export function recordAsk(state: ConversationState, field: string, question: string): ConversationState {
  const count = askCount(state, field) + 1;
  return {
    ...state,
    facts: {
      ...(state.facts || {}),
      lastAskedField: field,
      lastBotQuestion: question.slice(0, 240),
      [`askCount_${field}`]: String(count),
    },
  };
}

export function shouldStopAsking(state: ConversationState, field: string) {
  return askCount(state, field) >= 2;
}

export function determineNextAction(
  state: ConversationState,
  opts: { userText?: string; interruption?: boolean } = {},
): NextActionDecision {
  const readiness = getAppointmentReadiness(state);
  const locationSufficient = isLocationSufficient(state);

  let missing = [...readiness.missingFields];
  if (locationSufficient) {
    missing = missing.filter((f) => f !== "location");
  }
  if (isSlotConfirmed(state) || state.pendingSlot?.date) {
    missing = missing.filter((f) => f !== "slot");
  }
  if (hasRequestedExactWhen(state)) {
    missing = missing.filter((f) => f !== "slot");
  }

  if ((state.facts?.building || state.facts?.ph) && (state.facts?.unit || state.facts?.apartment)) {
    missing = missing.filter((f) => f !== "property_type" && f !== "building" && f !== "unit");
  }

  if (opts.interruption) {
    return {
      action: "ANSWER_USER_QUESTION",
      missingFields: missing,
      requiredMissing: missing,
      askField: "",
      reason: "user_interruption",
      cannedQuestion: "",
      readiness: { ...readiness, missingFields: missing, ready: missing.length === 0 },
      locationSufficient,
      blockInventedAsks: true,
    };
  }

  if (state.appointmentId && opts.userText && detectReprogramAppointmentIntent(opts.userText, state)) {
    return {
      action: "REPROGRAM_APPOINTMENT",
      missingFields: [],
      requiredMissing: [],
      askField: "",
      reason: "active_appointment_reprogram",
      cannedQuestion: "",
      readiness: { ...readiness, missingFields: [], ready: true },
      locationSufficient,
      blockInventedAsks: true,
    };
  }

  if (state.appointmentId) {
    return {
      action: "COMPLETE",
      missingFields: [],
      requiredMissing: [],
      askField: "",
      reason: "appointment_exists",
      cannedQuestion: "",
      readiness: { ...readiness, missingFields: [], ready: true },
      locationSufficient,
      blockInventedAsks: true,
    };
  }

  if (state.awaitingSlotSelection && state.offeredSlots?.length && !isSlotConfirmed(state)) {
    if (!state.pendingSlot && !(state.preferredDate && state.preferredTime)) {
      return {
        action: "ASK_SLOT_SELECTION",
        missingFields: missing,
        requiredMissing: missing.filter((f) => f === "slot"),
        askField: "slot",
        reason: "awaiting_slot_pick",
        cannedQuestion: "¿Cuál de esos horarios te queda mejor?",
        readiness: { ...readiness, missingFields: missing },
        locationSufficient,
        blockInventedAsks: true,
      };
    }
  }

  const requiredMissing = missing;
  const ready = requiredMissing.length === 0;

  // Exact when named by user but not yet calendar-locked → query calendar, do NOT re-ask date/time.
  if (
    ready &&
    hasRequestedExactWhen(state) &&
    !isSlotConfirmed(state) &&
    !state.pendingSlot
  ) {
    return {
      action: "CHECK_AVAILABILITY",
      missingFields: [],
      requiredMissing: [],
      askField: "",
      reason: "exact_when_needs_calendar",
      cannedQuestion: "",
      readiness: { ...readiness, missingFields: [], ready: true },
      locationSufficient,
      blockInventedAsks: true,
    };
  }

  if (ready && (isSlotConfirmed(state) || state.pendingSlot)) {
    return {
      action: "CONFIRM_OR_BOOK",
      missingFields: [],
      requiredMissing: [],
      askField: "",
      reason: "requirements_complete",
      cannedQuestion: "",
      readiness: { ...readiness, missingFields: [], ready: true },
      locationSufficient,
      blockInventedAsks: true,
    };
  }

  if (ready && state.bookingIntent && !state.offeredSlots?.length && !isSlotConfirmed(state)) {
    return {
      action: "CHECK_AVAILABILITY",
      missingFields: [],
      requiredMissing: [],
      askField: "",
      reason: "need_availability",
      cannedQuestion: "",
      readiness: { ...readiness, missingFields: [], ready: true },
      locationSufficient,
      blockInventedAsks: true,
    };
  }

  const order: AppointmentMissingField[] = [
    "service",
    "location",
    "property_type",
    "building",
    "unit",
    "contact",
    "slot",
    "customer_name",
  ];
  let askField: AppointmentMissingField | "" = "";
  for (const field of order) {
    if (!requiredMissing.includes(field)) continue;
    if (shouldBlockDuplicateAsk(field, state)) {
      logInfo("DUPLICATE_QUESTION_BLOCKED", { stage: field, phone: "confirmed" });
      continue;
    }
    if (shouldStopAsking(state, field) && field !== "contact" && field !== "customer_name") {
      continue;
    }
    askField = field;
    break;
  }
  if (!askField && requiredMissing.length) askField = requiredMissing[0];

  const actionMap: Record<AppointmentMissingField, ConciergeNextAction> = {
    customer_name: "ASK_NAME",
    contact: "ASK_PHONE",
    location: "ASK_LOCATION",
    property_type: "ASK_PROPERTY_TYPE",
    building: "ASK_BUILDING",
    unit: "ASK_UNIT",
    service: "ASK_SERVICE",
    slot: "ASK_SLOT_SELECTION",
  };

  const synthetic: AppointmentReadiness = {
    ...readiness,
    missingFields: requiredMissing,
    ready: false,
  };

  return {
    action: askField ? actionMap[askField] : "CONTINUE",
    missingFields: requiredMissing,
    requiredMissing,
    askField,
    reason: askField ? `missing_${askField}` : "continue",
    cannedQuestion: askField ? firstMissingQuestion(synthetic, askField) : "",
    readiness: synthetic,
    locationSufficient,
    blockInventedAsks: true,
  };
}

export function enforceDeterministicAsk(
  reply: string,
  state: ConversationState,
  decision: NextActionDecision,
): { reply: string; rewritten: boolean; state: ConversationState } {
  let nextState = state;
  let text = reply;
  let rewritten = false;

  const inventingLocation =
    LOCATION_ASK_RE.test(text) &&
    decision.locationSufficient &&
    !decision.requiredMissing.includes("location") &&
    !decision.requiredMissing.includes("building") &&
    !decision.requiredMissing.includes("unit") &&
    !decision.requiredMissing.includes("property_type");

  const inventingVague =
    /\b(alg[uú]n\s+otro\s+detalle|detalle\s+espec[ií]fico|falta\s+un\s+peque[nñ]o\s+detalle|un\s+poco\s+m[aá]s\s+de\s+informaci[oó]n|asegur[eé]monos)\b/i.test(
      text,
    ) && decision.requiredMissing.length === 0;

  if ((inventingLocation || inventingVague) && decision.action === "CONFIRM_OR_BOOK") {
    text =
      "Perfecto, con eso ya puedo confirmar la visita. Dame un segundo para dejarla agendada.";
    rewritten = true;
  } else if ((inventingLocation || inventingVague) && decision.cannedQuestion) {
    text = decision.cannedQuestion;
    rewritten = true;
  } else if ((inventingLocation || inventingVague) && decision.requiredMissing.length === 0) {
    text =
      "Listo. Si quieres confirmamos el horario que elegiste; no necesito más detalles de ubicación.";
    rewritten = true;
  }

  if (decision.askField && shouldStopAsking(state, decision.askField) && LOCATION_ASK_RE.test(text)) {
    if (decision.locationSufficient) {
      text =
        "Con la zona y el PH/apartamento que me diste es suficiente. ¿Confirmamos el horario que elegiste?";
      rewritten = true;
      nextState = {
        ...nextState,
        facts: { ...(nextState.facts || {}), additionalReference: "DECLINED", referenceStatus: "DECLINED" },
      };
    }
  }

  if (decision.askField && (rewritten || LOCATION_ASK_RE.test(text) || decision.cannedQuestion === text)) {
    nextState = recordAsk(nextState, decision.askField, text);
  } else {
    nextState = {
      ...nextState,
      facts: { ...(nextState.facts || {}), lastBotQuestion: text.slice(0, 240) },
    };
  }

  return { reply: text, rewritten, state: nextState };
}

export function logNextAction(
  conversationId: string,
  decision: NextActionDecision,
  extra: Record<string, string | number | boolean | undefined> = {},
) {
  logInfo("ConciergeNextAction", {
    contentJobId: conversationId.slice(0, 8),
    stage: decision.action,
    phone: decision.askField || decision.reason.slice(0, 24),
    ...Object.fromEntries(
      Object.entries(extra)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, typeof v === "boolean" ? (v ? "1" : "0") : String(v)]),
    ),
  });
}

export function phoneLooksValid(state: ConversationState) {
  return classifyPhone(state.phone).status === "VALID" || state.contactStatus === "VALID";
}
