/**
 * Behavioral assertions for P0 transaction — run via: npx tsx scripts/p0-tx-behavior.ts
 */
import { applyPackedExtraction } from "../src/lib/concierge/packed-extraction";
import { mergeParsedWhen } from "../src/lib/concierge-tools";
import {
  getAppointmentReadiness,
  isLocationSufficient,
  hasRequestedExactWhen,
} from "../src/lib/concierge/appointment-readiness";
import { determineNextAction } from "../src/lib/concierge/conversation-next-action";
import { parseNaturalDateTime, parseClock } from "../src/lib/concierge-datetime";
import {
  resolveSlotFromMessage,
  lockSelectedSlot,
  isSlotConfirmed,
} from "../src/lib/concierge-transaction";
import type { ConversationState } from "../src/lib/concierge-store";

function empty(): ConversationState {
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
  };
}

function turn(s: ConversationState, t: string) {
  return mergeParsedWhen(applyPackedExtraction(s, t), t);
}

let failed = 0;
function ok(name: string, value: boolean) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

const msgB =
  "tengo un problema de aire acondicionado estoy en edison park apartamento 3 a, es mantenimiento y requiero la solicitud para mañana a las 2 pm irving corro 65656565";
const parsed = parseNaturalDateTime(msgB);
ok("B parse date mañana", Boolean(parsed.date));
ok("B parse time 14:00", parsed.time === "14:00");
ok("B parseClock 14:00", parseClock(msgB) === "14:00");

let b = turn(empty(), msgB);
ok("B service ac", (b.primaryService || b.service) === "ac");
ok("B location Edison", /edison/i.test(b.location));
ok("B unit 3A", (b.facts?.unit || "").toUpperCase() === "3A");
ok("B name Irving", /irving/i.test(b.name) && !/\bpm\b/i.test(b.name));
ok("B phone valid", b.contactStatus === "VALID");
ok("B preferredDate set", Boolean(b.preferredDate));
ok("B preferredTime 14:00", b.preferredTime === "14:00");
ok("B hasRequestedExactWhen", hasRequestedExactWhen(b));
ok("B location sufficient", isLocationSufficient(b));
ok("B missing empty", getAppointmentReadiness(b).missingFields.length === 0);
const nextB = determineNextAction(b);
ok("B next CHECK_AVAILABILITY", nextB.action === "CHECK_AVAILABILITY");
ok("B does NOT ask date/time", !/d[ií]a y hora/i.test(nextB.cannedQuestion || ""));

let a = turn(empty(), "Necesito mantenimiento de aire acondicionado");
a = turn(a, "Panama centro edison park");
a.facts = { ...a.facts, lastAskedField: "units" };
a = turn(a, "2");
a = turn(a, "ph el mare 3000");
ok("A no auto unit 3000", a.facts?.unit !== "3000");
a = turn(a, "65653455");
a = turn(a, "puedes el viernes");
const date = a.preferredDate;
a.offeredSlots = [
  { date, time: "08:00", label: "8:00 a. m." },
  { date, time: "10:00", label: "10:00 a. m." },
  { date, time: "12:00", label: "12:00 p. m." },
  { date, time: "14:00", label: "2:00 p. m." },
];
a.awaitingSlotSelection = true;
a.lastAvailabilityAt = new Date().toISOString();

for (const [label, msg, time] of [
  ["10", "Me sirve 10.", "10:00"],
  ["12", "Me sirve 12.", "12:00"],
  ["14", "Me sirve 2:00 p. m.", "14:00"],
] as const) {
  const matched = resolveSlotFromMessage(msg, a.offeredSlots, date);
  ok(`SLOT_${label} match`, matched?.time === time);
  let s = lockSelectedSlot({ ...a }, matched!);
  s.facts = { ...s.facts, lastAskedField: "customer_name" };
  s = turn(s, "irving corro");
  ok(`SLOT_${label} survives name`, s.pendingSlot?.time === time && isSlotConfirmed(s));
  ok(`SLOT_${label} no re-offer`, determineNextAction(s).action !== "ASK_SLOT_SELECTION");
}

let loc = turn(empty(), "necesito aire acondicionado");
loc = turn(loc, "Edison Park");
const before = loc.location;
loc.facts = { ...loc.facts, lastAskedField: "customer_name" };
loc = turn(loc, "Irving Corro");
ok("LOCATION_PERSISTENCE", /edison/i.test(loc.location) && loc.location === before);

let fin = { ...a };
fin = lockSelectedSlot(fin, { date, time: "14:00", label: "2:00 p. m." });
fin.facts = { ...fin.facts, lastAskedField: "unit", lastBotQuestion: "¿Qué apartamento?" };
fin = turn(fin, "3A");
fin.facts = { ...fin.facts, lastAskedField: "customer_name" };
fin = turn(fin, "irving corro");
ok(
  "COMPLETE ready or book",
  getAppointmentReadiness(fin).ready === true || determineNextAction(fin).action === "CONFIRM_OR_BOOK",
);
ok("COMPLETE slot still 14", fin.pendingSlot?.time === "14:00");
ok("COMPLETE no ASK_SLOT", determineNextAction(fin).action !== "ASK_SLOT_SELECTION");

if (failed) {
  console.error(`\nFAILED: ${failed}`);
  process.exit(1);
}
console.log("\nP0 TX BEHAVIOR PASS");
