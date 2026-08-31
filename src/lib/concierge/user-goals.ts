/**
 * User goal model — what the customer is trying to accomplish (not just service id).
 */
import type { ConversationPerception } from "@/lib/concierge/conversation-perception";
import type { ConversationState } from "@/lib/concierge-store";

export type UserGoal =
  | "GET_INFORMATION"
  | "REQUEST_SERVICE"
  | "GET_ESTIMATE"
  | "DIAGNOSE_PRELIMINARILY"
  | "BOOK_VISIT"
  | "CHANGE_VISIT"
  | "CANCEL_VISIT"
  | "ADD_SERVICE"
  | "CHANGE_SERVICE"
  | "CHECK_STATUS"
  | "PROVIDE_EVIDENCE"
  | "ASK_GENERAL_QUESTION"
  | "COMPLAIN"
  | "FOLLOW_UP"
  | "END_INTERACTION"
  | "CONTINUE";

const INTENT_TO_GOAL: Record<string, UserGoal> = {
  REQUEST_SERVICE: "REQUEST_SERVICE",
  BOOK_VISIT: "BOOK_VISIT",
  REPROGRAM_APPOINTMENT: "CHANGE_VISIT",
  CANCEL_VISIT: "CANCEL_VISIT",
  SELECT_SLOT: "BOOK_VISIT",
  GET_ESTIMATE: "GET_ESTIMATE",
  CHECK_STATUS: "CHECK_STATUS",
  CHANGE_SERVICE: "CHANGE_SERVICE",
  ADD_SERVICE: "ADD_SERVICE",
  ASK_GENERAL_QUESTION: "ASK_GENERAL_QUESTION",
  MULTI_NEED: "REQUEST_SERVICE",
  CONTINUE: "CONTINUE",
};

export function resolveUserGoals(
  perception: ConversationPerception,
  state: ConversationState,
  userText = "",
): UserGoal[] {
  const goals: UserGoal[] = [];
  const primary = INTENT_TO_GOAL[perception.userIntent] || "CONTINUE";
  goals.push(primary);

  if (perception.secondaryIntents.includes("ASK_PRICING")) goals.push("GET_ESTIMATE");
  if (perception.secondaryIntents.includes("MULTI_SERVICE")) goals.push("ADD_SERVICE");
  if (state.humanHandoffRequested) goals.push("COMPLAIN");
  if (/\b(eso\s+es\s+todo|eso\s+ser[ií]a\s+todo|nada\s+m[aá]s)\b/i.test(userText)) {
    goals.push("END_INTERACTION");
  }
  if (state.photoCount > 0) goals.push("PROVIDE_EVIDENCE");

  return [...new Set(goals)];
}

export function primaryGoal(goals: UserGoal[]): UserGoal {
  return goals[0] || "CONTINUE";
}
