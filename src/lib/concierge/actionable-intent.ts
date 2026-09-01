/**
 * Actionable vs exploratory service intent.
 * Speech-act classification — not a phrase table for known test sentences.
 *
 * Pipeline contract: understand this turn before creating HS.
 */
import type { ConversationState } from "@/lib/concierge-store";
import { detectServices } from "@/lib/concierge/playbook-engine";

export type ActionablePrimaryIntent =
  | "SERVICE_CATALOG_QUESTION"
  | "CAPABILITY_QUESTION"
  | "COVERAGE_QUESTION"
  | "PRICE_EXPLORATION"
  | "ACTIONABLE_SERVICE_REQUEST"
  | "MIXED_QUESTION_AND_REQUEST"
  | "CONTINUE";

export type ActionableIntentDecision = {
  primaryIntent: ActionablePrimaryIntent;
  actionableServiceIntent: boolean;
  informationalOnly: boolean;
  createServiceRequest: boolean;
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
  /\b(necesito|necesitamos|requiero|urge|urgen|hay que|se me (esta|fue)|ocupo)\b/;

const WORK_SUBJUNCTIVE =
  /\b(vengan|venga|revisen|revise|pinten|pinte|instalen|instale|reparen|repare|arreglen|arregle|manden|mande|cambien|cambie)\b/;

const CUSTOMER_WORK_INFINITIVE =
  /\b(quiero|necesito|ocupo|hay que|para)\s+(pintar|instalar|reparar|arreglar|cambiar|revisar|mantener|agendar)\b/;

const WANT_TRADE_PRO =
  /\b(quiero|necesito|ocupo|busco|me hace falta)\s+(un|una|el|la)?\s*(plomero|electricista|pintor|cerrajero|tecnico)\b/;

const PROBLEM_PREDICATE =
  /\b(no enfri[ae]|no da fri[oa]|gotea|goteando|fuga|se dan[oó]|se dano|descompus|no abre|no cierra|bota agua|chispas?|no hay luz|se tapa|se tapo|filtraci|humedad|moho|qued[eé] afuera|perdi la llave|perd[ií] la llave)\b/;

const VISIT_REQUEST =
  /\b(vengan|agendar|agendemos|mantenimiento para|que (lo |la |me )?revisen|mand(e|en) (un |una )?(tecnico|plomero|pintor)|venir a (revisar|ver|chequear)|podr\w*\s+(venir|pasar|revisar)|pueden\s+(venir|pasar|revisar)|me pueden\s+(venir|revisar)|(quiero|necesito)\s+(una\s+)?visita)\b/;

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
  const blob = fold(raw);
  const reasons: string[] = [];
  const compact = compactLetters(blob);
  const trades = detectServices(raw);
  const genericService = hasGenericServiceNoun(blob);
  const interrogative = /[¿?]/.test(raw) || QUESTION_WORD.test(blob);
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
  const need = (rawNeed && !genericNeedOnly) || wantTradePro || customerInfinitive;
  const wantGenericCatalog =
    (/\b(quiero|ocupo|busco)\b/.test(blob) || genericNeedOnly) &&
    genericService &&
    !problem &&
    !workAsk &&
    trades.length === 0;

  const catalogFrame =
    (genericService && (interrogative || capabilityAsk || inquiry || wantGenericCatalog)) ||
    (capabilityAsk && interrogative && !problem && !workAsk) ||
    (/\bque\b/.test(blob) && (capabilityAsk || genericService));

  const hasConcreteNeed = Boolean(need || workAsk || problem || visit || (CUSTOMER_WORK_INFINITIVE.test(blob) && trades.length > 0));

  /** Declarative trade as a job, not "do you do X?" */
  const declarativeTradeRequest =
    trades.length > 0 &&
    !capabilityAsk &&
    !catalogFrame &&
    !priceBrowse &&
    !coverageAsk &&
    (need || problem || visit || workAsk || (!interrogative && !inquiry));

  const actionable = hasConcreteNeed || declarativeTradeRequest;
  const exploratory =
    (catalogFrame || capabilityAsk || coverageAsk || priceBrowse || (interrogative && inquiry) || wantGenericCatalog) &&
    !hasConcreteNeed;

  if (wantGenericCatalog) reasons.push("generic_service_noun");
  if (catalogFrame) reasons.push("catalog_or_capability_frame");
  if (capabilityAsk) reasons.push("provider_capability_verb");
  if (coverageAsk) reasons.push("coverage_question");
  if (priceBrowse) reasons.push("price_exploration");
  if (hasConcreteNeed) reasons.push("need_or_problem_or_visit");
  if (declarativeTradeRequest) reasons.push("declarative_trade_request");
  if (compact.includes("servicio") && genericService) reasons.push("servicio_noun");

  let primaryIntent: ActionablePrimaryIntent = "CONTINUE";
  if (actionable && (catalogFrame || capabilityAsk || interrogative)) {
    primaryIntent = "MIXED_QUESTION_AND_REQUEST";
  } else if (actionable) {
    primaryIntent = "ACTIONABLE_SERVICE_REQUEST";
  } else if (coverageAsk) {
    primaryIntent = "COVERAGE_QUESTION";
  } else if (priceBrowse) {
    primaryIntent = "PRICE_EXPLORATION";
  } else if (catalogFrame || wantGenericCatalog || (genericService && (interrogative || capabilityAsk))) {
    primaryIntent = "SERVICE_CATALOG_QUESTION";
  } else if (capabilityAsk || (interrogative && trades.length > 0 && !hasConcreteNeed)) {
    primaryIntent = "CAPABILITY_QUESTION";
  } else if (exploratory) {
    primaryIntent = "SERVICE_CATALOG_QUESTION";
  }

  const informationalOnly = !actionable && primaryIntent !== "CONTINUE" && primaryIntent !== "ACTIONABLE_SERVICE_REQUEST";
  const createServiceRequest = actionable;

  if (state?.activeLeadId && isNonDemandTurn(raw) && !informationalOnly) {
    return {
      primaryIntent: "CONTINUE",
      actionableServiceIntent: true,
      informationalOnly: false,
      createServiceRequest: false,
      reasons: [...reasons, "ack_with_active_request"],
    };
  }

  return {
    primaryIntent,
    actionableServiceIntent: createServiceRequest,
    informationalOnly,
    createServiceRequest,
    reasons,
  };
}
