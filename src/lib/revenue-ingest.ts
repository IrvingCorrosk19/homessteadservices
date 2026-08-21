import { ingestCanonicalLead } from "@/lib/revenue-store";
import { isRevenueEnabled } from "@/lib/revenue-score";
import type { SavedServiceRequest } from "@/lib/service-requests";

export function ingestSavedRequest(saved: SavedServiceRequest) {
  if (!isRevenueEnabled()) return;
  const source = saved.message.includes("[Asistente web") ? "WEBSITE_AI_CHAT" : "WEBSITE_FORM";
  const zone = saved.message.match(/Zona:\s*([^\n.]+)/);
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
  });
}
