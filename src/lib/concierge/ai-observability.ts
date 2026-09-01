/**
 * AI observability — audit events without hidden chain-of-thought.
 */
import { logInfo } from "@/lib/log";
import type { PlannerOutput } from "@/lib/concierge/homestead-planner";
import type { ConversationPerception } from "@/lib/concierge/conversation-perception";

export function logAiUnderstanding(
  conversationId: string,
  perception: ConversationPerception,
) {
  logInfo("AI_UNDERSTANDING_CREATED", {
    contentJobId: conversationId.slice(0, 8),
    stage: perception.userIntent,
    phone: perception.transactionRelationship,
  });
}

export function logPlanCreated(conversationId: string, plan: PlannerOutput) {
  logInfo("PLAN_CREATED", {
    contentJobId: conversationId.slice(0, 8),
    stage: plan.goal,
    phone: plan.reasoningSummary.slice(0, 120),
  });
}

export function logToolRequested(conversationId: string, tool: string, allowed: boolean) {
  logInfo("TOOL_REQUESTED", {
    contentJobId: conversationId.slice(0, 8),
    stage: tool,
    phone: allowed ? "allowed" : "blocked",
  });
}

export function logToolResult(conversationId: string, tool: string, ok: boolean) {
  logInfo(ok ? "TOOL_SUCCEEDED" : "TOOL_FAILED", {
    contentJobId: conversationId.slice(0, 8),
    stage: tool,
  });
}

export function logResponseValidated(conversationId: string, ok: boolean, reason = "") {
  logInfo("RESPONSE_VALIDATED", {
    contentJobId: conversationId.slice(0, 8),
    stage: ok ? "pass" : "blocked",
    phone: reason.slice(0, 80),
  });
}

export function logNaturalTurn(input: {
  conversationId: string;
  intent: string;
  goal: string;
  nextAction: string;
  toolCalls: number;
  reaskPrevented: boolean;
  validation: string;
  latencyMs: number;
}) {
  logInfo("NATURAL_TURN", {
    contentJobId: input.conversationId.slice(0, 8),
    stage: input.nextAction.slice(0, 40),
    phone: [
      input.intent,
      input.goal,
      `tools=${input.toolCalls}`,
      input.reaskPrevented ? "reask_prevented" : "",
      input.validation,
      `${input.latencyMs}ms`,
    ]
      .filter(Boolean)
      .join("|")
      .slice(0, 180),
  });
}
