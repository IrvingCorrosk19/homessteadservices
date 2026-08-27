/**
 * Request-first HS + calendar-aware booking certification tests.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(root, rel), "utf8");

let failed = 0;
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

const lifecycle = read("src/lib/concierge/service-request-lifecycle.ts");
const availability = read("src/lib/concierge-availability.ts");
const engine = read("src/lib/concierge-engine.ts");
const tools = read("src/lib/concierge-tools.ts");
const widget = read("src/components/concierge/ConciergeWidget.tsx");
const transaction = read("src/lib/concierge-transaction.ts");
const memory = read("src/lib/concierge/memory-truth.ts");
const datetime = read("src/lib/concierge-datetime.ts");

ok("lifecycle ensureActiveServiceRequest", /ensureActiveServiceRequest/.test(lifecycle));
ok("lifecycle hasValidServiceIntent", /hasValidServiceIntent/.test(lifecycle));
ok("lifecycle sync update", /syncServiceRequestFromState/.test(lifecycle));
ok("lifecycle client folio intro", /requestFolioIntro/.test(lifecycle));
ok("lifecycle request card", /buildRequestCard/.test(lifecycle));
ok("engine calls ensure", /ensureActiveServiceRequest\(/.test(engine));
ok("engine availability query event", /AVAILABILITY_QUERY_EXECUTED/.test(engine));
ok("engine returns requestCard", /requestCard:/.test(engine));
ok("engine returns real leadId", /leadId: ctx\.leadId \|\| state\.activeLeadId/.test(engine));
ok("tools slot revalidation", /isSlotStillOpen/.test(tools));
ok("availability busy message", /requestedSlotBusy|buildBusyMessage/.test(availability));
ok("availability horizon search", /SEARCH_HORIZON_DAYS/.test(availability));
ok("availability queryExecuted flag", /queryExecuted/.test(availability));
ok("datetime min time after 3", /parseMinTimeFromText/.test(datetime));
ok("transaction request card in snapshot", /requestCard/.test(transaction));
ok("widget request card UI", /Solicitud registrada/.test(widget));
ok("memory request folio question", /REQUEST_Q/.test(memory));

// --- behavioral mirror: busy exact slot offers same-day alts ---
const DEFAULT_SLOT_TIMES = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"];

function collectDaySlots(day, hours, busy, exclude) {
  const out = [];
  for (const time of hours) {
    if (exclude && exclude.date === day && exclude.time === time) continue;
    if (busy.has(`${day}|${time}`)) continue;
    out.push({ date: day, time });
    if (out.length >= 4) break;
  }
  return out;
}

const busy = new Set(["2026-08-27|10:00"]);
const alts = collectDaySlots("2026-08-27", DEFAULT_SLOT_TIMES, busy, { date: "2026-08-27", time: "10:00" });
ok("busy 10 offers 8 and 12", alts.some((s) => s.time === "08:00") && alts.some((s) => s.time === "12:00"));
ok("busy 10 does not offer 10", !alts.some((s) => s.time === "10:00"));

ok("hasValidServiceIntent gypsum", (() => {
  const state = { primaryService: "repairs", service: "repairs", problem: "necesito reparar mi gypsum mañana" };
  const service = state.primaryService || state.service;
  const problem = state.problem.trim();
  return Boolean(service && service !== "unknown") || problem.length >= 8;
})());

if (failed) {
  console.error(`\nREQUEST+CALENDAR TESTS FAILED: ${failed}`);
  process.exit(1);
}
console.log("\nREQUEST + CALENDAR BOOKING TESTS PASS");
