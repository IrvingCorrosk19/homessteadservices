/**
 * P0 Calendar action execution — behavioral regression.
 * Run: npx tsx scripts/calendar-action-behavior.ts
 */
import {
  BOOKING_INTEGRITY_OFFER,
  askDateForAvailability,
  decideCalendarExecution,
  formatAvailabilityResults,
  hasPendingAvailabilityAction,
  isAffirmativeResponse,
  isAvailabilityOfferText,
  isDirectAvailabilityRequest,
  setPendingAvailabilityAction,
  consumePendingAvailabilityAction,
  shouldBlockAvailabilityOfferLoop,
} from "../src/lib/concierge/calendar-action";
import { enforceBookingIntegrity } from "../src/lib/concierge-integrity";
import type { ConversationState } from "../src/lib/concierge-store";

function empty(): ConversationState {
  return {
    service: "plumbing",
    problem: "fuga",
    location: "Edison Park",
    name: "Irving",
    phone: "+50767676767",
    email: "",
    propertyType: "ph",
    preferredTime: "",
    preferredDate: "2026-08-28",
    intent: "",
    funnelStage: "BOOKING",
    leadTemperature: "WARM",
    photoCount: 0,
    contactStatus: "VALID",
    offeredSlots: [],
    pendingSlot: null,
    appointmentId: "",
    awaitingSlotSelection: false,
    slotOfferToken: "",
    activeLeadId: "HS-2026-000300",
    historicalSlotLabels: [],
    humanRequested: false,
    lastAvailabilityAt: "",
    detectedServices: ["plumbing"],
    primaryService: "plumbing",
    secondaryServices: [],
    facts: { unit: "3A", building: "PH El Cucyo" },
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

let failed = 0;
function ok(name: string, value: boolean) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

ok("affirm si por favor", isAffirmativeResponse("si por favor"));
ok("affirm sí", isAffirmativeResponse("sí"));
ok("affirm dale", isAffirmativeResponse("dale"));
ok("affirm ok", isAffirmativeResponse("ok"));
ok("not affirm long", !isAffirmativeResponse("si por favor mañana a las 5 quiero otra cosa más"));

ok("direct muestrame", isDirectAvailabilityRequest("muestram los horarios"));
ok("direct muestrame accent", isDirectAvailabilityRequest("muéstrame los horarios"));
ok("direct que tienes", isDirectAvailabilityRequest("qué horarios hay"));
ok("offer text integrity", isAvailabilityOfferText(BOOKING_INTEGRITY_OFFER));

{
  let s = setPendingAvailabilityAction(empty());
  ok("pending set", hasPendingAvailabilityAction(s));
  const d = decideCalendarExecution(s, "si por favor", { lastAssistantOffer: true });
  ok("yes please executes", d.execute && d.affirmedPending && d.reason === "pending_affirmed");
  ok("yes please no re-ask date", !d.needDate);
  s = consumePendingAvailabilityAction(s);
  ok("pending consumed", !hasPendingAvailabilityAction(s));
}

{
  const s = empty();
  const d = decideCalendarExecution(s, "muestram los horarios", {
    lastAssistantOffer: true,
  });
  ok("show times executes", d.execute && d.directRequest);
  ok("show times no permission", d.reason === "direct_availability_request");
}

{
  const s = { ...empty(), preferredDate: "" };
  const d = decideCalendarExecution(s, "muéstrame los horarios");
  ok("no date asks once", d.needDate && !d.execute);
  ok("ask date copy", /qu[eé] d[ií]a/i.test(askDateForAvailability()));
}

{
  const s = empty();
  const d = decideCalendarExecution(s, "dale", { lastAssistantOffer: true });
  ok("dale executes", d.execute && d.affirmedPending);
}

{
  const s = empty();
  const d = decideCalendarExecution(s, "ok", { lastAssistantOffer: true });
  ok("ok executes", d.execute);
}

{
  const d = decideCalendarExecution(empty(), "si por favor", { lastAssistantOffer: true });
  ok(
    "loop block after affirm",
    shouldBlockAvailabilityOfferLoop(BOOKING_INTEGRITY_OFFER, d, false),
  );
}

{
  const booked = enforceBookingIntegrity(
    "Tu visita quedó agendada para mañana a las 2.",
    false,
  );
  ok("integrity strips false book", booked.stripped);
  ok("integrity offers pending", booked.offeredPendingAction === true);
  ok("integrity text is offer", isAvailabilityOfferText(booked.text));
}

{
  const slots = [
    { date: "2026-08-28", time: "08:00", label: "vie 8:00 a. m." },
    { date: "2026-08-28", time: "10:00", label: "vie 10:00 a. m." },
    { date: "2026-08-28", time: "14:00", label: "vie 2:00 p. m." },
  ];
  const msg = formatAvailabilityResults(slots, "2026-08-28");
  ok("format has times", /8:00|10:00|2:00|14:00/.test(msg));
  ok("format asks which", /cu[aá]l/i.test(msg));
  ok("format not permission", !isAvailabilityOfferText(msg));
}

{
  // Exact time known → execute still true (engine uses preferredDate+time in whenText)
  const s = { ...empty(), preferredTime: "14:00" };
  const d = decideCalendarExecution(s, "revisa si tienen");
  ok("exact time direct or signal", d.execute || d.directRequest || d.reason.includes("signal") || d.directRequest);
  ok("revisa si tienen is direct", isDirectAvailabilityRequest("revisa si tienen"));
}

console.log(failed ? `\nFAILED: ${failed}` : "\nALL PASS");
process.exit(failed ? 1 : 0);
