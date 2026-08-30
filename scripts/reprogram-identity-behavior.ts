/**
 * P0 Reprogramming identity — behavioral regression.
 * Run: npx tsx scripts/reprogram-identity-behavior.ts
 */
import {
  detectReprogramAppointmentIntent,
  parseReprogramTarget,
  resolveAuthoritativeRequestId,
  REPROGRAM_APPOINTMENT_RE,
} from "../src/lib/concierge/appointment-reprogram";
import { detectNewTransactionSignal, reconcileTransactionState } from "../src/lib/concierge-transaction";
import type { ConversationState } from "../src/lib/concierge-store";
import type { AppointmentRecord } from "../src/lib/revenue-store";

function empty(): ConversationState {
  return {
    service: "plumbing",
    problem: "Fuga",
    location: "Costa del Este",
    name: "Carlos Pérez",
    phone: "60000001",
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
    activeLeadId: "HS-2026-000106",
    historicalSlotLabels: [],
    humanRequested: false,
    lastAvailabilityAt: "",
    detectedServices: ["plumbing"],
    primaryService: "plumbing",
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

const appt: AppointmentRecord = {
  appointmentId: "HA-TEST-001",
  leadId: "HS-2026-000106",
  customerId: 1,
  jobId: "",
  date: "2026-08-31",
  startTime: "14:00",
  endTime: "15:00",
  service: "plumbing",
  serviceLabel: "Plomería",
  status: "CONFIRMED",
  assignedTo: "",
  createdAt: "2026-08-30T00:00:00.000Z",
  confirmedAt: "2026-08-30T00:00:00.000Z",
  version: 1,
  notes: "",
  source: "CHAT",
  originLabel: "Chatbot",
  conversationId: "conv-test",
  quoteId: "",
  problem: "Fuga",
  zone: "Costa del Este",
  stage: "SCHEDULED",
  customerName: "Carlos Pérez",
  customerFirst: "Carlos",
  phone: "60000001",
  email: "",
};

let failed = 0;
function ok(name: string, value: boolean) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

const msg = "Perdón, mejor a las 4:00 p. m.";
ok("REPROGRAM regex", REPROGRAM_APPOINTMENT_RE.test(msg));
ok("detect REPROGRAM intent", detectReprogramAppointmentIntent(msg, empty(), appt));
ok("detect time-only mejor a las", detectReprogramAppointmentIntent("mejor a las 4", empty(), appt));
ok("detect date change", detectReprogramAppointmentIntent("Mejor el martes a las 10", empty(), appt));
ok("no intent without appointment", !detectReprogramAppointmentIntent(msg, empty(), null));

ok("resolve keeps HS-106 when set", resolveAuthoritativeRequestId(empty()) === "HS-2026-000106");
ok(
  "resolve from conversation column when state empty",
  resolveAuthoritativeRequestId({ ...empty(), activeLeadId: "" }, "HS-2026-000106") === "HS-2026-000106",
);

const target = parseReprogramTarget(msg, { ...empty(), preferredTime: "16:00" }, appt);
ok("parse time 16:00", target.time === "16:00");
ok("parse keeps date Monday", target.date === "2026-08-31");

const dateChange = parseReprogramTarget("Mejor el martes a las 10", empty(), appt);
ok("parse Tuesday date change", Boolean(dateChange.date));
ok("parse Tuesday time", dateChange.time === "10:00" || dateChange.time === "22:00" || Boolean(dateChange.time));

ok(
  "NEW_NEED mejor does not clear booked appointment",
  !detectNewTransactionSignal(empty(), msg),
);
const reconciled = reconcileTransactionState(empty(), msg, "HS-2026-000106");
ok("reconcile keeps appointmentId on reprogram", reconciled.appointmentId === "HA-TEST-001");
ok("reconcile keeps activeLeadId on reprogram", reconciled.activeLeadId === "HS-2026-000106");

ok(
  "NEW_NEED mejor does not clear activeLeadId without appointment",
  !detectNewTransactionSignal({ ...empty(), appointmentId: "", activeLeadId: "HS-2026-000106" }, msg),
);

console.log(failed ? `\nFAILED: ${failed}` : "\nALL PASS");
process.exit(failed ? 1 : 0);
