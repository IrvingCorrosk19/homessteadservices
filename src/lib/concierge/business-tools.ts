/**
 * Authenticated business-tool facade for n8n / local coordinator.
 * AI proposes; these functions validate and execute. No direct SQL from the model.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { classifyPhone } from "@/lib/phone";
import { conciergeInternalSecret } from "@/lib/concierge-flags";
import { getConversation, touchConversation, type ConversationState } from "@/lib/concierge-store";
import { detectServices } from "@/lib/concierge/playbook-engine";
import { ensureActiveServiceRequest, syncServiceRequestFromState, buildRequestCard } from "@/lib/concierge/service-request-lifecycle";
import {
  authorizeConversationAction,
  resolveTurnIntent,
  buildTurnActionPlan,
  type ConversationActionAuthorization,
} from "@/lib/concierge/conversation-action-gate";
import { markActiveRequest } from "@/lib/concierge/conversation-reset";
import { applyPackedExtraction } from "@/lib/concierge/packed-extraction";
import { classifyActionableServiceIntent } from "@/lib/concierge/actionable-intent";
import { isBusinessContactQuestion, formatBusinessContactReply, getBusinessContactChannels } from "@/lib/concierge/business-contact";
import { checkAvailability } from "@/lib/concierge-availability";
import { executeConciergeTool } from "@/lib/concierge-tools";
import { cancelServiceRequest } from "@/lib/service-request-cancellation";
import { getHomesteadDb } from "@/lib/service-requests";
import { bumpConversationStateVersion } from "@/lib/concierge/turn-store";
import type { StructuredIntent, ToolResultEnvelope } from "@/lib/concierge/turn-protocol";
import { detectLockoutIntent } from "@/lib/service-requirements";

export function verifyInternalAuth(headerValue: string | null | undefined): boolean {
  const expected = conciergeInternalSecret();
  if (!expected) return false;
  const got = String(headerValue || "").trim();
  if (!got) return false;
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(expected).digest();
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function fail(tool: string, code: string, message: string): ToolResultEnvelope {
  return { ok: false, tool, code, message };
}

function ok(tool: string, data: Record<string, unknown>, extra?: Partial<ToolResultEnvelope>): ToolResultEnvelope {
  return { ok: true, tool, data, ...extra };
}

export function toolGetContext(conversationId: string): ToolResultEnvelope {
  const conv = getConversation(conversationId);
  if (!conv) return fail("get_context", "not_found", "Conversación no encontrada");
  const state = conv.state;
  const biz = getBusinessContactChannels();
  return ok("get_context", {
    conversationId,
    leadPublicId: conv.leadPublicId || state.activeLeadId || "",
    appointmentId: state.appointmentId || "",
    name: state.name || "",
    phoneStatus: state.contactStatus,
    phoneMasked: state.phone ? `***${String(state.phone).slice(-4)}` : "",
    location: state.location || "",
    service: state.primaryService || state.service || "",
    problem: state.problem || "",
    photoCount: state.photoCount || 0,
    lockout: state.facts?.serviceIntent === "lockout" || state.facts?.lockedOut === "1",
    pendingConfirmation: state.facts?.pendingConfirmation || "",
    offeredSlots: state.offeredSlots || [],
    businessContactConfigured: biz.anyVerified,
    // Never expose raw customer phone as business fields
    businessPhoneConfigured: Boolean(biz.phone),
    businessWhatsappConfigured: Boolean(biz.whatsappDisplay),
  });
}

export function toolInterpret(conversationId: string, text: string): ToolResultEnvelope {
  const conv = getConversation(conversationId);
  if (!conv) return fail("interpret", "not_found", "Conversación no encontrada");
  let state = applyPackedExtraction(conv.state, text);
  const intent = classifyActionableServiceIntent(text, state);
  const services = detectServices(text);
  const missing: string[] = [];
  if (state.contactStatus !== "VALID") missing.push("phone");
  if (!state.location?.trim()) missing.push("location");
  if (!(state.primaryService || state.service || services[0])) missing.push("service");
  const structured: StructuredIntent = {
    primaryIntent: intent.primaryIntent,
    createServiceRequest: intent.createServiceRequest || detectLockoutIntent(text),
    informationalOnly: intent.informationalOnly,
    cancelRequest: /\b(cancel|cancelar|anular)\b/i.test(text) && /\b(solicitud|pedido|todo)\b/i.test(text),
    cancelAppointmentOnly: /\b(cancel|cancelar)\b/i.test(text) && /\b(cita|visita|horario)\b/i.test(text),
    reschedule: /\b(reprogram|cambiar\s+(la\s+)?(cita|hora|fecha))\b/i.test(text),
    humanHandoff: /\b(humano|asesor|persona|agente)\b/i.test(text),
    businessContactQuestion: isBusinessContactQuestion(text),
    extracted: {
      name: state.name || undefined,
      phone: state.contactStatus === "VALID" ? "[valid]" : undefined,
      location: state.location || undefined,
      service: state.primaryService || state.service || services[0] || undefined,
      problem: state.problem || text.slice(0, 240),
      preferredDate: state.preferredDate || undefined,
      preferredTime: state.preferredTime || undefined,
    },
    missingFields: missing,
    confidence: intent.createServiceRequest ? "high" : intent.informationalOnly ? "medium" : "low",
  };
  touchConversation(conversationId, { state });
  return ok("interpret", { intent: structured as unknown as Record<string, unknown> });
}

export function toolSaveFacts(
  conversationId: string,
  patch: Partial<Pick<ConversationState, "name" | "phone" | "location" | "problem" | "primaryService" | "service">>,
): ToolResultEnvelope {
  const conv = getConversation(conversationId);
  if (!conv) return fail("save_facts", "not_found", "Conversación no encontrada");
  let state = { ...conv.state, facts: { ...(conv.state.facts || {}) } };
  if (patch.name?.trim()) state.name = patch.name.trim();
  if (patch.location?.trim()) state.location = patch.location.trim();
  if (patch.problem?.trim()) state.problem = patch.problem.trim();
  if (patch.primaryService?.trim()) {
    state.primaryService = patch.primaryService.trim();
    state.service = patch.primaryService.trim();
  } else if (patch.service?.trim()) {
    state.service = patch.service.trim();
    if (!state.primaryService) state.primaryService = patch.service.trim();
  }
  if (patch.phone?.trim()) {
    const phone = classifyPhone(patch.phone);
    if (phone.status === "VALID") {
      state.phone = phone.e164 || phone.display;
      state.contactStatus = "VALID";
    } else {
      return fail("save_facts", "invalid_phone", "Teléfono no válido");
    }
  }
  // Propagate phone correction to active HS when present
  if (state.activeLeadId && !state.activeLeadId.startsWith("DRY-")) {
    syncServiceRequestFromState(state.activeLeadId, state, state.problem || "", conversationId);
  }
  touchConversation(conversationId, { state });
  bumpConversationStateVersion(conversationId);
  return ok("save_facts", {
    name: state.name,
    location: state.location,
    service: state.primaryService || state.service,
    phoneStatus: state.contactStatus,
    activeLeadId: state.activeLeadId || "",
  });
}

export async function toolUpsertRequest(
  conversationId: string,
  userText: string,
  utm?: Record<string, string>,
): Promise<ToolResultEnvelope> {
  const conv = getConversation(conversationId);
  if (!conv) return fail("upsert_request", "not_found", "Conversación no encontrada");
  let state = conv.state;
  const resolved = resolveTurnIntent(userText, state);
  const plan = buildTurnActionPlan(resolved, state);
  const auth = authorizeConversationAction("CREATE_REQUEST", {
    text: userText,
    state,
    conversationId,
    resolved,
    plan,
  });
  let authorization: ConversationActionAuthorization = auth;
  if (!auth.allowed) {
    // Soft path: ready facts + no active HS → allow create once (idempotent ensure).
    const hasService = Boolean(state.primaryService || state.service);
    const hasProblem = (state.problem || "").length >= 8;
    const ready =
      state.contactStatus === "VALID" &&
      Boolean(state.location?.trim()) &&
      (hasService || hasProblem);
    if (!ready || state.activeLeadId) {
      return fail("upsert_request", auth.reason || "not_authorized", "No autorizado a crear solicitud en este turno");
    }
    authorization = {
      allowed: true,
      action: "CREATE_REQUEST",
      reason: "tool_ready_create",
      plan: auth.plan,
      resolved: auth.resolved,
    };
  }
  try {
    const ensured = await ensureActiveServiceRequest({
      conversationId,
      state,
      summary: [state.problem, state.service, state.location].filter(Boolean).join(". "),
      conversationLeadId: state.activeLeadId || "",
      utm,
      userText,
      authorization,
    });
    if (!ensured) return fail("upsert_request", "not_created", "No se pudo persistir la solicitud");
    state = markActiveRequest(state, ensured.publicId);
    touchConversation(conversationId, { state, leadPublicId: ensured.publicId });
    bumpConversationStateVersion(conversationId);
    const card = buildRequestCard(state, ensured.publicId);
    return ok(
      "upsert_request",
      {
        publicId: ensured.publicId,
        created: ensured.created,
        updated: ensured.updated,
        announce: ensured.announce,
        requestCard: card,
      },
      { persistedIds: { requestId: ensured.publicId }, idempotentReplay: !ensured.created },
    );
  } catch (error) {
    return fail(
      "upsert_request",
      "persist_error",
      error instanceof Error ? error.message : "Error al persistir",
    );
  }
}

export async function toolCheckAvailability(
  conversationId: string,
  opts?: { date?: string; service?: string },
): Promise<ToolResultEnvelope> {
  const conv = getConversation(conversationId);
  if (!conv) return fail("check_availability", "not_found", "Conversación no encontrada");
  const service = opts?.service || conv.state.primaryService || conv.state.service || "plumbing";
  try {
    const result = checkAvailability({
      dateText: opts?.date || conv.state.preferredDate || "",
      logId: conversationId.slice(0, 8),
    });
    // Offer slots onto conversation state for UI chips (short write, no AI lock).
    if (result.slots?.length) {
      touchConversation(conversationId, {
        state: {
          ...conv.state,
          offeredSlots: result.slots.slice(0, 6).map((s) => ({
            date: s.date,
            time: s.time,
            label: s.label || `${s.date} ${s.time}`,
            slotId: `${s.date}T${s.time}`,
          })),
          awaitingSlotSelection: true,
          lastAvailabilityAt: new Date().toISOString(),
        },
      });
    }
    return ok("check_availability", {
      service,
      slots: result.slots || [],
      note: "La disponibilidad consultada no garantiza reserva; se revalida al reservar.",
    });
  } catch (error) {
    return fail(
      "check_availability",
      "availability_error",
      error instanceof Error ? error.message : "No pude consultar la agenda",
    );
  }
}

export async function toolBookAppointment(
  conversationId: string,
  args: { date: string; time: string; idempotencyKey?: string },
): Promise<ToolResultEnvelope> {
  const conv = getConversation(conversationId);
  if (!conv) return fail("book_appointment", "not_found", "Conversación no encontrada");
  if (!args.date || !args.time) return fail("book_appointment", "missing_slot", "Falta fecha u hora");
  const toolResult = await executeConciergeTool(
    "create_appointment",
    {
      date: args.date,
      time: args.time,
      customerConfirmed: true,
      conversation_id: conversationId,
      idempotency_key: args.idempotencyKey || `book:${conversationId}:${args.date}:${args.time}`,
    },
    { conversationId, state: conv.state, leadId: conv.state.activeLeadId || conv.leadPublicId || "" },
  );
  touchConversation(conversationId, { state: toolResult.state, leadPublicId: toolResult.leadId || "" });
  const parsed = (toolResult.result || {}) as Record<string, unknown>;
  if (parsed.ok === false) {
    return fail("book_appointment", String(parsed.reason || parsed.error || "book_failed"), String(parsed.message || "No se pudo reservar"));
  }
  bumpConversationStateVersion(conversationId);
  return ok(
    "book_appointment",
    parsed,
    { persistedIds: { appointmentId: String(parsed.appointmentId || parsed.id || toolResult.state.appointmentId || "") } },
  );
}

export async function toolReschedule(
  conversationId: string,
  args: { date: string; time: string },
): Promise<ToolResultEnvelope> {
  const conv = getConversation(conversationId);
  if (!conv) return fail("reschedule", "not_found", "Conversación no encontrada");
  const toolResult = await executeConciergeTool(
    "reschedule_appointment",
    { date: args.date, time: args.time, conversation_id: conversationId },
    { conversationId, state: conv.state, leadId: conv.state.activeLeadId || "" },
  );
  touchConversation(conversationId, { state: toolResult.state, leadPublicId: toolResult.leadId || "" });
  const parsed = (toolResult.result || {}) as Record<string, unknown>;
  if (parsed.ok === false) {
    return fail("reschedule", String(parsed.reason || "reschedule_failed"), String(parsed.message || "No se pudo reprogramar"));
  }
  bumpConversationStateVersion(conversationId);
  return ok("reschedule", parsed, { persistedIds: { appointmentId: String(parsed.appointmentId || toolResult.state.appointmentId || "") } });
}

export async function toolCancel(
  conversationId: string,
  scope: "request" | "appointment",
  confirm: boolean,
): Promise<ToolResultEnvelope> {
  const conv = getConversation(conversationId);
  if (!conv) return fail("cancel", "not_found", "Conversación no encontrada");
  if (!confirm) {
    touchConversation(conversationId, {
      state: {
        ...conv.state,
        facts: {
          ...(conv.state.facts || {}),
          pendingConfirmation: scope === "request" ? "CANCEL_REQUEST" : "CANCEL_APPOINTMENT",
        },
      },
    });
    return ok("cancel", { awaitingConfirmation: true, scope });
  }
  if (scope === "appointment") {
    const toolResult = await executeConciergeTool(
      "cancel_appointment",
      { conversation_id: conversationId, confirm: true },
      { conversationId, state: conv.state, leadId: conv.state.activeLeadId || "" },
    );
    touchConversation(conversationId, { state: toolResult.state });
    bumpConversationStateVersion(conversationId);
    const parsed = (toolResult.result || {}) as Record<string, unknown>;
    return parsed.ok === false
      ? fail("cancel", "cancel_appt_failed", String(parsed.message || "No se pudo cancelar la cita"))
      : ok("cancel", { ...parsed, scope });
  }
  const requestId = conv.state.activeLeadId || conv.leadPublicId;
  if (!requestId || requestId.startsWith("DRY-")) {
    return fail("cancel", "no_request", "No hay solicitud activa para cancelar");
  }
  const result = cancelServiceRequest({
    requestId,
    reason: "customer_chat",
    actor: "concierge-n8n",
    source: "CUSTOMER_AI",
    conversationId,
    notify: false,
  });
  if (!result.success && !result.alreadyCancelled) {
    return fail("cancel", result.errorCode || "cancel_failed", "No se pudo cancelar la solicitud");
  }
  touchConversation(conversationId, {
    state: {
      ...conv.state,
      activeLeadId: "",
      appointmentId: "",
      facts: { ...(conv.state.facts || {}), pendingConfirmation: "", lastCancelledRequestId: requestId },
    },
    leadPublicId: "",
  });
  bumpConversationStateVersion(conversationId);
  return ok("cancel", { publicId: requestId, scope: "request", alreadyCancelled: result.alreadyCancelled });
}

export function toolBusinessContact(): ToolResultEnvelope {
  const reply = formatBusinessContactReply();
  const ch = getBusinessContactChannels();
  return ok("business_contact", {
    reply: reply.reply,
    anyVerified: ch.anyVerified,
    phoneConfigured: Boolean(ch.phone),
    whatsappConfigured: Boolean(ch.whatsappDisplay),
    phoneHref: ch.phoneHref,
    whatsappUrl: ch.whatsappUrl,
  });
}

export function toolHumanHandoff(conversationId: string): ToolResultEnvelope {
  const conv = getConversation(conversationId);
  if (!conv) return fail("human_handoff", "not_found", "Conversación no encontrada");
  touchConversation(conversationId, {
    state: {
      ...conv.state,
      humanHandoffRequested: true,
      humanRequested: true,
      needsReview: true,
    },
  });
  return ok("human_handoff", {
    reply: "Dejo tu caso marcado para atención humana. Seguimos con lo que ya tenemos registrado; un asesor lo revisa.",
  });
}

export function toolListServices(): ToolResultEnvelope {
  return ok("list_services", {
    services: ["plumbing", "electrical", "ac", "painting", "locksmith"],
    note: "Requisitos exactos dependen del playbook del servicio.",
  });
}

/** Verify request still exists (reconcile after lost response). */
export function toolReconcileRequest(publicId: string): ToolResultEnvelope {
  if (!publicId || publicId.startsWith("DRY-")) return fail("reconcile", "invalid_id", "ID inválido");
  const row = getHomesteadDb()
    .prepare(`SELECT public_id, status, phone, service FROM service_requests WHERE public_id = ?`)
    .get(publicId) as { public_id: string; status: string; phone: string; service: string } | undefined;
  if (!row) return fail("reconcile", "missing", "Solicitud no encontrada");
  return ok("reconcile", {
    publicId: row.public_id,
    status: row.status,
    service: row.service,
    phoneMasked: row.phone ? `***${row.phone.slice(-4)}` : "",
  });
}

export type BusinessToolName =
  | "get_context"
  | "interpret"
  | "save_facts"
  | "upsert_request"
  | "check_availability"
  | "book_appointment"
  | "reschedule"
  | "cancel"
  | "business_contact"
  | "human_handoff"
  | "list_services"
  | "reconcile_request";

export async function dispatchBusinessTool(
  tool: BusinessToolName,
  body: Record<string, unknown>,
): Promise<ToolResultEnvelope> {
  const conversationId = String(body.conversationId || "");
  switch (tool) {
    case "get_context":
      return toolGetContext(conversationId);
    case "interpret":
      return toolInterpret(conversationId, String(body.text || ""));
    case "save_facts":
      return toolSaveFacts(conversationId, body.patch as never);
    case "upsert_request":
      return toolUpsertRequest(conversationId, String(body.text || "continuar"), body.utm as never);
    case "check_availability":
      return toolCheckAvailability(conversationId, body as never);
    case "book_appointment":
      return toolBookAppointment(conversationId, body as never);
    case "reschedule":
      return toolReschedule(conversationId, body as never);
    case "cancel":
      return toolCancel(conversationId, body.scope === "appointment" ? "appointment" : "request", Boolean(body.confirm));
    case "business_contact":
      return toolBusinessContact();
    case "human_handoff":
      return toolHumanHandoff(conversationId);
    case "list_services":
      return toolListServices();
    case "reconcile_request":
      return toolReconcileRequest(String(body.publicId || ""));
    default:
      return fail(String(tool), "unknown_tool", "Herramienta no permitida");
  }
}
