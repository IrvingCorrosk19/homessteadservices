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
import { logError, logInfo } from "@/lib/log";
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
import { formatConciergePhotoMessage, parseConciergePhotoMessage } from "@/lib/concierge-photo-message";
import { applyPackedExtraction } from "@/lib/concierge/packed-extraction";
import {
  detectRepeatedQuestion,
  questionEconomyBlock,
  shouldFlagOverquestioning,
} from "@/lib/concierge/turn-intelligence";
import { getAppointmentReadiness, readinessPromptHint } from "@/lib/concierge/appointment-readiness";
import {
  determineNextAction,
  enforceDeterministicAsk,
  logNextAction,
  markOptionalDeclined,
} from "@/lib/concierge/conversation-next-action";
import { answerMemoryQuestion, stripFalseThankYou } from "@/lib/concierge/memory-truth";
import {
  activateOfferedSlots,
  areOfferedSlotsActive,
  buildSessionSnapshot,
  clearActiveTransactionState,
  hasRescheduleSignal,
  isReturningGreeting,
  isSlotConfirmed,
  lockSelectedSlot,
  reconcileTransactionState,
  resolveSlotFromMessage,
  shouldShowLeadBanner,
} from "@/lib/concierge-transaction";
import { hasRequestedExactWhen } from "@/lib/concierge/appointment-readiness";
import { logStateTransition } from "@/lib/concierge/canonical-state";
import { checkAvailability } from "@/lib/concierge-availability";
import type { OfferedSlot } from "@/lib/concierge-store";
import {
  ensureActiveServiceRequest,
  requestFolioBookingConfirm,
  requestFolioIntro,
} from "@/lib/concierge/service-request-lifecycle";
import {
  bookingPauseReply,
  interpretTurnRoute,
  looksLikeAvailabilityLoop,
  newNeedReply,
  priceGuidanceReply,
  socialAckReply,
} from "@/lib/concierge-turn-routing";
import {
  applyConversationTransition,
  detectConversationTransition,
  paintingFollowUpQuestion,
  responseReferencesStaleService,
  switchAckPrefix,
} from "@/lib/concierge/service-transition";
import {
  activateDigitalLockFlow,
  analyzeDigitalLockPhoto,
  applyDigitalLockVision,
  detectDigitalLockPurchaseIntent,
  digitalLockIntroReply,
  digitalLockPhotosComplete,
  digitalLockPromptBlock,
  emptyDigitalLockChecklist,
  enforceDigitalLockReplyTruth,
  getDigitalLockChecklist,
  historySuggestsDigitalLockFlow,
  knownDigitalLockViews,
  maybeCompleteDigitalLockMeasurement,
  setDigitalLockChecklist,
  visionFailedResult,
} from "@/lib/concierge/digital-lock-vision";
import {
  detectLockoutIntent,
  getServiceRequirements,
  isDigitalLockEvidenceIntent,
} from "@/lib/service-requirements";

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

    // USER MESSAGE → INTENT TRANSITION before any pending playbook / photo reply.
    const transition = detectConversationTransition(state, text);
    const serviceContextAtTurnStart = state.facts?.serviceContextId || "";
    state = extractCasualFacts(state, text);
    if (
      transition.kind === "SWITCH_SERVICE" ||
      transition.kind === "CANCEL_CURRENT_SERVICE" ||
      transition.kind === "REFINE_CURRENT_SERVICE" ||
      transition.kind === "ADD_ANOTHER_SERVICE"
    ) {
      // Re-bind previous service identity for cancel/switch (packed extract may have already moved primaryService).
      const priorLead = conversation.state.activeLeadId || state.activeLeadId || "";
      const priorService = conversation.state.primaryService || conversation.state.service || "";
      state = applyConversationTransition(
        {
          ...state,
          activeLeadId: priorLead,
          primaryService:
            transition.kind === "SWITCH_SERVICE" || transition.kind === "CANCEL_CURRENT_SERVICE"
              ? priorService || state.primaryService
              : state.primaryService,
          service:
            transition.kind === "SWITCH_SERVICE" || transition.kind === "CANCEL_CURRENT_SERVICE"
              ? priorService || state.service
              : state.service,
        },
        transition,
      );
      logStateTransition(input.conversationId, {
        stage: `TRANSITION_${transition.kind}`,
        service: state.primaryService || state.service || "",
        previousService: transition.previousService,
        nextService: transition.nextService,
        requestId: state.activeLeadId || "",
      });
    }

    logStateTransition(input.conversationId, {
      stage: "TURN_EXTRACT",
      service: state.primaryService || state.service || "",
      location: (state.location || "").slice(0, 40),
      unit: state.facts?.unit || "",
      name: state.name ? "1" : "0",
      phone: state.contactStatus,
      preferredDate: state.preferredDate || "",
      preferredTime: state.preferredTime || "",
      slotConfirmed: isSlotConfirmed(state) ? "1" : "0",
      requestId: state.activeLeadId || "",
    });
    const returningGreeting = isReturningGreeting(text);
    let leadCreatedThisTurn = false;
    let transitionAck = switchAckPrefix(transition);

    if (transition.kind === "ADD_ANOTHER_SERVICE") {
      const clarify =
        state.facts?.lastBotQuestion ||
        "Claro. ¿Quieres agregar eso además del servicio actual, o dejamos el actual y seguimos solo con lo nuevo?";
      addMessage(input.conversationId, "assistant", clarify);
      touchConversation(input.conversationId, { state });
      const session = buildSessionSnapshot(state);
      return {
        ok: true as const,
        reply: clarify,
        chips: session.chips,
        historicalChips: session.historicalChips,
        leadBanner: null,
        nextAction: "CONTINUE",
        leadId: state.activeLeadId || null,
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

    if (transition.kind === "CANCEL_CURRENT_SERVICE") {
      const cancelReply = transitionAck || "Claro, lo dejamos por ahora. Cuando quieras, aquí estamos.";
      addMessage(input.conversationId, "assistant", cancelReply);
      touchConversation(input.conversationId, { state });
      const session = buildSessionSnapshot(state);
      return {
        ok: true as const,
        reply: cancelReply,
        chips: [],
        historicalChips: session.historicalChips,
        leadBanner: null,
        nextAction: "CONTINUE",
        leadId: null,
        dryLead: false,
        whatsappUrl: null,
        contactUrl: "/contact",
        ended: false,
        requiresHuman: false,
        awaitingSlotSelection: false,
        bookingPending: false,
        slotGroups: [],
        serviceContext: session.serviceContext,
        showResumeBooking: false,
        showPhotoCta: false,
        photosRemaining: session.photosRemaining,
      };
    }

    if (transition.kind === "SWITCH_SERVICE" && transition.nextService === "painting") {
      try {
        const ensured = await ensureActiveServiceRequest({
          conversationId: input.conversationId,
          state,
          summary: [state.problem, state.service, state.location].filter(Boolean).join(". "),
          conversationLeadId: "",
          utm: input.utm,
        });
        if (ensured) {
          state.activeLeadId = ensured.publicId;
          if (ensured.announce) {
            leadCreatedThisTurn = true;
            const playbook = getPlaybook(state.primaryService || state.service);
            transitionAck = [transitionAck, requestFolioIntro(ensured.publicId, playbook?.label || "")]
              .filter(Boolean)
              .join("\n\n");
            state.facts = { ...(state.facts || {}), requestFolioShown: "1" };
          }
        }
      } catch {
        // non-blocking
      }
      const paintReply = `${transitionAck}\n\n${paintingFollowUpQuestion(state)}`.trim();
      addMessage(input.conversationId, "assistant", paintReply);
      touchConversation(input.conversationId, { state });
      const session = buildSessionSnapshot(state, Date.now(), state.activeLeadId || "");
      return {
        ok: true as const,
        reply: paintReply,
        chips: session.chips,
        historicalChips: session.historicalChips,
        leadBanner: null,
        nextAction: "CONTINUE",
        leadId: state.activeLeadId || null,
        dryLead: false,
        whatsappUrl: null,
        contactUrl: "/contact",
        ended: false,
        requiresHuman: false,
        awaitingSlotSelection: false,
        bookingPending: false,
        slotGroups: [],
        serviceContext: session.serviceContext,
        showResumeBooking: false,
        showPhotoCta: false,
        photosRemaining: session.photosRemaining,
      };
    }

    const digitalLockAbandoned = state.facts?.digitalLockAbandoned === "1";
    const digitalLockIntent = detectDigitalLockPurchaseIntent(text) && !digitalLockAbandoned;
    const historyForLock = recentMessages(input.conversationId, 14);
    const historyDigital =
      !digitalLockAbandoned &&
      transition.kind !== "SWITCH_SERVICE" &&
      historySuggestsDigitalLockFlow(historyForLock);
    const lockoutNow = detectLockoutIntent(text) && !digitalLockIntent;
    const policy = getServiceRequirements({
      service: state.primaryService || state.service || "locksmith",
      message: text,
      intent: state.facts?.serviceIntent || "",
    });

    if (lockoutNow || policy.intentId === "lockout") {
      const prior = getDigitalLockChecklist(state);
      if (prior.active) {
        state = setDigitalLockChecklist(state, emptyDigitalLockChecklist());
      }
      state = {
        ...state,
        facts: {
          ...(state.facts || {}),
          serviceIntent: "lockout",
          lockedOut: "1",
        },
      };
    } else if (
      !digitalLockAbandoned &&
      transition.kind !== "SWITCH_SERVICE" &&
      (isDigitalLockEvidenceIntent(policy.intentId) ||
        digitalLockIntent ||
        (!lockoutNow && historyDigital))
    ) {
      state = activateDigitalLockFlow(state);
      state = {
        ...state,
        facts: {
          ...(state.facts || {}),
          serviceIntent: "digital_lock_purchase_install",
        },
      };
    }
    state = maybeCompleteDigitalLockMeasurement(state, text);

    let digitalLockReply = "";
    let digitalLockChecklist = getDigitalLockChecklist(state);
    // Never chase lock photos after an explicit service switch / abandon.
    if (digitalLockChecklist.active && !digitalLockAbandoned && transition.kind !== "SWITCH_SERVICE") {
      const pendingPhotoIds: string[] = [];
      for (const item of historyForLock) {
        if (item.role !== "user") continue;
        const parsed = parseConciergePhotoMessage(item.body);
        if (!parsed) continue;
        if (digitalLockChecklist.analyzedPhotoIds.includes(parsed.photoId)) continue;
        pendingPhotoIds.push(parsed.photoId);
      }
      const latestPhoto = [...historyForLock]
        .reverse()
        .map((item) => (item.role === "user" ? parseConciergePhotoMessage(item.body) : null))
        .find((item) => item)?.photoId;
      if (
        latestPhoto &&
        !pendingPhotoIds.includes(latestPhoto) &&
        latestPhoto !== digitalLockChecklist.lastPhotoId &&
        !digitalLockChecklist.analyzedPhotoIds.includes(latestPhoto)
      ) {
        pendingPhotoIds.push(latestPhoto);
      }

      if (pendingPhotoIds.length) {
        const contextBeforeVision = state.facts?.serviceContextId || serviceContextAtTurnStart;
        const replies: string[] = [];
        for (const photoId of pendingPhotoIds) {
          const analyzed = await analyzeDigitalLockPhoto({
            conversationId: input.conversationId,
            photoId,
            knownViews: knownDigitalLockViews(digitalLockChecklist),
            cachedByHash: digitalLockChecklist.analysisByHash,
          });
          // Stale async guard: if context switched while vision ran, discard.
          const fresh = getConversation(input.conversationId);
          const currentCtx = fresh?.state?.facts?.serviceContextId || state.facts?.serviceContextId || "";
          const abandonedNow = fresh?.state?.facts?.digitalLockAbandoned === "1";
          if (
            abandonedNow ||
            (contextBeforeVision && currentCtx && contextBeforeVision !== currentCtx) ||
            (fresh?.state && (fresh.state.primaryService || fresh.state.service) !== "locksmith" && getDigitalLockChecklist(fresh.state).active === false)
          ) {
            logInfo("STALE_ASYNC_RESULT_DISCARDED", {
              contentJobId: input.conversationId.slice(0, 8),
              stage: photoId.slice(0, 12),
            });
            continue;
          }
          const vision = analyzed?.vision || visionFailedResult("VISION_ANALYSIS_FAILED");
          const applied = applyDigitalLockVision(state, photoId, vision, analyzed?.sha256);
          state = applied.state;
          digitalLockChecklist = getDigitalLockChecklist(state);
          replies.push(applied.reply);
        }
        digitalLockReply = replies[replies.length - 1] || "";
      } else if (
        (digitalLockIntent || historyDigital) &&
        !digitalLockPhotosComplete(digitalLockChecklist) &&
        !digitalLockChecklist.front &&
        !digitalLockChecklist.inside &&
        !digitalLockChecklist.edge &&
        digitalLockChecklist.rejected.length === 0 &&
        digitalLockChecklist.analyzedPhotoIds.length === 0
      ) {
        digitalLockReply = digitalLockIntroReply();
      }
    }

    if (digitalLockReply && getDigitalLockChecklist(state).active && state.facts?.digitalLockAbandoned !== "1") {
      addMessage(input.conversationId, "assistant", digitalLockReply);
      touchConversation(input.conversationId, { state });
      const session = buildSessionSnapshot(state);
      return {
        ok: true as const,
        reply: digitalLockReply,
        chips: session.chips,
        historicalChips: session.historicalChips,
        leadBanner: null,
        nextAction: "CONTINUE",
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
      route.slotSelectionIntent && state.offeredSlots?.length
        ? resolveSlotFromMessage(text, state.offeredSlots, state.preferredDate)
        : null;
    if (matchedSlot) {
      state = lockSelectedSlot(state, matchedSlot as OfferedSlot);
      logStateTransition(input.conversationId, {
        stage: "SLOT_SELECTED",
        selectedDate: matchedSlot.date,
        selectedTime: matchedSlot.time,
      });
    }

    state = markOptionalDeclined(state, text);

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

    let requestAnnounce = "";
    try {
      const ensured = await ensureActiveServiceRequest({
        conversationId: input.conversationId,
        state,
        summary: [state.problem, state.service, state.location].filter(Boolean).join(". "),
        conversationLeadId: conversation.leadPublicId,
        utm: input.utm,
      });
      if (ensured) {
        state.activeLeadId = ensured.publicId;
        if (!state.appointmentId && state.funnelStage !== "BOOKED") {
          state.funnelStage = "HANDOFF";
        }
        if (ensured.announce) {
          leadCreatedThisTurn = true;
          const playbook = getPlaybook(state.primaryService || state.service);
          requestAnnounce = requestFolioIntro(ensured.publicId, playbook?.label || "");
          state.facts = { ...(state.facts || {}), requestFolioShown: "1" };
          addEvent(input.conversationId, "REQUEST_FOLIO_CREATED");
        } else if (ensured.updated) {
          addEvent(input.conversationId, "REQUEST_UPDATED");
        }
      }
    } catch {
      addEvent(input.conversationId, "REQUEST_CREATE_FAILED");
    }

    let availabilityHint = "";
    const bookingSignal =
      state.bookingIntent ||
      route.slotSelectionIntent ||
      hasRequestedExactWhen(state) ||
      /\b(disponib|agend|cita|visita|horario|mañana|manana|pasado)\b/i.test(text);
    const needsExactSlotQuery =
      hasRequestedExactWhen(state) && !isSlotConfirmed(state) && !state.pendingSlot;
    const shouldQueryCalendar =
      bookingSignal &&
      !route.isInterruption &&
      !state.bookingSuspended &&
      (!isSlotConfirmed(state) || hasRescheduleSignal(text)) &&
      (needsExactSlotQuery ||
        !areOfferedSlotsActive(state) ||
        hasRescheduleSignal(text) ||
        /\b(disponib|qu[eé] tienen|horario|mañana|manana|el \d+|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i.test(
          text,
        ));
    if (shouldQueryCalendar) {
      const whenText =
        needsExactSlotQuery && state.preferredDate && state.preferredTime
          ? `${state.preferredDate} ${state.preferredTime}`
          : text || `${state.preferredDate} ${state.preferredTime}`.trim();
      const availability = checkAvailability({
        dateText: whenText,
        timeText: whenText,
        logId: input.conversationId,
      });
      addEvent(input.conversationId, "AVAILABILITY_QUERY_EXECUTED");
      recordFunnelEvent(input.conversationId, "AvailabilityChecked", {
        date: availability.requested.date,
        slots: availability.slots.length,
        busy: availability.requestedSlotBusy ? "1" : "0",
      });
      if (availability.slots.length) {
        state = activateOfferedSlots(state, availability.slots as OfferedSlot[]);
        if (availability.requested.date) state.preferredDate = availability.requested.date;
        if (availability.requested.time) state.preferredTime = availability.requested.time;
      }
      // Exact requested slot free → lock selection (do not re-offer as open choice)
      if (
        availability.requestedAvailable &&
        availability.requested.date &&
        availability.requested.time
      ) {
        const exact = (availability.slots as OfferedSlot[]).find(
          (s) => s.date === availability.requested.date && s.time === availability.requested.time,
        ) || {
          date: availability.requested.date,
          time: availability.requested.time,
          label: formatPanamaSlot(availability.requested.date, availability.requested.time),
        };
        state = lockSelectedSlot(state, exact);
        logStateTransition(input.conversationId, {
          stage: "EXACT_SLOT_LOCKED",
          selectedDate: exact.date,
          selectedTime: exact.time,
        });
      }
      if (availability.message) availabilityHint = availability.message;
      else if (availability.requestedAvailable && availability.requested.time) {
        availabilityHint = `Sí, ${formatPanamaSlot(availability.requested.date, availability.requested.time)} está disponible.`;
      }
      state.facts = {
        ...(state.facts || {}),
        lastAvailabilityQuery: `${availability.requested.date}|${availability.requested.time || ""}`,
      };
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

    const memory = answerMemoryQuestion(text, state, state.activeLeadId || conversation.leadPublicId);
    if (memory.handled) {
      addMessage(input.conversationId, "assistant", memory.reply);
      touchConversation(input.conversationId, { state });
      const session = buildSessionSnapshot(state, Date.now(), state.activeLeadId || conversation.leadPublicId || "");
      return {
        ok: true as const,
        reply: memory.reply,
        chips: session.chips,
        historicalChips: session.historicalChips,
        leadBanner: session.leadBanner,
        requestCard: session.requestCard,
        leadId: state.activeLeadId || conversation.leadPublicId || null,
        nextAction: "CONTINUE",
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
        const missing = missingUsefulFacts(state, playbook).filter((key) => {
          // Photos are USEFUL, never block or prompt as if required near booking
          if (key === "photos" && (state.bookingIntent || state.offeredSlots?.length || state.pendingSlot)) {
            return false;
          }
          if (key === "location" && getAppointmentReadiness(state).knownFields.includes("location")) {
            return false;
          }
          return true;
        });
        const nextDecision = determineNextAction(state, {
          userText: text,
          interruption: route.isInterruption && !route.slotSelectionIntent,
        });
        logNextAction(input.conversationId, nextDecision, {
          bookingIntent: state.bookingIntent,
          offered: state.offeredSlots?.length || 0,
        });
        const history = recentMessages(input.conversationId, 10);
        const interruptionBlock = route.isInterruption
          ? [{
              role: "system" as const,
              content: `INTERRUPCIÓN (${route.priceIntent ? "PRECIO" : route.newNeedIntent ? "NUEVA NECESIDAD" : route.bookingPauseIntent ? "PAUSAR AGENDA" : route.serviceQuestionIntent ? "PREGUNTA SERVICIO" : route.socialAckIntent ? "AGRADECIMIENTO" : "INTERRUPCIÓN"}): el cliente NO está eligiendo horario ahora. Responde esa intención primero. NO repitas la lista de horarios salvo que pida retomar la cita.`,
            }]
          : [];
        const calendarBlock = availabilityHint
          ? [
              {
                role: "system" as const,
                content: `CALENDAR_RESULT (consulta REAL; NO inventes horarios): ${availabilityHint}. Slots: ${JSON.stringify(state.offeredSlots?.slice(0, 4) || [])}. Si falta confirmación del cliente, NO agendes todavía.`,
              },
            ]
          : [];
        const digitalLockBlock = digitalLockPromptBlock(getDigitalLockChecklist(state));
        const messages: ChatMessage[] = [
          {
            role: "system",
            content: conciergeSystemPrompt(
              knowledge,
              `${playbookPromptBlock(playbook, state, missing)}\n\n${questionEconomyBlock(state, playbook)}${digitalLockBlock ? `\n\n${digitalLockBlock}` : ""}`,
            ),
          },
          ...interruptionBlock,
          ...calendarBlock,
          {
            role: "system",
            content: `ESTADO ACTUAL (no lo preguntes de nuevo si ya está): ${JSON.stringify({
              name: state.name || null,
              phone: state.contactStatus === "VALID" ? "valid" : state.contactStatus,
              email: state.email ? "present" : null,
              location: state.location || null,
              propertyType: state.propertyType || null,
              building: state.facts?.building || state.facts?.ph || null,
              unit: state.facts?.unit || state.facts?.apartment || null,
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
              appointmentReadiness: nextDecision.readiness,
              nextAction: nextDecision.action,
              requiredMissing: nextDecision.requiredMissing,
              locationSufficient: nextDecision.locationSufficient,
            })}\n${readinessPromptHint(nextDecision.readiness)}\nNEXT_ACTION_ENGINE: action=${nextDecision.action}; reason=${nextDecision.reason}; askField=${nextDecision.askField || "none"}; requiredMissing=[${nextDecision.requiredMissing.join(", ") || "none"}]. Solo puedes solicitar campos en requiredMissing. Si action=CONFIRM_OR_BOOK debes llamar create_appointment ahora. PROHIBIDO inventar referencia/dirección/detalle adicional.`,
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

    const finalDecision = determineNextAction(state, {
      userText: text,
      interruption: route.isInterruption && !route.slotSelectionIntent,
    });

    // Server-authoritative booking: when requirements are complete, do not wait for the LLM to invent more questions.
    if (
      finalDecision.action === "CONFIRM_OR_BOOK" &&
      !ctx.bookedThisTurn &&
      !state.appointmentId &&
      !route.isInterruption
    ) {
      const slot =
        state.pendingSlot ||
        (state.preferredDate && state.preferredTime
          ? { date: state.preferredDate, time: state.preferredTime, label: `${state.preferredDate} ${state.preferredTime}` }
          : null);
      if (slot?.date && slot?.time) {
        const booked = await executeConciergeTool(
          "create_appointment",
          { date: slot.date, time: slot.time, customerConfirmed: true },
          ctx,
        );
        ctx.state = booked.state;
        ctx.leadId = booked.leadId || ctx.leadId;
        state = booked.state;
        if (booked.result && typeof booked.result === "object" && (booked.result as { ok?: boolean }).ok) {
          addEvent(input.conversationId, "DETERMINISTIC_BOOK");
          logNextAction(input.conversationId, finalDecision, { deterministicBook: true });
        }
      }
    }

    const enforced = enforceDeterministicAsk(reply, state, finalDecision);
    reply = enforced.reply;
    state = enforced.state;
    if (enforced.rewritten) {
      addEvent(input.conversationId, "DETERMINISTIC_ASK_REWRITE");
      logNextAction(input.conversationId, finalDecision, { rewritten: true });
    }

    const repeated = detectRepeatedQuestion(reply, state);
    if (repeated.length) {
      addEvent(input.conversationId, "REPEATED_QUESTION");
      recordFunnelEvent(input.conversationId, "IntentDetected", { intent: "repeated_question", service: repeated.join(",") });
      // Hard rewrite if still asking known location
      if (repeated.includes("location") && finalDecision.locationSufficient) {
        reply = finalDecision.action === "CONFIRM_OR_BOOK" || ctx.bookedThisTurn
          ? "Perfecto. Con los datos que ya tengo confirmo la visita."
          : finalDecision.cannedQuestion || "Con la ubicación que me diste es suficiente. Sigamos con la cita.";
        state = markOptionalDeclined(state, "no ningún detalle más");
      }
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
    reply = stripFalseThankYou(reply, text);
    reply = enforceDigitalLockReplyTruth(reply, getDigitalLockChecklist(state));
    if (responseReferencesStaleService(reply, state)) {
      logInfo("STALE_ASSISTANT_RESPONSE_BLOCKED", {
        contentJobId: input.conversationId.slice(0, 8),
        stage: state.primaryService || state.service || "",
      });
      reply =
        transitionAck ||
        (state.primaryService === "painting"
          ? paintingFollowUpQuestion(state)
          : "Claro, sigamos con lo que me acabas de pedir. ¿Qué más necesitas contarme?");
      if (transitionAck && !reply.startsWith(transitionAck)) {
        reply = `${transitionAck}\n\n${reply}`;
      }
    } else if (transitionAck && transition.kind === "SWITCH_SERVICE" && !reply.includes("dejamos")) {
      reply = `${transitionAck}\n\n${reply}`;
    }

    if (requestAnnounce && state.activeLeadId && !reply.includes(state.activeLeadId)) {
      reply = reply.trim() ? `${requestAnnounce}\n\n${reply}` : requestAnnounce;
    }

    if (ctx.bookedThisTurn) {
      const slot = state.pendingSlot;
      const when = slot?.date && slot?.time ? formatPanamaSlot(slot.date, slot.time) : "el horario acordado";
      const hs = ctx.leadId || state.activeLeadId;
      const playbook = getPlaybook(state.primaryService || state.service);
      if (hs) {
        reply = requestFolioBookingConfirm(hs, when, playbook?.label || "");
      } else if (!/\b(agendad|confirmad)\b/i.test(reply) || /estos horarios sí están libres/i.test(reply)) {
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

    const leadBanner = shouldShowLeadBanner(state, ctx.leadId || state.activeLeadId);
    const session = buildSessionSnapshot(state, Date.now(), ctx.leadId || state.activeLeadId || "");

    const wa =
      knowledge.whatsappConfigured && leadBanner
        ? whatsappHref(`Hola, vengo del asistente de Homestead Services. Mi solicitud es ${leadBanner}.`)
        : null;

    return {
      ok: true as const,
      reply,
      chips: chipsFrom(state, ctx.bookedThisTurn, state.humanRequested),
      historicalChips: session.historicalChips,
      leadBanner,
      requestCard: session.requestCard,
      requestCreatedThisTurn: leadCreatedThisTurn,
      nextAction: ctx.bookedThisTurn ? "CLOSE" : state.humanRequested ? "ESCALATE_HUMAN" : "CONTINUE",
      leadId: ctx.leadId || state.activeLeadId || null,
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
  const digitalLock = getDigitalLockChecklist(conversation.state);
  const maxPhotos = digitalLock.active ? 8 : 4;
  if (photoCount(conversationId) >= maxPhotos) return { error: "limit" as const };
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
