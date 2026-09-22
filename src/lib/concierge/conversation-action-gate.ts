/**
 * Semantic authority + business mutation firewall.
 *
 * Raw user text may be analyzed. It must not mutate HS/HA/outbox by itself.
 * Every consequential conversational write must pass authorizeConversationAction.
 */
import { logInfo } from "@/lib/log";
import type { ConversationState } from "@/lib/concierge-store";
import {
  classifyActionableServiceIntent,
  type Actionability,
  type ActionableIntentDecision,
} from "@/lib/concierge/actionable-intent";
import {
  classifyExistingRequestOperation,
  type ExistingRequestOperation,
} from "@/lib/concierge/existing-request-operation";
import { foldLex } from "@/lib/concierge/lexical-match";
import {
  SEMANTIC_ENGINE_VERSION,
  isBlankConversationalInput,
  isHypotheticalSpeech,
  isLastMomentBookingWithdrawal,
  isQuotedThirdPartyCommand,
  mutationBudgetForIntent,
  speechAfterSelfCorrection,
  type MutationBudget,
} from "@/lib/concierge/speech-act-safety";

export { SEMANTIC_ENGINE_VERSION };

export type FactProvenance =
  | "CURRENT_USER_EXPLICIT"
  | "CURRENT_USER_INFERRED"
  | "PRIOR_CONVERSATION"
  | "CUSTOMER_MEMORY"
  | "BUSINESS_DB"
  | "TOOL_OBSERVATION"
  | "SYSTEM_DEFAULT";

export type ConversationAction =
  | "CREATE_REQUEST"
  | "UPDATE_REQUEST"
  | "CANCEL_REQUEST"
  | "CANCEL_APPOINTMENT_ONLY"
  | "RESCHEDULE_APPOINTMENT"
  | "CREATE_APPOINTMENT"
  | "SWITCH_SERVICE"
  | "ADD_SERVICE"
  | "READ_REQUESTS"
  | "NOTIFY"
  | "NONE";

export type PlanConstraint = "DO" | "DO_NOT" | "PRESERVE";

export type PlannedAction = {
  action: ConversationAction;
  constraint: PlanConstraint;
  targetId?: string;
  service?: string;
  provenance: FactProvenance;
  supportedBy: string;
};

export type ResolvedTurnIntent = {
  conversationalIntent: string;
  businessIntent: string;
  actionability: Actionability;
  createServiceRequest: boolean;
  informationalOnly: boolean;
  existingOp: ExistingRequestOperation;
  actionable: ActionableIntentDecision;
  serviceFromCurrentMessage: boolean;
  serviceFromBusinessDb: boolean;
  preserveConstraint: boolean;
  doNotCreate: boolean;
  confidence: "low" | "medium" | "high";
  ambiguities: string[];
  factsProvenance: Record<string, FactProvenance>;
};

export type TurnActionPlan = {
  requestedActions: PlannedAction[];
  conflicts: string[];
  blocked: boolean;
  blockedReason: string;
  mutationBudget: MutationBudget;
};

export type ConversationActionAuthorization = {
  allowed: boolean;
  action: ConversationAction;
  reason: string;
  plan: TurnActionPlan;
  resolved: ResolvedTurnIntent;
};

const DO_NOT_CREATE_RE = /\bno\s+me\s+crees?\s+otra\b/i;
const HELP_ONLY_RE =
  /^(hola|buenas|buenos dias|hey|necesito ayuda|tengo una consulta|quiero informacion|quiero saber algo|me puedes ayudar)[\s!.?]*$/;

export function resolveTurnIntent(text: string, state: ConversationState | null): ResolvedTurnIntent {
  const trimmed = (text || "").trim();
  const speech = speechAfterSelfCorrection(trimmed);
  const existingOp = classifyExistingRequestOperation(speech);
  const actionable = classifyActionableServiceIntent(speech, state);
  const hypothetical = isHypotheticalSpeech(trimmed) || isQuotedThirdPartyCommand(trimmed);
  const bookingWithdrawn = isLastMomentBookingWithdrawal(trimmed);
  const blank = isBlankConversationalInput(trimmed);
  const serviceFromBusinessDb = Boolean(
    state?.activeLeadId &&
      (state.facts?.serviceFactSource === "BUSINESS_DB" || existingOp.isExistingRequestOperation),
  );
  const serviceFromCurrentMessage =
    Boolean(actionable.createServiceRequest) && !existingOp.blocksRequestCreation && !serviceFromBusinessDb;
  const doNotCreate = DO_NOT_CREATE_RE.test(trimmed) && !existingOp.hasExplicitNewRequestOperator;
  const greetingOrHelp = HELP_ONLY_RE.test(foldLex(trimmed));
  const ambiguities: string[] = [];
  if (existingOp.primaryAction === "CANCEL_REQUEST" && !existingOp.explicitRequestIds.length) {
    ambiguities.push("cancel_target");
  }
  let conversationalIntent: string = actionable.primaryIntent;
  if (existingOp.primaryAction === "CHECK_STATUS") conversationalIntent = "CHECK_STATUS";
  else if (existingOp.primaryAction === "CANCEL_REQUEST") {
    conversationalIntent = "CANCEL_REQUEST";
  } else if (existingOp.primaryAction === "CANCEL_APPOINTMENT_ONLY") {
    conversationalIntent = "CANCEL_APPOINTMENT_ONLY";
  } else if (greetingOrHelp) conversationalIntent = "GREETING_OR_HELP";

  const createServiceRequest =
    actionable.createServiceRequest &&
    !existingOp.blocksRequestCreation &&
    !doNotCreate &&
    !greetingOrHelp &&
    !hypothetical &&
    !blank &&
    !bookingWithdrawn &&
    existingOp.primaryAction !== "CHECK_STATUS";

  return {
    conversationalIntent: blank ? "EMPTY" : hypothetical ? "HYPOTHETICAL" : conversationalIntent,
    businessIntent: existingOp.primaryAction !== "NONE" ? existingOp.primaryAction : actionable.primaryIntent,
    actionability: greetingOrHelp || blank || hypothetical ? "NONE" : actionable.actionability,
    createServiceRequest,
    informationalOnly: actionable.informationalOnly || greetingOrHelp || hypothetical || blank,
    existingOp,
    actionable,
    serviceFromCurrentMessage,
    serviceFromBusinessDb,
    preserveConstraint: existingOp.preserveConstraint,
    doNotCreate,
    confidence: createServiceRequest || existingOp.primaryAction !== "NONE" ? "high" : "medium",
    ambiguities,
    factsProvenance: {
      service: serviceFromCurrentMessage
        ? "CURRENT_USER_EXPLICIT"
        : serviceFromBusinessDb
          ? "BUSINESS_DB"
          : "CURRENT_USER_INFERRED",
    },
  };
}

export function buildTurnActionPlan(resolved: ResolvedTurnIntent, state: ConversationState | null): TurnActionPlan {
  const requestedActions: PlannedAction[] = [];
  const { existingOp } = resolved;

  if (existingOp.primaryAction === "CHECK_STATUS") {
    requestedActions.push({
      action: "READ_REQUESTS",
      constraint: "DO",
      provenance: "CURRENT_USER_EXPLICIT",
      supportedBy: "status_query",
    });
  }
  if (existingOp.primaryAction === "CANCEL_REQUEST") {
    requestedActions.push({
      action: "CANCEL_REQUEST",
      constraint: "DO",
      targetId: existingOp.explicitRequestIds[0] || state?.activeLeadId || "",
      provenance: "CURRENT_USER_EXPLICIT",
      supportedBy: "cancel_request_speech_act",
    });
  }
  if (existingOp.primaryAction === "CANCEL_APPOINTMENT_ONLY") {
    requestedActions.push({
      action: "CANCEL_APPOINTMENT_ONLY",
      constraint: "DO",
      provenance: "CURRENT_USER_EXPLICIT",
      supportedBy: "cancel_appointment_only",
    });
  }
  if (existingOp.primaryAction === "RESCHEDULE_APPOINTMENT") {
    requestedActions.push({
      action: "RESCHEDULE_APPOINTMENT",
      constraint: "DO",
      provenance: "CURRENT_USER_EXPLICIT",
      supportedBy: "reschedule_speech_act",
    });
  }
  if (existingOp.preserveConstraint) {
    requestedActions.push({
      action: "NONE",
      constraint: "PRESERVE",
      provenance: "CURRENT_USER_EXPLICIT",
      supportedBy: "preserve_other_request",
    });
  }
  if (resolved.doNotCreate) {
    requestedActions.push({
      action: "CREATE_REQUEST",
      constraint: "DO_NOT",
      provenance: "CURRENT_USER_EXPLICIT",
      supportedBy: "do_not_create_another",
    });
  }
  if (resolved.createServiceRequest && existingOp.hasExplicitNewRequestOperator) {
    requestedActions.push({
      action: "CREATE_REQUEST",
      constraint: "DO",
      provenance: "CURRENT_USER_EXPLICIT",
      supportedBy: "explicit_new_job_operator",
    });
  } else if (resolved.createServiceRequest) {
    requestedActions.push({
      action: "CREATE_REQUEST",
      constraint: "DO",
      provenance: "CURRENT_USER_EXPLICIT",
      supportedBy: "actionable_service_intent",
    });
  }

  const conflicts: string[] = [];
  const has = (action: ConversationAction, constraint: PlanConstraint = "DO") =>
    requestedActions.some((row) => row.action === action && row.constraint === constraint);

  if (has("CANCEL_REQUEST") && has("CREATE_REQUEST") && !existingOp.hasExplicitNewRequestOperator) {
    conflicts.push("cancel_plus_unrequested_create");
  }
  if (has("CANCEL_APPOINTMENT_ONLY") && has("CANCEL_REQUEST")) {
    conflicts.push("appointment_only_plus_request_cancel");
  }
  if (has("READ_REQUESTS") && has("CREATE_REQUEST") && !resolved.createServiceRequest) {
    conflicts.push("read_plus_create_without_actionable_need");
  }
  if (has("CREATE_REQUEST") && has("CREATE_REQUEST", "DO_NOT")) {
    conflicts.push("create_versus_do_not_create");
  }
  if (
    existingOp.preserveConstraint &&
    has("CANCEL_REQUEST") &&
    existingOp.explicitRequestIds.length === 1 &&
    requestedActions.some((row) => row.constraint === "PRESERVE" && row.targetId === existingOp.explicitRequestIds[0])
  ) {
    conflicts.push("preserve_and_cancel_same_target");
  }

  const blocked = conflicts.length > 0;
  const mutationBudget = mutationBudgetForIntent({
    informationalOnly: resolved.informationalOnly,
    createServiceRequest: resolved.createServiceRequest && !blocked,
    existingPrimary: existingOp.primaryAction,
  });
  return {
    requestedActions,
    conflicts,
    blocked,
    blockedReason: conflicts.join(",") || "",
    mutationBudget,
  };
}

export function authorizeConversationAction(
  action: ConversationAction,
  ctx: {
    text: string;
    state: ConversationState | null;
    conversationId?: string;
    resolved?: ResolvedTurnIntent;
    plan?: TurnActionPlan;
    targetId?: string;
  },
): ConversationActionAuthorization {
  const resolved = ctx.resolved || resolveTurnIntent(ctx.text, ctx.state);
  const plan = ctx.plan || buildTurnActionPlan(resolved, ctx.state);
  const deny = (reason: string): ConversationActionAuthorization => ({
    allowed: false,
    action,
    reason,
    plan,
    resolved,
  });
  const allow = (reason: string): ConversationActionAuthorization => ({
    allowed: true,
    action,
    reason,
    plan,
    resolved,
  });

  if (plan.blocked && action !== "READ_REQUESTS" && action !== "NONE" && action !== "UPDATE_REQUEST") {
    if (!(action === "CANCEL_REQUEST" && resolved.existingOp.primaryAction === "CANCEL_REQUEST" && resolved.existingOp.hasExplicitNewRequestOperator)) {
      if (action === "CREATE_REQUEST" && plan.conflicts.includes("cancel_plus_unrequested_create")) {
        return deny("conflict_cancel_unrequested_create");
      }
    }
  }

  if (action === "READ_REQUESTS") {
    if (resolved.existingOp.primaryAction === "CHECK_STATUS") return allow("status_query");
    return deny("not_a_status_query");
  }

  if (action === "UPDATE_REQUEST") {
    const live = Boolean(ctx.state?.activeLeadId && !ctx.state.activeLeadId.startsWith("DRY-"));
    if (!live) return deny("no_active_request");
    if (resolved.existingOp.blocksRequestCreation && resolved.existingOp.primaryAction === "CHECK_STATUS") {
      return deny("read_does_not_update");
    }
    return allow("enrich_active_request");
  }

  if (action === "CREATE_REQUEST") {
    if (isBlankConversationalInput(ctx.text)) return deny("blank_input");
    if (isHypotheticalSpeech(ctx.text) || isQuotedThirdPartyCommand(ctx.text)) {
      return deny("hypothetical_or_quoted_not_create");
    }
    if (resolved.doNotCreate) return deny("customer_forbade_create");
    if (resolved.existingOp.preserveConstraint && !resolved.existingOp.hasExplicitNewRequestOperator) {
      return deny("preserve_constraint_blocks_create");
    }
    if (resolved.informationalOnly) return deny("informational_only");
    if (resolved.existingOp.blocksRequestCreation && !resolved.existingOp.hasExplicitNewRequestOperator) {
      return deny("existing_request_operation_blocks_create");
    }
    if (resolved.existingOp.primaryAction === "CHECK_STATUS") return deny("read_is_not_write");
    if (resolved.serviceFromBusinessDb && !resolved.createServiceRequest) {
      return deny("db_service_is_context_not_intent");
    }
    if (!resolved.createServiceRequest) return deny("not_actionable");
    if (resolved.actionability !== "ACTIONABLE" && resolved.actionability !== "EXPLICIT") {
      return deny("actionability_below_threshold");
    }
    return allow("actionable_create_authorized");
  }

  if (action === "CANCEL_REQUEST") {
    if (isHypotheticalSpeech(ctx.text) || isQuotedThirdPartyCommand(ctx.text)) {
      return deny("hypothetical_or_quoted_not_cancel");
    }
    if (resolved.existingOp.primaryAction === "CANCEL_APPOINTMENT_ONLY") {
      return deny("appointment_only_not_request_cancel");
    }
    if (
      resolved.existingOp.primaryAction === "CANCEL_REQUEST" ||
      resolved.conversationalIntent === "CANCEL_REQUEST"
    ) {
      return allow("cancel_request_authorized");
    }
    return deny("no_cancel_intent");
  }

  if (action === "CANCEL_APPOINTMENT_ONLY") {
    if (resolved.existingOp.primaryAction === "CANCEL_APPOINTMENT_ONLY") return allow("appointment_only");
    return deny("no_appointment_only_intent");
  }

  if (action === "SWITCH_SERVICE") {
    if (resolved.existingOp.blocksServiceSwitch) return deny("existing_op_blocks_switch");
    if (!resolved.createServiceRequest && resolved.existingOp.primaryAction !== "NONE") {
      return deny("switch_not_requested");
    }
    if (resolved.createServiceRequest && resolved.existingOp.hasExplicitNewRequestOperator) {
      return allow("explicit_new_job_after_cancel");
    }
    if (resolved.createServiceRequest) return allow("actionable_switch");
    return deny("no_switch_authorization");
  }

  if (action === "ADD_SERVICE") {
    if (resolved.existingOp.blocksRequestCreation && !resolved.existingOp.hasExplicitNewRequestOperator) {
      return deny("existing_op_blocks_add");
    }
    if (!resolved.createServiceRequest) return deny("add_not_actionable");
    return allow("actionable_add");
  }

  if (action === "CREATE_APPOINTMENT" || action === "RESCHEDULE_APPOINTMENT") {
    if (isLastMomentBookingWithdrawal(ctx.text)) return deny("booking_withdrawn");
    if (isHypotheticalSpeech(ctx.text) || isQuotedThirdPartyCommand(ctx.text)) {
      return deny("hypothetical_or_quoted_not_booking");
    }
    if (resolved.existingOp.primaryAction === "CHECK_STATUS") return deny("read_is_not_book");
    if (resolved.informationalOnly && !ctx.state?.bookingIntent) return deny("informational_not_booking");
    return allow("scheduling_authorized_if_calendar_confirms");
  }

  if (action === "NOTIFY") {
    return deny("notify_only_after_persisted_event");
  }

  return deny("unknown_or_none");
}

export function logTurnLedger(input: {
  conversationId: string;
  resolved: ResolvedTurnIntent;
  plan: TurnActionPlan;
  authorization?: ConversationActionAuthorization;
}) {
  logInfo("TURN_LEDGER", {
    contentJobId: input.conversationId.slice(0, 8),
    stage: `${SEMANTIC_ENGINE_VERSION}:${input.resolved.businessIntent}`.slice(0, 40),
    phone: [
      input.resolved.actionability,
      input.resolved.createServiceRequest ? "create" : "hold",
      input.plan.blocked ? `blocked:${input.plan.blockedReason}` : "plan_ok",
      input.authorization ? (input.authorization.allowed ? `auth_${input.authorization.action}` : `deny_${input.authorization.reason}`) : "",
    ]
      .filter(Boolean)
      .join("|")
      .slice(0, 180),
  });
}
