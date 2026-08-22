import { classifyPhone, maskPhone } from "@/lib/phone";
import { logInfo } from "@/lib/log";
import { recordLead } from "@/lib/marketing-store";
import { ingestCanonicalLead, saveLeadPreference, stopFollowUps } from "@/lib/revenue-store";
import { sendNewLeadAlert } from "@/lib/revenue-telegram";
import { conciergeKnowledge } from "@/lib/concierge-knowledge";
import { dispatchServiceRequest, persistServiceRequest } from "@/lib/service-request-service";
import { isConciergeDryRun } from "@/lib/concierge-flags";
import type { ConversationState } from "@/lib/concierge-store";
import { recordFunnelEvent } from "@/lib/concierge-intelligence";

export function canHandoffLead(state: ConversationState) {
  const phone = classifyPhone(state.phone);
  const hasNeed = Boolean(state.problem || (state.service && state.service !== "unknown"));
  return phone.status === "VALID" && hasNeed;
}

export function isTestHandoff(state: ConversationState, utm: Record<string, string> = {}) {
  const blob = `${state.name} ${state.problem} ${utm.hs_test || ""}`;
  if (/TEST-HS-E2E|AUDIT-CHATBOT-TEST|V2-TEST/i.test(blob) || utm.hs_test === "1") return true;
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
  if (input.existingLeadId && !input.existingLeadId.startsWith("DRY-")) return input.existingLeadId;
  if (!canHandoffLead(input.state)) return "";
  if (!shouldCreateCanonicalLead()) return "";
  const phone = classifyPhone(input.state.phone);
  const name = input.state.name.trim() || "Cliente web";
  let service = input.state.service && input.state.service !== "unknown" ? input.state.service : "other";
  const blob = `${input.state.problem} ${input.summary}`.toLowerCase();
  if (service === "multiple" || service === "other" || service === "ac") {
    if (/pintar|pintur/.test(blob) && /repar/.test(blob)) service = "painting";
    else if (/pintar|pintur/.test(blob)) service = "painting";
    else if (/plom|fuga|fregador|tuber/.test(blob)) service = "plumbing";
    else if (/aire|a\/c|\bac\b|enfri/.test(blob)) service = "ac";
    else if (/cerradur|puerta no cierra|llave/.test(blob)) service = "locksmith";
    else if (/toma|interruptor|el[eé]ctric/.test(blob)) service = "electrical";
  }
  const property =
    input.state.propertyType && ["house", "apartment", "ph", "office", "commerce", "other"].includes(input.state.propertyType)
      ? input.state.propertyType
      : "other";
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
  const saved = await persistServiceRequest({
    name,
    phone: phone.e164 || input.state.phone.trim(),
    email: input.state.email.trim() || conciergeKnowledge().email || "servicios@homestead.lat",
    property,
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
  if (input.escalate && notify) {
    await sendNewLeadAlert(saved.publicId);
  }
  recordFunnelEvent(input.conversationId, "ServiceRequestCreated", { service, lead: saved.publicId });
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
