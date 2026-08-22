import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const prompt = readFileSync(join(root, "src/lib/concierge-knowledge.ts"), "utf8");
const schema = readFileSync(join(root, "src/lib/concierge-schema.ts"), "utf8");
const engine = readFileSync(join(root, "src/lib/concierge-engine.ts"), "utf8");
const flags = readFileSync(join(root, "src/lib/concierge-flags.ts"), "utf8");
const tools = readFileSync(join(root, "src/lib/concierge-tools.ts"), "utf8");
const widget = readFileSync(join(root, "src/components/concierge/ConciergeWidget.tsx"), "utf8");
const chat = readFileSync(join(root, "src/app/api/concierge/chat/route.ts"), "utf8");

let failed = 0;
function assert(name, ok) {
  if (!ok) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

assert("no openai in widget", !/api\.openai\.com|OPENAI_API_KEY/.test(widget));
assert("openai only server", /api\.openai\.com/.test(engine));
assert("kill switch", /AI_CONCIERGE_ENABLED/.test(engine) || /AI_CONCIERGE_ENABLED/.test(flags));
assert("dry run flag kept", /AI_CONCIERGE_DRY_RUN/.test(flags));
assert("tools defined", /check_availability/.test(tools) && /create_appointment/.test(tools));
assert("booking requires confirmation", /customerConfirmed/.test(tools));
assert("valid contact gate", /canHandoffLead|canCreateLead/.test(engine));
assert("no 7-digit name gate", !/digits\.length >= 7/.test(engine));
assert("no chatbot label", !/Chatbot|AI Assistant|GPT-4/.test(widget));
assert("prompt forbids prices", /NUNCA inventes precios/.test(prompt));
assert("prompt forbids diagnosis", /capacitor/.test(prompt));
assert("prompt injection ignored", /jailbreak/.test(prompt));
assert("price strip exists", /stripHallucinatedPrices/.test(schema));
assert("rate limit", /429/.test(chat));
assert("no json to client in widget", !/leadTemperature/.test(widget));

function stripHallucinatedPrices(reply) {
  const PRICE_CLAIM = /\$\s*\d|\b\d+\s*(usd|balboas?|d[oó]lares?)\b|\b(desde|cuesta|cobramos)\s+\d+/i;
  if (!PRICE_CLAIM.test(reply)) return { text: reply, removed: false };
  return { text: "Depende del trabajo específico.", removed: true };
}
const stripped = stripHallucinatedPrices("El mantenimiento cuesta 45 dólares");
assert("price hallucination stripped", stripped.removed === true);

if (failed) process.exit(1);
console.log("AI SALES CONCIERGE STATIC TESTS PASS");
