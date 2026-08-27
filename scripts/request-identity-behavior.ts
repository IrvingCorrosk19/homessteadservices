/**
 * P0 Request Identity & Extraction — behavioral regression.
 * Run: npx tsx scripts/request-identity-behavior.ts
 */
import { applyPackedExtraction } from "../src/lib/concierge/packed-extraction";
import { mergeParsedWhen } from "../src/lib/concierge-tools";
import { isValidPersonName } from "../src/lib/concierge/canonical-state";
import { parseNaturalDateTime } from "../src/lib/concierge-datetime";
import { hasRequestedExactWhen } from "../src/lib/concierge/appointment-readiness";
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

const msg1 =
  "Hola buena, necesito me repares y me den manteniento de pintura en mi casa en edison park mi nomnre es irving corro, casa 34 en la esquina llamame al 67676767";

let s1 = turn(empty(), msg1);
ok("R1 service painting or repairs", (s1.primaryService || s1.service) === "painting" || (s1.primaryService || s1.service) === "repairs");
ok("R1 property house", s1.propertyType === "house");
ok("R1 location Edison", /edison/i.test(s1.location));
ok("R1 unit 34", (s1.facts?.unit || "") === "34");
ok("R1 reference esquina", /esquina/i.test(s1.facts?.reference || ""));
ok("R1 name Irving", /irving/i.test(s1.name) && !/esquina|llamame/i.test(s1.name));
ok("R1 name valid", isValidPersonName(s1.name));
ok("R1 phone valid", s1.contactStatus === "VALID");
ok("R1 bad name rejected", !isValidPersonName("esquina llamame al"));

s1 = { ...s1, activeLeadId: "HS-2026-000102" };
const msg2 = "manana a las 5 de la tarde";
const parsed2 = parseNaturalDateTime(msg2);
ok("R2 date parsed", Boolean(parsed2.date));
ok("R2 time 17:00", parsed2.time === "17:00");

let s2 = turn(s1, msg2);
ok("R2 activeLeadId preserved", s2.activeLeadId === "HS-2026-000102");
ok("R2 name still Irving", /irving/i.test(s2.name));
ok("R2 hasRequestedExactWhen", hasRequestedExactWhen(s2));

// Service refinement must NOT clear activeLeadId
let sRef = turn({ ...empty(), activeLeadId: "HS-2026-000001", primaryService: "repairs", service: "repairs" }, "Es pintura.");
ok("R3 service refined", (sRef.primaryService || sRef.service) === "painting");
ok("R3 activeLeadId preserved on refinement", sRef.activeLeadId === "HS-2026-000001");
ok("R3 serviceRefinedFrom tracked", sRef.facts?.serviceRefinedFrom === "repairs");

ok("R4 typo mi nomnre es", /irving/i.test(applyPackedExtraction(empty(), "mi nomnre es irving corro").name));
ok("R5 me llamo", /irving/i.test(applyPackedExtraction(empty(), "me llamo irving corro").name));
ok(
  "R6 name boundary",
  applyPackedExtraction(empty(), "mi nombre es Irving Corro casa 34 en la esquina llamame al 67676767").name ===
    "Irving Corro",
);

console.log(failed ? `\nFAILED: ${failed}` : "\nALL PASS");
process.exit(failed ? 1 : 0);
