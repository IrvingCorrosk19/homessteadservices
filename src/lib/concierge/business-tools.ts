/**
 * Authenticated business-tool facade for n8n / local coordinator.
 * AI proposes; these functions validate and execute. No direct SQL from the model.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { classifyPhone } from "@/lib/phone";
import { conciergeInternalSecret, isConciergeDryRun } from "@/lib/concierge-flags";
import { addMessage, getConversation, touchConversation, type ConversationState } from "@/lib/concierge-store";
import { detectServices } from "@/lib/concierge/playbook-engine";
import {
  ensureActiveServiceRequest,
  syncServiceRequestFromState,
  buildRequestCard,
  requestFolioIntro,
} from "@/lib/concierge/service-request-lifecycle";
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
import { getHomesteadDb, getRequestByPublicId } from "@/lib/service-requests";
import { bumpConversationStateVersion, getTurn, updateTurn, shouldAcceptTurnResult } from "@/lib/concierge/turn-store";
import type { StructuredIntent, ToolResultEnvelope, TurnReplyPayload } from "@/lib/concierge/turn-protocol";
import { detectLockoutIntent } from "@/lib/service-requirements";
import { detectDigitalLockPurchaseIntent } from "@/lib/concierge/digital-lock-intent";
import { buildSessionSnapshot } from "@/lib/concierge-transaction";
import { getPlaybook } from "@/lib/concierge/service-playbooks";

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
  const priorService = conv.state.primaryService || conv.state.service || "";
  const priorLead = conv.state.activeLeadId || "";
  let state = applyPackedExtraction(conv.state, text);
  const services = detectServices(text);
  // Never let packed extraction silently switch service on an active HS.
  if (priorLead && priorService && services[0] && services[0] !== priorService) {
    state = { ...state, primaryService: priorService, service: priorService };
  }
  const intent = classifyActionableServiceIntent(text, state);
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
  const incomingSvc = detectServices(userText)[0] || "";
  const currentSvc = state.primaryService || state.service || "";
  if (
    state.activeLeadId &&
    incomingSvc &&
    currentSvc &&
    incomingSvc !== currentSvc &&
    state.facts?.pendingConfirmation !== "SECOND_SERVICE_CHOICE"
  ) {
    return fail(
      "upsert_request",
      "second_service_requires_choice",
      "Hay una solicitud activa; confirma si continúas con ella o abres otra antes de cambiar el servicio",
    );
  }
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
  const priorAppointmentId = conv.state.appointmentId || "";
  const toolResult = await executeConciergeTool(
    "reschedule_appointment",
    { date: args.date, time: args.time, conversation_id: conversationId, customerConfirmed: true },
    { conversationId, state: conv.state, leadId: conv.state.activeLeadId || "" },
  );
  const parsed = (toolResult.result || {}) as Record<string, unknown>;
  if (parsed.ok === false) {
    // Keep prior appointment on failure — do not clear appointmentId from a failed attempt.
    const fresh = getConversation(conversationId);
    if (fresh && priorAppointmentId && !fresh.state.appointmentId) {
      touchConversation(conversationId, {
        state: { ...fresh.state, appointmentId: priorAppointmentId },
      });
    }
    return fail(
      "reschedule",
      String(parsed.reason || "reschedule_failed"),
      String(parsed.message || "No se pudo reprogramar; la cita anterior se conserva"),
    );
  }
  touchConversation(conversationId, { state: toolResult.state, leadPublicId: toolResult.leadId || "" });
  bumpConversationStateVersion(conversationId);
  return ok("reschedule", parsed, {
    persistedIds: { appointmentId: String(parsed.appointmentId || toolResult.state.appointmentId || "") },
  });
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

/**
 * n8n calls this AFTER interpret to learn the next allowed step.
 * Does not run the full local coordinator — only classifies the branch.
 */
export function toolRouteDecision(conversationId: string, text: string): ToolResultEnvelope {
  const conv = getConversation(conversationId);
  if (!conv) return fail("route_decision", "not_found", "Conversación no encontrada");
  // Compare against pre-extraction service so a new service mention cannot silently overwrite.
  const priorService = conv.state.primaryService || conv.state.service || "";
  const incomingService = detectServices(text)[0] || "";
  const secondService =
    Boolean(conv.state.activeLeadId) &&
    Boolean(incomingService) &&
    Boolean(priorService) &&
    incomingService !== priorService &&
    conv.state.facts?.pendingConfirmation !== "SECOND_SERVICE_CHOICE";

  let state = applyPackedExtraction(conv.state, text);
  if (secondService) {
    // Keep the first request's service while we ask how to continue.
    state = {
      ...state,
      primaryService: priorService,
      service: priorService,
      facts: {
        ...(state.facts || {}),
        pendingSecondService: incomingService,
      },
    };
  }
  touchConversation(conversationId, { state });
  const intent = classifyActionableServiceIntent(text, state);
  const pending = state.facts?.pendingConfirmation || "";
  const affirms =
    /^(s[ií]|ok|okay|dale|confirmo|afirmativo|de acuerdo|procede)([\s!.?]|$)/i.test(text.trim()) ||
    /\b(s[ií],?\s*cancel)/i.test(text.trim());
  const wantsSlots = /\b(horario|disponib|cita|agendar|mañana|pasado\s+mañana)/i.test(text);
  const ordinal =
    state.offeredSlots?.length &&
    (/^\s*(el\s+)?(primero|1|1o|uno)\b/i.test(text) ||
      /^\s*(el\s+)?(segundo|2|2o|dos)\b/i.test(text) ||
      /^\s*(el\s+)?(tercero|3|3o|tres)\b/i.test(text) ||
      /^\s*(el\s+)?(cuarto|4|4o|cuatro)\b/i.test(text));
  let slotPick = text.match(/\b(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\b/);
  if (!slotPick && state.offeredSlots?.length) {
    const hmOnly = text.match(/\b(\d{1,2}:\d{2})\b/);
    if (hmOnly) {
      const padded = (() => {
        const [hh, mm] = hmOnly[1].split(":");
        return `${hh.padStart(2, "0")}:${mm}`;
      })();
      const offered = state.offeredSlots.find((s) => s.time === padded);
      if (offered?.date && offered?.time) {
        slotPick = [offered.date + " " + offered.time, offered.date, offered.time] as unknown as RegExpMatchArray;
      }
    }
  }
  if (!slotPick && ordinal && state.offeredSlots?.length) {
    const idx = /^\s*(el\s+)?(segundo|2)/i.test(text)
      ? 1
      : /^\s*(el\s+)?(tercero|3)/i.test(text)
        ? 2
        : /^\s*(el\s+)?(cuarto|4)/i.test(text)
          ? 3
          : 0;
    const chosen = state.offeredSlots[Math.min(idx, state.offeredSlots.length - 1)];
    if (chosen?.date && chosen?.time) {
      slotPick = [chosen.date + " " + chosen.time, chosen.date, chosen.time] as unknown as RegExpMatchArray;
    }
  }
  // "el de las 8:00" / "a las 2" / labels with a. m. / p. m.
  if (!slotPick && state.offeredSlots?.length) {
    const hm = text.match(/\b(?:a\s+las\s+|las\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/i);
    if (hm) {
      const hour12 = Number(hm[1]);
      const mm = (hm[2] || "00").padStart(2, "0");
      const meridiem = (hm[3] || "").toLowerCase();
      const candidates = new Set<string>();
      const hh24from12 = (h: number, pm: boolean) => {
        let h24 = h % 12;
        if (pm) h24 += 12;
        if (!pm && h === 12) h24 = 0;
        return `${String(h24).padStart(2, "0")}:${mm}`;
      };
      if (/p/.test(meridiem)) candidates.add(hh24from12(hour12, true));
      else if (/a/.test(meridiem)) candidates.add(hh24from12(hour12, false));
      else {
        candidates.add(`${String(hour12).padStart(2, "0")}:${mm}`);
        candidates.add(hh24from12(hour12, true));
        candidates.add(hh24from12(hour12, false));
      }
      const chosen =
        state.offeredSlots.find((s) => candidates.has(s.time)) ||
        state.offeredSlots.find((s) => (s.label || "").includes(`${hour12}:${mm}`) || (s.label || "").includes(`${hour12}:`));
      if (chosen?.date && chosen?.time) {
        slotPick = [chosen.date + " " + chosen.time, chosen.date, chosen.time] as unknown as RegExpMatchArray;
      }
    }
  }
  const cancelAll = /\b(cancel\w*|anul\w*)\s+(todas|todo|todos)\b/i.test(text);
  const lockout = detectLockoutIntent(text) || state.facts?.serviceIntent === "lockout";
  const digitalLock = detectDigitalLockPurchaseIntent(text);

  let nextAction:
    | "BUSINESS_CONTACT"
    | "CANCEL_CONFIRM"
    | "CANCEL_ASK"
    | "CANCEL_ALL_ASK"
    | "CANCEL_ALL_CONFIRM"
    | "SECOND_SERVICE_ASK"
    | "BOOK"
    | "RESCHEDULE"
    | "UPSERT_AND_CONTINUE"
    | "CHECK_AVAILABILITY"
    | "HUMAN"
    | "ASK_MISSING"
    | "DIGITAL_LOCK"
    | "LOCKOUT" = "ASK_MISSING";

  if (isBusinessContactQuestion(text)) nextAction = "BUSINESS_CONTACT";
  else if (pending === "CANCEL_ALL" && affirms) nextAction = "CANCEL_ALL_CONFIRM";
  else if (pending && affirms) nextAction = "CANCEL_CONFIRM";
  else if (cancelAll) nextAction = "CANCEL_ALL_ASK";
  else if (intent.cancelRequest || intent.cancelAppointmentOnly || /\bcancel/i.test(text)) nextAction = "CANCEL_ASK";
  else if (/\b(reprogram\w*|cambiar\s+(la\s+)?(cita|hora|fecha))\b/i.test(text)) nextAction = "RESCHEDULE";
  else if (secondService) nextAction = "SECOND_SERVICE_ASK";
  else if (digitalLock) nextAction = "DIGITAL_LOCK";
  else if (lockout) nextAction = "LOCKOUT";
  else if (slotPick && state.offeredSlots?.length) nextAction = "BOOK";
  else if (wantsSlots && state.contactStatus === "VALID") nextAction = "CHECK_AVAILABILITY";
  else if (/\b(humano|asesor|persona)\b/i.test(text)) nextAction = "HUMAN";
  else if (intent.createServiceRequest || state.activeLeadId || state.contactStatus === "VALID")
    nextAction = "UPSERT_AND_CONTINUE";

  const missing: string[] = [];
  if (state.contactStatus !== "VALID") missing.push("phone");
  if (!state.location?.trim()) missing.push("location");

  // Do not force upsert while required fields are still missing (unless HS already exists).
  if (nextAction === "UPSERT_AND_CONTINUE" && missing.length && !state.activeLeadId) {
    nextAction = "ASK_MISSING";
  }

  return ok("route_decision", {
    nextAction,
    missing,
    pendingConfirmation: pending,
    activeLeadId: state.activeLeadId || "",
    appointmentId: state.appointmentId || "",
    offeredSlotCount: state.offeredSlots?.length || 0,
    lockout,
    digitalLock,
    createServiceRequest: intent.createServiceRequest,
    primaryIntent: intent.primaryIntent,
    // Hint for n8n book node
    bookHint: (() => {
      if (!slotPick) return null;
      const g1 = String(slotPick[1] || "");
      const g2 = String(slotPick[2] || "");
      let date = "";
      let time = "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(g1) && /^\d{1,2}:\d{2}$/.test(g2)) {
        date = g1;
        time = g2;
      } else if (/^\d{1,2}:\d{2}$/.test(g1)) {
        time = g1;
        date = state.offeredSlots?.find((s) => s.time === time || s.time.endsWith(time.slice(-5)))?.date ||
          state.offeredSlots?.[0]?.date ||
          "";
      } else {
        date = g1;
        time = g2;
      }
      if (/^\d{1,2}:\d{2}$/.test(time)) {
        const [hh, mm] = time.split(":");
        time = `${hh.padStart(2, "0")}:${mm}`;
      }
      // Prefer an exact offered slot when time matches.
      const offered = state.offeredSlots?.find((s) => s.time === time);
      if (offered?.date) date = offered.date;
      if (!date || !time) return null;
      return { date, time };
    })(),
  });
}

export function toolSecondServiceAsk(conversationId: string, text: string): ToolResultEnvelope {
  const conv = getConversation(conversationId);
  if (!conv) return fail("second_service", "not_found", "Conversación no encontrada");
  const incoming = detectServices(text)[0] || "";
  const current = conv.state.primaryService || conv.state.service || "";
  const parked = conv.state.activeLeadId || "";
  touchConversation(conversationId, {
    state: {
      ...conv.state,
      facts: {
        ...(conv.state.facts || {}),
        parkedRequestId: parked,
        parkedService: current,
        pendingSecondService: incoming,
        pendingConfirmation: "SECOND_SERVICE_CHOICE",
      },
    },
  });
  const playbookNew = getPlaybook(incoming);
  const playbookOld = getPlaybook(current);
  return ok("second_service", {
    reply: `Ya tienes una solicitud activa de ${playbookOld.label || current || "servicio"} (${parked || "sin folio"}). ¿Quieres (1) seguir con esa, o (2) abrir otra de ${playbookNew.label || incoming}? No reemplazo la primera sin que lo confirmes.`,
    parkedRequestId: parked,
    pendingService: incoming,
  });
}

export function toolCancelAllAsk(conversationId: string): ToolResultEnvelope {
  const conv = getConversation(conversationId);
  if (!conv) return fail("cancel_all", "not_found", "Conversación no encontrada");
  if (conv.state.contactStatus !== "VALID" || !conv.state.phone) {
    return fail("cancel_all", "unauthorized", "Necesito un teléfono verificado en esta conversación para listar solicitudes");
  }
  const phone = classifyPhone(conv.state.phone);
  const digits = phone.national || phone.digits || "";
  const rows = getHomesteadDb()
    .prepare(
      `SELECT public_id, service, status, phone FROM service_requests
       WHERE status NOT IN ('CANCELLED','COMPLETED')
       ORDER BY created_at DESC LIMIT 20`,
    )
    .all() as Array<{ public_id: string; service: string; status: string; phone: string }>;
  const authorized = rows.filter((r) => {
    const p = classifyPhone(r.phone);
    return p.national === digits || p.e164 === phone.e164;
  });
  if (!authorized.length) {
    return ok("cancel_all", {
      reply: "No encuentro solicitudes abiertas autorizadas para este teléfono.",
      items: [],
    });
  }
  touchConversation(conversationId, {
    state: {
      ...conv.state,
      facts: {
        ...(conv.state.facts || {}),
        pendingConfirmation: "CANCEL_ALL",
        cancelAllIds: authorized.map((r) => r.public_id).join(","),
      },
    },
  });
  const list = authorized.map((r) => `• ${r.public_id} (${r.service}, ${r.status})`).join("\n");
  return ok("cancel_all", {
    reply: `Estas son las solicitudes abiertas autorizadas para tu número:\n${list}\n¿Confirmas cancelar TODAS estas? Responde sí para proceder.`,
    items: authorized.map((r) => ({ publicId: r.public_id, service: r.service, status: r.status })),
  });
}

export function toolCancelAllConfirm(conversationId: string): ToolResultEnvelope {
  const conv = getConversation(conversationId);
  if (!conv) return fail("cancel_all_confirm", "not_found", "Conversación no encontrada");
  if (conv.state.facts?.pendingConfirmation !== "CANCEL_ALL") {
    return fail("cancel_all_confirm", "no_pending", "No hay confirmación de cancelar todas pendiente");
  }
  const ids = String(conv.state.facts.cancelAllIds || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const results: Array<{ publicId: string; ok: boolean; code?: string }> = [];
  for (const id of ids) {
    const row = getRequestByPublicId(id);
    if (!row) {
      results.push({ publicId: id, ok: false, code: "NOT_FOUND" });
      continue;
    }
    const r = cancelServiceRequest({
      requestId: id,
      actor: "concierge-n8n",
      source: "CUSTOMER_AI",
      conversationId,
      reason: "customer_cancel_all",
      notify: false,
      idempotencyKey: `service_request.cancelled:${id}:cancel_all`,
    });
    results.push({ publicId: id, ok: r.success || r.alreadyCancelled, code: r.errorCode });
  }
  touchConversation(conversationId, {
    state: {
      ...conv.state,
      activeLeadId: "",
      appointmentId: "",
      facts: { ...(conv.state.facts || {}), pendingConfirmation: "", cancelAllIds: "" },
    },
    leadPublicId: "",
  });
  bumpConversationStateVersion(conversationId);
  const lines = results.map((r) => `${r.publicId}: ${r.ok ? "cancelada" : `falló (${r.code || "error"})`}`);
  return ok("cancel_all_confirm", {
    reply: `Resultado de cancelación:\n${lines.join("\n")}`,
    results,
  });
}

/** Compose UI reply + persist turn DONE. Called by n8n at end of coordination. */
export function toolFinalizeTurn(body: {
  conversationId: string;
  turnId: string;
  reply: string;
  n8nExecutionId?: string;
  kind?: string;
}): ToolResultEnvelope {
  const { conversationId, turnId } = body;
  const reply = String(body.reply || "").trim();
  if (!reply) return fail("finalize_turn", "empty_reply", "Respuesta vacía");
  const turn = getTurn(turnId);
  if (!turn || turn.conversationId !== conversationId) {
    return fail("finalize_turn", "turn_mismatch", "Turno no pertenece a la conversación");
  }
  if (!shouldAcceptTurnResult(turnId)) {
    updateTurn(turnId, { status: "SUPERSEDED", completed: true });
    return fail("finalize_turn", "superseded", "Resultado atrasado; no sobrescribe estado reciente");
  }
  addMessage(conversationId, "assistant", reply);
  const conv = getConversation(conversationId);
  const session = conv ? buildSessionSnapshot(conv.state, Date.now(), conv.state.activeLeadId || "") : null;
  const payload: TurnReplyPayload = {
    ok: true,
    reply,
    turnId,
    status: "DONE",
    leadId: session?.leadBanner || conv?.state.activeLeadId || null,
    requestCard: (session?.requestCard as Record<string, unknown> | null) || null,
    chips: session?.chips || [],
    historicalChips: session?.historicalChips || [],
    awaitingSlotSelection: session?.awaitingSlotSelection || false,
    bookingPending: session?.bookingPending || false,
    slotGroups: session?.slotGroups || [],
    serviceContext: session?.serviceContext || null,
    showResumeBooking: session?.showResumeBooking || false,
    showPhotoCta: session?.showPhotoCta || false,
    photosRemaining: session?.photosRemaining ?? 4,
    contactUrl: "/contact",
    whatsappUrl: null,
    ended: false,
    requiresHuman: Boolean(conv?.state.humanHandoffRequested),
    dryLead: isConciergeDryRun(),
    engine: "n8n",
    nextAction: body.kind || "",
  };
  updateTurn(turnId, {
    status: "DONE",
    replyJson: JSON.stringify({
      ...payload,
      n8nExecutionId: body.n8nExecutionId || "",
      correlation: {
        conversationId,
        turnId,
        folio: conv?.state.activeLeadId || "",
        n8nExecutionId: body.n8nExecutionId || "",
      },
    }),
    completed: true,
  });
  bumpConversationStateVersion(conversationId);
  return ok("finalize_turn", {
    turnId,
    status: "DONE",
    folio: conv?.state.activeLeadId || "",
    n8nExecutionId: body.n8nExecutionId || "",
    payload,
  });
}

/** Build a folio announce line after upsert (for n8n to include in finalize). */
export function toolComposeAsk(conversationId: string, kind: string, toolData?: Record<string, unknown>): ToolResultEnvelope {
  const conv = getConversation(conversationId);
  if (!conv) return fail("compose_ask", "not_found", "Conversación no encontrada");
  const state = conv.state;
  const missing: string[] = [];
  if (state.contactStatus !== "VALID") missing.push("teléfono");
  if (!state.location?.trim()) missing.push("zona");

  let reply = "";
  if (kind === "folio_continue") {
    const folio = String(toolData?.publicId || state.activeLeadId || "");
    const playbook = getPlaybook(state.primaryService || state.service);
    const intro = folio ? requestFolioIntro(folio, playbook.label || "") : "";
    if (missing.includes("teléfono")) reply = `${intro}\n\nPara completar el registro, ¿me compartes un teléfono de contacto?`.trim();
    else if (missing.includes("zona")) reply = `${intro}\n\n¿En qué zona o barrio estás?`.trim();
    else reply = `${intro}\n\n¿Qué día y hora te conviene, o prefieres que el equipo te contacte?`.trim();
  } else if (kind === "slots") {
    const slots = (toolData?.slots as Array<{ label?: string; date: string; time: string }>) || state.offeredSlots || [];
    const lines = slots.slice(0, 4).map((s, i) => `${i + 1}) ${s.label || `${s.date} ${s.time}`}`);
    reply = lines.length
      ? `Estos horarios están libres ahora (se revalidan al reservar):\n${lines.join("\n")}\n¿Cuál te queda mejor?`
      : "No veo horarios libres en el rango cercano. ¿Prefieres que el equipo te contacte?";
  } else if (kind === "lockout") {
    reply =
      "Para registrar la apertura necesito un teléfono de contacto y la zona. No te pido fotos del interior si no puedes entrar.";
  } else if (kind === "digital_lock") {
    reply =
      "Para la cerradura digital me ayudan fotos del frente, el interior y el canto de la puerta cuando puedas obtenerlas. ¿Me compartes un teléfono y la zona?";
  } else if (kind === "missing") {
    if (missing.includes("teléfono")) reply = "Para completar el registro, ¿me compartes un teléfono de contacto?";
    else if (missing.includes("zona")) reply = "¿En qué zona o barrio estás?";
    else reply = "Cuéntame un poco más para seguir con tu solicitud.";
  } else {
    if (missing.includes("teléfono")) reply = "Para completar el registro, ¿me compartes un teléfono de contacto?";
    else if (missing.includes("zona")) reply = "¿En qué zona o barrio estás?";
    else reply = "Cuéntame un poco más para seguir con tu solicitud.";
  }
  return ok("compose_ask", { reply, missing, folio: state.activeLeadId || "" });
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
  | "reconcile_request"
  | "route_decision"
  | "second_service"
  | "cancel_all_ask"
  | "cancel_all_confirm"
  | "finalize_turn"
  | "compose_ask";

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
    case "route_decision":
      return toolRouteDecision(conversationId, String(body.text || ""));
    case "second_service":
      return toolSecondServiceAsk(conversationId, String(body.text || ""));
    case "cancel_all_ask":
      return toolCancelAllAsk(conversationId);
    case "cancel_all_confirm":
      return toolCancelAllConfirm(conversationId);
    case "finalize_turn":
      return toolFinalizeTurn({
        conversationId,
        turnId: String(body.turnId || ""),
        reply: String(body.reply || ""),
        n8nExecutionId: String(body.n8nExecutionId || ""),
        kind: String(body.kind || ""),
      });
    case "compose_ask":
      return toolComposeAsk(conversationId, String(body.kind || "ask"), body.toolData as Record<string, unknown> | undefined);
    default:
      return fail(String(tool), "unknown_tool", "Herramienta no permitida");
  }
}
