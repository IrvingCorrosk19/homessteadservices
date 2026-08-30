/**
 * P1 — schedule phrases must not overwrite confirmed location.
 * Run: npx tsx scripts/location-schedule-guard-behavior.ts
 */
import { applyPackedExtraction } from "../src/lib/concierge/packed-extraction";
import { applyLocationCorrection } from "../src/lib/concierge/playbook-engine";
import {
  isLocationExplicitCorrection,
  isScheduleOrTimeOnlyMessage,
  looksLikeScheduleLocationCandidate,
} from "../src/lib/concierge/schedule-phrases";
import type { ConversationState } from "../src/lib/concierge-store";

function base(): ConversationState {
  return {
    service: "plumbing",
    problem: "Fuga",
    location: "Betania",
    name: "Carlos Pérez",
    phone: "+50761234567",
    email: "",
    propertyType: "ph",
    preferredTime: "14:00",
    preferredDate: "2026-08-31",
    intent: "",
    funnelStage: "BOOKED",
    leadTemperature: "WARM",
    photoCount: 0,
    contactStatus: "VALID",
    offeredSlots: [],
    pendingSlot: { date: "2026-08-31", time: "14:00", label: "2:00 p. m." },
    appointmentId: "HA-TEST-001",
    awaitingSlotSelection: false,
    slotOfferToken: "",
    activeLeadId: "HS-2026-000001",
    historicalSlotLabels: [],
    humanRequested: false,
    lastAvailabilityAt: "",
    detectedServices: ["plumbing"],
    primaryService: "plumbing",
    secondaryServices: [],
    facts: { location: "Betania" },
    urgency: "normal",
    bookingIntent: false,
    bookingStrategy: "",
    bookingSuspended: false,
    questionsAsked: 0,
    humanHandoffRequested: false,
    needsReview: false,
    factConfidence: { location: "EXPLICIT" },
    corrections: [],
  };
}

let failed = 0;
function assert(name: string, value: boolean) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else {
    console.log("PASS", name);
  }
}

const reschedulePhrases = [
  "Perdón, mejor a las 4:00 p. m.",
  "mejor a las 4",
  "mejor mañana",
  "mejor el martes",
  "a las 2",
  "a las 5",
  "cámbiala para las 5",
  "prefiero las 12",
  "puede ser a las 3",
];

for (const phrase of reschedulePhrases) {
  assert(`schedule phrase: ${phrase}`, isScheduleOrTimeOnlyMessage(phrase));
  assert(`not location correction: ${phrase}`, !isLocationExplicitCorrection(phrase));
}

assert("applyLocationCorrection keeps Betania", applyLocationCorrection("Perdón, mejor a las 4:00 p. m.", "Betania") === "Betania");
assert(
  "looksLikeScheduleLocationCandidate mejor a las 4",
  looksLikeScheduleLocationCandidate("mejor a las 4"),
);

const afterReprogram = applyPackedExtraction(base(), "Perdón, mejor a las 4:00 p. m.");
assert("packed extraction preserves Betania", afterReprogram.location === "Betania");
assert("facts.location preserved", afterReprogram.facts?.location === "Betania");

const afterRealCorrection = applyPackedExtraction(base(), "Perdón, estoy en Costa del Este");
assert("explicit location correction updates", afterRealCorrection.location === "Costa del Este");

const afterBetterIn = applyPackedExtraction(base(), "mejor en San Francisco");
assert("mejor en San Francisco updates location", afterBetterIn.location === "San Francisco");

if (failed) {
  console.error(`\nFAILED: ${failed}`);
  process.exit(1);
}
console.log("\nLOCATION SCHEDULE GUARD TESTS PASS");
