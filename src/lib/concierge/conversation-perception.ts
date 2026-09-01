/**
 * Conversation perception — semantic understanding of a full user turn.
 * Regex assists; meaning is composed from context + transition + extraction.
 */
import type { ConversationState } from "@/lib/concierge-store";
import type { ConversationTransition } from "@/lib/concierge/service-transition";
import { detectServices } from "@/lib/concierge/playbook-engine";
import { resolvePrimaryFromMessage } from "@/lib/concierge/service-intent";
import { interpretTurnRoute } from "@/lib/concierge-turn-routing";
import { detectReprogramAppointmentIntent, REPROGRAM_APPOINTMENT_RE } from "@/lib/concierge/appointment-reprogram";
import { hasRescheduleSignal } from "@/lib/concierge/canonical-state";
import { isScheduleOrTimeOnlyMessage, isQualityFeedbackNotSchedule } from "@/lib/concierge/schedule-phrases";
import { classifyPhone } from "@/lib/phone";
import { isPresent } from "@/lib/concierge/canonical-state";
import { classifyActionableServiceIntent } from "@/lib/concierge/actionable-intent";

export type ConversationPerception = {
  userIntent: string;
  secondaryIntents: string[];
  entities: Record<string, string>;
  corrections: string[];
  negations: string[];
  schedulingInformation: {
    dateText: string;
    timeText: string;
    preference: string;
  };
  serviceCandidates: string[];
  contactInformation: { name: string; phone: string; email: string };
  propertyInformation: Record<string, string>;
  urgencySignals: boolean;
  emotionalSignals: string[];
  referencesPriorContext: boolean;
  uncertainty: boolean;
  transactionRelationship: "CONTINUE" | "CORRECTION" | "SWITCH" | "ADD" | "CANCEL" | "NEW" | "REPROGRAM";
};

const SAFETY_RE =
  /\b(gas|humo|chispas?|incendio|inundaci[oó]n|riesgo|peligro|olor\s+a\s+gas|electrocut)\b/i;
const PRICE_RE =
  /\b(cu[aá]nto|cuesta|precio|costo|valor|tarifa|cotiz|presupuesto)\b/i;
const STATUS_RE = /\b(mi\s+cita|n[uú]mero\s+de\s+solicitud|a\s+qu[eé]\s+hora|estado)\b/i;
const CANCEL_RE = /\b(cancelar|anular|canc[eé]lalo|ya\s+no\s+quiero\s+(la\s+)?cita|quiero\s+cancelar)\b/i;
const INFO_ONLY_RE = /\b(ustedes\s+hacen|trabajan|atienden|domingo|s[aá]bado|horario)\b/i;
const SERVICE_CAPABILITY_RE =
  /\b(?:tambi[eé]n\s+)?(?:ustedes|usted|vos)\s+.*\b(arreglan|hacen|ofrecen|instalan|atienden|reparan)\b/i;
const SERVICE_CAPABILITY_QUESTION_RE =
  /\b(?:tambi[eé]n\s+)?(?:ustedes|usted)?\s*.*\b(arreglan|hacen|ofrecen|instalan|reparan)\b.*\?|¿.*\b(?:tambi[eé]n\s+)?(?:arreglan|hacen|ofrecen|instalan|reparan)\b/i;
const TIME_CHANGE_ONLY =
  /\b(mejor\s+a\s+las|a\s+las\s+\d|las\s+\d|:\d{2}\s*(a\.?\s*m|p\.?\s*m)|\d{1,2}\s*(a\.?\s*m|p\.?\s*m|am|pm))\b/i;

function fold(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function perceiveTurn(
  text: string,
  state: ConversationState,
  transition: ConversationTransition,
): ConversationPerception {
  const route = interpretTurnRoute(text, state);
  const services = detectServices(text);
  const primaryHint = resolvePrimaryFromMessage(text) || state.primaryService || "";
  const actionable = classifyActionableServiceIntent(text, state);
  const secondaryIntents: string[] = [];
  let userIntent = "CONTINUE";
  let relationship: ConversationPerception["transactionRelationship"] = "CONTINUE";

  if (transition.kind === "SWITCH_SERVICE" || transition.kind === "CANCEL_CURRENT_SERVICE") {
    userIntent = CANCEL_RE.test(text) ? "CANCEL_VISIT" : "CHANGE_SERVICE";
    relationship = "SWITCH";
  } else if (actionable.primaryIntent === "MIXED_QUESTION_AND_REQUEST") {
    userIntent = "REQUEST_SERVICE";
    relationship = "NEW";
    secondaryIntents.push("ASK_SERVICE_CAPABILITY");
  } else if (transition.kind === "GENERAL_QUESTION" || actionable.informationalOnly) {
    if (actionable.primaryIntent === "PRICE_EXPLORATION") {
      userIntent = "GET_ESTIMATE";
      secondaryIntents.push("ASK_PRICING");
    } else if (INFO_ONLY_RE.test(text) || actionable.primaryIntent === "COVERAGE_QUESTION") {
      userIntent = "ASK_GENERAL_QUESTION";
    } else {
      userIntent = "ASK_SERVICE_CAPABILITY";
    }
  } else if (transition.kind === "ADD_ANOTHER_SERVICE") {
    userIntent = "ADD_SERVICE";
    relationship = "ADD";
  } else if (
    state.appointmentId &&
    !isQualityFeedbackNotSchedule(text) &&
    (hasRescheduleSignal(text) || REPROGRAM_APPOINTMENT_RE.test(text) || TIME_CHANGE_ONLY.test(text))
  ) {
    userIntent = "REPROGRAM_APPOINTMENT";
    relationship = "REPROGRAM";
  } else if (detectReprogramAppointmentIntent(text, state)) {
    userIntent = "REPROGRAM_APPOINTMENT";
    relationship = "REPROGRAM";
  } else if (
    state.primaryService &&
    (SERVICE_CAPABILITY_RE.test(text) || SERVICE_CAPABILITY_QUESTION_RE.test(text)) &&
    !/\b(tambi[eé]n\s+necesito|tambi[eé]n\s+quiero|adem[aá]s\s+necesito)\b/i.test(text)
  ) {
    userIntent = "ASK_SERVICE_CAPABILITY";
  } else if (
    route.slotSelectionIntent ||
    (state.awaitingSlotSelection &&
      /\b(me\s+sirve\s+la|la\s+de\s+las|dame\s+la|quiero\s+el\s+de|esa\s+hora)\b/i.test(text))
  ) {
    userIntent = "SELECT_SLOT";
  } else if (
    services.length &&
    state.primaryService &&
    services.some((s) => s !== state.primaryService) &&
    /\b(olvida|olvide|fuga|tambi[eé]n|adem[aá]s|mejor)\b/i.test(text)
  ) {
    userIntent = "CHANGE_SERVICE";
    relationship = "SWITCH";
  } else if (route.priceIntent) {
    userIntent = "GET_ESTIMATE";
    secondaryIntents.push("ASK_PRICING");
  } else if (/\b(ya\s+no\s+quiero\s+el\s+servicio|cancela\s+mi\s+solicitud)\b/i.test(text)) {
    userIntent = "CANCEL_REQUEST";
  } else if (CANCEL_RE.test(text)) {
    userIntent = "CANCEL_VISIT";
  } else if (STATUS_RE.test(text)) {
    userIntent = "CHECK_STATUS";
  } else if (INFO_ONLY_RE.test(text) && !services.length) {
    userIntent = "ASK_GENERAL_QUESTION";
  } else if (services.length && !state.primaryService && actionable.createServiceRequest) {
    userIntent = "REQUEST_SERVICE";
    relationship = "NEW";
  } else if (state.bookingIntent || /\b(agendar|cita|visita|mañana|horario)\b/i.test(text)) {
    userIntent = "BOOK_VISIT";
  } else if (services.length > 1) {
    userIntent = "MULTI_NEED";
    secondaryIntents.push("MULTI_SERVICE");
  }

  if (
    (userIntent === "ASK_SERVICE_CAPABILITY" || userIntent === "ASK_GENERAL_QUESTION") &&
    (state.primaryService || state.activeLeadId || state.bookingIntent)
  ) {
    secondaryIntents.push("CONTINUE_BOOKING");
  }
  if (
    /\?/.test(text) &&
    userIntent !== "ASK_GENERAL_QUESTION" &&
    userIntent !== "ASK_SERVICE_CAPABILITY" &&
    (INFO_ONLY_RE.test(text) || SERVICE_CAPABILITY_RE.test(text) || SERVICE_CAPABILITY_QUESTION_RE.test(text) || PRICE_RE.test(text))
  ) {
    secondaryIntents.push(PRICE_RE.test(text) ? "ASK_PRICING" : "ASK_GENERAL_QUESTION");
  }

  if (transition.kind === "REFINE_CURRENT_SERVICE") {
    secondaryIntents.push("REFINE_SERVICE");
  }

  const entities: Record<string, string> = {};
  if (state.facts?.units) entities.unitsTotal = state.facts.units;
  if (state.facts?.symptom) entities.symptom = state.facts.symptom;
  if (state.facts?.duration) entities.onset = state.facts.duration;

  const schedulingInformation = {
    dateText: state.preferredDate || "",
    timeText: state.preferredTime || "",
    preference: isScheduleOrTimeOnlyMessage(text) ? text.trim() : state.facts?.schedulePreference || "",
  };

  const propertyInformation: Record<string, string> = {};
  if (isPresent(state.location)) propertyInformation.location = state.location;
  if (isPresent(state.facts?.building)) propertyInformation.building = state.facts!.building;
  if (isPresent(state.facts?.ph)) propertyInformation.ph = state.facts!.ph;
  if (isPresent(state.facts?.unit)) propertyInformation.unit = state.facts!.unit;

  const phoneClass = classifyPhone(state.phone);
  const contactInformation = {
    name: state.name || "",
    phone: phoneClass.status === "VALID" ? state.phone : "",
    email: state.email || "",
  };

  const blob = fold(text);
  const uncertainty = /\b(quiz[aá]s|tal\s+vez|no\s+s[eé]|creo\s+que|puede\s+ser)\b/.test(blob);

  return {
    userIntent,
    secondaryIntents,
    entities,
    corrections: [...(state.corrections || [])],
    negations: state.facts?.negated ? state.facts.negated.split("|").filter(Boolean) : [],
    schedulingInformation,
    serviceCandidates: [...new Set([...services, primaryHint].filter(Boolean))],
    contactInformation,
    propertyInformation,
    urgencySignals: SAFETY_RE.test(text) || state.urgency === "safety",
    emotionalSignals: /\b(urgente|desesperad|molest|enojad|frustrad)\b/i.test(text) ? ["frustration"] : [],
    referencesPriorContext: /\b(lo\s+mismo|la\s+vez\s+pasada|otra\s+vez|como\s+antes)\b/i.test(text),
    uncertainty,
    transactionRelationship: relationship,
  };
}
