import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const region = JSON.parse(readFileSync(join(root, "src/data/contact-region.json"), "utf8"));
const engine = readFileSync(join(root, "src/lib/concierge-engine.ts"), "utf8");
const phoneSrc = readFileSync(join(root, "src/lib/phone.ts"), "utf8");
const contactSrc = readFileSync(join(root, "src/lib/concierge-contact.ts"), "utf8");
const handoff = readFileSync(join(root, "src/lib/concierge-handoff.ts"), "utf8");
const tg = readFileSync(join(root, "src/lib/revenue-telegram.ts"), "utf8");
const handler = readFileSync(join(root, "src/lib/content-handler.ts"), "utf8");
const scoreSrc = readFileSync(join(root, "src/lib/revenue-score.ts"), "utf8");
const store = readFileSync(join(root, "src/lib/revenue-store.ts"), "utf8");
const prompt = readFileSync(join(root, "src/lib/concierge-knowledge.ts"), "utf8");

let failed = 0;
function assert(name, ok) {
  if (!ok) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

const ALL_SAME = /^(\d)\1+$/;
function classifyPhone(raw) {
  const trimmed = String(raw || "").trim();
  const pa = region.regions.PA;
  if (!trimmed) return { status: "UNKNOWN", digits: "" };
  if (/[A-Za-z]/.test(trimmed)) return { status: "INVALID", digits: "" };
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return { status: "UNKNOWN", digits: "" };
  if (ALL_SAME.test(digits) || digits === "123" || digits === "000") return { status: "INVALID", digits };
  let national = "";
  if (digits.length === pa.nationalLength) national = digits;
  if (digits.length === pa.e164Length && digits.startsWith(pa.countryCode)) national = digits.slice(pa.countryCode.length);
  if (national && !ALL_SAME.test(national)) return { status: "VALID", digits: `${pa.countryCode}${national}`, national };
  if (digits.length < pa.nationalLength) return { status: "INCOMPLETE", digits };
  if (region.allowInternational && digits.length >= region.internationalMinDigits && digits.length <= region.internationalMaxDigits && !digits.startsWith(pa.countryCode)) {
    return { status: "VALID", digits };
  }
  if (digits.length > pa.nationalLength && digits.length < pa.e164Length) return { status: "INCOMPLETE", digits };
  return { status: "INVALID", digits };
}

assert("594210 incomplete", classifyPhone("594210").status === "INCOMPLETE");
assert("678993 incomplete", classifyPhone("678993").status === "INCOMPLETE");
assert("69594210 valid panama", classifyPhone("69594210").status === "VALID");
assert("+507 6959-4210 valid", classifyPhone("+507 6959-4210").status === "VALID");
assert("international kept", classifyPhone("+14155552671").status === "VALID" && classifyPhone("+14155552671").digits.startsWith("1"));
assert("abcdef invalid", classifyPhone("abcdef").status === "INVALID");
assert("000 invalid", classifyPhone("000").status === "INVALID");
assert("123 invalid", classifyPhone("123").status === "INVALID");
assert("whitespace unknown", classifyPhone("   ").status === "UNKNOWN");
assert("region not scattered", !/\+507/.test(phoneSrc) && phoneSrc.includes("contact-region.json"));
assert("name not required for handoff", /canHandoffLead/.test(engine) && !/digits\.length >= 7 && \(state\.problem/.test(engine));
assert("no dry fake lead", !/DRY-\$\{conversationId/.test(engine) && /createLeadFromConcierge/.test(engine));
assert("canonical source", /WEBSITE_AI_CHAT/.test(handoff));
assert("incomplete human reply", /faltan algunos dígitos/.test(contactSrc));
assert("no validation failed copy", !/validation failed/i.test(contactSrc));
assert("visit preference reply", /más conveniente para la visita/.test(contactSrc));
assert("no passive close as success", /isPassiveClose/.test(engine) && /nos pondremos en contacto/.test(contactSrc));
assert("telegram premium format", /HOMESTEAD · NUEVO LEAD/.test(tg));
assert("program visit button", /PROGRAMAR VISITA/.test(tg));
assert("contact button", /CONTACTAR/.test(tg));
assert("quote button", /PREPARAR COTIZACIÓN/.test(tg));
assert("visit not confirmed silently", /no CONFIRMED/.test(tg));
assert("site visit required quote", /SITE VISIT REQUIRED/.test(tg));
assert("manual contact when no outbound", /CONTACT CUSTOMER MANUALLY/.test(tg));
assert("callback after auth", /isTelegramAdmin/.test(handler) && handler.indexOf("isTelegramAdmin") < handler.indexOf("applyRevenueCallback"));
assert("unauthorized denied", /denied: true/.test(handler));
assert("hot sla configurable", /hotLeadAttentionMinutes/.test(phoneSrc) && /HOT_LEAD_ATTENTION_MINUTES/.test(phoneSrc));
assert("idempotent lead", /existingLeadId/.test(handoff) && /lead_id = \?/.test(store));
assert("stop signal wired", /STOP_SIGNAL/.test(engine) && /no quiero que me contacten/.test(contactSrc));
assert("prompt forbids passive close", /nos pondremos en contacto contigo pronto/.test(prompt));
assert("prompt one question", /UNA pregunta/.test(prompt));
assert("score uses validator", /classifyPhone\(input\.phone\)/.test(scoreSrc));
assert("next action program visit", /PROGRAM_SITE_VISIT/.test(scoreSrc));
assert("alert idempotent", /internal_alert_at IS NULL/.test(store));
assert("n8n still used", /notifyN8n/.test(handoff));
assert("country code centralized", region.regions.PA.countryCode === "507");

if (failed) process.exit(1);
console.log("CHAT-LEAD-HANDOFF TESTS PASS");
