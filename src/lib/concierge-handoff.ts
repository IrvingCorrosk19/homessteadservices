import { classifyPhone, maskPhone } from "@/lib/phone";
import { logInfo } from "@/lib/log";
import { notifyN8n } from "@/lib/n8n";
import { saveServiceRequest } from "@/lib/service-requests";
import { recordLead } from "@/lib/marketing-store";
import { ingestCanonicalLead, saveLeadPreference, stopFollowUps } from "@/lib/revenue-store";
import { sendNewLeadAlert } from "@/lib/revenue-telegram";
import { conciergeKnowledge } from "@/lib/concierge-knowledge";
import type { ConversationState } from "@/lib/concierge-store";

export function canHandoffLead(state: ConversationState) {
  const phone = classifyPhone(state.phone);
  const hasNeed = Boolean(state.problem || (state.service && state.service !== "unknown"));
  return phone.status === "VALID" && hasNeed;
}

export function isTestHandoff(state: ConversationState, utm: Record<string, string> = {}) {
  const blob = `${state.name} ${state.problem} ${utm.hs_test || ""}`;
  if (/TEST-HS-E2E/i.test(blob) || utm.hs_test === "1") return true;
  return classifyPhone(state.phone).national === "60001111";
}

export function shouldCreateCanonicalLead() {
  return process.env.AI_CONCIERGE_CREATE_LEADS !== "false";
}

export function createLeadFromConcierge(input: {
  conversationId: string;
  state: ConversationState;
  summary: string;
  existingLeadId: string;
  utm?: Record<string, string>;
}) {
  if (input.existingLeadId && !input.existingLeadId.startsWith("DRY-")) return input.existingLeadId;
  if (!canHandoffLead(input.state)) return "";
  if (!shouldCreateCanonicalLead()) return "";
  const phone = classifyPhone(input.state.phone);
  const name = input.state.name.trim() || "Cliente web";
  const service = input.state.service && input.state.service !== "unknown" ? input.state.service : "other";
  const location = input.state.location ? `Zona: ${input.state.location}. ` : "";
  const when = input.state.preferredTime ? `Preferencia de horario: ${input.state.preferredTime}. ` : "";
  const message = [
    "[Asistente web Homestead]",
    input.summary || input.state.problem,
    location + when,
    `Servicio: ${service}.`,
    "Solicita evaluación en sitio.",
  ]
    .filter(Boolean)
    .join("\n");
  const saved = saveServiceRequest({
    name,
    phone: phone.display || phone.e164 || input.state.phone.trim(),
    email: input.state.email.trim() || conciergeKnowledge().email || "servicios@homestead.lat",
    property: "other",
    service: service === "unknown" ? "other" : service,
    message,
    photos: [],
  });
  ingestCanonicalLead({
    leadId: saved.publicId,
    name,
    phone: saved.phone,
    email: saved.email,
    service,
    problem: input.state.problem || message,
    photoCount: 0,
    source: "WEBSITE_AI_CHAT",
    conversationId: input.conversationId,
    location: input.state.location,
    preferredDate: "",
    preferredTimeWindow: input.state.preferredTime,
    utm: input.utm,
    isTest: isTestHandoff(input.state, input.utm || {}),
  });
  if (input.state.preferredTime) {
    saveLeadPreference(saved.publicId, "", input.state.preferredTime);
  }
  recordLead({ publicId: saved.publicId, channel: "website_ai_concierge", outcome: "CONTACT" });
  void notifyN8n(saved);
  void sendNewLeadAlert(saved.publicId);
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
