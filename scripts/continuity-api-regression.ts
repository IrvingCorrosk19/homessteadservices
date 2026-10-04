/**
 * Isolated API regression: pintura → horario → lavamanos mid-confirm → elimina.
 * Uses temp DATA_DIR. Does NOT touch HS-2026-000123 or live customers.
 *
 * Run: npx tsx scripts/continuity-api-regression.ts
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "hs-continuity-api-"));
process.env.DATA_DIR = dataDir;
process.env.OPENAI_API_KEY = "";
process.env.AI_CONCIERGE_DRY_RUN = "true";
process.env.AUTOMATION_DISPATCH_ENABLED = "false";
process.env.HOMESTEAD_TELEGRAM_CHAT_ID = "";

let failed = 0;
function ok(name: string, value: boolean, detail = "") {
  if (!value) {
    failed += 1;
    console.error("FAIL", name, detail);
  } else console.log("PASS", name, detail ? `— ${detail}` : "");
}

async function main() {
  const { createConversation, touchConversation, getConversation } = await import("../src/lib/concierge-store");
  const { conciergeTurn } = await import("../src/lib/concierge-engine");
  const { saveServiceRequest, getRequestByPublicId } = await import("../src/lib/service-requests");
  const { ingestCanonicalLead, createAppointment, getAppointment } = await import("../src/lib/revenue-store");

  const phone = "60009988";
  const hs = saveServiceRequest({
    name: "Regression Continuity",
    phone,
    email: "continuity@example.com",
    property: "house",
    service: "painting",
    message: "pintura habitación",
    photos: [],
  });
  ingestCanonicalLead({
    leadId: hs.publicId,
    name: hs.name,
    phone: hs.phone,
    email: "continuity@example.com",
    service: "painting",
    problem: "pintura",
    photoCount: 0,
    source: "WEBSITE_AI_CHAT",
    isTest: true,
    skipFollowUp: true,
  });
  const haId =
    createAppointment(hs.publicId, "2026-10-04", "12:00", "CONFIRMED", { source: "CHAT" }) || "";
  ok("fixture not real HS-2026-000123", hs.publicId !== "HS-2026-000123");

  const conversationId = createConversation("127.0.0.1", {}, true);
  const conv = getConversation(conversationId)!;
  await touchConversation(conversationId, {
    leadPublicId: hs.publicId,
    state: {
      ...conv.state,
      name: "Regression Continuity",
      phone,
      contactStatus: "VALID",
      primaryService: "painting",
      service: "painting",
      problem: "pintura habitación",
      location: "Bethania",
      preferredDate: "2026-10-04",
      preferredTime: "12:00",
      pendingSlot: { date: "2026-10-04", time: "12:00", label: "sábado 12:00 p. m." },
      appointmentId: haId,
      activeLeadId: hs.publicId,
      funnelStage: "BOOKED",
      bookingIntent: true,
    },
  });

  // BEFORE: lavamanos mid/post confirm was ignored; only paint ack.
  const lavamanos = await conciergeTurn({
    conversationId,
    message: "tengo un problea con mi lava manos",
  });
  ok("lavamanos turn ok", lavamanos.ok === true);
  if (lavamanos.ok) {
    ok(
      "AFTER: ack paint + ask lavamanos",
      /pintura.*confirmada|visita de pintura/i.test(lavamanos.reply) && /lavamanos/i.test(lavamanos.reply),
      lavamanos.reply.slice(0, 160),
    );
    ok("does not silent-switch service card away", lavamanos.requestCard?.serviceLabel !== "Plomería");
    ok("no whatsapp forced on deferred need", lavamanos.whatsappUrl == null);
  }

  const afterNeed = getConversation(conversationId)!;
  ok("paint HS still active", afterNeed.state.activeLeadId === hs.publicId);
  ok("deferred plumbing stored", afterNeed.state.facts?.deferredNeedService === "plumbing");

  const elimina = await conciergeTurn({ conversationId, message: "elimina mis solicitudes" });
  ok("elimina asks confirm (not hard delete)", elimina.ok === true);
  if (elimina.ok) {
    ok(
      "confirm language natural",
      /confirmas que quieres cancelar/i.test(elimina.reply) && !/parece que no puedo/i.test(elimina.reply),
      elimina.reply.slice(0, 160),
    );
    ok("card shows cancel pending or keeps folio", Boolean(elimina.requestCard?.publicId || elimina.reply.includes(hs.publicId)));
    ok("no whatsapp on cancel ask", elimina.whatsappUrl == null);
  }
  ok("HS still live before sí", getRequestByPublicId(hs.publicId)?.status !== "CANCELLED");

  const no = await conciergeTurn({ conversationId, message: "no" });
  ok("no keeps request", no.ok && getRequestByPublicId(hs.publicId)?.status !== "CANCELLED");
  if (no.ok) ok("no reply natural", /mantengo tu solicitud/i.test(no.reply), no.reply.slice(0, 120));

  const elimina2 = await conciergeTurn({ conversationId, message: "elimina mis solicitudes" });
  ok("re-ask confirm", elimina2.ok === true && /confirmas/i.test(elimina2.ok ? elimina2.reply : ""));
  const yes = await conciergeTurn({ conversationId, message: "sí" });
  ok("sí cancels HS", yes.ok && getRequestByPublicId(hs.publicId)?.status === "CANCELLED");
  if (haId) ok("sí releases appointment", getAppointment(haId)?.status === "CANCELLED");
  if (yes.ok) {
    ok("cancel result grounded", /cancel/i.test(yes.reply), yes.reply.slice(0, 140));
    ok("card cleared after cancel", yes.requestCard == null);
    ok("no whatsapp after cancel", yes.whatsappUrl == null);
  }

  // Foreign folio access
  const foreign = saveServiceRequest({
    name: "Otro",
    phone: "69990001",
    email: "x@example.com",
    property: "house",
    service: "plumbing",
    message: "fuga",
    photos: [],
  });
  const denied = await conciergeTurn({
    conversationId,
    message: `cancela ${foreign.publicId}`,
  });
  ok("foreign HS untouched", getRequestByPublicId(foreign.publicId)?.status !== "CANCELLED");
  if (denied.ok) ok("foreign not leaked as success", !/cancelé tu solicitud HS/i.test(denied.reply) || !denied.reply.includes(foreign.publicId));

  console.log("\nDATA_DIR", dataDir);
  if (failed) {
    console.error(`\nCONTINUITY API FAILED (${failed})`);
    process.exit(1);
  }
  console.log("\nCONTINUITY API REGRESSION PASS (local/isolated — not production)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
