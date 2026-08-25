import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

let failed = 0;
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

const datetimeSrc = readFileSync(join(root, "src/lib/concierge-datetime.ts"), "utf8");
const availSrc = readFileSync(join(root, "src/lib/concierge-availability.ts"), "utf8");
const readinessSrc = readFileSync(join(root, "src/lib/concierge/appointment-readiness.ts"), "utf8");
const memorySrc = readFileSync(join(root, "src/lib/concierge/memory-truth.ts"), "utf8");
const toolsSrc = readFileSync(join(root, "src/lib/concierge-tools.ts"), "utf8");
const engineSrc = readFileSync(join(root, "src/lib/concierge-engine.ts"), "utf8");
const packedSrc = readFileSync(join(root, "src/lib/concierge/packed-extraction.ts"), "utf8");

ok("AI-01 exact calendar day parser", datetimeSrc.includes("parseExactCalendarDay") && datetimeSrc.includes("este\\s+mes"));
ok("AI-02 exactDay flag", datetimeSrc.includes("exactDay"));
ok("AI-03 availability respects exact day", availSrc.includes("exactDayRequested") && availSrc.includes("requestedDateUnavailable"));
ok("AI-04 no silent date substitution on exact", availSrc.includes("considerDates = exactDayRequested ? [date]"));
ok("AI-05 appointment readiness gate", readinessSrc.includes("getAppointmentReadiness") && toolsSrc.includes("missing_visit_data"));
ok("AI-06 required visit fields", readinessSrc.includes("customer_name") && readinessSrc.includes("location") && readinessSrc.includes("property_type"));
ok("AI-07 memory truth handler", memorySrc.includes("answerMemoryQuestion") && engineSrc.includes("answerMemoryQuestion"));
ok("AI-08 no false thank you", memorySrc.includes("stripFalseThankYou") && engineSrc.includes("stripFalseThankYou"));
ok("AI-09 stale slots on date change", toolsSrc.includes("preferredDate !== parsed.date") && toolsSrc.includes("offeredSlots: []"));
ok("AI-10 PH/building extraction", packedSrc.includes("extractBuildingFacts") && packedSrc.includes('return "ph"'));
ok("AI-11 mejor no abandons intent", packedSrc.includes("abandonedService"));
ok("AI-12 readiness in LLM state", engineSrc.includes("readinessPromptHint"));

function fold(value) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function ymdFromParts(year, month, day) {
  if (day < 1 || day > daysInMonth(year, month)) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseExactCalendarDay(text, todayYmd) {
  const lower = fold(text);
  const year = Number(todayYmd.slice(0, 4));
  const monthNow = Number(todayYmd.slice(5, 7));
  const dayNow = Number(todayYmd.slice(8, 10));
  const esteMes = lower.match(/\b(?:el\s+|dia\s+|d[ií]a\s+)?(\d{1,2})\s+de\s+este\s+mes\b/);
  if (esteMes) return ymdFromParts(year, monthNow, Number(esteMes[1]));
  const bareDay = lower.match(/\b(?:el|dia|d[ií]a)\s+(\d{1,2})\b(?!\s*(?:am|pm|a\.?\s*m|p\.?\s*m|:))/);
  if (bareDay) {
    const day = Number(bareDay[1]);
    let y = year;
    let m = monthNow;
    if (day < dayNow) {
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return ymdFromParts(y, m, day);
  }
  return "";
}

ok("AI-13 el 27 de este mes → 2026-08-27", parseExactCalendarDay("el 27 de este mes", "2026-08-24") === "2026-08-27");
ok("AI-14 el 27 → 2026-08-27", parseExactCalendarDay("el 27", "2026-08-24") === "2026-08-27");
ok("AI-15 not confused with tomorrow", parseExactCalendarDay("el 27 de este mes", "2026-08-24") !== "2026-08-25");

function getAppointmentReadiness(state) {
  const missing = [];
  if (!state.name || /cliente web/i.test(state.name)) missing.push("customer_name");
  if (state.contactStatus !== "VALID") missing.push("contact");
  if (!state.location || /ciudad de panam/i.test(state.location)) missing.push("location");
  if (!state.propertyType) missing.push("property_type");
  if (state.propertyType === "ph" && !state.facts?.building) missing.push("building");
  if (state.propertyType === "ph" && !state.facts?.unit) missing.push("unit");
  if (!state.service && !state.problem) missing.push("service");
  return { ready: missing.length === 0, missingFields: missing };
}

ok(
  "AI-16 missing name blocks",
  !getAppointmentReadiness({ name: "", contactStatus: "VALID", location: "Costa del Este", propertyType: "house", service: "remodeling", problem: "sala" }).ready,
);
ok(
  "AI-17 ph needs building",
  getAppointmentReadiness({
    name: "Carlos",
    contactStatus: "VALID",
    location: "Costa del Este",
    propertyType: "ph",
    service: "remodeling",
    problem: "sala",
    facts: {},
  }).missingFields.includes("building"),
);
ok(
  "AI-18 house ready without unit",
  getAppointmentReadiness({
    name: "Carlos",
    contactStatus: "VALID",
    location: "Costa del Este",
    propertyType: "house",
    service: "remodeling",
    problem: "sala",
  }).ready,
);

const MEMORY_Q = /\b(sabes?|conoces?|tienes?)\b.{0,40}\b(c[oó]mo me llamo|d[oó]nde|si es ph)\b/i;
ok("AI-19 memory question detected", MEMORY_Q.test("pero sabes como me llamo donde es si es ph o demas"));
ok("AI-20 false thank strip exists", memorySrc.includes("gracias por la informaci"));

if (failed) {
  console.error(`\nAPPOINTMENT INTEGRITY checks FAILED (${failed})`);
  process.exit(1);
}
console.log("\nAPPOINTMENT INTEGRITY static checks OK");
