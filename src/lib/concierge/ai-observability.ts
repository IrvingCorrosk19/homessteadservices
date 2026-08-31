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
