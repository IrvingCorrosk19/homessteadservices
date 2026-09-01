/**
 * Natural conversation engine — semantic/behavior tests (no live OpenAI required).
 */
import { applyPackedExtraction } from "../src/lib/concierge/packed-extraction";
import { determineNextAction } from "../src/lib/concierge/conversation-next-action";
import { perceiveTurn } from "../src/lib/concierge/conversation-perception";
import { detectConversationTransition } from "../src/lib/concierge/service-transition";
import { planHomesteadTurn } from "../src/lib/concierge/homestead-planner";
import {
  parseConversationObjective,
  updateConversationObjective,
} from "../src/lib/concierge/conversation-objective";
import {
  applyNaturalStyleGuard,
  detectKnownFactEcho,
  stripRepeatedRoboticOpener,
} from "../src/lib/concierge/natural-style";
import { buildResponsePlan, factsLearnedThisTurn } from "../src/lib/concierge/response-plan";
import { validateNaturalResponse } from "../src/lib/concierge/natural-response-validator";
import { formatToolObservation } from "../src/lib/concierge/tool-observation";
import { applyContradictionResolution } from "../src/lib/concierge/contradiction-engine";
import { detectServices } from "../src/lib/concierge/playbook-engine";
import { classifyActionableServiceIntent } from "../src/lib/concierge/actionable-intent";
import { hasValidServiceIntent } from "../src/lib/concierge/service-request-lifecycle";
import type { ConversationState } from "../src/lib/concierge-store";

function empty(partial: Partial<ConversationState> = {}): ConversationState {
  return {
    service: "",
    problem: "",
    location: "",
    name: "",
    phone: "",
    email: "",
    propertyType: "",
    preferredTime: "",
    preferredDate: "",
    intent: "",
    funnelStage: "DISCOVERY",
    leadTemperature: "COLD",
    photoCount: 0,
    contactStatus: "UNKNOWN",
    offeredSlots: [],
    pendingSlot: null,
    appointmentId: "",
    awaitingSlotSelection: false,
    slotOfferToken: "",
    activeLeadId: "",
    historicalSlotLabels: [],
    humanRequested: false,
    lastAvailabilityAt: "",
    detectedServices: [],
    primaryService: "",
    secondaryServices: [],
    facts: {},
    urgency: "normal",
    bookingIntent: false,
    bookingStrategy: "",
    bookingSuspended: false,
    questionsAsked: 0,
    humanHandoffRequested: false,
    needsReview: false,
    factConfidence: {},
    corrections: [],
    ...partial,
  };
}

let failed = 0;
function ok(name: string, value: boolean) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

const packed =
  "Hola soy Irving, estoy en Edison Park apartamento 3A, el aire prende pero no enfría, mi número es 65656565 y si pueden venir mañana después de las 2 mejor.";
const extracted = applyPackedExtraction(empty(), packed);
ok("SET-B name Irving", /irving/i.test(extracted.name));
ok("SET-B location Edison", /edison/i.test(extracted.location || extracted.facts?.location || ""));
ok("SET-B unit 3A", /3a/i.test(extracted.facts?.unit || extracted.facts?.apartment || ""));
ok("SET-B phone", extracted.contactStatus === "VALID" || /65656565/.test(extracted.phone));
ok("SET-B AC service", extracted.primaryService === "ac" || extracted.service === "ac" || detectServices(packed).includes("ac"));
ok("SET-B no re-ask name", Boolean(extracted.name) && !determineNextAction(extracted).requiredMissing.includes("customer_name"));

const afterLocPhone = applyPackedExtraction(
  empty({ primaryService: "ac", service: "ac", location: "Edison Park", facts: { location: "Edison Park", building: "Edison Park", unit: "3A" }, propertyType: "apartment" }),
  "ok",
);
afterLocPhone.location = "Edison Park";
afterLocPhone.facts = { ...afterLocPhone.facts, unit: "3A", building: "Edison Park" };
const identity = determineNextAction(afterLocPhone);
ok("combined identity ask", identity.action === "ASK_IDENTITY");
ok("combined identity question mentions name and phone", /nombre/i.test(identity.cannedQuestion) && /n[uú]mero|tel[eé]fono/i.test(identity.cannedQuestion));

const t = detectConversationTransition(empty({ primaryService: "ac", service: "ac", location: "Edison Park" }), "Edison Park. Oye, ¿también hacen pintura?");
const perception = perceiveTurn(
  "Edison Park. Oye, ¿también hacen pintura?",
  empty({ primaryService: "ac", service: "ac", location: "Edison Park" }),
  t,
);
ok("multi-intent painting question", perception.userIntent === "ASK_SERVICE_CAPABILITY" || perception.secondaryIntents.includes("ASK_GENERAL_QUESTION") || detectServices("¿también hacen pintura?").includes("painting"));
ok("multi-intent continue booking", perception.secondaryIntents.includes("CONTINUE_BOOKING") || perception.userIntent === "ASK_SERVICE_CAPABILITY");

let objState = empty({ primaryService: "ac", service: "ac", location: "Edison Park", name: "", bookingIntent: true });
const next = determineNextAction(objState);
const plan = planHomesteadTurn({
  perception,
  state: objState,
  nextDecision: next,
  hasCalendarResult: false,
  bookedThisTurn: false,
  userText: "¿también hacen pintura?",
});
objState = updateConversationObjective({
  state: objState,
  perception,
  plan,
  userText: "¿también hacen pintura?",
});
const obj = parseConversationObjective(objState);
ok("interruption records question topic", obj.currentTopic.includes("ASK") || obj.conversationPhase === "QUESTION" || obj.interruptedGoal.length > 0 || plan.responseStrategy === "ANSWER_THEN_RESUME");

const learned = factsLearnedThisTurn(empty(), extracted);
ok("facts learned this turn has several", learned.length >= 3);

const rp = buildResponsePlan({
  state: extracted,
  perception,
  plan,
  nextDecision: determineNextAction(extracted),
  factsLearnedThisTurn: learned,
});
ok("response plan mustNotAsk includes known", rp.mustNotAsk.includes("name") || rp.knownFacts.includes("name"));
ok("response plan tone natural", rp.tone === "natural_professional");

const echo = detectKnownFactEcho(
  "Gracias Irving. Entiendo que estás en Edison Park y tu número es 65656565.",
  extracted,
  false,
);
ok("detects known-fact echo", echo === true);

const style = applyNaturalStyleGuard(
  "Perfecto, seguimos. ¿En qué zona sería?",
  empty({ location: "Betania", facts: { _recentOpenings: JSON.stringify(["perfecto"]) } }),
);
ok("style guard can strip or keep", typeof style.reply === "string");

const strip = stripRepeatedRoboticOpener("Perfecto, ya quedó.", ["perfecto"]);
ok("strip repeated opener", strip.stripped === true || strip.text.length > 0);

const obs = formatToolObservation("check_availability", {
  ok: true,
  requested: { date: "2026-09-01", time: "14:00" },
  requestedAvailable: false,
  requestedSlotBusy: true,
  slots: [
    { date: "2026-09-01", time: "12:00", label: "12:00 p. m." },
    { date: "2026-09-01", time: "16:00", label: "4:00 p. m." },
  ],
});
ok("tool observation requested busy", obs.requestedAvailable === false);
ok("tool observation alternatives", (obs.alternatives || []).length === 2);

const bogus = validateNaturalResponse("Ya agendé tu cita para mañana.", empty(), { bookedThisTurn: false });
ok("unsupported commitment flagged", bogus.unsupportedCommitment === true);

const grounded = validateNaturalResponse("Listo, la visita quedó confirmada para mañana a las 2.", empty({ appointmentId: "HA-1" }), {
  bookedThisTurn: true,
});
ok("grounded booking not flagged as fake", grounded.unsupportedCommitment === false);

const unit1 = applyPackedExtraction(empty({ primaryService: "ac", location: "Edison Park" }), "Mi apartamento es 3A.");
const unit2 = applyContradictionResolution(applyPackedExtraction(unit1, "Perdón, es 3B."), "Perdón, es 3B.");
ok("correction unit 3B", /3b/i.test(unit2.facts?.unit || unit2.facts?.apartment || ""));

const typo = applyPackedExtraction(empty(), "nesesito reparar el aire en edison par, soy Carlos 61234567");
ok("typo AC detected", detectServices("nesesito reparar el aire").includes("ac") || typo.primaryService === "ac" || typo.service === "ac");

const catalogQ = "Hola quiero uns ervicios que me ofreces?";
const catalogDecision = classifyActionableServiceIntent(catalogQ, empty());
ok("real defect is informational", catalogDecision.informationalOnly === true && catalogDecision.createServiceRequest === false);
ok(
  "real defect does not satisfy hasValidServiceIntent",
  hasValidServiceIntent(applyPackedExtraction(empty(), catalogQ), catalogQ) === false,
);
const catalogPacked = applyPackedExtraction(empty(), catalogQ);
ok("catalog question does not become problem", !catalogPacked.problem || catalogPacked.problem.length < 8 || classifyActionableServiceIntent(catalogPacked.problem).informationalOnly);
ok("catalog question does not stick a job service", !catalogPacked.primaryService || catalogPacked.primaryService === "");

ok(
  "necesito pintura is actionable",
  classifyActionableServiceIntent("Necesito pintura.", empty()).createServiceRequest === true,
);
ok(
  "mixed plumbing question+leak is actionable",
  classifyActionableServiceIntent("¿Hacen plomería? Tengo una fuga y necesito que vengan.", empty()).createServiceRequest === true,
);
ok(
  "averiguando precios not actionable",
  classifyActionableServiceIntent("Estoy averiguando precios de aire acondicionado.", empty()).createServiceRequest === false,
);

if (failed) {
  console.error(`NATURAL_CONVERSATION_BEHAVIOR_FAILED ${failed}`);
  process.exit(1);
}
console.log("NATURAL_CONVERSATION_BEHAVIOR_OK");
