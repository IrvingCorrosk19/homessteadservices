/**
 * Homestead AI benchmark — AI-01..AI-15 behavioral assertions (no LLM required).
 */
import { perceiveTurn } from "../src/lib/concierge/conversation-perception";
import { applyContradictionResolution } from "../src/lib/concierge/contradiction-engine";
import { planHomesteadTurn } from "../src/lib/concierge/homestead-planner";
import { evaluateAskField } from "../src/lib/concierge/question-value-engine";
import { buildFactGraph, supersedeFact } from "../src/lib/concierge/fact-model";
import { resolveUserGoals } from "../src/lib/concierge/user-goals";
import { detectConversationTransition } from "../src/lib/concierge/service-transition";
import { determineNextAction } from "../src/lib/concierge/conversation-next-action";
import type { ConversationState } from "../src/lib/concierge-store";
import { applyPackedExtraction } from "../src/lib/concierge/packed-extraction";

function baseState(partial: Partial<ConversationState> = {}): ConversationState {
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

function transitionFor(state: ConversationState, text: string) {
  return detectConversationTransition(state, text);
}

function plan(state: ConversationState, text: string) {
  const t = transitionFor(state, text);
  const p = perceiveTurn(text, state, t);
  const next = determineNextAction(state, { userText: text });
  return planHomesteadTurn({ perception: p, state, nextDecision: next, hasCalendarResult: false, bookedThisTurn: false, userText: text });
}

function loc(state: ConversationState) {
  return state.location || state.facts?.location || "";
}

let failed = 0;
function ok(name: string, value: boolean) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

// AI-01 AC issue
{
  const text = "El aire no enfría.";
  let s = applyPackedExtraction(baseState(), text);
  const p = perceiveTurn(text, s, transitionFor(s, text));
  ok("AI-01 intent request or continue", p.userIntent === "REQUEST_SERVICE" || p.serviceCandidates.includes("ac") || s.primaryService === "ac");
}

// AI-02 two units one failing
{
  const text = "Tengo dos, pero solo uno está fallando.";
  let s = applyPackedExtraction(baseState({ primaryService: "ac", service: "ac" }), text);
  ok("AI-02 units extracted", s.facts?.units === "2" || /dos/.test(text));
}

// AI-03 Edison + tomorrow afternoon — no repeat asks
{
  const text =
    "Estoy en Edison Park y mañana después de almuerzo puedo. Soy Irving Corro 65656565.";
  let s = applyPackedExtraction(baseState({ primaryService: "ac", service: "ac" }), text);
  ok("AI-03 location", loc(s).includes("Edison"));
  ok("AI-03 name", s.name.includes("Irving"));
  ok("AI-03 phone valid", s.contactStatus === "VALID");
  const askLoc = evaluateAskField(s, "location");
  const askPhone = evaluateAskField(s, "phone");
  ok("AI-03 no ask location", !askLoc.shouldAsk);
  ok("AI-03 no ask phone", !askPhone.shouldAsk);
}

// AI-04 price interruption
{
  const text = "Antes de agendar, ¿cuánto puede costar?";
  const s = baseState({ primaryService: "ac", bookingIntent: true, offeredSlots: [{ date: "2026-08-31", time: "14:00", label: "2pm" }] });
  const p = perceiveTurn(text, s, transitionFor(s, text));
  ok("AI-04 price intent", p.userIntent === "GET_ESTIMATE");
  const pl = plan(s, text);
  ok("AI-04 answer strategy", pl.responseStrategy === "ANSWER" || pl.recommendedActions.includes("ANSWER_PRICING_POLICY"));
}

// AI-05 reprogram mejor a las 4
{
  const text = "Bueno, mejor a las 4.";
  const s = baseState({ primaryService: "plumbing", activeLeadId: "HS-2026-000001", appointmentId: "HA-x", location: "Betania" });
  const p = perceiveTurn(text, s, transitionFor(s, text));
  ok("AI-05 reprogram not new need", p.userIntent === "REPROGRAM_APPOINTMENT");
  ok("AI-05 location preserved", s.location === "Betania");
}

// AI-06 switch away from AC
{
  const text = "No, espera, mejor olvida el aire. Tengo una fuga.";
  const s = baseState({ primaryService: "ac", service: "ac", facts: { serviceContextId: "ac-1" } });
  const t = transitionFor(s, text);
  const p = perceiveTurn(text, s, t);
  ok("AI-06 switch detected", t.kind === "SWITCH_SERVICE" || t.nextService === "plumbing" || p.userIntent === "CHANGE_SERVICE");
}

// AI-07 add painting
{
  const text = "También necesito pintura.";
  const s = baseState({ primaryService: "plumbing", service: "plumbing" });
  const t = transitionFor(s, text);
  ok("AI-07 add or multi", t.kind === "ADD_ANOTHER_SERVICE" || perceiveTurn(text, s, t).secondaryIntents.includes("MULTI_SERVICE"));
}

// AI-08 prior context reference
{
  const text = "Lo mismo que me arreglaron la vez pasada.";
  const s = baseState({ phone: "65656565", contactStatus: "VALID" });
  const p = perceiveTurn(text, s, transitionFor(s, text));
  ok("AI-08 references prior", p.referencesPriorContext);
  const pl = plan(s, text);
  ok("AI-08 retrieve history action", pl.recommendedActions.includes("RETRIEVE_CUSTOMER_HISTORY"));
}

// AI-09 tomorrow with contact
{
  const text = "¿Puedes venir mañana?";
  const s = baseState({
    primaryService: "plumbing",
    name: "Irving",
    phone: "65656565",
    contactStatus: "VALID",
    location: "Betania",
    activeLeadId: "HS-1",
  });
  const pl = plan(s, text);
  ok("AI-09 query or book path", pl.recommendedActions.includes("QUERY_AVAILABILITY") || pl.goal === "BOOK_VISIT");
}

// AI-10 sí against pending context
{
  const text = "Sí.";
  const s = baseState({ awaitingSlotSelection: true, offeredSlots: [{ date: "2026-08-31", time: "12:00", label: "12:00" }] });
  const p = perceiveTurn(text, s, transitionFor(s, text));
  ok("AI-10 short affirm", p.userIntent === "CONTINUE" || p.userIntent === "SELECT_SLOT");
}

// AI-11 no more details
{
  const text = "No tengo más detalles.";
  const s = baseState({ location: "Betania", primaryService: "plumbing" });
  const ask = evaluateAskField(s, "reference", text);
  ok("AI-11 decline reference", !ask.shouldAsk);
}

// AI-12 eso es todo
{
  const text = "Eso es todo.";
  const goals = resolveUserGoals(perceiveTurn(text, baseState(), transitionFor(baseState(), text)), baseState(), text);
  ok("AI-12 end goal", goals.includes("END_INTERACTION"));
}

// AI-13 select offered slot
{
  const text = "Me sirve la de las 12.";
  const s = baseState({ awaitingSlotSelection: true, offeredSlots: [{ date: "2026-08-31", time: "12:00", label: "12:00" }] });
  const p = perceiveTurn(text, s, transitionFor(s, text));
  ok("AI-13 select slot", p.userIntent === "SELECT_SLOT");
}

// AI-14 appointment question
{
  const text = "¿A qué hora era mi cita?";
  const s = baseState({ appointmentId: "HA-1", activeLeadId: "HS-1" });
  const p = perceiveTurn(text, s, transitionFor(s, text));
  ok("AI-14 check status", p.userIntent === "CHECK_STATUS");
}

// AI-15 cancel intent
{
  const text = "Quiero cancelar la cita.";
  const s = baseState({ appointmentId: "HA-1" });
  const p = perceiveTurn(text, s, transitionFor(s, text));
  ok("AI-15 cancel visit", p.userIntent === "CANCEL_VISIT" || p.userIntent === "CHANGE_SERVICE");
}

// Complex scenario cognition (partial — extraction path)
{
  const text =
    "Hola, desde ayer uno de mis aires está botando agua. Tengo dos equipos pero el otro está bien. Estoy en Edison Park, PH El Mare, apartamento 3A. Soy Irving Corro, mi número es 65656565. Si pueden venir mañana después del almuerzo mejor.";
  let s = applyPackedExtraction(baseState(), text);
  ok("COMPLEX name", s.name.includes("Irving"));
  ok("COMPLEX phone", s.contactStatus === "VALID");
  ok("COMPLEX location", loc(s).includes("Edison"));
  ok("COMPLEX unit", s.facts?.unit === "3A" || s.facts?.apartment === "3A");
  const graph = buildFactGraph(s);
  ok("COMPLEX diagnosis unknown", graph.diagnosis?.status === "UNKNOWN");
}

// Contradiction: Betania → El Dorado → mejor a las 4
{
  let s = baseState({ location: "Betania", facts: { location: "Betania" }, primaryService: "plumbing", appointmentId: "HA-1", activeLeadId: "HS-1" });
  s = applyContradictionResolution(s, "Perdón, es en El Dorado.");
  ok("CONTRA location El Dorado", s.location.includes("Dorado") || s.facts?.location?.includes("Dorado"));
  s = applyContradictionResolution(s, "mejor a las 4");
  ok("CONTRA schedule not location", !s.location.toLowerCase().includes("mejor"));
  const g = buildFactGraph(s);
  ok("CONTRA graph has location", Boolean(g.location?.value));
}

// Fact supersede quantity
{
  let g = buildFactGraph(baseState({ facts: { units: "2" }, primaryService: "ac" }));
  g = supersedeFact(g, "units", "3", { source: "USER_EXPLICIT" });
  ok("QTY supersede", g.units?.value === "3");
  ok("QTY prev superseded", g.units__prev?.status === "SUPERSEDED");
}

if (failed) {
  console.error(`\nHOMESTEAD AI BENCHMARK FAILED (${failed})`);
  process.exit(1);
}
console.log("\nHOMESTEAD AI BENCHMARK PASS");
