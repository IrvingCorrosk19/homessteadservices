/**
 * Pre-send natural response validation — grounding + known-fact re-ask + stale speech.
 * Repair, do not synonym-roulette.
 */
import type { ConversationState } from "@/lib/concierge-store";
import { detectRepeatedQuestion } from "@/lib/concierge/turn-intelligence";
import { responseReferencesStaleService } from "@/lib/concierge/service-transition";
import { isPresent } from "@/lib/concierge/canonical-state";

export type NaturalValidation = {
  ok: boolean;
  reasons: string[];
  knownFactReasks: string[];
  unsupportedCommitment: boolean;
  staleContext: boolean;
  internalTerminology: boolean;
};

const COMMITMENT_RE =
  /\b(cre[eé]|registr[eé]|agend|cancel[eé]|reprogram[eé]|envi[eé]|qued[oó]\s+confirmad|ya\s+est[aá]\s+agendad|visita\s+qued[oó]|est[aá]\s+disponible)\b/i;

const INTERNAL_RE =
  /\b(nextAction|ASK_PHONE|CONFIRM_OR_BOOK|playbook|tool_call|HS creation|state machine|pipeline_stage|actionability|pendingQuestion|outbox|tenant|semantic confidence|TurnActionPlan)\b/i;

const MALFORMED_COMPOSITION = /\bpara\s+por\b/i;

export function validateNaturalResponse(
  reply: string,
  state: ConversationState,
  opts: {
    bookedThisTurn?: boolean;
    cancelledThisTurn?: boolean;
    calendarQueried?: boolean;
    offeredSlots?: Array<{ time?: string; label?: string }>;
  } = {},
): NaturalValidation {
  const reasons: string[] = [];
  const knownFactReasks = detectRepeatedQuestion(reply, state);
  if (knownFactReasks.length) reasons.push(`reask:${knownFactReasks.join(",")}`);

  const claimsSuccess = COMMITMENT_RE.test(reply);
  const grounded =
    Boolean(opts.bookedThisTurn) ||
    Boolean(opts.cancelledThisTurn) ||
    Boolean(state.appointmentId) ||
    Boolean(opts.calendarQueried && /disponible|ocupad|horario/i.test(reply));
  const unsupportedCommitment = claimsSuccess && !grounded && /agend|confirm|cancel|registr/i.test(reply);
  if (unsupportedCommitment) reasons.push("unsupported_commitment");

  const staleContext = responseReferencesStaleService(reply, state);
  if (staleContext) reasons.push("stale_service");

  const internalTerminology = INTERNAL_RE.test(reply);
  if (internalTerminology) reasons.push("internal_terminology");
  if (MALFORMED_COMPOSITION.test(reply)) reasons.push("malformed_composition");
  if (!reply.trim()) reasons.push("empty_response");
  if (/^\s*[{[]/.test(reply) || /"tool_call"\s*:/.test(reply)) reasons.push("raw_json");
  if (/\b(at\s+\w+\.\w+|TypeError:|ReferenceError:|stack trace)\b/i.test(reply)) reasons.push("stack_trace");
  const dupPara = reply.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (dupPara.length >= 2 && dupPara[0] === dupPara[1]) reasons.push("duplicate_paragraph");

  if (opts.offeredSlots?.length && /est[aá]n? disponibles?:/i.test(reply)) {
    const blob = reply.toLowerCase();
    const invented = opts.offeredSlots.every(
      (s) => s.time && !blob.includes(s.time.slice(0, 5)) && !(s.label && blob.includes(s.label.toLowerCase().slice(0, 8))),
    );
    if (invented && /\d{1,2}:\d{2}/.test(reply)) reasons.push("possible_invented_slots");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    knownFactReasks,
    unsupportedCommitment,
    staleContext,
    internalTerminology,
  };
}

export function repairNaturalResponse(
  reply: string,
  state: ConversationState,
  validation: NaturalValidation,
): string {
  let text = reply;
  if (validation.internalTerminology) {
    text = text.replace(INTERNAL_RE, "");
  }
  if (validation.unsupportedCommitment) {
    text =
      "Todavía no confirmo la operación hasta dejarla registrada. " +
      (isPresent(state.location) ? "Sigo con lo que ya me diste." : "Cuéntame lo que falte para avanzar.");
  }
  if (validation.knownFactReasks.includes("slot")) {
    text = "Voy a revisar el calendario con el horario que ya me diste.";
  }
  text = text.replace(/\bpara\s+por\b/gi, "para");
  if (validation.reasons.includes("empty_response") || validation.reasons.includes("raw_json") || validation.reasons.includes("stack_trace")) {
    text = isPresent(state.activeLeadId)
      ? "Sigo con tu solicitud. Dime cómo quieres continuar."
      : "Cuéntame qué necesitas y te ayudo.";
  }
  return text.replace(/\s{2,}/g, " ").trim();
}
