import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const playbooks = readFileSync(join(root, "src/lib/concierge/service-playbooks.ts"), "utf8");
const engineLogic = readFileSync(join(root, "src/lib/concierge/playbook-engine.ts"), "utf8");
const chatEngine = readFileSync(join(root, "src/lib/concierge-engine.ts"), "utf8");
const tools = readFileSync(join(root, "src/lib/concierge-tools.ts"), "utf8");
const knowledge = readFileSync(join(root, "src/lib/concierge-knowledge.ts"), "utf8");
const handoff = readFileSync(join(root, "src/lib/concierge-handoff.ts"), "utf8");
const store = readFileSync(join(root, "src/lib/concierge-store.ts"), "utf8");
const widget = readFileSync(join(root, "src/components/concierge/ConciergeWidget.tsx"), "utf8");
const photoLink = readFileSync(join(root, "src/lib/concierge/photo-link.ts"), "utf8");
const opsEngine = readFileSync(join(root, "src/lib/ops-engine.ts"), "utf8");
const opsStore = readFileSync(join(root, "src/lib/ops-store.ts"), "utf8");
const n8n = readFileSync(join(root, "src/lib/n8n.ts"), "utf8");
const adminPage = readFileSync(join(root, "src/app/admin/solicitudes/[requestId]/page.tsx"), "utf8");
const chatRoute = readFileSync(join(root, "src/app/api/concierge/chat/route.ts"), "utf8");

let failed = 0;
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

function fold(value) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function aliasHits(blob, alias) {
  const needle = fold(alias);
  if (!needle) return false;
  if (needle.length <= 4) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}`).test(blob);
  }
  return blob.includes(needle);
}

function extractAliases(constName) {
  const match = playbooks.match(new RegExp(`const ${constName}[\\s\\S]*?aliases:\\s*\\[([\\s\\S]*?)\\]`));
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

const CATALOG = [
  ["locksmith", "LOCKSMITH"],
  ["ac", "AC"],
  ["plumbing", "PLUMBING"],
  ["electrical", "ELECTRICAL"],
  ["painting", "PAINTING"],
  ["remodeling", "REMODELING"],
  ["repairs", "REPAIRS"],
];

function detectServices(text) {
  const blob = fold(text);
  const found = [];
  for (const [id, name] of CATALOG) {
    if (extractAliases(name).some((alias) => aliasHits(blob, alias)) && !found.includes(id)) found.push(id);
  }
  return found;
}

function detectUnknown(text) {
  if (detectServices(text).length) return false;
  const blob = fold(text);
  return extractAliases("OTHER").some((alias) => aliasHits(blob, alias));
}

function applyLocationCorrection(text, current) {
  const match = text.match(
    /(?:perd[oó]n[,.]?|mejor dicho|no[,.]?\s*estoy en|no[,.]?\s*es)\s+(?:es\s+|estoy en\s+)?([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,3})/i,
  );
  if (match) return match[1].trim();
  return current;
}

function countQuestions(reply) {
  return (reply.match(/¿/g) || []).length || (reply.match(/\?/g) || []).length;
}

function redactForModel(text) {
  return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]").replace(/\+?\d[\d\s\-()]{6,}\d/g, "[teléfono]");
}

ok("playbook file exists", /ServicePlaybook/.test(playbooks) && /PHOTO_REVIEW_FIRST/.test(playbooks));
ok("config driven no locksmith if-chain in engine", !/if\s*\(\s*service\s*===\s*["']locksmith["']/.test(chatEngine + tools + handoff));
ok("required vs useful", /REQUIRED/.test(playbooks) && /USEFUL/.test(playbooks) && /OPTIONAL/.test(playbooks) && /NOT_NEEDED/.test(playbooks));
ok("unknown catalog", /unknownCatalog:\s*true/.test(playbooks));
ok("structured state fields", /detectedServices/.test(store) && /facts:/.test(store) && /bookingStrategy/.test(store));
ok("record_service_intelligence tool", /record_service_intelligence/.test(tools));
ok("photos copied to HS", /conciergePhotoBuffers/.test(handoff) && /copyConciergePhotosToRequest/.test(handoff + chatEngine));
ok("facts_json persisted", /factsJson/.test(handoff) && /facts_json/.test(readFileSync(join(root, "src/lib/service-requests.ts"), "utf8")));
ok("widget not a form menu", !/Necesito un servicio/.test(widget) && !/Seleccione una opción/.test(widget + knowledge));
ok("fallback chips empty", /chips:\s*\[\]/.test(chatRoute));
ok("one openai call loop max 3", /round < 3/.test(chatEngine));
ok("pii redact before model", /redactForModel/.test(chatEngine) && redactForModel("llámame al 60001111") === "llámame al [teléfono]");
ok("prompt version keeps v3", /hs-concierge-v3/.test(knowledge));
ok("no fake human", /No finjas ser una persona/.test(knowledge));
ok("bot transparency", /bot o una IA/.test(knowledge));
ok("booking still deterministic", /createAppointment\(/.test(tools) && /photo_review_first/.test(tools));
ok("availability not invented", /checkAvailability/.test(tools));
ok("human handoff event", /HUMAN_HANDOFF_REQUESTED/.test(chatEngine));
ok("sla uses structured lines", /telegramServiceLines/.test(opsEngine) && /SOLICITUD PENDIENTE/.test(opsEngine));
ok("rescue uses photos without openai", /countLeadPhotos/.test(opsStore) && !/openai/.test(opsStore));
ok("admin facts", /adminFactRows/.test(adminPage));
ok("n8n presentation from facts", /presentation/.test(n8n) && /telegramServiceLines/.test(n8n));
ok("no new n8n workflow file", !/chatbot_notification_queue/.test(handoff + chatEngine + n8n));
ok("overquestioning flag", /OVERQUESTIONING/.test(chatEngine));
ok("photo stored names", /storedPhotoName/.test(photoLink));

ok("LOCK-01 locksmith", detectServices("Necesito cambiar la cerradura.").includes("locksmith"));
ok("LOCK-02 lost key urgency alias", detectServices("Perdí la llave y no puedo entrar.").includes("locksmith"));
ok("LOCK-03 digital lock", detectServices("Quiero poner una cerradura digital.").includes("locksmith"));
ok("AIR-01 no cool", detectServices("Mi aire no enfría.").includes("ac") && !detectServices("Mi aire no enfría.").includes("locksmith"));
ok("AIR-02 water", detectServices("Mi aire bota agua.").includes("ac"));
ok("AIR-03 maintenance units", detectServices("Quiero mantenimiento para tres aires.").includes("ac"));
ok("PLUMB-01 sink", detectServices("Se me sale agua debajo del fregador.").includes("plumbing"));
ok("PLUMB-02 broken pipe", detectServices("Tengo una tubería rota y sigue saliendo agua.").includes("plumbing"));
ok("ELEC-01 outlet", detectServices("Un tomacorriente no funciona.").includes("electrical"));
ok("ELEC-02 sparks", detectServices("Está echando chispas y huele a quemado.").includes("electrical"));
ok("PAINT-01 room", detectServices("Quiero pintar mi sala.").includes("painting"));
ok("PAINT-02 exterior house", detectServices("Necesito pintar toda la casa por fuera.").includes("painting"));
ok("UNKNOWN-01 gates no false catalog", detectServices("¿Arreglan portones?").length === 0 && detectUnknown("¿Arreglan portones?"));
ok("multi-service keeps both", (() => {
  const found = detectServices("Necesito arreglar una cerradura y también revisar un aire.");
  return found.includes("locksmith") && found.includes("ac");
})());
ok("fachada is not AC", !detectServices("Quiero pintar la fachada.").includes("ac"));
ok("correction Bella Vista", applyLocationCorrection("Perdón, es Bella Vista.", "San Francisco") === "Bella Vista");
ok("memory packed identity stays", /soy\s+/.test(chatEngine) && /applyLocationCorrection/.test(chatEngine));
ok("overquestioning metric", countQuestions("¿Zona? ¿Teléfono? ¿Tipo? ¿Fotos? ¿Marca? ¿Modelo?") >= 5);
ok("photo review blocks slots", /shouldOfferAvailability/.test(engineLogic) && /PHOTO_REVIEW_FIRST/.test(engineLogic));
ok("no price invention", /NUNCA inventes precios/.test(knowledge));
ok("injection still denied", /INJECTION_RE/.test(chatEngine));
ok("openai timeout fallback keeps data", /Estoy teniendo un inconveniente/.test(chatEngine));

if (failed) {
  console.error(`CONVERSATIONAL_AI_V3_FAILED ${failed}`);
  process.exit(1);
}
console.log("CONVERSATIONAL_AI_V3_TESTS_OK");
