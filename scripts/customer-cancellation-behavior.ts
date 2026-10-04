/**
 * Customer cancellation intent — no database.
 */
import type { ConversationState } from "../src/lib/concierge-store";
import { detectCustomerCancellationIntent } from "../src/lib/concierge/cancellation-intent";
import { detectFullConversationReset } from "../src/lib/concierge/conversation-reset";
import { classifyCancellationReason } from "../src/lib/concierge/cancellation-intent";
import { detectConversationTransition } from "../src/lib/concierge/service-transition";
import { detectServices } from "../src/lib/concierge/playbook-engine";
import { resolvePrimaryFromMessage } from "../src/lib/concierge/service-intent";
import { detectNewTransactionSignal } from "../src/lib/concierge-transaction";
import { classifyExistingRequestOperation, serviceAfterNewRequestOperator } from "../src/lib/concierge/existing-request-operation";
import { hasValidServiceIntent } from "../src/lib/concierge/service-request-lifecycle";

function empty(): ConversationState {
  return {
    service: "plumbing",
    problem: "fuga",
    location: "San Francisco",
    name: "Ana",
    phone: "66771122",
    email: "",
    propertyType: "apartment",
    preferredTime: "",
    preferredDate: "",
    intent: "",
    funnelStage: "BOOKED",
    leadTemperature: "WARM",
    photoCount: 0,
    contactStatus: "VALID",
    offeredSlots: [],
    pendingSlot: null,
    appointmentId: "HA-abcd1234",
    awaitingSlotSelection: false,
    slotOfferToken: "",
    activeLeadId: "HS-2026-000125",
    historicalSlotLabels: [],
    humanRequested: false,
    lastAvailabilityAt: "",
    detectedServices: ["plumbing"],
    primaryService: "plumbing",
    secondaryServices: [],
    facts: {},
    urgency: "normal",
    bookingIntent: true,
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

const booked = empty();
const hsOnly = { ...empty(), appointmentId: "", funnelStage: "HANDOFF" };

ok("LANG elimina mis solicitudes", detectCustomerCancellationIntent("elimina mis solicitudes", booked).kind === "CANCEL_REQUEST");
ok("LANG elimina mi solicitud", detectCustomerCancellationIntent("elimina mi solicitud", booked).kind === "CANCEL_REQUEST");
ok("LANG ya no quiero el servicio", detectCustomerCancellationIntent("Ya no quiero el servicio", booked).kind === "CANCEL_REQUEST");
ok("LANG cancela mi solicitud", detectCustomerCancellationIntent("cancela mi solicitud", booked).kind === "CANCEL_REQUEST");
ok("LANG cansela eso", detectCustomerCancellationIntent("cansela la solicitud", hsOnly).kind === "CANCEL_REQUEST");
ok("LANG ya lo resolví", detectCustomerCancellationIntent("Ya resolví el problema, cancela la solicitud", booked).kind === "CANCEL_REQUEST");
ok("LANG conseguí otra persona", detectCustomerCancellationIntent("Conseguí a otra persona, cancela", hsOnly).kind === "CANCEL_REQUEST");
ok("LANG no necesito que vengan", detectCustomerCancellationIntent("Ya no necesito que vengan", booked).kind === "CANCEL_REQUEST");
ok("LANG mejor no vengan", detectCustomerCancellationIntent("Mejor no vengan", booked).kind === "CANCEL_REQUEST");
ok("LANG cancela la cita", detectCustomerCancellationIntent("cancela la cita", booked).kind === "CANCEL_APPOINTMENT_ONLY");
ok("LANG cancela la sita", detectCustomerCancellationIntent("cancela la sita", booked).kind === "CANCEL_APPOINTMENT_ONLY");
ok("LANG keep request", detectCustomerCancellationIntent("No necesito la cita de mañana, pero quiero mantener la solicitud", booked).kind === "CANCEL_APPOINTMENT_ONLY");
ok("LANG reschedule viernes", detectCustomerCancellationIntent("No puedo mañana, mejor el viernes", booked).kind === "RESCHEDULE_APPOINTMENT");
ok("LANG mañana no", detectCustomerCancellationIntent("mañana no", booked).kind === "AMBIGUOUS_TOMORROW");
ok("LANG olvida todo", detectCustomerCancellationIntent("olvida todo", booked).kind === "RESET_CONVERSATION");
ok("LANG reset detector", detectFullConversationReset("olvida todo"));
ok("LANG reset does not match cancel request", !detectFullConversationReset("cancela mi solicitud"));
ok("LANG end chat", detectCustomerCancellationIntent("gracias, eso es todo", booked).kind === "END_CONVERSATION");
ok("LANG delete data", detectCustomerCancellationIntent("Quiero que eliminen todos mis datos personales", booked).kind === "DELETE_DATA_REQUEST");
ok("LANG reject slot", detectCustomerCancellationIntent("no quiero esa hora", booked).kind === "REJECT_SLOT");
ok("LANG mejor pintura", detectCustomerCancellationIntent("Olvidemos la cerradura, mejor necesito pintura", { ...booked, primaryService: "locksmith", service: "locksmith" }).kind === "SWITCH_SERVICE");
ok("LANG mejor cancela servicio", detectCustomerCancellationIntent("Mejor cancela el servicio.", hsOnly).kind === "CANCEL_REQUEST");
ok("LANG bare no", detectCustomerCancellationIntent("no", booked).kind === "NONE");
ok("LANG ya no kiero", detectCustomerCancellationIntent("ya no kiero el servicio", booked).kind === "CANCEL_REQUEST");
ok("LANG multi-fact resolved", detectCustomerCancellationIntent("Ya resolví la fuga, cancela la solicitud y no hace falta que vengan mañana", booked).kind === "CANCEL_REQUEST");
ok("LANG reason resolved", classifyCancellationReason("Ya lo resolví por mi cuenta, cancela").category === "RESOLVED_BY_CUSTOMER");
ok("LANG reason other provider", classifyCancellationReason("Ya conseguí quien lo arreglara, cancela la solicitud").category === "FOUND_OTHER_PROVIDER");
ok("LANG switch not cancel current", detectConversationTransition({ ...booked, primaryService: "locksmith", service: "locksmith" }, "Olvidemos la cerradura, mejor necesito pintura").kind === "SWITCH_SERVICE");
ok("LANG explicit HS extracted", detectCustomerCancellationIntent("Cancela HS-2026-000125", booked).explicitRequestId === "HS-2026-000125");
ok("LANG explicit HS is CANCEL_REQUEST not ambiguous", detectCustomerCancellationIntent("cancela la HS-2026-000125 la otra dejala activa", booked).kind === "CANCEL_REQUEST");
ok("LANG explicit HS keeps folio", detectCustomerCancellationIntent("cancela la HS-2026-000125 la otra dejala activa", booked).explicitRequestId === "HS-2026-000125");

{
  const human = "cancela la HS-2026-000114 la otra dejala activa";
  ok("HUMAN activa is not AC alias", !detectServices(human).includes("ac"));
  ok("HUMAN resolvePrimary not ac", resolvePrimaryFromMessage(human) !== "ac");
  ok("HUMAN existing op cancel", classifyExistingRequestOperation(human).primaryAction === "CANCEL_REQUEST");
  ok("HUMAN blocks create", classifyExistingRequestOperation(human).blocksRequestCreation);
  ok("HUMAN blocks switch", classifyExistingRequestOperation(human).blocksServiceSwitch);
  ok("HUMAN no new transaction", !detectNewTransactionSignal(booked, human, "ac"));
  ok("HUMAN transition not switch", detectConversationTransition(booked, human).kind !== "SWITCH_SERVICE");
  ok("HUMAN no valid create intent", !hasValidServiceIntent({ ...booked, activeLeadId: "" }, human));
}

{
  const multi = "cancela la del aire y créame otra para pintura";
  const op = classifyExistingRequestOperation(multi);
  ok("MULTI cancel action", op.primaryAction === "CANCEL_REQUEST");
  ok("MULTI new operator", op.hasExplicitNewRequestOperator);
  ok("MULTI remainder painting", serviceAfterNewRequestOperator(multi) === "painting");
  ok("MULTI no switch", detectConversationTransition(booked, multi).kind !== "SWITCH_SERVICE");
  ok("MULTI no new tx before cancel", !detectNewTransactionSignal(booked, multi));
}

if (failed) {
  console.error(`\nCANCELLATION INTENT FAILED (${failed})`);
  process.exit(1);
}
console.log("\nCANCELLATION INTENT PASS");
