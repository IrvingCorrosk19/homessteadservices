/**
 * Isolated regression: pintura → lavamanos mid-confirm → elimina mis solicitudes.
 * Does NOT touch real HS-2026-000123 or live customer data.
 *
 * Run: npx tsx scripts/continuity-intent-cancel-regression.ts
 */
import { detectCustomerCancellationIntent } from "../src/lib/concierge/cancellation-intent";
import {
  cancelConfirmationKeptReply,
  confirmCancelRequestReply,
  deferredNeedAfterBookingReply,
  markPendingCancelConfirmation,
} from "../src/lib/concierge/cancellation-conversation";
import { classifyExistingRequestOperation } from "../src/lib/concierge/existing-request-operation";
import { resolvePrimaryFromMessage } from "../src/lib/concierge/service-intent";
import { detectConversationTransition } from "../src/lib/concierge/service-transition";
import { interpretTurnRoute } from "../src/lib/concierge-turn-routing";
import { resolveShortReplyIntent } from "../src/lib/concierge/affirmative-context";
import { extractServiceNeeds } from "../src/lib/concierge/multi-service-needs";
import type { ConversationState } from "../src/lib/concierge-store";

let failed = 0;
function ok(name: string, value: boolean, detail = "") {
  if (!value) {
    failed += 1;
    console.error("FAIL", name, detail);
  } else console.log("PASS", name);
}

function paintBooked(): ConversationState {
  return {
    service: "painting",
    problem: "pintura habitación",
    location: "Bethania",
    name: "Regression Cliente",
    phone: "60001122",
    email: "",
    propertyType: "house",
    preferredTime: "12:00",
    preferredDate: "2026-10-04",
    intent: "",
    funnelStage: "BOOKED",
    leadTemperature: "WARM",
    photoCount: 0,
    contactStatus: "VALID",
    offeredSlots: [],
    pendingSlot: { date: "2026-10-04", time: "12:00", label: "sábado 12:00 p. m." },
    appointmentId: "HA-REGRESSION-PAINT",
    awaitingSlotSelection: false,
    slotOfferToken: "",
    activeLeadId: "HS-REGRESSION-000001",
    historicalSlotLabels: [],
    humanRequested: false,
    lastAvailabilityAt: new Date().toISOString(),
    detectedServices: ["painting"],
    primaryService: "painting",
    secondaryServices: [],
    facts: {},
    urgency: "normal",
    bookingIntent: true,
    bookingStrategy: "DIRECT_BOOKING",
    bookingSuspended: false,
    questionsAsked: 0,
    humanHandoffRequested: false,
    needsReview: false,
    factConfidence: {},
    corrections: [],
  };
}

function paintPendingConfirm(): ConversationState {
  return {
    ...paintBooked(),
    appointmentId: "",
    funnelStage: "HANDOFF",
    awaitingSlotSelection: false,
  };
}

const lavamanos = "tengo un problea con mi lava manos";

ok("lavamanos resolves plumbing", resolvePrimaryFromMessage(lavamanos) === "plumbing");
ok(
  "multi-need extracts plumbing",
  extractServiceNeeds(lavamanos).some((n) => n.serviceType === "plumbing"),
);

{
  const t = detectConversationTransition(paintPendingConfirm(), lavamanos);
  ok("mid-confirm ADD not SWITCH", t.kind === "ADD_ANOTHER_SERVICE", t.kind);
  ok("keeps painting as previous", t.previousService === "painting");
  ok("next is plumbing", t.nextService === "plumbing");
}

{
  const t = detectConversationTransition(paintBooked(), lavamanos);
  ok("after booking ADD not SWITCH", t.kind === "ADD_ANOTHER_SERVICE", t.kind);
}

{
  const route = interpretTurnRoute(lavamanos, paintPendingConfirm());
  ok("route newNeed mid-confirm", route.newNeedIntent);
  ok("route interruption mid-confirm", route.isInterruption);
}

{
  const reply = deferredNeedAfterBookingReply({
    serviceLabel: "Pintura",
    when: "sábado 4 de octubre a las 12:00 p. m.",
    deferredService: "plumbing",
    deferredSummary: lavamanos,
  });
  ok("ack painting + ask lavamanos", /pintura.*confirmada/i.test(reply) && /lavamanos/i.test(reply), reply);
  ok("asks fuga/tapado", /fuga|tapado/i.test(reply));
}

{
  const elimina = "elimina mis solicitudes";
  ok(
    "elimina plural is CANCEL_REQUEST",
    detectCustomerCancellationIntent(elimina, paintBooked()).kind === "CANCEL_REQUEST",
  );
  ok(
    "elimina plural existing op cancel",
    classifyExistingRequestOperation(elimina).primaryAction === "CANCEL_REQUEST",
  );
  ok(
    "elimina plural not CHECK_STATUS",
    classifyExistingRequestOperation(elimina).primaryAction !== "CHECK_STATUS",
  );
}

{
  const confirm = confirmCancelRequestReply({
    serviceLabel: "Pintura",
    publicId: "HS-REGRESSION-000001",
    when: "sábado 12:00 p. m.",
  });
  ok("confirm asks explícito", /confirmas que quieres cancelar/i.test(confirm), confirm);
  ok("confirm has folio", /HS-REGRESSION-000001/.test(confirm));
  ok("confirm has when", /12:00/.test(confirm));

  let state = markPendingCancelConfirmation(paintBooked(), ["HS-REGRESSION-000001"], confirm, "ONE");
  ok("pending action bound", state.facts?.pendingAction === "CONFIRM_CANCEL_REQUEST");
  ok("pending ids bound", state.facts?.pendingCancelRequestIds === "HS-REGRESSION-000001");

  ok("sí → CONFIRM_CANCEL", resolveShortReplyIntent("sí", state) === "CONFIRM_CANCEL");
  ok("no → PRESERVE", resolveShortReplyIntent("no", state) === "PRESERVE_APPOINTMENT");
  ok("kept reply natural", /mantengo tu solicitud/i.test(cancelConfirmationKeptReply()));
}

if (failed) {
  console.error(`\nCONTINUITY REGRESSION FAILED (${failed})`);
  process.exit(1);
}
console.log("\nCONTINUITY INTENT/CANCEL REGRESSION PASS");
