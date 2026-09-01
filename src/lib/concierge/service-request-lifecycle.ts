/**
 * Request-first lifecycle: one logical HS-* per active service conversation.
 * HS is created on valid service intent — not gated on appointment or full contact.
 */
import { classifyPhone, maskPhone } from "@/lib/phone";
import { logInfo } from "@/lib/log";
import { conciergeKnowledge } from "@/lib/concierge-knowledge";
import { dispatchServiceRequest, persistServiceRequest } from "@/lib/service-request-service";
import { isConciergeDryRun } from "@/lib/concierge-flags";
import type { ConversationState } from "@/lib/concierge-store";
import { recordFunnelEvent } from "@/lib/concierge-intelligence";
import { getPlaybook, playbookById } from "@/lib/concierge/service-playbooks";
import { detectServices, formatRequestBrief } from "@/lib/concierge/playbook-engine";
import { conciergePhotoBuffers, copyConciergePhotosToRequest } from "@/lib/concierge/photo-link";
import { getHomesteadDb } from "@/lib/service-requests";
import { ingestCanonicalLead, saveLeadPreference } from "@/lib/revenue-store";
import { isTestHandoff, shouldCreateCanonicalLead } from "@/lib/concierge-handoff";
import {
  classifyActionableServiceIntent,
  isNonDemandTurn,
} from "@/lib/concierge/actionable-intent";
import {
  hasActiveBookedAppointment,
  rehydrateRequestFromAppointment,
  resolveAuthoritativeRequestId,
} from "@/lib/concierge/appointment-reprogram";

export type EnsureRequestResult = {
  publicId: string;
  created: boolean;
  updated: boolean;
  announce: boolean;
};

const GENERIC_NAMES = /^(cliente(\s+web)?|usuario|test|prueba)$/i;

/**
 * Valid *actionable* service intent — enough to open an operational HS.
 * A detected trade word or a long utterance is not sufficient.
 * Catalog / capability / coverage / price-exploration questions must not create HS.
 */
export function hasValidServiceIntent(state: ConversationState, userText = ""): boolean {
  const text = userText.trim();
  if (text) {
    const decision = classifyActionableServiceIntent(text, state);
    if (decision.informationalOnly) return false;
    if (decision.createServiceRequest) return true;
    if (decision.actionableServiceIntent) return true;
    if (state.activeLeadId && isNonDemandTurn(text)) return true;
    return false;
  }
  if (state.activeLeadId) return true;
  const problem = (state.problem || state.facts?.need || state.facts?.what || "").trim();
  if (!problem) return false;
  return classifyActionableServiceIntent(problem, state).createServiceRequest;
}

function resolveService(state: ConversationState, summary: string) {
  let service = state.primaryService || state.service || "";
  if (!playbookById(service) || service === "other" || service === "multiple" || service === "unknown") {
    service = detectServices(`${state.problem} ${summary}`)[0] || "other";
  }
  return service === "unknown" ? "other" : service;
}

function buildRequestPayload(state: ConversationState, summary: string, service: string) {
  const playbook = getPlaybook(service);
  const phone = classifyPhone(state.phone);
  const name = (state.name || "").trim();
  const location = state.location ? `Zona: ${state.location}. ` : "";
  const building = state.facts?.building || state.facts?.ph || "";
  const unit = state.facts?.unit || state.facts?.apartment || "";
  const tower = state.facts?.tower || "";
  const reference = state.facts?.reference || "";
  const propertyBits = [
    state.propertyType ? `Tipo: ${state.propertyType}` : "",
    building ? `PH/Edificio: ${building}` : "",
    tower ? `Torre: ${tower}` : "",
    unit ? `Unidad: ${unit}` : "",
    reference ? `Referencia: ${reference}` : "",
  ]
    .filter(Boolean)
    .join(". ");
  const when = state.preferredTime ? `Preferencia de horario: ${state.preferredTime}. ` : "";
  const message = [
    "[Asistente web Homestead]",
    formatRequestBrief(state, playbook) || summary || state.problem,
    location + (propertyBits ? `${propertyBits}. ` : "") + when,
    state.humanHandoffRequested ? "HUMAN_HANDOFF_REQUESTED" : "",
  ]
    .filter(Boolean)
    .join("\n");
  const property =
    state.propertyType && ["house", "apartment", "ph", "office", "commerce", "other"].includes(state.propertyType)
      ? state.propertyType
      : "other";
  const factsJson = JSON.stringify({
    service,
    facts: state.facts || {},
    photoCount: state.photoCount,
    urgency: state.urgency || "normal",
    bookingStrategy: state.bookingStrategy || playbook.bookingStrategy,
    needsReview: Boolean(state.needsReview || playbook.unknownCatalog),
    location: state.location,
    preferredDate: state.preferredDate || "",
    preferredTime: state.preferredTime || "",
    lifecycle: "COLLECTING_DETAILS",
  });
  return {
    name: name && !GENERIC_NAMES.test(name) ? name : "Cliente web",
    phone: phone.status === "VALID" ? phone.e164 || state.phone.trim() : state.phone.trim() || "",
    email: state.email.trim() || conciergeKnowledge().email || "servicios@homestead.lat",
    property,
    service,
    message,
    factsJson,
  };
}

/** Sync known fields onto an existing HS without creating a new folio. */
export function syncServiceRequestFromState(
  publicId: string,
  state: ConversationState,
  summary: string,
  conversationId = "",
) {
  if (!publicId || publicId.startsWith("DRY-")) return false;
  const service = resolveService(state, summary);
  const payload = buildRequestPayload(state, summary, service);
  const db = getHomesteadDb();
  const row = db.prepare("SELECT public_id FROM service_requests WHERE public_id = ?").get(publicId) as
    | { public_id: string }
    | undefined;
  if (!row) return false;
  db.prepare(
    `UPDATE service_requests
     SET updated_at = ?, name = ?, phone = ?, email = ?, property = ?, service = ?, message = ?, facts_json = ?
     WHERE public_id = ?`,
  ).run(
    new Date().toISOString(),
    payload.name,
    payload.phone,
    payload.email,
    payload.property,
    payload.service,
    payload.message,
    payload.factsJson,
    publicId,
  );
  if (payload.phone && classifyPhone(payload.phone).status === "VALID") {
    ingestCanonicalLead({
      leadId: publicId,
      name: payload.name,
      phone: payload.phone,
      email: payload.email,
      service: payload.service,
      problem: state.problem || payload.message,
      photoCount: state.photoCount || 0,
      source: "WEBSITE_AI_CHAT",
      conversationId,
      location: state.location,
      preferredDate: state.preferredDate || "",
      preferredTimeWindow: state.preferredTime,
      isTest: false,
    });
  }
  if (state.preferredDate || state.preferredTime) {
    saveLeadPreference(publicId, state.preferredDate || "", state.preferredTime);
  }
  return true;
}

async function createEarlyRequest(input: {
  conversationId: string;
  state: ConversationState;
  summary: string;
  utm?: Record<string, string>;
}): Promise<string> {
  const service = resolveService(input.state, input.summary);
  const payload = buildRequestPayload(input.state, input.summary, service);
  const photos = conciergePhotoBuffers(input.conversationId);
  const saved = await persistServiceRequest({
    ...payload,
    photos,
  });
  copyConciergePhotosToRequest(input.conversationId, saved.publicId);
  ingestCanonicalLead({
    leadId: saved.publicId,
    name: payload.name,
    phone: payload.phone || saved.phone,
    email: payload.email,
    service: payload.service,
    problem: input.state.problem || payload.message,
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
  const notify = !isConciergeDryRun();
  await dispatchServiceRequest(saved, { email: notify, n8n: notify, photos: [] });
  recordFunnelEvent(input.conversationId, "ServiceRequestCreated", { service, lead: saved.publicId });
  logInfo("REQUEST_SERVICE_PERSISTED", {
    contentJobId: saved.publicId,
    stage: service,
    phone: maskPhone(saved.phone),
  });
  return saved.publicId;
}

/**
 * Idempotent: one active HS per service transaction.
 * Creates early on intent; updates as details arrive.
 */
export async function ensureActiveServiceRequest(input: {
  conversationId: string;
  state: ConversationState;
  summary: string;
  conversationLeadId?: string;
  utm?: Record<string, string>;
  userText?: string;
}): Promise<EnsureRequestResult | null> {
  if (!shouldCreateCanonicalLead()) return null;

  let state = rehydrateRequestFromAppointment(input.state);
  const authoritative = resolveAuthoritativeRequestId(state, input.conversationLeadId || "");
  if (authoritative) {
    state = { ...state, activeLeadId: authoritative };
  }

  const userText = (input.userText || "").trim();
  const intent = userText ? classifyActionableServiceIntent(userText, state) : null;
  if (intent?.informationalOnly && !hasActiveBookedAppointment(state)) {
    if (authoritative || state.activeLeadId) {
      return {
        publicId: String(state.activeLeadId || authoritative),
        created: false,
        updated: false,
        announce: false,
      };
    }
    return null;
  }

  if (!hasValidServiceIntent(state, userText) && !hasActiveBookedAppointment(state)) return null;

  const existing = state.activeLeadId || authoritative || "";

  // Never create a new HS while an active appointment exists for this conversation.
  if (!existing && hasActiveBookedAppointment(state)) {
    state = rehydrateRequestFromAppointment(state);
  }

  const finalExisting = state.activeLeadId || resolveAuthoritativeRequestId(state, input.conversationLeadId || "");

  if (finalExisting && !finalExisting.startsWith("DRY-")) {
    syncServiceRequestFromState(finalExisting, state, input.summary, input.conversationId);
    copyConciergePhotosToRequest(input.conversationId, finalExisting);
    return { publicId: finalExisting, created: false, updated: true, announce: false };
  }

  if (hasActiveBookedAppointment(state)) {
    const fromAppt = resolveAuthoritativeRequestId(state, input.conversationLeadId || "");
    if (fromAppt) {
      syncServiceRequestFromState(fromAppt, state, input.summary, input.conversationId);
      return { publicId: fromAppt, created: false, updated: true, announce: false };
    }
  }

  if (!hasValidServiceIntent(state, userText)) return null;

  const created = await createEarlyRequest({ ...input, state });
  return { publicId: created, created: true, updated: false, announce: true };
}

export function requestFolioIntro(publicId: string, serviceLabel: string) {
  const label = serviceLabel ? ` para ${serviceLabel.toLowerCase()}` : "";
  return `Listo, ya abrí tu solicitud ${publicId}${label}. Ahora seguimos completando los detalles para ayudarte.`;
}

export function requestFolioBookingConfirm(publicId: string, when: string, serviceLabel: string) {
  const svc = serviceLabel ? ` ${serviceLabel.toLowerCase()}` : "";
  return `Listo. Tu solicitud ${publicId}${svc ? ` (${svc.trim()})` : ""} quedó agendada para ${when}.`;
}

export function buildRequestCard(state: ConversationState, publicId: string) {
  if (!publicId || publicId.startsWith("DRY-")) return null;
  const service = state.primaryService || state.service;
  const playbook = service ? getPlaybook(service) : null;
  const when =
    state.pendingSlot?.date && state.pendingSlot?.time
      ? `${state.pendingSlot.date} ${state.pendingSlot.time}`
      : state.appointmentId && state.preferredDate && state.preferredTime
        ? `${state.preferredDate} ${state.preferredTime}`
        : "";
  return {
    publicId,
    serviceLabel: playbook?.label || service || "",
    status: state.appointmentId ? ("scheduled" as const) : ("open" as const),
    when,
  };
}
