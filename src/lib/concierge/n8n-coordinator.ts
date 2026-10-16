/**
 * n8n-coordinated concierge turn runner.
 *
 * local  — in-process coordinator calling business-tools (isolated tests / no remote n8n)
 * remote — POST turn reference to n8n webhook; n8n calls /api/internal/concierge/*
 *
 * Never holds a SQLite transaction across network/AI waits.
 */
import {
  conciergeN8nMode,
  conciergeN8nWebhookUrl,
  conciergeInternalSecret,
  conciergeTurnTimeoutMs,
  isConciergeDryRun,
} from "@/lib/concierge-flags";
import { getConversation, addMessage, addEvent, touchConversation } from "@/lib/concierge-store";
import { buildSessionSnapshot } from "@/lib/concierge-transaction";
import { requestFolioIntro } from "@/lib/concierge/service-request-lifecycle";
import {
  createTurn,
  updateTurn,
  pinConversationEngine,
  getConversationEngine,
  shouldAcceptTurnResult,
  bumpConversationStateVersion,
} from "@/lib/concierge/turn-store";
import {
  toolGetContext,
  toolInterpret,
  toolUpsertRequest,
  toolCheckAvailability,
  toolBookAppointment,
  toolCancel,
  toolBusinessContact,
  toolHumanHandoff,
  toolSaveFacts,
} from "@/lib/concierge/business-tools";
import type { StructuredIntent, TurnReplyPayload } from "@/lib/concierge/turn-protocol";
import { classifyPhone } from "@/lib/phone";
import { applyPackedExtraction } from "@/lib/concierge/packed-extraction";
import { detectServices } from "@/lib/concierge/playbook-engine";
import { getPlaybook } from "@/lib/concierge/service-playbooks";
import { logInfo, logError } from "@/lib/log";

function formFallbackReply(): TurnReplyPayload {
  return {
    ok: true,
    reply:
      "En este momento el asistente coordinado no está disponible. Puedes dejar tu solicitud en el formulario de contacto y el equipo te responde.",
    turnId: "",
    status: "FAILED",
    contactUrl: "/contact",
    chips: [],
    processing: false,
    engine: "n8n",
  };
}

function sessionPayload(conversationId: string, turnId: string, reply: string, extra?: Partial<TurnReplyPayload>): TurnReplyPayload {
  const conv = getConversation(conversationId);
  const session = conv ? buildSessionSnapshot(conv.state, Date.now(), conv.state.activeLeadId || "") : null;
  return {
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
    ...extra,
  };
}

async function runLocalCoordinator(input: {
  conversationId: string;
  turnId: string;
  text: string;
  utm?: Record<string, string>;
}): Promise<TurnReplyPayload> {
  const { conversationId, turnId, text, utm } = input;
  updateTurn(turnId, { status: "CONTEXT_LOADED" });
  toolGetContext(conversationId);

  updateTurn(turnId, { status: "INTERPRETING" });
  // Persist packed extraction into state (short write).
  const conv0 = getConversation(conversationId);
  if (!conv0) return formFallbackReply();
  let state = applyPackedExtraction(conv0.state, text);
  const detected = detectServices(text);
  if (detected[0] && !state.primaryService) {
    state.primaryService = detected[0];
    state.service = detected[0];
  }
  if (!state.problem?.trim() && text.length >= 8) state.problem = text.slice(0, 240);
  touchConversation(conversationId, { state });

  const interpreted = toolInterpret(conversationId, text);
  const intent = (interpreted.data?.intent || {}) as StructuredIntent;

  updateTurn(turnId, { status: "TOOLS" });

  // Pending confirmation (cancel) — check before other intents; accept short affirmatives.
  const pending = getConversation(conversationId)?.state.facts?.pendingConfirmation || "";
  const affirms =
    /^(s[ií]|ok|okay|dale|confirmo|afirmativo|de acuerdo|procede)([\s!.?]|$)/i.test(text.trim()) ||
    /\b(s[ií],?\s*cancel)/i.test(text.trim());
  if (pending && affirms) {
    const scope = pending === "CANCEL_APPOINTMENT" ? "appointment" : "request";
    const cancelled = await toolCancel(conversationId, scope, true);
    const reply = cancelled.ok
      ? scope === "appointment"
        ? "Listo, cancelé la cita. La solicitud queda abierta si aún necesitas el servicio."
        : `Cancelé la solicitud ${cancelled.data?.publicId || ""}. Si necesitas algo más, dímelo.`
      : `No pude completar la cancelación (${cancelled.code || "error"}). ¿Me confirmas de nuevo?`;
    addMessage(conversationId, "assistant", reply);
    const payload = sessionPayload(conversationId, turnId, reply);
    updateTurn(turnId, { status: "DONE", replyJson: JSON.stringify(payload), completed: true });
    return payload;
  }

  if (intent.businessContactQuestion) {
    const biz = toolBusinessContact();
    const reply = String(biz.data?.reply || "No tengo un contacto comercial verificado para compartir aquí.");
    addMessage(conversationId, "assistant", reply);
    const payload = sessionPayload(conversationId, turnId, reply);
    updateTurn(turnId, { status: "DONE", replyJson: JSON.stringify(payload), completed: true });
    return payload;
  }

  if (intent.humanHandoff) {
    const hand = toolHumanHandoff(conversationId);
    const reply = String(hand.data?.reply || "Dejo tu caso para revisión humana.");
    addMessage(conversationId, "assistant", reply);
    const payload = sessionPayload(conversationId, turnId, reply, { requiresHuman: true });
    updateTurn(turnId, { status: "DONE", replyJson: JSON.stringify(payload), completed: true });
    return payload;
  }

  if (intent.cancelRequest || intent.cancelAppointmentOnly) {
    const scope = intent.cancelAppointmentOnly ? "appointment" : "request";
    await toolCancel(conversationId, scope, false);
    const reply =
      scope === "appointment"
        ? "¿Confirmas que cancelo solo la cita (no la solicitud)?"
        : "¿Confirmas que cancelo la solicitud completa? Responde sí para confirmar.";
    addMessage(conversationId, "assistant", reply);
    const payload = sessionPayload(conversationId, turnId, reply);
    updateTurn(turnId, { status: "DONE", replyJson: JSON.stringify(payload), completed: true });
    return payload;
  }

  // Save any phone embedded this turn (corrections)
  const phone = classifyPhone(text);
  if (phone.status !== "VALID") {
    const embedded = text.match(/\b\d{4}[\s-]?\d{4}\b/);
    if (embedded) {
      const p2 = classifyPhone(embedded[0]);
      if (p2.status === "VALID") {
        toolSaveFacts(conversationId, { phone: p2.e164 || embedded[0] });
      }
    }
  } else {
    toolSaveFacts(conversationId, { phone: phone.e164 || text });
  }

  const after = getConversation(conversationId)?.state;
  const missing: string[] = [];
  if (after?.contactStatus !== "VALID") missing.push("teléfono");
  if (!after?.location?.trim()) missing.push("zona");
  if (!(after?.primaryService || after?.service)) missing.push("servicio");

  let folioAnnounce = "";
  const readyToCreate =
    after?.contactStatus === "VALID" &&
    Boolean(after?.location?.trim()) &&
    Boolean(after?.primaryService || after?.service || after?.problem);

  if (readyToCreate || intent.createServiceRequest) {
    // Ensure service set for plumbing journey
    if (after && !after.primaryService && !after.service) {
      const svc = detectServices(text)[0] || (/\bfuga|gotera|lavamanos|plomer/i.test(text) ? "plumbing" : "");
      if (svc) toolSaveFacts(conversationId, { primaryService: svc, service: svc });
    }
    const upserted = await toolUpsertRequest(conversationId, text, utm);
    if (upserted.ok && upserted.data?.publicId) {
      const playbook = getPlaybook(String(after?.primaryService || "plumbing"));
      const shown = getConversation(conversationId)?.state.facts?.requestFolioShown === "1";
      if (upserted.data.announce || !shown) {
        folioAnnounce = requestFolioIntro(String(upserted.data.publicId), playbook?.label || "");
        const c = getConversation(conversationId);
        if (c) {
          touchConversation(conversationId, {
            state: { ...c.state, facts: { ...(c.state.facts || {}), requestFolioShown: "1" } },
          });
        }
      }
    }
  }

  // Booking language → availability
  const wantsSlots = /\b(horario|disponib|cita|agendar|mañana|pasado\s+mañana|a\s+las\s+\d)/i.test(text);
  const slotPick = text.match(/\b(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\b/) || text.match(/\b(\d{1,2}:\d{2})\b/);
  const current = getConversation(conversationId)?.state;

  if (slotPick && current?.offeredSlots?.length) {
    const time = slotPick[2] || slotPick[1];
    const match =
      current.offeredSlots.find((s) => s.time === time || s.label?.includes(time)) ||
      current.offeredSlots[0];
    if (match?.date && match?.time) {
      const booked = await toolBookAppointment(conversationId, {
        date: match.date,
        time: match.time,
        idempotencyKey: `n8n-book:${conversationId}:${match.date}:${match.time}`,
      });
      const reply = booked.ok
        ? `Quedó reservada la visita para ${match.label || `${match.date} ${match.time}`}.${folioAnnounce ? ` ${folioAnnounce}` : ""}`
        : `${folioAnnounce ? folioAnnounce + " " : ""}Aún no pude confirmar ese horario. ¿Probamos otra opción?`;
      addMessage(conversationId, "assistant", reply.trim());
      const payload = sessionPayload(conversationId, turnId, reply.trim());
      updateTurn(turnId, { status: "DONE", replyJson: JSON.stringify(payload), completed: true });
      return payload;
    }
  }

  if (wantsSlots && current?.contactStatus === "VALID") {
    const avail = await toolCheckAvailability(conversationId, {
      date: current.preferredDate || "",
      service: current.primaryService || current.service || "plumbing",
    });
    const slots = (avail.data?.slots as Array<{ date: string; time: string; label: string }>) || [];
    const lines = slots.slice(0, 4).map((s, i) => `${i + 1}) ${s.label || `${s.date} ${s.time}`}`);
    const reply = [
      folioAnnounce,
      lines.length
        ? `Estos horarios están libres ahora (se revalidan al reservar):\n${lines.join("\n")}\n¿Cuál te queda mejor?`
        : "No veo horarios libres en el rango cercano. ¿Prefieres que el equipo te contacte para coordinar?",
    ]
      .filter(Boolean)
      .join("\n\n");
    addMessage(conversationId, "assistant", reply);
    const payload = sessionPayload(conversationId, turnId, reply);
    updateTurn(turnId, { status: "DONE", replyJson: JSON.stringify(payload), completed: true });
    return payload;
  }

  // Ask next missing field — one useful question
  let ask = "";
  if (missing.includes("teléfono")) ask = "Para registrar la solicitud, ¿me compartes un teléfono de contacto?";
  else if (missing.includes("zona")) ask = "¿En qué zona o barrio estás?";
  else if (missing.includes("servicio") && !current?.problem) ask = "¿Qué está pasando exactamente?";
  else if (folioAnnounce) ask = "¿Qué día y hora te conviene, o prefieres que el equipo te contacte?";
  else if (current?.activeLeadId)
    ask = "Ya tengo tu solicitud. ¿Reviso horarios disponibles o prefieres que te contacten?";
  else ask = "Cuéntame un poco más (zona y teléfono) para dejarla registrada.";

  const reply = [folioAnnounce, ask].filter(Boolean).join("\n\n");
  addMessage(conversationId, "assistant", reply);
  bumpConversationStateVersion(conversationId);
  const payload = sessionPayload(conversationId, turnId, reply);
  updateTurn(turnId, { status: "DONE", replyJson: JSON.stringify(payload), completed: true });
  return payload;
}

async function runRemoteCoordinator(input: {
  conversationId: string;
  turnId: string;
  messageId: string;
  text: string;
}): Promise<TurnReplyPayload> {
  const url = conciergeN8nWebhookUrl();
  const secret = conciergeInternalSecret();
  if (!url || !secret) {
    logError("ConciergeN8nRemoteMisconfigured", { contentJobId: input.conversationId.slice(0, 8) });
    return formFallbackReply();
  }
  updateTurn(input.turnId, { status: "INTERPRETING" });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-homestead-internal-secret": secret,
      },
      body: JSON.stringify({
        turnId: input.turnId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        // No raw PII beyond what n8n needs to fetch context via tools
        hasText: Boolean(input.text),
        textLength: input.text.length,
      }),
      signal: AbortSignal.timeout(Math.min(conciergeTurnTimeoutMs(), 20000)),
    });
    if (!res.ok) {
      updateTurn(input.turnId, { status: "FAILED", errorCode: `webhook_${res.status}`, completed: true });
      return formFallbackReply();
    }
  } catch {
    updateTurn(input.turnId, { status: "FAILED", errorCode: "webhook_unreachable", completed: true });
    return formFallbackReply();
  }

  // Poll turn until DONE / timeout
  const deadline = Date.now() + conciergeTurnTimeoutMs();
  while (Date.now() < deadline) {
    const turn = (await import("@/lib/concierge/turn-store")).getTurn(input.turnId);
    if (!turn) break;
    if (turn.status === "DONE" && turn.replyJson) {
      if (!shouldAcceptTurnResult(input.turnId)) {
        updateTurn(input.turnId, { status: "SUPERSEDED", completed: true });
        return formFallbackReply();
      }
      try {
        return JSON.parse(turn.replyJson) as TurnReplyPayload;
      } catch {
        break;
      }
    }
    if (turn.status === "FAILED" || turn.status === "TIMED_OUT") break;
    await new Promise((r) => setTimeout(r, 400));
  }
  updateTurn(input.turnId, { status: "TIMED_OUT", errorCode: "turn_timeout", completed: true });
  return {
    ...formFallbackReply(),
    reply: "Está tardando más de lo normal. Tus datos siguen guardados; puedes reintentar o usar el formulario de contacto.",
    status: "TIMED_OUT",
    turnId: input.turnId,
    processing: false,
  };
}

export async function runConciergeN8nTurn(input: {
  conversationId: string;
  message: string;
  utm?: Record<string, string>;
  idempotencyKey?: string;
}): Promise<TurnReplyPayload> {
  const text = String(input.message || "").trim();
  if (!text) {
    return { ok: false, reply: "", turnId: "", status: "FAILED", error: "empty" };
  }

  const pinned = getConversationEngine(input.conversationId);
  const pin = pinConversationEngine(input.conversationId, "n8n");
  if (!pin.ok && pinned === "legacy") {
    return {
      ok: false,
      reply: "Esta conversación ya está en el motor anterior. Abre un chat nuevo para usar el motor n8n.",
      turnId: "",
      status: "FAILED",
      error: "engine_pinned",
      engine: "legacy",
    };
  }

  const turn = createTurn({
    conversationId: input.conversationId,
    userText: text,
    engine: "n8n",
    idempotencyKey: input.idempotencyKey || "",
  });

  // Idempotent replay
  if (turn.status === "DONE" && turn.replyJson) {
    try {
      return JSON.parse(turn.replyJson) as TurnReplyPayload;
    } catch {
      /* continue */
    }
  }

  addMessage(input.conversationId, "user", text);
  addEvent(input.conversationId, "CHAT_MESSAGE");
  logInfo("CONCIERGE_N8N_TURN_START", {
    contentJobId: input.conversationId.slice(0, 8),
    stage: conciergeN8nMode(),
    phone: turn.turnId.slice(0, 8),
  });

  try {
    if (conciergeN8nMode() === "remote") {
      return await runRemoteCoordinator({
        conversationId: input.conversationId,
        turnId: turn.turnId,
        messageId: turn.messageId,
        text,
      });
    }
    updateTurn(turn.turnId, { status: "PERSISTING" });
    return await runLocalCoordinator({
      conversationId: input.conversationId,
      turnId: turn.turnId,
      text,
      utm: input.utm,
    });
  } catch (error) {
    logError("ConciergeN8nTurnFailed", {
      contentJobId: input.conversationId.slice(0, 8),
      stage: error instanceof Error ? `${error.name}:${error.message}`.slice(0, 120) : "error",
    });
    updateTurn(turn.turnId, {
      status: "FAILED",
      errorCode: "exception",
      completed: true,
    });
    return formFallbackReply();
  }
}
