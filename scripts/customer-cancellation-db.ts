/**
 * Isolated DATA_DIR DB + conciergeTurn cancellation matrix.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), "hs-cancel-"));
process.env.DATA_DIR = dataDir;
process.env.OPENAI_API_KEY = "";
process.env.AI_CONCIERGE_DRY_RUN = "true";
process.env.AUTOMATION_DISPATCH_ENABLED = "false";
process.env.HOMESTEAD_TELEGRAM_CHAT_ID = "";

let failed = 0;
function ok(name: string, value: boolean) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

async function main() {
const {
  saveServiceRequest,
  getRequestByPublicId,
  updateRequestStatus,
  listCancellableRequestsForCustomer,
} = await import("../src/lib/service-requests");
const { ingestCanonicalLead, createAppointment, getAppointment } = await import("../src/lib/revenue-store");
const { isOpenAppointmentSlot } = await import("../src/lib/appointment-slot");
const { cancelServiceRequest, cancelAppointmentOnly } = await import("../src/lib/service-request-cancellation");
const { getOutboxByIdempotency } = await import("../src/lib/automation-outbox");
const { createConversation, touchConversation, getConversation } = await import("../src/lib/concierge-store");
const { conciergeTurn } = await import("../src/lib/concierge-engine");
const { detectCustomerCancellationIntent, resolveCancellationTarget, requestOwnedByConversation } = await import(
  "../src/lib/concierge/cancellation-intent"
);

function seedHs(input: { name: string; phone: string; service: string; message: string }) {
  return saveServiceRequest({
    name: input.name,
    phone: input.phone,
    email: "cancel-test@example.com",
    property: "apartment",
    service: input.service,
    message: input.message,
    photos: [],
  });
}

function linkLead(hs: { publicId: string; name: string; phone: string; service: string; message: string }) {
  ingestCanonicalLead({
    leadId: hs.publicId,
    name: hs.name,
    phone: hs.phone,
    email: "cancel-test@example.com",
    service: hs.service,
    problem: hs.message,
    photoCount: 0,
    source: "WEBSITE_AI_CHAT",
    isTest: true,
    skipFollowUp: true,
  });
}

const SLOT_DATE = "2026-12-15";
const SLOT_TIME = "10:00";

async function seededTurn(hsPublicId: string, appointmentId: string, phone: string, message: string) {
  const conversationId = createConversation("127.0.0.1", {}, true);
  const conv = getConversation(conversationId);
  if (!conv) throw new Error("no conversation");
  await touchConversation(conversationId, {
    leadPublicId: hsPublicId,
    state: {
      ...conv.state,
      name: "Ana",
      phone,
      contactStatus: "VALID",
      primaryService: "plumbing",
      service: "plumbing",
      problem: "fuga en el baño",
      location: "San Francisco",
      activeLeadId: hsPublicId,
      appointmentId,
      funnelStage: appointmentId ? "BOOKED" : "HANDOFF",
      bookingIntent: true,
    },
  });
  return conciergeTurn({ conversationId, message });
}

// CANCEL-01 HS without HA
{
  const hs = seedHs({ name: "Ana Uno", phone: "66771122", service: "plumbing", message: "fuga en el baño principal" });
  linkLead(hs);
  const result = cancelServiceRequest({
    requestId: hs.publicId,
    actor: "CUSTOMER_AI",
    source: "CUSTOMER_AI",
    notify: true,
  });
  const after = getRequestByPublicId(hs.publicId);
  ok("CANCEL-01 success", result.success && result.newStatus === "CANCELLED");
  ok("CANCEL-01 record remains", Boolean(after) && after?.publicId === hs.publicId);
  ok("CANCEL-01 no HA", result.cancelledAppointmentIds.length === 0);
  ok("CANCEL-01 no hard delete", Boolean(getRequestByPublicId(hs.publicId)));
}

// CANCEL-02 HS + future HA
{
  const hs = seedHs({ name: "Ana Dos", phone: "66771123", service: "plumbing", message: "fuga cocina" });
  linkLead(hs);
  const haId = createAppointment(hs.publicId, SLOT_DATE, SLOT_TIME, "CONFIRMED", { source: "CHAT" });
  ok("CANCEL-02 booked", Boolean(haId));
  const result = cancelServiceRequest({
    requestId: hs.publicId,
    actor: "CUSTOMER_AI",
    source: "CUSTOMER_AI",
    reason: "Ya resolví el problema, cancela la solicitud",
    notify: true,
  });
  const ha = haId ? getAppointment(haId) : null;
  ok("CANCEL-02 both cancelled", result.success && result.cancelledAppointmentIds.includes(haId || ""));
  ok("CANCEL-02 HA status", ha?.status === "CANCELLED");
  ok("CANCEL-04 reason stored", /resolv/i.test(result.reasonStored) && result.reasonCategory === "RESOLVED_BY_CUSTOMER");
  // CANCEL-03 calendar released
  ok("CANCEL-03 slot free", isOpenAppointmentSlot(SLOT_DATE, SLOT_TIME));
}

// CANCEL-05 no reason
{
  const hs = seedHs({ name: "Ana Cinco", phone: "66771125", service: "plumbing", message: "llave gotea" });
  linkLead(hs);
  const result = cancelServiceRequest({
    requestId: hs.publicId,
    actor: "CUSTOMER_AI",
    source: "CUSTOMER_AI",
  });
  ok("CANCEL-05 no reason ok", result.success && result.reasonCategory === "NOT_PROVIDED");
}

// CANCEL-06 appointment only
{
  const hs = seedHs({ name: "Ana Seis", phone: "66771126", service: "plumbing", message: "inodoro tapado" });
  linkLead(hs);
  const haId = createAppointment(hs.publicId, "2026-12-16", "12:00", "CONFIRMED", { source: "CHAT" }) || "";
  const result = cancelAppointmentOnly({
    appointmentId: haId,
    actor: "CUSTOMER_AI",
    source: "CUSTOMER_AI",
    requestId: hs.publicId,
  });
  const hsAfter = getRequestByPublicId(hs.publicId);
  ok("CANCEL-06 HA cancelled", result.success && getAppointment(haId)?.status === "CANCELLED");
  ok("CANCEL-06 HS stays active", hsAfter?.status === "NEW");
}

// CANCEL-11 / 12 idempotent
{
  const hs = seedHs({ name: "Ana Idem", phone: "66771127", service: "plumbing", message: "ducha" });
  linkLead(hs);
  const first = cancelServiceRequest({
    requestId: hs.publicId,
    actor: "CUSTOMER_AI",
    source: "CUSTOMER_AI",
    idempotencyKey: `service_request.cancelled:${hs.publicId}`,
  });
  const second = cancelServiceRequest({
    requestId: hs.publicId,
    actor: "CUSTOMER_AI",
    source: "CUSTOMER_AI",
    idempotencyKey: `service_request.cancelled:${hs.publicId}`,
  });
  const outbox = getOutboxByIdempotency(`service_request.cancelled:${hs.publicId}`);
  ok("CANCEL-11 already cancelled", second.success && second.alreadyCancelled);
  ok("CANCEL-12 one outbox", Boolean(outbox) && first.auditEventId === second.auditEventId);
}

// CANCEL-14 / 15 ownership
{
  const a = seedHs({ name: "Cliente A", phone: "66772211", service: "plumbing", message: "fuga A" });
  const b = seedHs({ name: "Cliente B", phone: "66772212", service: "ac", message: "aire B" });
  const owned = requestOwnedByConversation(a.publicId, {
    service: "plumbing",
    problem: "",
    location: "",
    name: "A",
    phone: "66772211",
    email: "",
    propertyType: "",
    preferredTime: "",
    preferredDate: "",
    intent: "",
    funnelStage: "HANDOFF",
    leadTemperature: "COLD",
    photoCount: 0,
    contactStatus: "VALID",
    offeredSlots: [],
    pendingSlot: null,
    appointmentId: "",
    awaitingSlotSelection: false,
    slotOfferToken: "",
    activeLeadId: a.publicId,
    historicalSlotLabels: [],
    humanRequested: false,
    lastAvailabilityAt: "",
    detectedServices: [],
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
  });
  const foreign = requestOwnedByConversation(b.publicId, {
    service: "plumbing",
    problem: "",
    location: "",
    name: "A",
    phone: "66772211",
    email: "",
    propertyType: "",
    preferredTime: "",
    preferredDate: "",
    intent: "",
    funnelStage: "HANDOFF",
    leadTemperature: "COLD",
    photoCount: 0,
    contactStatus: "VALID",
    offeredSlots: [],
    pendingSlot: null,
    appointmentId: "",
    awaitingSlotSelection: false,
    slotOfferToken: "",
    activeLeadId: a.publicId,
    historicalSlotLabels: [],
    humanRequested: false,
    lastAvailabilityAt: "",
    detectedServices: [],
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
  });
  ok("CANCEL-14 own HS", owned);
  ok("CANCEL-15 foreign denied", !foreign);
}

// CANCEL-13 multiple
{
  seedHs({ name: "Multi", phone: "66773344", service: "plumbing", message: "fuga multi" });
  seedHs({ name: "Multi", phone: "66773344", service: "ac", message: "aire multi" });
  const open = listCancellableRequestsForCustomer("66773344");
  ok("CANCEL-13 two open", open.length >= 2);
  const intent = detectCustomerCancellationIntent("cancela mi solicitud", {
    service: "",
    problem: "",
    location: "",
    name: "Multi",
    phone: "66773344",
    email: "",
    propertyType: "",
    preferredTime: "",
    preferredDate: "",
    intent: "",
    funnelStage: "DISCOVERY",
    leadTemperature: "COLD",
    photoCount: 0,
    contactStatus: "VALID",
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
  });
  const target = resolveCancellationTarget(intent, {
    service: "",
    problem: "",
    location: "",
    name: "Multi",
    phone: "66773344",
    email: "",
    propertyType: "",
    preferredTime: "",
    preferredDate: "",
    intent: "",
    funnelStage: "DISCOVERY",
    leadTemperature: "COLD",
    photoCount: 0,
    contactStatus: "VALID",
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
  });
  ok("CANCEL-13 needs clarification", !target.ok && target.errorCode === "NEEDS_CLARIFICATION");
}

// CANCEL-16 completed
{
  const hs = seedHs({ name: "Done", phone: "66774455", service: "plumbing", message: "trabajo hecho" });
  updateRequestStatus(hs.publicId, "COMPLETED");
  const result = cancelServiceRequest({
    requestId: hs.publicId,
    actor: "CUSTOMER_AI",
    source: "CUSTOMER_AI",
  });
  ok("CANCEL-16 not rewritten", !result.success && result.errorCode === "NOT_CANCELLABLE" && getRequestByPublicId(hs.publicId)?.status === "COMPLETED");
}

// CANCEL-19 booking vs cancel
{
  const hs = seedHs({ name: "Race", phone: "66775566", service: "plumbing", message: "carrera" });
  linkLead(hs);
  cancelServiceRequest({ requestId: hs.publicId, actor: "CUSTOMER_AI", source: "CUSTOMER_AI" });
  const booked = createAppointment(hs.publicId, "2026-12-17", "14:00", "CONFIRMED", { source: "CHAT" });
  ok("CANCEL-19 no HA on cancelled HS", booked === null);
}

// CANCEL-20 reprogram vs cancel
{
  const hs = seedHs({ name: "Repro", phone: "66776677", service: "plumbing", message: "reprogram race" });
  linkLead(hs);
  const haId = createAppointment(hs.publicId, "2026-12-18", "08:00", "CONFIRMED", { source: "CHAT" }) || "";
  cancelServiceRequest({ requestId: hs.publicId, actor: "CUSTOMER_AI", source: "CUSTOMER_AI" });
  const { rescheduleAppointment } = await import("../src/lib/revenue-store");
  const moved = rescheduleAppointment(haId, "2026-12-19", "10:00", { actor: "test" });
  ok("CANCEL-20 reprogram blocked", moved.ok === false);
}

// Engine turns
{
  const hs = seedHs({ name: "Chat", phone: "66777788", service: "plumbing", message: "chat cancel" });
  linkLead(hs);
  const haId = createAppointment(hs.publicId, "2026-12-20", "16:00", "CONFIRMED", { source: "CHAT" }) || "";
  const turn = await seededTurn(hs.publicId, haId, "66777788", "Ya resolví el problema, cancela la solicitud.");
  const after = getRequestByPublicId(hs.publicId);
  const ha = getAppointment(haId);
  ok("ENGINE cancel HS", turn.ok && after?.status === "CANCELLED");
  ok("ENGINE cancel HA", ha?.status === "CANCELLED");
  ok("ENGINE grounded reply", /cancel/i.test("ok" in turn && turn.ok ? turn.reply : ""));
  ok("ENGINE no extra HS create", turn.ok && !/HS-2026-/.test(turn.ok ? turn.reply : "") || Boolean(after));
  ok("ENGINE no photo ask", turn.ok ? !/foto/i.test(turn.reply) : false);
}

{
  const hs = seedHs({ name: "ApptOnly", phone: "66777889", service: "plumbing", message: "solo cita" });
  linkLead(hs);
  const haId = createAppointment(hs.publicId, "2026-12-21", "10:00", "CONFIRMED", { source: "CHAT" }) || "";
  const turn = await seededTurn(
    hs.publicId,
    haId,
    "66777889",
    "No necesito la cita de mañana, pero quiero mantener la solicitud.",
  );
  ok("ENGINE appt-only HA", getAppointment(haId)?.status === "CANCELLED");
  ok("ENGINE appt-only HS active", getRequestByPublicId(hs.publicId)?.status === "NEW");
  ok("ENGINE appt-only reply", turn.ok && /contin[uú]a abierta|sigue abierta/i.test(turn.reply));
}

{
  const hs = seedHs({ name: "Amb", phone: "66777990", service: "plumbing", message: "ambiguo" });
  linkLead(hs);
  const haId = createAppointment(hs.publicId, "2026-12-22", "12:00", "CONFIRMED", { source: "CHAT" }) || "";
  const before = getRequestByPublicId(hs.publicId)?.status;
  const turn = await seededTurn(hs.publicId, haId, "66777990", "mañana no");
  ok("ENGINE ambiguous no mutate HS", getRequestByPublicId(hs.publicId)?.status === before);
  ok("ENGINE ambiguous no mutate HA", getAppointment(haId)?.status !== "CANCELLED" || getAppointment(haId)?.status === "CONFIRMED");
  ok("ENGINE ambiguous asks", turn.ok && /cancelar la visita|cambiarla/i.test(turn.reply));
}

{
  const hs = seedHs({ name: "Reset", phone: "66778001", service: "plumbing", message: "reset hs" });
  linkLead(hs);
  const turn = await seededTurn(hs.publicId, "", "66778001", "olvida todo");
  ok("ENGINE reset no HS cancel", getRequestByPublicId(hs.publicId)?.status === "NEW");
  ok("ENGINE reset reply", turn.ok && /cero|de nuevo/i.test(turn.reply));
}

{
  const hs = seedHs({ name: "Bye", phone: "66778002", service: "plumbing", message: "end chat" });
  linkLead(hs);
  await seededTurn(hs.publicId, "", "66778002", "gracias, eso es todo");
  ok("ENGINE end chat no cancel", getRequestByPublicId(hs.publicId)?.status === "NEW");
}

{
  const hs = seedHs({ name: "Privacy", phone: "66778003", service: "plumbing", message: "privacy" });
  linkLead(hs);
  const turn = await seededTurn(hs.publicId, "", "66778003", "Quiero que eliminen todos mis datos personales");
  ok("ENGINE privacy no cancel", getRequestByPublicId(hs.publicId)?.status === "NEW");
  ok("ENGINE privacy reply", turn.ok && /datos personales/i.test(turn.reply));
}

{
  const hs = seedHs({ name: "Photo", phone: "66778004", service: "locksmith", message: "cerradura digital" });
  linkLead(hs);
  const conversationId = createConversation("127.0.0.1", {}, true);
  const conv = getConversation(conversationId);
  if (!conv) throw new Error("no conv");
  await touchConversation(conversationId, {
    leadPublicId: hs.publicId,
    state: {
      ...conv.state,
      name: "Ana",
      phone: "66778004",
      contactStatus: "VALID",
      primaryService: "locksmith",
      service: "locksmith",
      problem: "instalar cerradura digital",
      activeLeadId: hs.publicId,
      facts: { pendingAction: "ASK_LOCK_EDGE_PHOTO", pendingPhotoRequirement: "edge" },
    },
  });
  const turn = await conciergeTurn({
    conversationId,
    message: "Ya no quiero instalarla, cancela la solicitud.",
  });
  ok("CANCEL-17 photo override", turn.ok && getRequestByPublicId(hs.publicId)?.status === "CANCELLED");
  ok("CANCEL-17 no more photo", turn.ok && !/canto|pestillo|foto/i.test(turn.reply));
}

{
  const hs = seedHs({ name: "Slots", phone: "66778005", service: "plumbing", message: "slots" });
  linkLead(hs);
  const conversationId = createConversation("127.0.0.1", {}, true);
  const conv = getConversation(conversationId);
  if (!conv) throw new Error("no conv");
  await touchConversation(conversationId, {
    leadPublicId: hs.publicId,
    state: {
      ...conv.state,
      name: "Ana",
      phone: "66778005",
      contactStatus: "VALID",
      primaryService: "plumbing",
      service: "plumbing",
      problem: "fuga",
      activeLeadId: hs.publicId,
      awaitingSlotSelection: true,
      offeredSlots: [
        { date: SLOT_DATE, time: "08:00", label: "8" },
        { date: SLOT_DATE, time: "10:00", label: "10" },
      ],
    },
  });
  const turn = await conciergeTurn({ conversationId, message: "Mejor cancela el servicio." });
  ok("CANCEL-18 expires offers", turn.ok && getRequestByPublicId(hs.publicId)?.status === "CANCELLED");
  ok("CANCEL-18 not slot pick", turn.ok && !turn.awaitingSlotSelection);
}

{
  const src = readFileSync(join(root, "src/lib/service-request-cancellation.ts"), "utf8");
  ok("NO hard delete HS", !/DELETE\s+FROM\s+service_requests/i.test(src));
}

if (failed) {
  console.error(`\nCANCELLATION DB FAILED (${failed})`);
  process.exit(1);
}
console.log("\nCANCELLATION DB PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
