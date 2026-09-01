/**
 * Exploratory vs actionable service intent — HS must not be created from catalog questions.
 * Paraphrases are unseen at classifier-authoring time; none are hardcoded as NLU rules.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyActionableServiceIntent } from "../src/lib/concierge/actionable-intent";
import { applyPackedExtraction } from "../src/lib/concierge/packed-extraction";
import { hasValidServiceIntent } from "../src/lib/concierge/service-request-lifecycle";
import type { ConversationState } from "../src/lib/concierge-store";

const dataDir = mkdtempSync(join(tmpdir(), "hs-explore-"));
process.env.DATA_DIR = dataDir;
process.env.OPENAI_API_KEY = "";
process.env.AI_CONCIERGE_DRY_RUN = "true";
process.env.AUTOMATION_DISPATCH_ENABLED = "false";
process.env.HOMESTEAD_TELEGRAM_CHAT_ID = "";

let failed = 0;
function ok(name: string, value: boolean) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

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

type ExploreCase = { id: string; text: string; expectHs: boolean };

const required: ExploreCase[] = [
  { id: "EXPLORE-01", text: "¿Qué servicios ofrecen?", expectHs: false },
  { id: "EXPLORE-02", text: "Hola quiero un servicio, ¿qué me ofrecen?", expectHs: false },
  { id: "EXPLORE-03", text: "¿Hacen pintura?", expectHs: false },
  { id: "EXPLORE-04", text: "¿Instalan cerraduras digitales?", expectHs: false },
  { id: "EXPLORE-05", text: "¿Atienden oficinas?", expectHs: false },
  { id: "EXPLORE-06", text: "Necesito pintura.", expectHs: true },
  { id: "EXPLORE-07", text: "Quiero pintar mi apartamento.", expectHs: true },
  { id: "EXPLORE-08", text: "¿Hacen plomería? Tengo una fuga y necesito que vengan.", expectHs: true },
  { id: "EXPLORE-09", text: "Estoy averiguando precios de aire acondicionado.", expectHs: false },
  { id: "EXPLORE-10", text: "Necesito que revisen mi aire acondicionado.", expectHs: true },
  { id: "EXPLORE-REAL", text: "Hola quiero uns ervicios que me ofreces?", expectHs: false },
];

const paraphrases: ExploreCase[] = [
  { id: "P-01", text: "Me puedes decir con qué oficios trabajan?", expectHs: false },
  { id: "P-02", text: "A ver, qué tipo de trabajos hacen ustedes", expectHs: false },
  { id: "P-03", text: "Estoy viendo opciones, qué cubren en mantenimiento del hogar", expectHs: false },
  { id: "P-04", text: "Trabajan electricidad o solo plomería?", expectHs: false },
  { id: "P-05", text: "Instalan ustedes chapas inteligentes?", expectHs: false },
  { id: "P-06", text: "Hacen remodelaciones pequeñas o solo reparaciones?", expectHs: false },
  { id: "P-07", text: "Atienden PH en Costa del Este o solo casas?", expectHs: false },
  { id: "P-08", text: "Quería saber si dan servicio a comercios", expectHs: false },
  { id: "P-09", text: "Ando preguntando quién pinta apartamentos, ustedes lo hacen?", expectHs: false },
  { id: "P-10", text: "Solo quiero información de lo que manejan", expectHs: false },
  { id: "P-11", text: "Me interesa conocer el catálogo, no pedir visita todavía", expectHs: false },
  { id: "P-12", text: "Cobran visita para decirme si arreglan aires?", expectHs: false },
  { id: "P-13", text: "Se me está botando agua debajo del fregador", expectHs: true },
  { id: "P-14", text: "El aire no enfría desde ayer", expectHs: true },
  { id: "P-15", text: "Necesito un plomero en Betania", expectHs: true },
  { id: "P-16", text: "Quiero que pinten la fachada de la casa", expectHs: true },
  { id: "P-17", text: "Necesito instalar una cerradura en la puerta principal", expectHs: true },
  { id: "P-18", text: "Necesito mantenimiento para dos aires", expectHs: true },
  { id: "P-19", text: "¿Hacen electricidad? Se me dañó un tomacorriente y hay que cambiarlo", expectHs: true },
  { id: "P-20", text: "Podrían venir a revisar el split que no da frío", expectHs: true },
  { id: "P-21", text: "Buenas, qué servicios tienen disponibles hoy", expectHs: false },
  { id: "P-22", text: "Quiero un servicio pero primero dime qué ofrecen", expectHs: false },
];

ok("at least 20 unseen paraphrases", paraphrases.length >= 20);

async function main() {
  const { createConversation, getConversation } = await import("../src/lib/concierge-store");
  const { conciergeTurn } = await import("../src/lib/concierge-engine");
  const { getHomesteadDb } = await import("../src/lib/service-requests");

  function counts() {
    const db = getHomesteadDb();
    const hs = db.prepare("SELECT COUNT(*) AS n FROM service_requests").get() as { n: number };
    const ha = db.prepare("SELECT COUNT(*) AS n FROM revenue_appointments").get() as { n: number };
    return { hs: Number(hs.n), ha: Number(ha.n) };
  }

  async function turn(message: string) {
    const id = createConversation("127.0.0.1", {}, true);
    const result = await conciergeTurn({ conversationId: id, message });
    const conv = getConversation(id);
    return { result, state: conv?.state, id };
  }

  for (const item of [...required, ...paraphrases]) {
    const decision = classifyActionableServiceIntent(item.text, empty());
    const packed = applyPackedExtraction(empty(), item.text);
    const semanticCreate = decision.createServiceRequest;
    ok(
      `${item.id} classifier ${item.expectHs ? "actionable" : "informational"}`,
      semanticCreate === item.expectHs,
    );
    ok(
      `${item.id} hasValidServiceIntent`,
      hasValidServiceIntent(packed, item.text) === item.expectHs,
    );

    const before = counts();
    const ran = await turn(item.text);
    const after = counts();
    const hsDelta = after.hs - before.hs;
    const haDelta = after.ha - before.ha;
    const announced = /HS-2026|Solicitud registrada|ya abrí tu solicitud/i.test(
      ran.result.ok ? ran.result.reply : "",
    );

    if (item.expectHs) {
      ok(`${item.id} HS delta 1 (idempotent new request)`, hsDelta === 1);
      ok(`${item.id} HA delta 0`, haDelta === 0);
    } else {
      ok(`${item.id} HS delta 0`, hsDelta === 0);
      ok(`${item.id} HA delta 0`, haDelta === 0);
      ok(`${item.id} no folio announce`, announced === false);
      ok(`${item.id} no activeLeadId`, !ran.state?.activeLeadId);
    }
  }

  const beforeIdem = counts();
  const id = createConversation("127.0.0.1", {}, true);
  await conciergeTurn({ conversationId: id, message: "Necesito pintura." });
  await conciergeTurn({ conversationId: id, message: "Necesito pintura." });
  const afterIdem = counts();
  ok("idempotent second Necesito pintura does not create another HS", afterIdem.hs === beforeIdem.hs + 1);
  const conv = getConversation(id);
  ok("idempotent keeps same folio", Boolean(conv?.state.activeLeadId));

  if (failed) {
    console.error(`NATURAL_CONVERSATION_EXPLORE_FAILED ${failed}`);
    process.exit(1);
  }
  console.log("NATURAL_CONVERSATION_EXPLORE_OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
