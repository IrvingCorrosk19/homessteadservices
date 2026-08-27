/**
 * P0 REPRODUCTION ONLY — Case A + Case B against real modules.
 * Run: npx tsx scripts/repro-p0-tx.ts
 */
import { applyPackedExtraction } from "../src/lib/concierge/packed-extraction";
import { mergeParsedWhen } from "../src/lib/concierge-tools";
import {
  getAppointmentReadiness,
  isLocationSufficient,
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

function turn(state: ConversationState, text: string) {
  return mergeParsedWhen(applyPackedExtraction(state, text), text);
}

function snap(label: string, state: ConversationState, text: string) {
  const readiness = getAppointmentReadiness(state);
  const next = determineNextAction(state);
  const out = {
    label,
    RAW: text,
    service: state.primaryService || state.service,
    location: state.location,
    building: state.facts?.building,
    unit: state.facts?.unit,
    units: state.facts?.units,
    name: state.name,
    phone: state.phone,
    contact: state.contactStatus,
    preferredDate: state.preferredDate,
    preferredTime: state.preferredTime,
    pendingSlot: state.pendingSlot,
    slotConfirmed: isSlotConfirmed(state),
    offered: (state.offeredSlots || []).map((s) => s.time),
    locationOk: isLocationSufficient(state),
    missing: readiness.missingFields,
    nextAction: next.action,
    askField: next.askField,
    canned: next.cannedQuestion,
  };
  console.log(JSON.stringify(out, null, 2));
  console.log("---");
  return out;
}

console.log("======== CASE B — SINGLE MESSAGE ========");
const msgB =
  "tengo un problema de aire acondicionado estoy en edison park apartamento 3 a, es mantenimiento y requiero la solicitud para mañana a las 2 pm irving corro 65656565";
console.log("parseNaturalDateTime", parseNaturalDateTime(msgB));
console.log("parseClock", parseClock(msgB));
let b = turn(empty(), msgB);
const caseB = snap("CASE_B", b, msgB);

console.log("======== CASE A — MULTI TURN ========");
let a = empty();
const turnsA = [
  "Necesito reparación y mantenimiento de aire acondicionado",
  "Panama centro edison park",
  "2",
  "ph el mare 3000",
  "65653455",
  "puedes el viernes",
  "Me sirve 2:00 p. m.",
  "irving corro",
];
const logA: ReturnType<typeof snap>[] = [];
for (const t of turnsA) {
  if (t === "2") {
    a.facts = {
      ...a.facts,
      lastAskedField: "units",
      lastBotQuestion: "¿Cuántos aires debemos revisar?",
    };
  }
  if (t === "irving corro") {
    a.facts = {
      ...a.facts,
      lastAskedField: "customer_name",
      lastBotQuestion: "¿A nombre de quién coordinamos?",
    };
  }
  a = turn(a, t);
  if (/viernes/i.test(t)) {
    const date = a.preferredDate || "2026-08-28";
    a.offeredSlots = [
      { date, time: "08:00", label: "8:00 a. m." },
      { date, time: "10:00", label: "10:00 a. m." },
      { date, time: "12:00", label: "12:00 p. m." },
      { date, time: "14:00", label: "2:00 p. m." },
    ];
    a.awaitingSlotSelection = true;
    a.lastAvailabilityAt = new Date().toISOString();
  }
  if (/me sirve/i.test(t)) {
    const matched = resolveSlotFromMessage(t, a.offeredSlots, a.preferredDate);
    console.log("SLOT_MATCH", matched);
    if (matched) a = lockSelectedSlot(a, matched);
  }
  logA.push(snap(`A:${t.slice(0, 36)}`, a, t));
}

const finalA = logA[logA.length - 1];
const flags = {
  BUG_B_ASKS_DATE_TIME:
    caseB.nextAction === "ASK_SLOT_SELECTION" || /d[ií]a y hora/i.test(caseB.canned || ""),
  BUG_B_SLOT_MISSING_WITH_DATETIME: Boolean(
    caseB.preferredDate && caseB.preferredTime && caseB.missing.includes("slot"),
  ),
  BUG_B_NAME_MISSING: !caseB.name,
  BUG_B_PHONE_OK: caseB.contact === "VALID",
  BUG_B_LOCATION_OK: /edison/i.test(caseB.location || ""),
  BUG_B_UNIT: caseB.unit || null,
  BUG_A_FINAL_ACTION: finalA.nextAction,
  BUG_A_ASKS_LOCATION: finalA.askField === "location" || finalA.nextAction === "ASK_LOCATION",
  BUG_A_ASKS_SLOT: finalA.nextAction === "ASK_SLOT_SELECTION",
  BUG_A_READY: finalA.nextAction === "CONFIRM_OR_BOOK",
  BUG_A_SLOT_CONFIRMED: finalA.slotConfirmed,
  BUG_A_LOCATION: finalA.location,
  BUG_A_UNIT: finalA.unit,
};
console.log("======== BUG FLAGS ========");
console.log(JSON.stringify(flags, null, 2));
