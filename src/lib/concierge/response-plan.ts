/**
 * Compact response plan for the model — not a reply template mosaic.
 */
import type { ConversationState } from "@/lib/concierge-store";
import type { NextActionDecision } from "@/lib/concierge/conversation-next-action";
import type { PlannerOutput } from "@/lib/concierge/homestead-planner";
import type { ConversationPerception } from "@/lib/concierge/conversation-perception";
import {
  parseConversationObjective,
  type ConversationObjective,
} from "@/lib/concierge/conversation-objective";
import { isPresent } from "@/lib/concierge/canonical-state";

export type ToolObservationSummary = {
  tool?: string;
  requested?: string;
  requestedAvailable?: boolean;
  alternatives?: string[];
  ok?: boolean;
  error?: string;
};

export type ResponsePlan = {
  customerGoal: string;
  interruptedGoal: string;
  currentTopic: string;
  factsLearnedThisTurn: string[];
  knownFacts: string[];
  businessAction: string;
  toolResult: ToolObservationSummary | null;
  mustCommunicate: string[];
  shouldAsk: string;
  mustNotAsk: string[];
  tone: "natural_professional";
  resumeAfterAnswer: boolean;
};

function knownFactKeys(state: ConversationState): string[] {
  const keys: string[] = [];
  if (isPresent(state.name)) keys.push("name");
  if (state.contactStatus === "VALID") keys.push("phone");
  if (isPresent(state.location) || isPresent(state.facts?.location)) keys.push("location");
  if (isPresent(state.facts?.building) || isPresent(state.facts?.ph)) keys.push("building");
  if (isPresent(state.facts?.unit) || isPresent(state.facts?.apartment)) keys.push("unit");
  if (isPresent(state.primaryService || state.service)) keys.push("service");
  if (isPresent(state.facts?.symptom) || isPresent(state.problem)) keys.push("problem");
  if (isPresent(state.preferredDate)) keys.push("preferredDate");
  if (isPresent(state.preferredTime)) keys.push("preferredTime");
  return keys;
}

export function factsLearnedThisTurn(before: ConversationState, after: ConversationState): string[] {
  const learned: string[] = [];
  if (!isPresent(before.name) && isPresent(after.name)) learned.push("name");
  if (before.contactStatus !== "VALID" && after.contactStatus === "VALID") learned.push("phone");
  if (!isPresent(before.location) && isPresent(after.location)) learned.push("location");
  if (!isPresent(before.facts?.unit) && isPresent(after.facts?.unit)) learned.push("unit");
  if (!isPresent(before.facts?.building) && isPresent(after.facts?.building)) learned.push("building");
  if (!isPresent(before.primaryService) && isPresent(after.primaryService || after.service)) learned.push("service");
  if (!isPresent(before.preferredDate) && isPresent(after.preferredDate)) learned.push("preferredDate");
  if (!isPresent(before.preferredTime) && isPresent(after.preferredTime)) learned.push("preferredTime");
  if (!isPresent(before.facts?.symptom) && isPresent(after.facts?.symptom)) learned.push("problem");
  return learned;
}

export function buildResponsePlan(input: {
  state: ConversationState;
  perception: ConversationPerception;
  plan: PlannerOutput;
  nextDecision: NextActionDecision;
  toolResult?: ToolObservationSummary | null;
  factsLearnedThisTurn?: string[];
  groundedCompanyAnswer?: string;
}): ResponsePlan {
  const obj: ConversationObjective = parseConversationObjective(input.state);
  const known = knownFactKeys(input.state);
  const askingQuestion =
    input.perception.userIntent === "ASK_GENERAL_QUESTION" ||
    input.perception.userIntent === "ASK_SERVICE_CAPABILITY" ||
    input.perception.secondaryIntents.includes("ASK_PRICING") ||
    input.perception.secondaryIntents.includes("ASK_GENERAL_QUESTION");

  const mustCommunicate: string[] = [];
  if (askingQuestion) mustCommunicate.push("answer_customer_question");
  if (input.groundedCompanyAnswer) mustCommunicate.push("grounded_company_fact");
  if (input.toolResult?.requestedAvailable === false) mustCommunicate.push("requested_busy");
  if (input.toolResult?.alternatives?.length) mustCommunicate.push("alternatives");
  if (input.toolResult?.requestedAvailable === true) mustCommunicate.push("requested_available");
  if (input.toolResult?.ok === false) mustCommunicate.push("tool_failure_honest");
  if (obj.interruptedGoal && askingQuestion) mustCommunicate.push("resume_interrupted_goal");

  let shouldAsk = "";
  if (askingQuestion && obj.interruptedGoal) {
    shouldAsk = input.nextDecision.askField
      ? `after_answer_continue:${input.nextDecision.action}`
      : "resume_booking_naturally";
  } else if (input.nextDecision.action === "ASK_IDENTITY") {
    shouldAsk = "name_and_phone_together";
  } else if (input.nextDecision.askField) {
    shouldAsk = input.nextDecision.askField;
  } else if (input.nextDecision.action === "ASK_SLOT_SELECTION") {
    shouldAsk = "choose_alternative";
  } else if (input.toolResult?.requestedAvailable === false && input.toolResult.alternatives?.length) {
    shouldAsk = "choose_alternative";
  }

  return {
    customerGoal: obj.primaryGoal || input.plan.goal,
    interruptedGoal: obj.interruptedGoal,
    currentTopic: obj.currentTopic || input.perception.userIntent,
    factsLearnedThisTurn: input.factsLearnedThisTurn || [],
    knownFacts: known,
    businessAction: input.nextDecision.action,
    toolResult: input.toolResult || null,
    mustCommunicate,
    shouldAsk,
    mustNotAsk: known,
    tone: "natural_professional",
    resumeAfterAnswer: Boolean(obj.interruptedGoal && askingQuestion),
  };
}

export function responsePlanPromptBlock(plan: ResponsePlan): string {
  return [
    "RESPONSE_PLAN (genera español coherente; NO concatenes plantillas; NO inventes operaciones):",
    JSON.stringify(plan),
    "Si resumeAfterAnswer=true: responde la pregunta y vuelve al objetivo interrumpido en la misma intervención.",
    "shouldAsk=name_and_phone_together: una sola pregunta natural (nombre + teléfono), no dos turnos.",
    "mustNotAsk: no preguntes ni confirmes esos hechos uno por uno.",
    "No empieces con Entendido / Perfecto / Excelente / Gracias por la información salvo que sea una corrección o cierre de cita.",
    "No repitas datos que el cliente acaba de dar salvo corrección, ambigüedad o confirmación de reserva.",
    "Longitud variable: pregunta simple = corto; reserva = claro y estructurado.",
    "Si el cliente ya pidió horarios o un día/hora, no pidas permiso para consultar el calendario.",
    "Hechos de empresa desconocidos: dilo (“Eso no lo tengo confirmado”) y ofrece el siguiente paso útil.",
  ].join("\n");
}
