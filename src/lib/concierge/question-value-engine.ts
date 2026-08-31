/**
 * Question value engine — ask only what materially changes the next safe action.
 */
import type { ConversationState } from "@/lib/concierge-store";
import type { AppointmentMissingField } from "@/lib/concierge/appointment-readiness";
import { getAppointmentReadiness } from "@/lib/concierge/appointment-readiness";
import { isPresent } from "@/lib/concierge/canonical-state";
import { classifyPhone } from "@/lib/phone";

export type AskEvaluation = {
  field: string;
  shouldAsk: boolean;
  reason: string;
};

export function evaluateAskField(
  state: ConversationState,
  field: AppointmentMissingField | string,
  userText = "",
): AskEvaluation {
  const readiness = getAppointmentReadiness(state);
  const known = new Set(readiness.knownFields);
  const normalized =
    field === "name" || field === "phone"
      ? field === "name"
        ? "customer_name"
        : "contact"
      : field;
  const declined =
    state.facts?.[`${field}Status`] === "DECLINED" ||
    state.facts?.additionalReference === "DECLINED";

  if (known.has(normalized) || (field === "location" && known.has("location"))) {
    return { field, shouldAsk: false, reason: "already_known" };
  }
  if (declined) {
    return { field, shouldAsk: false, reason: "user_declined" };
  }

  const askCount = Number(state.facts?.[`askCount_${field}`] || 0);
  if (askCount >= 2) {
    return { field, shouldAsk: false, reason: "asked_twice" };
  }

  if (field === "phone") {
    const phone = classifyPhone(state.phone);
    if (phone.status === "VALID") return { field, shouldAsk: false, reason: "phone_valid" };
  }

  if (field === "location" && isPresent(state.location)) {
    return { field, shouldAsk: false, reason: "location_present" };
  }

  if (field === "name" && isPresent(state.name)) {
    return { field, shouldAsk: false, reason: "name_present" };
  }

  if (field === "service" && isPresent(state.primaryService || state.service)) {
    return { field, shouldAsk: false, reason: "service_present" };
  }

  if (/\b(no\s+s[eé]|no\s+tengo|ninguno|eso\s+es\s+todo)\b/i.test(userText) && field === "reference") {
    return { field, shouldAsk: false, reason: "user_declined_turn" };
  }

  const required = readiness.missingFields.includes(normalized as AppointmentMissingField);
  if (!required && field !== "reference") {
    return { field, shouldAsk: false, reason: "not_required_for_next_action" };
  }

  return { field, shouldAsk: true, reason: "required_for_next_action" };
}

export function filterAskableFields(
  state: ConversationState,
  fields: AppointmentMissingField[],
  userText = "",
): AppointmentMissingField[] {
  return fields.filter((f) => evaluateAskField(state, f, userText).shouldAsk);
}
