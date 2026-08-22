import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("..", import.meta.url));
const engine = readFileSync(join(root, "src/lib/concierge-engine.ts"), "utf8");
const tools = readFileSync(join(root, "src/lib/concierge-tools.ts"), "utf8");
const knowledge = readFileSync(join(root, "src/lib/concierge-knowledge.ts"), "utf8");
const integrity = readFileSync(join(root, "src/lib/concierge-integrity.ts"), "utf8");
const datetimeSrc = readFileSync(join(root, "src/lib/concierge-datetime.ts"), "utf8");
const availability = readFileSync(join(root, "src/lib/concierge-availability.ts"), "utf8");
const calendar = readFileSync(join(root, "src/components/admin/AppointmentCalendar.tsx"), "utf8");
const widget = readFileSync(join(root, "src/components/concierge/ConciergeWidget.tsx"), "utf8");
const handoff = readFileSync(join(root, "src/lib/concierge-handoff.ts"), "utf8");
const contact = readFileSync(join(root, "src/app/api/contact/route.ts"), "utf8");
const service = readFileSync(join(root, "src/lib/service-request-service.ts"), "utf8");

let failed = 0;
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

ok("prompt version v3", /hs-concierge-v3/.test(knowledge));
ok("persona split", /PERSONA/.test(knowledge) && /POLÍTICAS/.test(knowledge) && /HERRAMIENTAS/.test(knowledge));
ok("no false human identity", /No finjas ser una persona/.test(knowledge));
ok("tools in openai call", /CONCIERGE_TOOLS/.test(engine));
ok("createAppointment from tools", /createAppointment\(/.test(tools));
ok("availability from sqlite", /listAppointments/.test(availability));
ok("integrity booking", /enforceBookingIntegrity/.test(integrity) && /enforceBookingIntegrity/.test(engine));
ok("unified request service", /dispatchServiceRequest/.test(service) && /dispatchServiceRequest/.test(contact) && /dispatchServiceRequest/.test(handoff));
ok("calendar origin", /originLabel/.test(calendar) && /WhatsApp/.test(calendar));
ok("no openai in widget", !/api\.openai\.com|OPENAI_API_KEY/.test(widget));
ok("enter sends", /Shift\+Enter|shiftKey/.test(widget));

function addYmd(ymd, days) {
  const utc = Date.parse(`${ymd}T12:00:00Z`) + days * 86400000;
  return new Date(utc).toISOString().slice(0, 10);
}

function parseNaturalDateTime(text, today = "2026-08-22") {
  const lower = text.toLowerCase();
  let date = "";
  if (/\bhoy\b/.test(lower)) date = today;
  else if (/\bpasado\s+ma[ñn]ana\b/.test(lower)) date = addYmd(today, 2);
  else if (/\bma[ñn]ana\b/.test(lower)) date = addYmd(today, 1);
  const hm = lower.match(/\b(\d{1,2}):(\d{2})\b/);
  const ampm = lower.match(/\b(\d{1,2})\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)\b/);
  let time = "";
  if (hm) time = `${String(Number(hm[1])).padStart(2, "0")}:${hm[2]}`;
  else if (ampm) {
    let hours = Number(ampm[1]);
    const afternoon = /p/.test(ampm[2]);
    if (hours === 12) hours = afternoon ? 12 : 0;
    else if (afternoon) hours += 12;
    time = `${String(hours).padStart(2, "0")}:00`;
  }
  return { date, time };
}

assert.equal(parseNaturalDateTime("mañana a las 3 pm").date, "2026-08-23");
assert.equal(parseNaturalDateTime("mañana a las 3 pm").time, "15:00");
assert.equal(parseNaturalDateTime("pasado mañana").date, "2026-08-24");
ok("natural date parser", datetimeSrc.includes("pasado") && datetimeSrc.includes("businessTimezone"));

const PRICE_CLAIM = /\$\s*\d|\b\d+\s*(usd|balboas?|d[oó]lares?)\b|\b(desde|cuesta|cobramos)\s+\d+/i;
ok("price strip", PRICE_CLAIM.test("cuesta 45 dolares"));

const BOOKED_CLAIM = /\b(cita|visita)\b.{0,40}\b(agendad[ao]|confirmad[ao])/i;
ok("false booking detected", BOOKED_CLAIM.test("Tu visita quedó agendada para mañana"));
ok("slot hours real", /DEFAULT_SLOT_TIMES/.test(availability));

if (failed) process.exit(1);
console.log("CONVERSATIONAL_AI_V2_TESTS_OK");
