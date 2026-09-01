/**
 * Calendar action orchestration: pending QUERY_AVAILABILITY, affirmations, direct requests.
 * ASK → ACCEPT → EXECUTE. Direct request → EXECUTE. No permission loops.
 */
import type { ConversationState, OfferedSlot } from "@/lib/concierge-store";
import { formatPanamaSlot } from "@/lib/concierge-datetime";
import { logInfo } from "@/lib/log";
import { isSlotConfirmed } from "@/lib/concierge/canonical-state";

export const PENDING_QUERY_AVAILABILITY = "QUERY_AVAILABILITY";

export const BOOKING_INTEGRITY_OFFER =
  "Todavía no confirmé esa visita en el calendario. Si te parece, reviso horarios reales y te los ofrezco para que elijas.";

const AFFIRM_RE =
  /^(s[ií]|si\s+por\s+favor|s[ií]\s+por\s+favor|dale|ok|okay|perfecto|hazlo|revisa(\s+por\s+favor)?|adelante|claro|por\s+favor|va|vamos|listo|de\s+acuerdo|bueno)[\s!.?]*$/i;

const AFFIRM_EMBEDDED_RE =
  /\b(s[ií]\s+por\s+favor|dale\s+pues|hazlo\s+por\s+favor|ok\s+revisa|perfecto\s+revisa|adelante\s+revisa)\b/i;

const DIRECT_AVAIL_RE =
  /\b(mu[eé]stra(me)?(\s+los)?\s+horarios?|muestram(e)?(\s+los)?\s+horarios?|qu[eé]\s+(horarios?|tienen|hay)|horarios?\s+disponibles?|revisa(\s+la)?\s+(agenda|disponib|calendario)|revisa\s+si\s+tienen|consulta(r)?\s+(la\s+)?agenda|dime\s+los\s+horarios?|opciones\s+de\s+horario|disponibilidad)\b/i;

const AVAIL_OFFER_RE =
  /\b(si\s+te\s+parece|si\s+quieres|puedo\s+revis|reviso\s+horarios|consultar?\s+los\s+horarios|todav[ií]a\s+no\s+confirm[eé]|d[eé]jame\s+revisar\s+la\s+agenda)\b/i;

const BOOKING_SIGNAL_RE =
  /\b(disponib|agend|cita|visita|horarios?|ma[nñ]ana|manana|pasado|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i;

export function isAffirmativeResponse(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 40) return false;
  if (/\b(otra cosa|olvidemos|mejor|pintura|plomer|cambiar)\b/i.test(trimmed)) return false;
  if (AFFIRM_RE.test(trimmed)) return true;
  if (AFFIRM_EMBEDDED_RE.test(trimmed)) return true;
  return false;
}

export function isDirectAvailabilityRequest(text: string): boolean {
  return DIRECT_AVAIL_RE.test(text);
}

export function isAvailabilityOfferText(text: string): boolean {
  return AVAIL_OFFER_RE.test(text) || text.includes("reviso horarios reales");
}

export function hasPendingAvailabilityAction(state: ConversationState): boolean {
  return state.facts?.pendingAction === PENDING_QUERY_AVAILABILITY;
}

export function setPendingAvailabilityAction(state: ConversationState): ConversationState {
  logInfo("PENDING_ACTION_CREATED", {
    contentJobId: (state.activeLeadId || "").slice(0, 16),
    stage: PENDING_QUERY_AVAILABILITY,
  });
  return {
    ...state,
    facts: {
      ...(state.facts || {}),
      pendingAction: PENDING_QUERY_AVAILABILITY,
      calendarActionState: "PENDING_CONFIRMATION",
    },
    bookingIntent: true,
  };
}

export function consumePendingAvailabilityAction(state: ConversationState): ConversationState {
  if (state.facts?.pendingAction !== PENDING_QUERY_AVAILABILITY) return state;
  logInfo("PENDING_ACTION_CONSUMED", {
    contentJobId: (state.activeLeadId || "").slice(0, 16),
    stage: PENDING_QUERY_AVAILABILITY,
  });
  const facts = { ...(state.facts || {}) };
  delete facts.pendingAction;
  facts.calendarActionState = "QUERYING";
  return { ...state, facts, bookingIntent: true };
}

export function markCalendarQueryResult(
  state: ConversationState,
  ok: boolean,
): ConversationState {
  return {
    ...state,
    facts: {
      ...(state.facts || {}),
      calendarActionState: ok ? "RESULTS_AVAILABLE" : "FAILED",
    },
  };
}

export type CalendarExecuteDecision = {
  execute: boolean;
  needDate: boolean;
  reason: string;
  affirmedPending: boolean;
  directRequest: boolean;
};

/**
 * Decide whether this turn must query real availability.
 */
export function decideCalendarExecution(
  state: ConversationState,
  text: string,
  opts: {
    bookingSuspended?: boolean;
    interruption?: boolean;
    lastAssistantOffer?: boolean;
  } = {},
): CalendarExecuteDecision {
  if (opts.bookingSuspended) {
    return { execute: false, needDate: false, reason: "booking_suspended", affirmedPending: false, directRequest: false };
  }
  if (isSlotConfirmed(state) && !/\b(otro|cambiar|reprogram|mejor)\b/i.test(text)) {
    return { execute: false, needDate: false, reason: "slot_already_selected", affirmedPending: false, directRequest: false };
  }

  const pending = hasPendingAvailabilityAction(state) || Boolean(opts.lastAssistantOffer);
  const affirmed = pending && isAffirmativeResponse(text);
  const direct = isDirectAvailabilityRequest(text);
  const signal = BOOKING_SIGNAL_RE.test(text) || state.bookingIntent || Boolean(state.preferredDate);

  if (affirmed) {
    logInfo("PENDING_ACTION_ACCEPTED", {
      contentJobId: (state.activeLeadId || "").slice(0, 16),
      stage: PENDING_QUERY_AVAILABILITY,
    });
    if (!state.preferredDate) {
      return { execute: false, needDate: true, reason: "affirm_need_date", affirmedPending: true, directRequest: false };
    }
    return { execute: true, needDate: false, reason: "pending_affirmed", affirmedPending: true, directRequest: false };
  }

  if (direct) {
    logInfo("DIRECT_ACTION_DETECTED", {
      contentJobId: (state.activeLeadId || "").slice(0, 16),
      stage: PENDING_QUERY_AVAILABILITY,
    });
    if (!state.preferredDate) {
      return { execute: false, needDate: true, reason: "direct_need_date", affirmedPending: false, directRequest: true };
    }
    return { execute: true, needDate: false, reason: "direct_availability_request", affirmedPending: false, directRequest: true };
  }

  // Soft booking signals with known date (e.g. "mañana", "viernes") still query
  if (signal && state.preferredDate && !opts.interruption) {
    return { execute: true, needDate: false, reason: "booking_signal_with_date", affirmedPending: false, directRequest: false };
  }

  return { execute: false, needDate: false, reason: "no_calendar_trigger", affirmedPending: false, directRequest: false };
}

export function askDateForAvailability(): string {
  return "Claro. ¿Qué día te gustaría la visita?";
}

export function formatAvailabilityResults(slots: OfferedSlot[], preferredDate = ""): string {
  if (!slots.length) {
    return "Para esa fecha no tengo horarios libres en este momento. ¿Quieres que revise otro día?";
  }
  const sameDay = preferredDate ? slots.filter((s) => s.date === preferredDate) : slots;
  let use = sameDay.length ? sameDay : slots;
  if (use.length > 3) use = use.slice(0, 3);
  const labels = use.slice(0, 6).map((s) => {
    const clock = s.label.match(/\d{1,2}:\d{2}\s*(a\.\s*m\.|p\.\s*m\.)?/i)?.[0] || s.time;
    return clock;
  });
  const dayHint =
    preferredDate && use[0]
      ? formatPanamaSlot(use[0].date, use[0].time).replace(/\d{1,2}:\d{2}\s*(a\.\s*m\.|p\.\s*m\.)?/i, "").trim()
      : "";
  const dayPrefix = dayHint ? `Para ${dayHint} ` : "";
  if (labels.length === 1) {
    return `${dayPrefix}tengo disponible ${labels[0]}. ¿Te funciona?`;
  }
  const last = labels[labels.length - 1];
  const rest = labels.slice(0, -1).join(", ");
  return `${dayPrefix}tengo disponibles: ${rest} y ${last}. ¿Cuál te funciona mejor?`;
}

export function calendarFailureReply(requestId = ""): string {
  const hs = requestId && !requestId.startsWith("DRY-") ? ` Tu solicitud ${requestId} sigue registrada.` : "";
  return `No pude consultar la agenda en este momento.${hs} Podemos intentarlo nuevamente en un momento.`;
}

/** Block repeating the same permission offer after user already accepted/requested. */
export function shouldBlockAvailabilityOfferLoop(
  reply: string,
  decision: CalendarExecuteDecision,
  queriedThisTurn: boolean,
): boolean {
  if (!isAvailabilityOfferText(reply)) return false;
  if (decision.affirmedPending || decision.directRequest || queriedThisTurn) {
    logInfo("ACTION_OFFER_LOOP_BLOCKED", {
      contentJobId: "calendar",
      stage: decision.reason,
    });
    return true;
  }
  return false;
}
