/**
 * Conversation semantic summary — compressed episodic memory for retrieval.
 */
import type { ConversationState } from "@/lib/concierge-store";
import type { PlannerOutput } from "@/lib/concierge/homestead-planner";
import { isPresent } from "@/lib/concierge/canonical-state";

export type ConversationSummary = {
  customerGoal: string;
  confirmedFacts: string[];
  unresolvedQuestions: string[];
  activeRequests: string[];
  appointments: string[];
  serviceContexts: string[];
  declinedFields: string[];
  importantCorrections: string[];
  commitmentsMade: string[];
  updatedAt: string;
};

export function buildConversationSummary(
  state: ConversationState,
  plan: PlannerOutput,
): ConversationSummary {
  const confirmedFacts: string[] = [];
  if (isPresent(state.name)) confirmedFacts.push(`name:${state.name}`);
  if (isPresent(state.phone) && state.contactStatus === "VALID") confirmedFacts.push(`phone:${state.phone}`);
  if (isPresent(state.location)) confirmedFacts.push(`location:${state.location}`);
  if (isPresent(state.primaryService || state.service)) {
    confirmedFacts.push(`service:${state.primaryService || state.service}`);
  }
  if (isPresent(state.facts?.units)) confirmedFacts.push(`units:${state.facts!.units}`);
  if (isPresent(state.facts?.symptom)) confirmedFacts.push(`symptom:${state.facts!.symptom}`);

  const declinedFields = Object.entries(state.facts || {})
    .filter(([, v]) => v === "DECLINED")
    .map(([k]) => k);

  return {
    customerGoal: plan.goal,
    confirmedFacts,
    unresolvedQuestions: plan.missingCriticalInformation,
    activeRequests: state.activeLeadId ? [state.activeLeadId] : [],
    appointments: state.appointmentId ? [state.appointmentId] : [],
    serviceContexts: state.facts?.serviceContextId ? [state.facts.serviceContextId] : [],
    declinedFields,
    importantCorrections: [...(state.corrections || [])].slice(-6),
    commitmentsMade: state.appointmentId ? [`appointment:${state.appointmentId}`] : [],
    updatedAt: new Date().toISOString(),
  };
}

export function persistSummaryOnState(state: ConversationState, summary: ConversationSummary): ConversationState {
  return {
    ...state,
    facts: {
      ...(state.facts || {}),
      _conversationSummary: JSON.stringify(summary),
      _plannerGoal: summary.customerGoal,
    },
  };
}

export function parseConversationSummary(state: ConversationState): ConversationSummary | null {
  const raw = state.facts?._conversationSummary;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ConversationSummary;
  } catch {
    return null;
  }
}
