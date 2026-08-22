import { ingestCanonicalLead } from "@/lib/revenue-store";
import { isRevenueEnabled } from "@/lib/revenue-score";
import { classifyPhone } from "@/lib/phone";
import type { SavedServiceRequest } from "@/lib/service-requests";

export function ingestSavedRequest(saved: SavedServiceRequest) {
  if (!isRevenueEnabled()) return;
  const source = saved.message.includes("[Asistente web") ? "WEBSITE_AI_CHAT" : "WEBSITE_FORM";
  const zone = saved.message.match(/Zona:\s*([^\n.]+)/);
  const national = classifyPhone(saved.phone).national;
  const blob = `${saved.name} ${saved.message}`;
  const isTest =
    /WAVE-A-TEST|WAVE-B-TEST|WAVE-C-TEST|N8N-MASTER-AUDIT-TEST|V2-TEST|TEST-HS-E2E|AUDIT-CHATBOT-TEST/i.test(blob) ||
    national === "60001111" ||
    national === "60000000";
  ingestCanonicalLead({
    leadId: saved.publicId,
    name: saved.name,
    phone: saved.phone,
    email: saved.email,
    service: saved.service,
    problem: saved.message,
    photoCount: saved.photos.length,
    source,
    location: zone?.[1]?.trim() || "",
    inboxStatus: saved.status,
    isTest,
  });
}
