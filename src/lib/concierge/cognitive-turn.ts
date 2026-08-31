/**
 * Cognitive turn orchestration — perception → contradiction → planner → memory.
 */
import type { ConversationState } from "@/lib/concierge-store";
import type { ConversationTransition } from "@/lib/concierge/service-transition";
import type { NextActionDecision } from "@/lib/concierge/conversation-next-action";
import { perceiveTurn } from "@/lib/concierge/conversation-perception";
import { applyContradictionResolution } from "@/lib/concierge/contradiction-engine";
import { planHomesteadTurn, type PlannerOutput } from "@/lib/concierge/homestead-planner";
import { buildConversationSummary, persistSummaryOnState } from "@/lib/concierge/conversation-summary";
import { logAiUnderstanding, logPlanCreated } from "@/lib/concierge/ai-observability";

export type CognitiveTurnResult = {
  state: ConversationState;
  perception: ReturnType<typeof perceiveTurn>;
  plan: PlannerOutput;
};

export function runCognitiveTurn(input: {
  conversationId: string;
  text: string;
  state: ConversationState;
  transition: ConversationTransition;
  nextDecision: NextActionDecision;
  hasCalendarResult: boolean;
  bookedThisTurn: boolean;
}): CognitiveTurnResult {
  let state = applyContradictionResolution(input.state, input.text);
  const perception = perceiveTurn(input.text, state, input.transition);
  logAiUnderstanding(input.conversationId, perception);

  const plan = planHomesteadTurn({
    perception,
    state,
    nextDecision: input.nextDecision,
    hasCalendarResult: input.hasCalendarResult,
    bookedThisTurn: input.bookedThisTurn,
    userText: input.text,
  });
  logPlanCreated(input.conversationId, plan);

  const summary = buildConversationSummary(state, plan);
  state = persistSummaryOnState(state, summary);

  return { state, perception, plan };
}
