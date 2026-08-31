/**
 * Homestead cognitive planner — operational summaries, not chain-of-thought.
 */
import type { ConversationState } from "@/lib/concierge-store";
import type { ConversationPerception } from "@/lib/concierge/conversation-perception";
import type { NextActionDecision } from "@/lib/concierge/conversation-next-action";
import { primaryGoal, resolveUserGoals, type UserGoal } from "@/lib/concierge/user-goals";
import { filterAskableFields } from "@/lib/concierge/question-value-engine";
import { buildFactGraph, serializeFactGraph } from "@/lib/concierge/fact-model";
import { isPresent } from "@/lib/concierge/canonical-state";

export type PlannerToolStep = {
  tool: string;
  purpose: string;
  risk: "READ" | "LOW_RISK_WRITE" | "HIGH_IMPACT_WRITE";
};

export type PlannerOutput = {
  goal: UserGoal;
  goals: UserGoal[];
  understanding: string;
  reasoningSummary: string;
  missingCriticalInformation: string[];
  assumptions: string[];
  riskFlags: string[];
  recommendedActions: string[];
  toolPlan: PlannerToolStep[];
  responseStrategy: string;
  factGraphSummary: string;
};

function serviceLabel(state: ConversationState) {
  const s = state.primaryService || state.service || "servicio";
  const map: Record<string, string> = {
    ac: "aire acondicionado",
    plumbing: "plomería",
    painting: "pintura",
    locksmith: "cerrajería",
    repairs: "reparaciones",
  };
  return map[s] || s;
}

export function planHomesteadTurn(input: {
  perception: ConversationPerception;
  state: ConversationState;
  nextDecision: NextActionDecision;
  hasCalendarResult: boolean;
  bookedThisTurn: boolean;
  userText?: string;
}): PlannerOutput {
  const { perception, state, nextDecision, hasCalendarResult, bookedThisTurn, userText = "" } = input;
  const goals = resolveUserGoals(perception, state, userText);
  const goal = primaryGoal(goals);
  const graph = buildFactGraph(state);
  const askable = filterAskableFields(state, nextDecision.requiredMissing, "");

  const missingCriticalInformation = askable.map((f) => f);
  const assumptions: string[] = [];
  const riskFlags: string[] = [];
  const recommendedActions: string[] = [];
  const toolPlan: PlannerToolStep[] = [];

  if (perception.urgencySignals) riskFlags.push("SAFETY_SIGNAL");
  if (perception.uncertainty) assumptions.push("user_expressed_uncertainty");
  if (graph.diagnosis?.status === "UNKNOWN") assumptions.push("diagnosis_unknown_by_design");

  let understanding = `Cliente en contexto de ${serviceLabel(state)}`;
  if (isPresent(state.facts?.symptom)) understanding += `; síntoma: ${state.facts!.symptom}`;
  if (perception.serviceCandidates.length > 1) understanding += "; múltiples servicios detectados";

  let responseStrategy = "ACKNOWLEDGE";
  if (goal === "GET_ESTIMATE" || goal === "ASK_GENERAL_QUESTION") responseStrategy = "ANSWER";
  else if (goal === "CHANGE_VISIT" || perception.userIntent === "REPROGRAM_APPOINTMENT") responseStrategy = "ACT";
  else if (goal === "BOOK_VISIT" && nextDecision.action === "CONFIRM_OR_BOOK") responseStrategy = "ACT";
  else if (missingCriticalInformation.length) responseStrategy = "CLARIFY";
  else if (nextDecision.action === "ASK_SLOT_SELECTION") responseStrategy = "OFFER_OPTIONS";
  else if (bookedThisTurn) responseStrategy = "CONFIRM";

  if (goal === "REQUEST_SERVICE" || goal === "BOOK_VISIT") {
    recommendedActions.push("ENSURE_SERVICE_REQUEST");
    toolPlan.push({ tool: "create_or_update_lead", purpose: "ensure HS", risk: "LOW_RISK_WRITE" });
  }
  if (nextDecision.action === "CHECK_AVAILABILITY" || nextDecision.action === "ASK_SLOT_SELECTION") {
    recommendedActions.push("QUERY_AVAILABILITY");
    toolPlan.push({ tool: "check_availability", purpose: "real slots", risk: "READ" });
  }
  if (nextDecision.action === "CONFIRM_OR_BOOK" && !bookedThisTurn) {
    recommendedActions.push("BOOK_APPOINTMENT");
    toolPlan.push({ tool: "create_appointment", purpose: "confirm visit", risk: "HIGH_IMPACT_WRITE" });
  }
  if (perception.userIntent === "REPROGRAM_APPOINTMENT") {
    recommendedActions.push("REPROGRAM_APPOINTMENT");
    toolPlan.push({ tool: "reschedule_appointment", purpose: "same HS new time", risk: "HIGH_IMPACT_WRITE" });
  }
  if (goal === "GET_ESTIMATE") {
    recommendedActions.push("ANSWER_PRICING_POLICY");
    responseStrategy = "ANSWER";
  }
  if (perception.referencesPriorContext) {
    recommendedActions.push("RETRIEVE_CUSTOMER_HISTORY");
    toolPlan.push({ tool: "get_customer_context", purpose: "prior jobs", risk: "READ" });
  }

  const reasoningSummary = [
    `goal=${goal}`,
    `intent=${perception.userIntent}`,
    `next=${nextDecision.action}`,
    `missing=[${missingCriticalInformation.join(",") || "none"}]`,
    hasCalendarResult ? "calendar_grounded=yes" : "calendar_grounded=no",
  ].join("; ");

  return {
    goal,
    goals,
    understanding,
    reasoningSummary,
    missingCriticalInformation,
    assumptions,
    riskFlags,
    recommendedActions,
    toolPlan,
    responseStrategy,
    factGraphSummary: serializeFactGraph(graph),
  };
}

export function plannerPromptBlock(plan: PlannerOutput): string {
  return [
    "HOMESTEAD_PLANNER (operational summary; NO inventar datos):",
    `goal=${plan.goal}`,
    `understanding=${plan.understanding}`,
    `missingCritical=[${plan.missingCriticalInformation.join(", ") || "none"}]`,
    `recommendedActions=[${plan.recommendedActions.join(", ") || "none"}]`,
    `responseStrategy=${plan.responseStrategy}`,
    `toolPlan=[${plan.toolPlan.map((t) => `${t.tool}:${t.risk}`).join(", ") || "none"}]`,
    `facts=${plan.factGraphSummary}`,
    "PROHIBIDO afirmar disponibilidad, citas o HS sin resultado de herramienta.",
  ].join("\n");
}
