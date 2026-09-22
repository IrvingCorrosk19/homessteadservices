/**
 * Non-mutating speech-act guards.
 * Hypothetical, quoted, withdrawn, and blank turns must not authorize writes.
 */
import { foldLex } from "@/lib/concierge/lexical-match";

export const SEMANTIC_ENGINE_VERSION = "hs-semantic-v4-zd";

export function isBlankConversationalInput(text: string) {
  return !(text || "").trim();
}

/** Last clause after "perdón" / "perdón, no" wins for time, name, and target. */
export function speechAfterSelfCorrection(text: string) {
  const parts = (text || "").split(/\bperd[oó]n[,.]?\s*(?:no,?\s*)?/i);
  if (parts.length < 2) return text || "";
  const last = parts[parts.length - 1].trim();
  return last || text;
}

export function isHypotheticalSpeech(text: string) {
  const t = foldLex(text);
  if (/\bsi no hay\b/.test(t) || /\bsi no pueden\b/.test(t)) return false;
  return (
    /\b(si yo quisiera|si quisiera cancelar|que pasa si|que pasaria si|como seria si)\b/.test(t) ||
    /\b(despues voy a cancelar|mas tarde (lo )?voy a cancelar|luego cancelo)\b/.test(t)
  );
}

export function isQuotedThirdPartyCommand(text: string) {
  const t = foldLex(text);
  const quoted = /['"«»][^'"«»]{3,120}['"»]/.test(text);
  const attributed = /\b(me escribio|me mando|mi esposa|mi esposo|tu dijiste|usted dijo|mi mujer)\b/.test(t);
  return quoted && attributed;
}

export function isLastMomentBookingWithdrawal(text: string) {
  const t = foldLex(text);
  return (
    /\b(agend\w*|reserv\w*|para (mañana|manana)).{0,160}\b(no,?\s+(espera,?\s+)?(mejor\s+)?no|todavia no quiero agendar|mejor no)\b/.test(
      t,
    ) || /\bno,?\s+espera,?\s+todavia no quiero agendar/.test(t)
  );
}

/** HS- prefix present but not a strict folio — never fuzzy-target another object. */
export function looksLikeMalformedHsId(text: string) {
  return /\bHS-\d/i.test(text) && !/\bHS-\d{4}-\d{6}\b/i.test(text);
}

export type MutationBudget = {
  newHs: number;
  newHa: number;
  writes: boolean;
  kind: "READ_ONLY" | "MUTATING";
};

export function mutationBudgetForIntent(input: {
  informationalOnly: boolean;
  createServiceRequest: boolean;
  existingPrimary: string;
}): MutationBudget {
  if (input.informationalOnly || input.existingPrimary === "CHECK_STATUS") {
    return { newHs: 0, newHa: 0, writes: false, kind: "READ_ONLY" };
  }
  if (input.createServiceRequest) {
    return { newHs: 1, newHa: 0, writes: true, kind: "MUTATING" };
  }
  if (
    input.existingPrimary === "CANCEL_REQUEST" ||
    input.existingPrimary === "CANCEL_APPOINTMENT_ONLY" ||
    input.existingPrimary === "RESCHEDULE_APPOINTMENT"
  ) {
    return { newHs: 0, newHa: 0, writes: true, kind: "MUTATING" };
  }
  return { newHs: 0, newHa: 0, writes: false, kind: "READ_ONLY" };
}
