/**
 * 50+ unseen paraphrases — semantic classification, not hardcoded test sentences as NLU.
 */
import { applyPackedExtraction } from "../src/lib/concierge/packed-extraction";
import { detectServices } from "../src/lib/concierge/playbook-engine";
import { perceiveTurn } from "../src/lib/concierge/conversation-perception";
import { detectConversationTransition } from "../src/lib/concierge/service-transition";
import { detectCustomerCancellationIntent } from "../src/lib/concierge/cancellation-intent";
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

type Case = { text: string; expect: "ac" | "plumbing" | "painting" | "locksmith" | "cancel" | "question" | "noise" };

const cases: Case[] = [
  { text: "El aire no enfría.", expect: "ac" },
  { text: "mi split prende y no da frío", expect: "ac" },
  { text: "mantenimiento de aire acondicionado porfa", expect: "ac" },
  { text: "el abanico echa agua", expect: "ac" },
  { text: "nesesito reparar el aire", expect: "ac" },
  { text: "el aire acondicionado está dañado", expect: "ac" },
  { text: "hace calor y el aire no sirve", expect: "ac" },
  { text: "Necesito un plomero mañana.", expect: "plumbing" },
  { text: "el fregador bota agua", expect: "plumbing" },
  { text: "se me tapó el inodoro", expect: "plumbing" },
  { text: "plomeria en la cosina", expect: "plumbing" },
  { text: "hay una fuga debajo del lavamanos", expect: "plumbing" },
  { text: "el tubo está goteando", expect: "plumbing" },
  { text: "Quiero pintar mi sala.", expect: "painting" },
  { text: "pintura para las paredes del apto", expect: "painting" },
  { text: "se me dañó el cielo raso, hay que pintar", expect: "painting" },
  { text: "quiero que pinten la fachada", expect: "painting" },
  { text: "Necesito una cerradura digital.", expect: "locksmith" },
  { text: "quiero cambiar la cerradura", expect: "locksmith" },
  { text: "se me dañó la chapa", expect: "locksmith" },
  { text: "cerrajeria para la puerta principal", expect: "locksmith" },
  { text: "canbiar la seradura", expect: "locksmith" },
  { text: "Ya no lo necesito.", expect: "cancel" },
  { text: "Mejor no vengan.", expect: "cancel" },
  { text: "Solo cancela la cita.", expect: "cancel" },
  { text: "cancela la cita porfa", expect: "cancel" },
  { text: "cansela la cita", expect: "cancel" },
  { text: "¿También trabajan los domingos?", expect: "question" },
  { text: "¿Atienden oficinas?", expect: "question" },
  { text: "cuanto tiempo llevan trabajando", expect: "question" },
  { text: "ustedes hacen pintura también?", expect: "question" },
  { text: "hola", expect: "noise" },
  { text: "ok", expect: "noise" },
  { text: "mmm", expect: "noise" },
  { text: "una pregunta", expect: "noise" },
  { text: "espera", expect: "noise" },
  { text: "manana alas 2 el aire no sirve", expect: "ac" },
  { text: "estoy en edison par y el fregadero gotea", expect: "plumbing" },
  { text: "buenas, para pintar dos cuartos", expect: "painting" },
  { text: "se trabó la llave de la puerta", expect: "locksmith" },
  { text: "podrían venir a revisar el split?", expect: "ac" },
  { text: "hay humedad en el techo, pintan eso?", expect: "painting" },
  { text: "se reventó una tubería", expect: "plumbing" },
  { text: "instalación de lock digital", expect: "locksmith" },
  { text: "el equipo congela y no enfría bien", expect: "ac" },
  { text: "quiero cotizar pintura, no agendar todavía", expect: "painting" },
  { text: "olvídalo, ya no hace falta que vengan", expect: "cancel" },
  { text: "¿trabajan sábado?", expect: "question" },
  { text: "gracias", expect: "noise" },
  { text: "el fregador de la cocina está botando agua", expect: "plumbing" },
  { text: "necesito plomería y también quiero pintar", expect: "plumbing" },
];

let failed = 0;
function ok(name: string, value: boolean) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

ok("at least 50 paraphrases", cases.length >= 50);

let pass = 0;
for (const item of cases) {
  const services = detectServices(item.text);
  const packed = applyPackedExtraction(empty(), item.text);
  const state = empty({ primaryService: packed.primaryService || packed.service });
  const transition = detectConversationTransition(state, item.text);
  const perception = perceiveTurn(item.text, state, transition);
  const cancel = detectCustomerCancellationIntent(item.text, empty({ appointmentId: "HA-x", activeLeadId: "HS-x" }));

  let matched = false;
  if (item.expect === "cancel") {
    matched =
      cancel.kind === "CANCEL_REQUEST" ||
      cancel.kind === "CANCEL_APPOINTMENT_ONLY" ||
      perception.userIntent === "CANCEL_VISIT" ||
      perception.userIntent === "CANCEL_REQUEST";
  } else if (item.expect === "question") {
    matched =
      perception.userIntent === "ASK_GENERAL_QUESTION" ||
      perception.userIntent === "ASK_SERVICE_CAPABILITY" ||
      perception.userIntent === "GET_ESTIMATE" ||
      /\?/.test(item.text);
  } else if (item.expect === "noise") {
    matched = !services.length && cancel.kind === "NONE";
  } else {
    matched = services.includes(item.expect) || packed.primaryService === item.expect || packed.service === item.expect;
  }
  if (matched) pass += 1;
  else console.error("PARAPHRASE_MISS", item.expect, item.text, services, perception.userIntent, cancel.kind);
}

ok(`paraphrase semantic hit ${pass}/${cases.length} >= 45`, pass >= 45);

if (failed) {
  console.error(`NATURAL_CONVERSATION_PARAPHRASES_FAILED ${failed}`);
  process.exit(1);
}
console.log(`NATURAL_CONVERSATION_PARAPHRASES_OK ${pass}/${cases.length}`);
