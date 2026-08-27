import { classifyPhone, maskPhone } from "@/lib/phone";
import { logInfo } from "@/lib/log";
import { recordLead } from "@/lib/marketing-store";
import { ingestCanonicalLead, saveLeadPreference, stopFollowUps } from "@/lib/revenue-store";
import { conciergeKnowledge } from "@/lib/concierge-knowledge";
import { dispatchServiceRequest, persistServiceRequest } from "@/lib/service-request-service";
import { isConciergeDryRun } from "@/lib/concierge-flags";
import type { ConversationState } from "@/lib/concierge-store";
import { recordFunnelEvent } from "@/lib/concierge-intelligence";
import { getPlaybook, playbookById } from "@/lib/concierge/service-playbooks";
import { detectServices, formatRequestBrief } from "@/lib/concierge/playbook-engine";
import { conciergePhotoBuffers, copyConciergePhotosToRequest } from "@/lib/concierge/photo-link";
import { getHomesteadDb } from "@/lib/service-requests";
import { syncServiceRequestFromState } from "@/lib/concierge/service-request-lifecycle";

export function canHandoffLead(state: ConversationState) {
  const phone = classifyPhone(state.phone);
  const hasNeed = Boolean(state.problem || (state.service && state.service !== "unknown"));
  return phone.status === "VALID" && hasNeed;
}

export function isTestHandoff(state: ConversationState, utm: Record<string, string> = {}) {
  const blob = `${state.name} ${state.problem} ${utm.hs_test || ""}`;
  if (/TEST-HS-E2E|AUDIT-CHATBOT-TEST|V2-TEST|V3-TEST|V3\.1-TEST|WAVE-C-TEST|WAVE-B-TEST|WAVE-A-TEST/i.test(blob) || utm.hs_test === "1") return true;
  const national = classifyPhone(state.phone).national;
  return national === "60001111" || national === "60000000";
}

export function shouldCreateCanonicalLead() {
  return process.env.AI_CONCIERGE_CREATE_LEADS !== "false";
}

export async function createLeadFromConcierge(input: {
  conversationId: string;
  state: ConversationState;
  summary: string;
  existingLeadId: string;
  utm?: Record<string, string>;
  escalate?: boolean;
}) {
  if (input.existingLeadId && !input.existingLeadId.startsWith("DRY-")) {
    const row = getHomesteadDb()
      .prepare("SELECT public_id FROM service_requests WHERE public_id = ?")
      .get(input.existingLeadId) as { public_id: string } | undefined;
    if (row) {
      syncServiceRequestFromState(
        input.existingLeadId,
        input.state,
        input.summary,
        input.conversationId,
      );
      copyConciergePhotosToRequest(input.conversationId, input.existingLeadId);
      logInfo("SERVICE_INTENT_RESOLVED", {
        contentJobId: input.existingLeadId,
        stage: "lead_service_refined_same_request",
        phone: maskPhone(input.state.phone),
      });
      return input.existingLeadId;
    }
  }
  if (!canHandoffLead(input.state)) return "";
  if (!shouldCreateCanonicalLead()) return "";
  const phone = classifyPhone(input.state.phone);
  const name = input.state.name.trim() || "Cliente web";
  let service = input.state.primaryService || input.state.service || "";
  if (!playbookById(service) || service === "other" || service === "multiple" || service === "unknown") {
    service = detectServices(`${input.state.problem} ${input.summary}`)[0] || "other";
  }
  const property =
    input.state.propertyType && ["house", "apartment", "ph", "office", "commerce", "other"].includes(input.state.propertyType)
      ? input.state.propertyType
      : "other";
  const playbook = getPlaybook(service);
  const brief = formatRequestBrief(input.state, playbook);
  const location = input.state.location ? `Zona: ${input.state.location}. ` : "";
  const building = input.state.facts?.building || input.state.facts?.ph || "";
  const unit = input.state.facts?.unit || input.state.facts?.apartment || "";
  const tower = input.state.facts?.tower || "";
  const reference = input.state.facts?.reference || "";
  const propertyBits = [
    input.state.propertyType ? `Tipo: ${input.state.propertyType}` : "",
    building ? `PH/Edificio: ${building}` : "",
    tower ? `Torre: ${tower}` : "",
    unit ? `Unidad: ${unit}` : "",
    reference ? `Referencia: ${reference}` : "",
  ]
    .filter(Boolean)
    .join(". ");
  const when = input.state.preferredTime ? `Preferencia de horario: ${input.state.preferredTime}. ` : "";
  const message = [
    "[Asistente web Homestead]",
    brief || input.summary || input.state.problem,
    location + (propertyBits ? `${propertyBits}. ` : "") + when,
    input.state.humanHandoffRequested ? "HUMAN_HANDOFF_REQUESTED" : "",
  ]
    .filter(Boolean)
    .join("\n");
  const photos = conciergePhotoBuffers(input.conversationId);
  const factsJson = JSON.stringify({
    service,
    facts: input.state.facts || {},
    photoCount: photos.length || input.state.photoCount,
    urgency: input.state.urgency || "normal",
    bookingStrategy: input.state.bookingStrategy || playbook.bookingStrategy,
    needsReview: Boolean(input.state.needsReview || playbook.unknownCatalog),
    location: input.state.location,
  });
  const saved = await persistServiceRequest({
    name,
    phone: phone.e164 || input.state.phone.trim(),
    email: input.state.email.trim() || conciergeKnowledge().email || "servicios@homestead.lat",
    property,
    service: service === "unknown" ? "other" : service,
    message,
    photos,
    factsJson,
  });
  copyConciergePhotosToRequest(input.conversationId, saved.publicId);
  try {
    getHomesteadDb().prepare("UPDATE service_requests SET facts_json = ? WHERE public_id = ?").run(factsJson, saved.publicId);
  } catch {
    // facts_json may not exist on very old DBs mid-migrate
  }
  ingestCanonicalLead({
    leadId: saved.publicId,
    name,
    phone: saved.phone,
    email: saved.email,
    service,
    problem: input.state.problem || message,
    photoCount: photos.length || input.state.photoCount,
    source: "WEBSITE_AI_CHAT",
    conversationId: input.conversationId,
    location: input.state.location,
    preferredDate: input.state.preferredDate || "",
    preferredTimeWindow: input.state.preferredTime,
    utm: input.utm,
    isTest: isTestHandoff(input.state, input.utm || {}),
  });
  if (input.state.preferredDate || input.state.preferredTime) {
    saveLeadPreference(saved.publicId, input.state.preferredDate || "", input.state.preferredTime);
  }
  recordLead({ publicId: saved.publicId, channel: "website_ai_concierge", outcome: "CONTACT" });
  const notify = !isConciergeDryRun();
  await dispatchServiceRequest(saved, { email: notify, n8n: notify, photos: [] });
  recordFunnelEvent(input.conversationId, "ServiceRequestCreated", { service, lead: saved.publicId });
  if (input.state.facts?.entryPoint === "service_image") {
    recordFunnelEvent(input.conversationId, "RequestCreatedFromImage", {
      service,
      intent: input.state.facts.entryItemId || input.state.facts.entryImageId || "",
      lead: saved.publicId,
    });
  }
  logInfo("REQUEST_SERVICE_PERSISTED", {
    contentJobId: saved.publicId,
    stage: service,
    phone: maskPhone(saved.phone),
  });
  logInfo("ConciergeLeadCreated", {
    contentJobId: saved.publicId,
    stage: input.conversationId.slice(0, 8),
    phone: maskPhone(saved.phone),
  });
  return saved.publicId;
}

export function stopLeadIfPresent(leadId: string) {
  if (!leadId || leadId.startsWith("DRY-")) return;
  stopFollowUps(leadId, "STOP_SIGNAL");
}
