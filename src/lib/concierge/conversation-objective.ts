/**
 * Semantic conversation objective — primary/secondary/interrupted goals.
 * Derived from planner + perception, not keyword→reply tables.
 */
import type { ConversationState } from "@/lib/concierge-store";
import type { ConversationPerception } from "@/lib/concierge/conversation-perception";
import type { PlannerOutput } from "@/lib/concierge/homestead-planner";
import type { TurnRoute } from "@/lib/concierge-turn-routing";
import { isPresent } from "@/lib/concierge/canonical-state";

export type ConversationPhase =
  | "GREETING"
  | "DISCOVERY"
  | "SCHEDULING"
  | "QUESTION"
  | "BOOKING"
  | "POST_BOOK"
  | "CANCEL"
  | "SWITCH";

export type ConversationObjective = {
  primaryGoal: string;
  secondaryGoals: string[];
  currentTopic: string;
  interruptedGoal: string;
  pendingBusinessAction: string;
  customerQuestion: string;
  conversationPhase: ConversationPhase;
};

const EMPTY: ConversationObjective = {
  primaryGoal: "",
  secondaryGoals: [],
  currentTopic: "",
  interruptedGoal: "",
  pendingBusinessAction: "",
  customerQuestion: "",
  conversationPhase: "DISCOVERY",
};

export function parseConversationObjective(state: ConversationState): ConversationObjective {
  const raw = state.facts?._conversationObjective;
  if (!raw) return { ...EMPTY };
  try {
    const parsed = JSON.parse(raw) as ConversationObjective;
    return {
      ...EMPTY,
      ...parsed,
      secondaryGoals: Array.isArray(parsed.secondaryGoals) ? parsed.secondaryGoals.slice(0, 6) : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

function phaseFrom(plan: PlannerOutput, state: ConversationState, perception: ConversationPerception): ConversationPhase {
  if (state.appointmentId) return "POST_BOOK";
  if (plan.goal === "CANCEL_VISIT") return "CANCEL";
  if (plan.goal === "CHANGE_SERVICE" || perception.transactionRelationship === "SWITCH") return "SWITCH";
  if (plan.goal === "ASK_GENERAL_QUESTION" || perception.userIntent === "ASK_SERVICE_CAPABILITY") {
    return "QUESTION";
  }
  if (plan.goal === "BOOK_VISIT" || plan.goal === "CHANGE_VISIT") return "SCHEDULING";
  if (state.bookingIntent || state.offeredSlots?.length) return "BOOKING";
  return "DISCOVERY";
}

export function updateConversationObjective(input: {
  state: ConversationState;
  perception: ConversationPerception;
  plan: PlannerOutput;
  route?: TurnRoute;
  userText?: string;
}): ConversationState {
  const prev = parseConversationObjective(input.state);
  const { perception, plan, route, userText = "" } = input;
  const bookingActive =
    Boolean(input.state.primaryService || input.state.service) &&
    !input.state.appointmentId &&
    (plan.goal === "REQUEST_SERVICE" ||
      plan.goal === "BOOK_VISIT" ||
      plan.goal === "CONTINUE" ||
      isPresent(input.state.activeLeadId));

  const asking =
    perception.userIntent === "ASK_GENERAL_QUESTION" ||
    perception.userIntent === "ASK_SERVICE_CAPABILITY" ||
    perception.secondaryIntents.includes("ASK_PRICING") ||
    perception.secondaryIntents.includes("ASK_GENERAL_QUESTION") ||
    Boolean(route?.priceIntent || route?.serviceQuestionIntent);

  const questionText = asking ? userText.trim().slice(0, 180) : "";

  let interruptedGoal = prev.interruptedGoal;
  let primaryGoal: string = plan.goal;
  let currentTopic = perception.userIntent;

  if (asking && bookingActive && plan.goal !== "ASK_GENERAL_QUESTION") {
    interruptedGoal = prev.primaryGoal || plan.goal || "BOOK_VISIT";
    currentTopic = perception.userIntent || "ASK_GENERAL_QUESTION";
  } else if (asking && bookingActive) {
    interruptedGoal = prev.primaryGoal && prev.primaryGoal !== "ASK_GENERAL_QUESTION"
      ? prev.primaryGoal
      : "BOOK_VISIT";
    primaryGoal = "ASK_GENERAL_QUESTION";
    currentTopic = perception.userIntent;
  } else if (!asking && interruptedGoal) {
    primaryGoal = interruptedGoal;
    currentTopic = interruptedGoal;
    interruptedGoal = "";
  } else if (!asking) {
    interruptedGoal = "";
  }

  const secondaryGoals = [...new Set([...plan.goals.slice(1), ...perception.secondaryIntents])].slice(0, 6);

  const next: ConversationObjective = {
    primaryGoal,
    secondaryGoals,
    currentTopic,
    interruptedGoal,
    pendingBusinessAction: plan.recommendedActions[0] || "",
    customerQuestion: questionText || (asking ? prev.customerQuestion : ""),
    conversationPhase: phaseFrom(plan, input.state, perception),
  };

  return {
    ...input.state,
    facts: {
      ...(input.state.facts || {}),
      _conversationObjective: JSON.stringify(next),
    },
  };
}

/** Fallback resume when OpenAI is down — one sentence, no slot dump. */
export function resumeAfterInterruption(reply: string, state: ConversationState): string {
  const obj = parseConversationObjective(state);
  const interrupted = obj.interruptedGoal || "";
  const booking =
    interrupted === "BOOK_VISIT" ||
    interrupted === "REQUEST_SERVICE" ||
    Boolean(state.primaryService || state.service);
  if (!booking) return reply;
  if (/aire|cita|solicitud|horario|zona|nombre|tel[eé]fono/i.test(reply) && reply.length > 80) {
    return reply;
  }
  const loc = state.location || state.facts?.location || "";
  const missing: string[] = [];
  if (!isPresent(state.name)) missing.push("nombre");
  if (state.contactStatus !== "VALID") missing.push("teléfono");
  if (!loc) missing.push("zona");
  if (missing.length) {
    return `${reply.trim()} Y para lo del servicio, ya sigo con esa solicitud; me falta ${missing.join(" y ")}.`;
  }
  if (state.offeredSlots?.length) {
    return `${reply.trim()} Cuando quieras volvemos a la cita.`;
  }
  return `${reply.trim()} Seguimos con lo que ya veníamos coordinando.`;
}
