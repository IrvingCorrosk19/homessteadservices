import { conciergeKnowledge, conciergeSystemPrompt } from "@/lib/concierge-knowledge";
import { stripHallucinatedPrices, enforceAvailabilityIntegrity, enforceBookingIntegrity, injectionDeniedReply } from "@/lib/concierge-integrity";
import {
  addEvent,
  addMessage,
  createConversation,
  endTurn,
  getConversation,
  photoCount,
  recentMessages,
  recordUsage,
  savePhoto,
  touchConversation,
  tryBeginTurn,
  type ConversationState,
} from "@/lib/concierge-store";
import { assessUserContact, isPassiveClose, shouldStopCommercial } from "@/lib/concierge-contact";
import { canHandoffLead, createLeadFromConcierge, stopLeadIfPresent } from "@/lib/concierge-handoff";
import { classifyPhone, looksLikePhoneAttempt } from "@/lib/phone";
import { whatsappHref } from "@/lib/site";
import { logError } from "@/lib/log";
import { conciergeApiKey, conciergeModel, isConciergeDryRun, isConciergeEnabled } from "@/lib/concierge-flags";
import { CONCIERGE_TOOLS, executeConciergeTool, mergeParsedWhen, type ToolContext } from "@/lib/concierge-tools";
import { inferOutcome, recordFunnelEvent, setConversationOutcome } from "@/lib/concierge-intelligence";
import { formatPanamaSlot } from "@/lib/concierge-datetime";
import type { AvailabilitySlot } from "@/lib/concierge-availability";
import type { SniffedImage } from "@/lib/photos";
import { getPlaybook } from "@/lib/concierge/service-playbooks";
import {
  applyLocationCorrection,
  countQuestions,
  missingUsefulFacts,
  playbookPromptBlock,
  redactForModel,
} from "@/lib/concierge/playbook-engine";
import { copyConciergePhotosToRequest } from "@/lib/concierge/photo-link";
import { formatConciergePhotoMessage } from "@/lib/concierge-photo-message";
import { applyPackedExtraction } from "@/lib/concierge/packed-extraction";
import {
  detectRepeatedQuestion,
  questionEconomyBlock,
  shouldFlagOverquestioning,
} from "@/lib/concierge/turn-intelligence";
import {
  areOfferedSlotsActive,
  buildSessionSnapshot,
  clearActiveTransactionState,
  isReturningGreeting,
  reconcileTransactionState,
  resolveSlotFromMessage,
  shouldShowLeadBanner,
} from "@/lib/concierge-transaction";
import {
  bookingPauseReply,
  interpretTurnRoute,
  looksLikeAvailabilityLoop,
  newNeedReply,
  priceGuidanceReply,
  socialAckReply,
} from "@/lib/concierge-turn-routing";

export { isConciergeDryRun, isConciergeEnabled };

const SAFETY_RE = /chispa|humo|olor a quemado|electroc|incendio|gas(olina)?\s*(fug|olor)|inundaci[oó]n/i;
const EXIT_RE = /\bno gracias\b|\bno,? gracias\b|deja as[ií]|no quiero que me contacten/i;
const HUMAN_RE = /persona|humano|asesor|hablar con alguien|un t[eé]cnico/i;
const INJECTION_RE = /ignore (all|previous)|olvida( tus)? instrucciones|system prompt|api key|act[úu]a como/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

type ChatMessage = { role: string; content: string | unknown; tool_calls?: unknown; tool_call_id?: string; name?: string };

function fallbackReply(message: string, state?: ConversationState) {
  if (SAFETY_RE.test(message)) {
    return "Si hay chispas, humo, olor a gas o riesgo inmediato, aléjate y usa los servicios de emergencia. Cuando estés en un lugar seguro, dime qué ocurrió y en qué zona estás.";
  }
  if (INJECTION_RE.test(message)) return injectionDeniedReply();
  if (EXIT_RE.test(message)) return "Claro, lo dejamos ahí. Cuando quieras retomar una reparación o mantenimiento, aquí estamos.";
  const service = state?.primaryService || state?.service;
  const playbook = service ? getPlaybook(service) : null;
  if (playbook?.bookingStrategy === "PHOTO_REVIEW_FIRST") {
    return "Sigo contigo. Si puedes, envíame una foto de la puerta y la cerradura; con eso avanzamos más rápido.";
  }
  if (playbook?.serviceId === "ac") {
    return "Sigo contigo con lo del aire. Cuéntame qué está pasando o, si ya lo mencionaste, dime en qué zona estás para coordinar.";
  }
  if (playbook) {
    return "Sigo contigo. Lo que ya me contaste queda anotado; si me dejas tu teléfono y zona, el equipo puede darle seguimiento.";
  }
  return "Estoy teniendo un inconveniente para continuar por aquí. Lo que ya me contaste queda anotado. Si me dejas tu teléfono y qué hay que revisar, nuestro equipo le da seguimiento.";
}

function extractCasualFacts(state: ConversationState, text: string) {
  const next = applyPackedExtraction(state, text);
  const soy = text.match(/\bsoy\s+([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,3})/i);
  if (soy && !looksLikePhoneAttempt(soy[1]) && !next.name) next.name = soy[1].trim().slice(0, 80);
  const email = text.match(EMAIL_RE);
  if (email) next.email = email[0];
  next.location = applyLocationCorrection(text, next.location);
  if (next.location) next.facts = { ...(next.facts || {}), location: next.location };
  return mergeParsedWhen(next, text);
}

async function completeTurn(messages: ChatMessage[]) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 28_000);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${conciergeApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: conciergeModel(),
        temperature: 0.5,
        tools: CONCIERGE_TOOLS,
        messages,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`openai_${response.status}`);
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }> } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      message: data.choices?.[0]?.message || { content: "" },
      usage: data.usage,
    };
  } finally {
    clearTimeout(timer);
  }
}

function chipsFrom(state: ConversationState, booked: boolean, human: boolean) {
  if (human || booked) return [];
  if (!areOfferedSlotsActive(state) || state.bookingSuspended) return [];
  return state.offeredSlots.slice(0, 6).map((item) => item.label);
}

export function canCreateLead(state: ConversationState) {
  return canHandoffLead(state);
}

export async function conciergeTurn(input: {
  conversationId: string;
  message: string;
  utm?: Record<string, string>;
  skipUserMessage?: boolean;
}) {
  const conversation = getConversation(input.conversationId);
  if (!conversation) return { ok: false as const, error: "session" };
  if (!tryBeginTurn(input.conversationId)) {
    return { ok: false as const, error: "busy" };
  }
  try {
    const text = input.message.trim().slice(0, 2000);
    if (!input.skipUserMessage) {
      addMessage(input.conversationId, "user", text);
    }
    addEvent(input.conversationId, "CHAT_MESSAGE");
    let state = reconcileTransactionState(conversation.state, text, conversation.leadPublicId);
    touchConversation(input.conversationId, { state });
    state = extractCasualFacts(state, text);
    const returningGreeting = isReturningGreeting(text);
    let leadCreatedThisTurn = false;

    const route = interpretTurnRoute(text, state);
    if (route.priceIntent || route.serviceQuestionIntent || route.objectionIntent) {
      state = { ...state, bookingSuspended: true };
    }
    if (route.bookingPauseIntent) {
      state = { ...state, bookingSuspended: true, awaitingSlotSelection: false };
    }
    if (route.resumeBookingIntent || route.slotSelectionIntent) {
      state = { ...state, bookingSuspended: false };
    }

    const matchedSlot =
      route.slotSelectionIntent && areOfferedSlotsActive(state)
        ? resolveSlotFromMessage(text, state.offeredSlots)
        : null;
    if (matchedSlot) {
      state.preferredDate = matchedSlot.date;
      state.preferredTime = matchedSlot.time;
    }

    if (route.isInterruption) {
      addEvent(input.conversationId, "INTENT_INTERRUPTION");
      recordFunnelEvent(input.conversationId, "IntentDetected", {
        intent: route.priceIntent
          ? "price"
          : route.newNeedIntent
            ? "new_need"
            : route.bookingPauseIntent
              ? "booking_pause"
              : "interruption",
      });
    }

    const contact = assessUserContact(text, state.phone);
    if (looksLikePhoneAttempt(text) || contact.status !== "UNKNOWN") addEvent(input.conversationId, "CONTACT_VALIDATION_ATTEMPT");
    if (contact.status === "VALID") {
      const classified = classifyPhone(contact.raw);
      state.phone = classified.e164 || classified.display;
      state.contactStatus = "VALID";
      addEvent(input.conversationId, "VALID_CONTACT");
    } else if (contact.status === "INCOMPLETE") {
      state.contactStatus = "INCOMPLETE";
    } else if (contact.status === "INVALID") {
      state.contactStatus = "INVALID";
    }

    if (INJECTION_RE.test(text)) {
      addMessage(input.conversationId, "assistant", injectionDeniedReply());
      touchConversation(input.conversationId, { state });
      const session = buildSessionSnapshot(state);
      return {
        ok: true as const,
        reply: injectionDeniedReply(),
        chips: session.chips,
        historicalChips: session.historicalChips,
        leadBanner: null,
        nextAction: "ASK_SERVICE_QUESTION",
        leadId: null,
        dryLead: false,
        whatsappUrl: null,
        contactUrl: "/contact",
        ended: false,
        requiresHuman: false,
        awaitingSlotSelection: session.awaitingSlotSelection,
        bookingPending: session.bookingPending,
        slotGroups: session.slotGroups,
        serviceContext: session.serviceContext,
        showResumeBooking: session.showResumeBooking,
        showPhotoCta: session.showPhotoCta,
        photosRemaining: session.photosRemaining,
      };
    }

    if (shouldStopCommercial(text) || EXIT_RE.test(text)) {
      const reply = "Queda anotado: no te contactaremos. Si más adelante quieres retomar un servicio de Homestead, aquí estamos.";
      if (conversation.leadPublicId) stopLeadIfPresent(conversation.leadPublicId);
      addEvent(input.conversationId, "STOP_SIGNAL");
      addMessage(input.conversationId, "assistant", reply);
      setConversationOutcome(input.conversationId, "ABANDONED");
      const cleared = clearActiveTransactionState({ ...state, funnelStage: "ABANDONED" }, state.offeredSlots.length > 0);
      touchConversation(input.conversationId, { state: cleared });
      const session = buildSessionSnapshot(cleared);
      return {
        ok: true as const,
        reply,
        chips: [],
        historicalChips: session.historicalChips,
        leadBanner: null,
        nextAction: "CLOSE",
        leadId: null,
        dryLead: false,
        whatsappUrl: null,
        contactUrl: "/contact",
        ended: true,
        requiresHuman: false,
        awaitingSlotSelection: false,
      };
    }

    const knowledge = conciergeKnowledge();
    let reply = "";
    const ctx: ToolContext = {
      conversationId: input.conversationId,
      state,
      leadId: state.activeLeadId || (conversation.leadPublicId && !conversation.leadPublicId.startsWith("DRY-") ? conversation.leadPublicId : ""),
      summary: [state.problem, state.service, state.location].filter(Boolean).join(". "),
      utm: conversation.utm,
      bookedThisTurn: false,
      lastSlots: areOfferedSlotsActive(state) ? [...(state.offeredSlots || [])] as AvailabilitySlot[] : [],
    };

    if (conciergeApiKey()) {
      try {
        const playbook = getPlaybook(state.primaryService || state.service);
        const missing = missingUsefulFacts(state, playbook);
        const history = recentMessages(input.conversationId, 10);
        const interruptionBlock = route.isInterruption
          ? [{
              role: "system" as const,
              content: `INTERRUPCIÓN (${route.priceIntent ? "PRECIO" : route.newNeedIntent ? "NUEVA NECESIDAD" : route.bookingPauseIntent ? "PAUSAR AGENDA" : route.serviceQuestionIntent ? "PREGUNTA SERVICIO" : route.socialAckIntent ? "AGRADECIMIENTO" : "INTERRUPCIÓN"}): el cliente NO está eligiendo horario ahora. Responde esa intención primero. NO repitas la lista de horarios salvo que pida retomar la cita.`,
            }]
          : [];
        const messages: ChatMessage[] = [
          {
            role: "system",
            content: conciergeSystemPrompt(
              knowledge,
              `${playbookPromptBlock(playbook, state, missing)}\n\n${questionEconomyBlock(state, playbook)}`,
            ),
          },
          ...interruptionBlock,
          {
            role: "system",
            content: `ESTADO ACTUAL (no lo preguntes de nuevo si ya está): ${JSON.stringify({
              name: state.name || null,
              phone: state.contactStatus === "VALID" ? "valid" : state.contactStatus,
              email: state.email ? "present" : null,
              location: state.location || null,
              propertyType: state.propertyType || null,
              service: state.primaryService || state.service || null,
              detectedServices: state.detectedServices || [],
              facts: state.facts || {},
              problem: state.problem || null,
              preferredDate: state.preferredDate || null,
              preferredTime: state.preferredTime || null,
              lead: ctx.leadId || null,
              appointmentId: state.appointmentId || null,
              offeredSlots: state.offeredSlots,
              photos: photoCount(input.conversationId),
              bookingStrategy: state.bookingStrategy || playbook.bookingStrategy,
              urgency: state.urgency || "normal",
              safety: SAFETY_RE.test(text),
            })}`,
          },
          ...history.map((item) => ({
            role: item.role === "assistant" ? "assistant" : "user",
            content: redactForModel(item.body),
          })),
        ];
        for (let round = 0; round < 3; round += 1) {
          const result = await completeTurn(messages);
          if (result.usage) {
            recordUsage(input.conversationId, result.usage.prompt_tokens || 0, result.usage.completion_tokens || 0);
          }
          const toolCalls = result.message.tool_calls || [];
          if (!toolCalls.length) {
            reply = String(result.message.content || "").trim();
            break;
          }
          messages.push({
            role: "assistant",
            content: result.message.content || "",
            tool_calls: toolCalls,
          });
          for (const call of toolCalls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(call.function?.arguments || "{}") as Record<string, unknown>;
            } catch {
              args = {};
            }
            const executed = await executeConciergeTool(call.function?.name || "", args, ctx);
            ctx.state = executed.state;
            ctx.leadId = executed.leadId;
            state = executed.state;
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              name: call.function?.name || "",
              content: JSON.stringify(executed.result),
            });
          }
        }
      } catch (error) {
        logError("ConciergeOpenAiFailed", {
          stage: error instanceof Error ? error.name : "error",
          contentJobId: input.conversationId.slice(0, 8),
        });
      }
    }

    if (state.contactStatus === "INCOMPLETE" && looksLikePhoneAttempt(text)) {
      reply = "Me faltan algunos dígitos de ese número. ¿Me lo das completo, con el código de área si lo tienes?";
    } else if (state.contactStatus === "INVALID" && looksLikePhoneAttempt(text)) {
      reply = "Ese número no me quedó claro. ¿Me lo envías con todos los dígitos?";
    }

    if (!reply) reply = fallbackReply(text, state);

    if (SAFETY_RE.test(text) && !/emergencia|aleja|911|bomberos/.test(reply.toLowerCase())) {
      reply = fallbackReply(text, state);
    }

    const repeated = detectRepeatedQuestion(reply, state);
    if (repeated.length) {
      addEvent(input.conversationId, "REPEATED_QUESTION");
      recordFunnelEvent(input.conversationId, "IntentDetected", { intent: "repeated_question", service: repeated.join(",") });
    }

    if (!ctx.leadId && canCreateLead(state) && !returningGreeting) {
      const created = await createLeadFromConcierge({
        conversationId: input.conversationId,
        state,
        summary: ctx.summary || state.problem,
        existingLeadId: state.activeLeadId || "",
        utm: conversation.utm,
        escalate: HUMAN_RE.test(text) || state.humanRequested,
      });
      if (created) {
        ctx.leadId = created;
        state.activeLeadId = created;
        leadCreatedThisTurn = true;
      }
    }

    const lastAssistant = recentMessages(input.conversationId, 6)
      .filter((item) => item.role === "assistant")
      .pop()?.body || "";

    const priced = stripHallucinatedPrices(reply);
    reply = priced.text;

    if (route.priceIntent && (looksLikeAvailabilityLoop(reply) || !reply.trim())) {
      reply = priceGuidanceReply(state, true);
      addEvent(input.conversationId, "PRICE_INTENT_HANDLED");
    } else if (route.newNeedIntent && looksLikeAvailabilityLoop(reply)) {
      reply = newNeedReply();
    } else if (route.bookingPauseIntent) {
      reply = bookingPauseReply();
    } else if (route.socialAckIntent && looksLikeAvailabilityLoop(reply)) {
      reply = socialAckReply(state);
    } else if (
      route.isInterruption &&
      looksLikeAvailabilityLoop(reply) &&
      looksLikeAvailabilityLoop(lastAssistant)
    ) {
      addEvent(input.conversationId, "RESPONSE_LOOP_DETECTED");
      reply = route.priceIntent
        ? priceGuidanceReply(state, true)
        : route.newNeedIntent
          ? newNeedReply()
          : socialAckReply(state);
    }

    if (isPassiveClose(reply) && !ctx.bookedThisTurn) {
      reply = state.contactStatus === "VALID"
        ? "Cuando quieras, revisamos un horario real para la visita. ¿Qué día te queda mejor?"
        : "Cuando quieras te ayudo a dejar los datos para que el equipo te contacte. ¿Me compartes un teléfono?";
    }
    if (ctx.bookedThisTurn) {
      const slot = state.pendingSlot;
      const when = slot?.date && slot?.time ? formatPanamaSlot(slot.date, slot.time) : "el horario acordado";
      if (!/\b(agendad|confirmad)\b/i.test(reply) || /estos horarios sí están libres/i.test(reply)) {
        reply = `Listo. La visita quedó agendada para ${when}. Ya está en nuestro calendario.`;
      }
    } else {
      const availability = enforceAvailabilityIntegrity(reply, ctx.lastSlots, {
        skipRewrite: route.isInterruption || route.priceIntent || route.bookingPauseIntent || route.newNeedIntent,
      });
      reply = availability.text;
      const booked = enforceBookingIntegrity(reply, false);
      reply = booked.text;
    }

    if (HUMAN_RE.test(text)) {
      state.humanRequested = true;
      state.humanHandoffRequested = true;
      addEvent(input.conversationId, "HUMAN_HANDOFF_REQUESTED");
      if (!/ya dejo tu solicitud|nuestro equipo/i.test(reply)) {
        reply = ctx.leadId
          ? "Claro. Ya dejo tu solicitud para que podamos continuar contigo. Un miembro del equipo te contacta; no tengo a alguien en línea en este chat."
          : "Claro. Si me dejas un teléfono, dejo la solicitud para que el equipo te contacte. No tengo a alguien en línea en este chat.";
      }
    }
    const ended = Boolean(state.humanHandoffRequested && HUMAN_RE.test(text));
    state.questionsAsked = (state.questionsAsked || 0) + (countQuestions(reply) > 0 ? 1 : 0);
    if (shouldFlagOverquestioning(state, state.questionsAsked, ctx.leadId, state.appointmentId)) {
      addEvent(input.conversationId, "OVERQUESTIONING");
    }
    const outcome = inferOutcome({
      appointmentId: state.appointmentId,
      leadId: ctx.leadId,
      ended,
      unsupported: false,
    });
    if (ended || state.appointmentId) setConversationOutcome(input.conversationId, outcome);

    touchConversation(input.conversationId, {
      state,
      summary: ctx.summary || conversation.summary,
      leadPublicId: ctx.leadId || conversation.leadPublicId,
    });
    addMessage(input.conversationId, "assistant", reply);

    const leadBanner = shouldShowLeadBanner();
    const session = buildSessionSnapshot(state);

    const wa =
      knowledge.whatsappConfigured && ctx.leadId && leadBanner
        ? whatsappHref(`Hola, vengo del asistente de Homestead Services. Mi solicitud es ${ctx.leadId}.`)
        : null;

    return {
      ok: true as const,
      reply,
      chips: chipsFrom(state, ctx.bookedThisTurn, state.humanRequested),
      historicalChips: session.historicalChips,
      leadBanner,
      nextAction: ctx.bookedThisTurn ? "CLOSE" : state.humanRequested ? "ESCALATE_HUMAN" : "CONTINUE",
      leadId: leadBanner,
      appointmentId: state.appointmentId || null,
      dryLead: false,
      whatsappUrl: wa,
      contactUrl: "/contact",
      ended,
      requiresHuman: state.humanRequested,
      awaitingSlotSelection: session.awaitingSlotSelection,
      bookingPending: session.bookingPending,
      slotGroups: session.slotGroups,
      serviceContext: session.serviceContext,
      showResumeBooking: session.showResumeBooking,
      showPhotoCta: session.showPhotoCta,
      photosRemaining: session.photosRemaining,
    };
  } finally {
    endTurn(input.conversationId);
  }
}

export function attachConciergePhoto(
  conversationId: string,
  bytes: Buffer,
  sniffed: SniffedImage,
  caption = "",
) {
  const conversation = getConversation(conversationId);
  if (!conversation) return null;
  if (photoCount(conversationId) >= 4) return { error: "limit" as const };
  const stored = savePhoto(conversationId, bytes, sniffed);
  const state = { ...conversation.state, photoCount: conversation.state.photoCount + 1 };
  touchConversation(conversationId, { state });
  addEvent(conversationId, "PHOTO_ATTACHED");
  addMessage(conversationId, "user", formatConciergePhotoMessage(stored, caption));
  if (conversation.leadPublicId && !conversation.leadPublicId.startsWith("DRY-")) {
    copyConciergePhotosToRequest(conversationId, conversation.leadPublicId);
  }
  return { stored };
}

export function startConcierge(ip: string, utm: Record<string, string>) {
  const id = createConversation(ip, utm, isConciergeDryRun());
  addEvent(id, "CHAT_OPENED");
  recordFunnelEvent(id, "ConversationStarted", {});
  return id;
}
