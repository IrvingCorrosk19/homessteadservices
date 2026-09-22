/**
 * Actionable vs exploratory service intent.
 * Speech-act classification — not a phrase table for known test sentences.
 *
 * Pipeline contract: understand this turn before creating HS.
 */
import type { ConversationState } from "@/lib/concierge-store";
import { detectServices } from "@/lib/concierge/playbook-engine";
import { classifyExistingRequestOperation, speechTextForNewWork } from "@/lib/concierge/existing-request-operation";
import {
  isBlankConversationalInput,
  isHypotheticalSpeech,
  isQuotedThirdPartyCommand,
} from "@/lib/concierge/speech-act-safety";

export type ActionablePrimaryIntent =
  | "SERVICE_CATALOG_QUESTION"
  | "CAPABILITY_QUESTION"
  | "COVERAGE_QUESTION"
  | "PRICE_EXPLORATION"
  | "PROBLEM_MENTION"
  | "DIAGNOSTIC_QUESTION"
  | "ACTIONABLE_SERVICE_REQUEST"
  | "MIXED_QUESTION_AND_REQUEST"
  | "CONTINUE";

export type Actionability = "NONE" | "POSSIBLE" | "ACTIONABLE" | "EXPLICIT";

export type ActionableIntentDecision = {
  primaryIntent: ActionablePrimaryIntent;
  actionableServiceIntent: boolean;
  informationalOnly: boolean;
  createServiceRequest: boolean;
  actionability: Actionability;
  customerWantsHomesteadAction: boolean | "uncertain";
  reasons: string[];
};

function fold(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Typo-tolerant generic "servicio(s)" — compact letters only, never used for short trade aliases. */
function compactLetters(blob: string) {
  return blob.replace(/[^a-z0-9]+/g, "");
}

function hasGenericServiceNoun(blob: string) {
  const compact = compactLetters(blob);
  return compact.includes("servicio") || /\bservicios?\b/.test(blob);
}

/** Provider talking about itself: 2nd/3rd person present, not customer infinitives. */
const PROVIDER_CAPABILITY =
  /\b(ofrecen|ofreces|ofrecemos|ofrecer|hacen|haces|hacemos|trabajan|trabajas|trabajamos|atienden|atiendes|atendemos|instalan|instalas|instalamos|reparan|reparas|reparamos|arreglan|arreglas|arreglamos|cubren|cubres|cubrimos|dedican|dedicas)\b/;

const INQUIRY_VERB = /\b(saber|averigu\w*|consult\w*|pregunt\w*|explic\w*|inform\w*|interesa|interesaria)\b/;

const QUESTION_WORD =
  /\b(que|cual|cuales|como|donde|cuando|cuanto|cuanta|cuantos|cuantas|quien|quienes|si)\b/;

const NEED_OPERATOR =
  /\b(necesito|necesitamos|requiero|urge|urgen|hay que|ocupo)\b/;

const WORK_SUBJUNCTIVE =
  /\b(vengan|venga|revisen(?:me)?|revise|pinten|pinte|instalen|instale|reparen|repare|arreglen|arregle|manden(?:me)?|mande|cambien|cambie)\b/;

const CUSTOMER_WORK_INFINITIVE =
  /\b(quiero|necesito|ocupo|hay que|para)\s+(pintar|instalar|reparar|arreglar|cambiar|revisar|mantener|agendar)\b/;

const WANT_TRADE_PRO =
  /\b(quiero|necesito|ocupo|busco|me hace falta)(?:\s+\w+){0,2}\s+(un|una|el|la)?\s*(plomero|electricista|pintor|cerrajero|tecnico)\b/;

const PROBLEM_PREDICATE =
  /\b(no enfri[ae]|no da fri[oa]|gotea|goteando|fuga|se dan[oó]|se dano|se me dan|seme\s+dan|descompus|no abre|no cierra|bota agua|hay agua|se me esta|se me fue|chispas?|no hay luz|se tapa|se tapo|filtraci|humedad|moho|qued[eé] afuera|perdi la llave|perd[ií] la llave)\b/;

const VISIT_REQUEST =
  /\b(vengan|agendar|agendemos|mantenimiento para|que (lo |la |me )?revisen|mand(e|en|a)(me)?\s+(un |una )?(tecnico|plomero|pintor)|venir a (revisar|ver|chequear)|podr\w*\s+(venir|pasar|revisar)|pueden\s+(venir|pasar|revisar)|me pueden\s+(venir|revisar)|(quiero|necesito)\s+(una\s+)?visita)\b/;

const COVERAGE_OBJECT =
  /\b(oficinas?|casas?|apartamentos?|comercios?|\bph\b|edificios?|locales?)\b/;

const PRICE_NOUN =
  /\b(precio|precios|costo|costos|costar|tarifa|cotiz|presupuesto|cuanto(\s+\w+){0,3}\s+(cuesta|cobran|sale|costar|vale))\b/;

const ACK_ONLY = /^(ok|okay|vale|si|sí|dale|bueno|listo|gracias|perfecto|entendido|hola|buenas)[\s!.?]*$/i;

export function isNonDemandTurn(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return ACK_ONLY.test(trimmed);
}

export function classifyActionableServiceIntent(
  text: string,
  state: ConversationState | null = null,
): ActionableIntentDecision {
  const raw = text || "";
  if (isBlankConversationalInput(raw)) {
    return {
      primaryIntent: "CONTINUE",
      actionableServiceIntent: false,
      informationalOnly: false,
      createServiceRequest: false,
      actionability: "NONE",
      customerWantsHomesteadAction: false,
      reasons: ["blank_input"],
    };
  }
  if (isHypotheticalSpeech(raw) || isQuotedThirdPartyCommand(raw)) {
    return {
      primaryIntent: "CONTINUE",
      actionableServiceIntent: false,
      informationalOnly: true,
      createServiceRequest: false,
      actionability: "NONE",
      customerWantsHomesteadAction: false,
      reasons: ["non_mutating_speech_act"],
    };
  }
  const existingOp = classifyExistingRequestOperation(raw);
  if (existingOp.blocksRequestCreation) {
    return {
      primaryIntent: "CONTINUE",
      actionableServiceIntent: false,
      informationalOnly: false,
      createServiceRequest: false,
      actionability: "NONE",
      customerWantsHomesteadAction: false,
      reasons: ["existing_request_operation"],
    };
  }
  const workText = existingOp.hasExplicitNewRequestOperator ? speechTextForNewWork(raw) : raw;
  if (existingOp.hasExplicitNewRequestOperator && !workText) {
    return {
      primaryIntent: "CONTINUE",
      actionableServiceIntent: false,
      informationalOnly: false,
      createServiceRequest: false,
      actionability: "NONE",
      customerWantsHomesteadAction: false,
      reasons: ["existing_request_operation_without_new_job_clause"],
    };
  }
  const blob = fold(workText);
  const reasons: string[] = [];
  const compact = compactLetters(blob);
  const trades = detectServices(workText);
  const genericService = hasGenericServiceNoun(blob);
  const interrogative = /[¿?]/.test(workText) || QUESTION_WORD.test(blob);
  const capabilityAsk = PROVIDER_CAPABILITY.test(blob);
  const inquiry = INQUIRY_VERB.test(blob);
  const coverageAsk = capabilityAsk && COVERAGE_OBJECT.test(blob) && /\b(atiend|trabaj|cubr)\w*/.test(blob);
  const priceBrowse =
    PRICE_NOUN.test(blob) &&
    (inquiry || interrogative || /\baverigu/.test(blob) || /\bno agendar|solo cotiz|solo precio|estoy (viendo|consultando)/.test(blob));

  const workAsk = WORK_SUBJUNCTIVE.test(blob);
  const problem = PROBLEM_PREDICATE.test(blob);
  const visit = VISIT_REQUEST.test(blob) && !/\bantes de (agendar|la cita|confirmar|cotiz)/.test(blob);
  const wantTradePro = WANT_TRADE_PRO.test(blob);
  const customerInfinitive = CUSTOMER_WORK_INFINITIVE.test(blob);
  const rawNeed = NEED_OPERATOR.test(blob);
  const genericNeedOnly =
    rawNeed && genericService && trades.length === 0 && !problem && !workAsk && !customerInfinitive && !wantTradePro;
  const underspecifiedNeed =
    rawNeed &&
    trades.length === 0 &&
    !problem &&
    !workAsk &&
    !visit &&
    !wantTradePro &&
    !customerInfinitive;
  const need = (rawNeed && !genericNeedOnly && !underspecifiedNeed) || wantTradePro || customerInfinitive;
  const wantGenericCatalog =
    (/\b(quiero|ocupo|busco)\b/.test(blob) || genericNeedOnly) &&
    genericService &&
    !problem &&
    !workAsk &&
    trades.length === 0;

  const catalogNounAsk =
    /\b(catalogo|lista de servicios|rubros)\b/.test(blob) && !problem && !workAsk && !visit;
  const catalogFrame =
    catalogNounAsk ||
    (genericService && (interrogative || capabilityAsk || inquiry || wantGenericCatalog)) ||
    (capabilityAsk && interrogative && !problem && !workAsk) ||
    (/\bque\b/.test(blob) && (capabilityAsk || genericService));

  const authorizedNewJob =
    existingOp.hasExplicitNewRequestOperator && trades.length > 0 && !capabilityAsk && !catalogFrame && !priceBrowse && !coverageAsk;
  const hasConcreteNeed = Boolean(need || workAsk || visit || wantTradePro || customerInfinitive || authorizedNewJob);
  const wantsHomesteadAction = hasConcreteNeed;
  const problemMention = Boolean(problem || (trades.length > 0 && !capabilityAsk && !catalogFrame && !priceBrowse && !coverageAsk));
  const diagnosticAsk = (interrogative || inquiry) && problemMention && !wantsHomesteadAction;

  /** A trade word in a statement is a problem/category mention, not a service order. */
  const declarativeTradeRequest = trades.length > 0 && wantsHomesteadAction && !capabilityAsk && !catalogFrame && !priceBrowse && !coverageAsk;

  const exploratory =
    (catalogFrame || capabilityAsk || coverageAsk || priceBrowse || (interrogative && inquiry) || wantGenericCatalog) &&
    !wantsHomesteadAction;

  if (wantGenericCatalog) reasons.push("generic_service_noun");
  if (catalogFrame) reasons.push("catalog_or_capability_frame");
  if (capabilityAsk) reasons.push("provider_capability_verb");
  if (coverageAsk) reasons.push("coverage_question");
  if (priceBrowse) reasons.push("price_exploration");
  if (authorizedNewJob) reasons.push("explicit_new_job_operator");
  if (wantsHomesteadAction) reasons.push("customer_wants_homestead_action");
  if (problem && !wantsHomesteadAction) reasons.push("problem_mention");
  if (trades.length > 0 && !wantsHomesteadAction) reasons.push("trade_as_context");
  if (diagnosticAsk) reasons.push("diagnostic_question");
  if (declarativeTradeRequest) reasons.push("declarative_trade_request");
  if (compact.includes("servicio") && genericService) reasons.push("servicio_noun");

  let actionability: Actionability = "NONE";
  if (wantsHomesteadAction && (wantTradePro || customerInfinitive || authorizedNewJob || /\b(solicitar|agendar)\b/.test(blob))) {
    actionability = "EXPLICIT";
  } else if (wantsHomesteadAction) {
    actionability = "ACTIONABLE";
  } else if (problemMention || diagnosticAsk) {
    actionability = "POSSIBLE";
  }

  let primaryIntent: ActionablePrimaryIntent = "CONTINUE";
  if (wantsHomesteadAction && (catalogFrame || capabilityAsk || interrogative)) {
    primaryIntent = "MIXED_QUESTION_AND_REQUEST";
  } else if (wantsHomesteadAction) {
    primaryIntent = "ACTIONABLE_SERVICE_REQUEST";
  } else if (diagnosticAsk) {
    primaryIntent = "DIAGNOSTIC_QUESTION";
  } else if (problemMention) {
    primaryIntent = "PROBLEM_MENTION";
  } else if (coverageAsk) {
    primaryIntent = "COVERAGE_QUESTION";
  } else if (priceBrowse) {
    primaryIntent = "PRICE_EXPLORATION";
  } else if (catalogFrame || wantGenericCatalog || (genericService && (interrogative || capabilityAsk))) {
    primaryIntent = "SERVICE_CATALOG_QUESTION";
  } else if (capabilityAsk || (interrogative && trades.length > 0 && !wantsHomesteadAction)) {
    primaryIntent = "CAPABILITY_QUESTION";
  } else if (exploratory) {
    primaryIntent = "SERVICE_CATALOG_QUESTION";
  }

  const informationalOnly = !wantsHomesteadAction && primaryIntent !== "CONTINUE" && primaryIntent !== "PROBLEM_MENTION" && primaryIntent !== "DIAGNOSTIC_QUESTION" && primaryIntent !== "ACTIONABLE_SERVICE_REQUEST";
  const createServiceRequest = actionability === "ACTIONABLE" || actionability === "EXPLICIT";

  if (state?.activeLeadId && isNonDemandTurn(raw) && !informationalOnly) {
    return {
      primaryIntent: "CONTINUE",
      actionableServiceIntent: true,
      informationalOnly: false,
      createServiceRequest: false,
      actionability: "ACTIONABLE",
      customerWantsHomesteadAction: true,
      reasons: [...reasons, "ack_with_active_request"],
    };
  }

  return {
    primaryIntent,
    actionableServiceIntent: createServiceRequest,
    informationalOnly,
    createServiceRequest,
    actionability,
    customerWantsHomesteadAction: wantsHomesteadAction ? true : actionability === "POSSIBLE" ? "uncertain" : false,
    reasons,
  };
}
