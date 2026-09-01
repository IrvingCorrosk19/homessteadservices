import { conciergeKnowledge } from "@/lib/concierge-knowledge";
import { checkAvailability, isSlotStillOpen, type AvailabilitySlot } from "@/lib/concierge-availability";
import { parseNaturalDateTime } from "@/lib/concierge-datetime";
import { canHandoffLead, createLeadFromConcierge } from "@/lib/concierge-handoff";
import { recordFunnelEvent } from "@/lib/concierge-intelligence";
import { classifyPhone } from "@/lib/phone";
import {
  createAppointment,
  latestAppointment,
  rescheduleAppointment,
  saveLeadPreference,
  setAppointmentStatus,
} from "@/lib/revenue-store";
import { cancelAppointmentOnly, cancelServiceRequest } from "@/lib/service-request-cancellation";
import { isRequestEligibleForAppointment } from "@/lib/service-requests";
import {
  applyAppointmentOnlyCancelledState,
  applyRequestCancelledConversationState,
} from "@/lib/concierge/cancellation-conversation";
import { requestOwnedByConversation } from "@/lib/concierge/cancellation-intent";
import { notifyAppointmentEvent } from "@/lib/revenue-telegram";
import { isConciergeDryRun } from "@/lib/concierge-flags";
import type { ConversationState, OfferedSlot } from "@/lib/concierge-store";
import { getPlaybook } from "@/lib/concierge/service-playbooks";
import {
  applyFactPatch,
  detectServices,
  mergeDetectedServices,
  choosePrimary,
  shouldOfferAvailability,
} from "@/lib/concierge/playbook-engine";
import { applyTurnIntelligence, parseTurnIntelligence } from "@/lib/concierge/turn-intelligence";
import { getAppointmentReadiness, firstMissingQuestion } from "@/lib/concierge/appointment-readiness";
import { classifyActionableServiceIntent } from "@/lib/concierge/actionable-intent";
import { hasValidServiceIntent } from "@/lib/concierge/service-request-lifecycle";
import { logInfo } from "@/lib/log";
import {
  activateOfferedSlots,
  clearActiveTransactionState,
  consumeOfferedSlots,
  detectNewTransactionSignal,
  hasRescheduleSignal,
  isSlotConfirmed,
  validateActiveSlotBooking,
} from "@/lib/concierge-transaction";
import { clearSlotSelection } from "@/lib/concierge/canonical-state";
import {
  rehydrateRequestFromAppointment,
  resolveAuthoritativeRequestId,
} from "@/lib/concierge/appointment-reprogram";
import { retrieveCustomerMemory } from "@/lib/concierge/customer-memory";
import { isTestInjectionActive } from "@/lib/concierge/test-injection";

export const CONCIERGE_TOOLS = [
  {
    type: "function",
    function: {
      name: "record_service_intelligence",
      description: "Interpreta el turno: oficios, hechos, urgencia, intención de agendar. No se muestra al cliente.",
      parameters: {
        type: "object",
        properties: {
          detectedServices: { type: "array", items: { type: "string" } },
          primaryService: { type: "string" },
          facts: { type: "object", additionalProperties: { type: "string" } },
          factConfidence: {
            type: "object",
            additionalProperties: { type: "string", enum: ["EXPLICIT", "HIGH_CONFIDENCE", "UNCERTAIN"] },
          },
          corrections: { type: "array", items: { type: "string" } },
          urgency: { type: "string", enum: ["normal", "elevated", "safety"] },
          bookingIntent: { type: "boolean" },
          needsReview: { type: "boolean" },
          humanHandoffIntent: { type: "boolean" },
          priceIntent: { type: "boolean" },
          safetySignals: { type: "boolean" },
          nextRecommendedAction: { type: "string" },
          nextAction: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_customer_facts",
      description: "Guarda hechos ya dichos por el cliente. No pidas de nuevo lo que aquí quede lleno.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          phone: { type: "string" },
          email: { type: "string" },
          location: { type: "string" },
          propertyType: { type: "string", description: "house, apartment, ph, office, commerce, other" },
          service: { type: "string", description: "ac, plumbing, painting, electrical, locksmith, repairs, remodeling, multiple, other" },
          problem: { type: "string" },
          intent: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_services",
      description: "Mapea un problema en lenguaje natural al catálogo Homestead.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_or_update_lead",
      description: "Crea o reutiliza la solicitud HS cuando hay teléfono válido y una necesidad.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Consulta horarios reales en America/Panama. Obligatorio antes de ofrecer horas.",
      parameters: {
        type: "object",
        properties: {
          dateText: { type: "string", description: "Ej. mañana, viernes, 2026-08-24" },
          timeText: { type: "string", description: "Ej. 3 pm, tarde, 15:00" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_appointment",
      description: "Crea la cita real solo si el cliente confirmó el horario ofrecido.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: "string", description: "HH:MM 24h" },
          customerConfirmed: { type: "boolean" },
        },
        required: ["date", "time", "customerConfirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_appointment",
      description: "Reprograma la cita existente de esta conversación.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string" },
          time: { type: "string" },
          customerConfirmed: { type: "boolean" },
        },
        required: ["date", "time", "customerConfirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_appointment",
      description: "Cancela solo la visita (HA). No cancela la solicitud HS.",
      parameters: {
        type: "object",
        properties: { customerConfirmed: { type: "boolean" } },
        required: ["customerConfirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_service_request",
      description:
        "Cancela la solicitud HS del cliente. No inventes el folio. Usa el requestId activo de la conversación. El motivo es opcional.",
      parameters: {
        type: "object",
        properties: {
          requestId: { type: "string", description: "Folio HS-YYYY-NNNNNN de ESTA conversación" },
          reason: { type: "string" },
          customerConfirmed: { type: "boolean" },
        },
        required: ["customerConfirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_customer_context",
      description:
        "Lee historial previo del cliente por teléfono validado. Solo lectura; no activa solicitudes históricas.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "Teléfono validado del cliente actual" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_human",
      description: "Pasa la conversación a una persona del equipo Homestead.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string" } },
      },
    },
  },
] as const;

export type ToolContext = {
  conversationId: string;
  state: ConversationState;
  leadId: string;
  summary: string;
  userText?: string;
  utm: Record<string, string>;
  bookedThisTurn: boolean;
  lastSlots: AvailabilitySlot[];
};

type ToolResult = { result: Record<string, unknown>; state: ConversationState; leadId: string };

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function searchCatalog(query: string) {
  const knowledge = conciergeKnowledge();
  const detected = detectServices(query);
  const slug = detected[0] || "other";
  const found = knowledge.services.find((item) => item.slug === slug);
  const playbook = getPlaybook(slug);
  return {
    slug,
    title: found?.title || playbook.label,
    inCatalog: Boolean(found) && !playbook.unknownCatalog,
    needsReview: playbook.unknownCatalog || slug === "other",
    also: detected.slice(1),
  };
}

export async function executeConciergeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  let state = { ...ctx.state };
  let leadId = ctx.leadId;

  if (name === "record_service_intelligence") {
    const parsed = parseTurnIntelligence(args);
    if (!parsed) {
      return {
        result: { ok: false, reason: "invalid_structured_output" },
        state,
        leadId,
      };
    }
    const incoming = parsed.detectedServices.length
      ? parsed.detectedServices
      : Array.isArray(args.detectedServices)
        ? args.detectedServices.map((item) => String(item))
        : [];
    const fromText = detectServices([state.problem, parsed.primaryService, incoming.join(" ")].join(" "));
    const previousPrimary = state.primaryService || state.service;
    state.detectedServices = mergeDetectedServices(state.detectedServices || [], [...incoming, ...fromText]);
    state.primaryService = choosePrimary(
      state.detectedServices,
      parsed.primaryService || asString(args.primaryService) || state.primaryService || state.service,
      state.problem || asString(args.summary) || "",
    );
    if (previousPrimary && state.primaryService && previousPrimary !== state.primaryService) {
      state = clearActiveTransactionState(state, true);
      state.activeLeadId = "";
      state.appointmentId = "";
      leadId = "";
      recordFunnelEvent(ctx.conversationId, "ServiceContextChanged", {
        service: state.primaryService,
        intent: previousPrimary,
      });
    }
    if (state.primaryService) state.service = state.primaryService;
    state.secondaryServices = state.detectedServices.filter((id) => id !== state.primaryService);
    state = applyTurnIntelligence(state, parsed);
    if (args.facts && typeof args.facts === "object" && !parsed.extractedFacts) {
      state.facts = applyFactPatch(state.facts || {}, args.facts as Record<string, unknown>);
    }
    const urgency = parsed.urgency || asString(args.urgency);
    if (urgency === "normal" || urgency === "elevated" || urgency === "safety") state.urgency = urgency;
    state.bookingIntent = parsed.bookingIntent || Boolean(args.bookingIntent) || state.bookingIntent;
    state.needsReview = parsed.needsReview || Boolean(args.needsReview) || getPlaybook(state.primaryService).unknownCatalog;
    state.bookingStrategy = getPlaybook(state.primaryService || state.service).bookingStrategy;
    if (state.facts.location && !state.location) state.location = state.facts.location;
    if ((state.facts.what || state.facts.symptom || state.facts.need) && !state.problem) {
      state.problem = (state.facts.need || state.facts.symptom || state.facts.what).slice(0, 500);
    }
    recordFunnelEvent(ctx.conversationId, "IntentDetected", {
      intent: parsed.nextRecommendedAction || asString(args.nextAction),
      service: state.primaryService || state.service,
      structured: true,
    });
    return {
      result: {
        primaryService: state.primaryService || null,
        detectedServices: state.detectedServices,
        urgency: state.urgency,
        bookingStrategy: state.bookingStrategy,
        facts: state.facts,
      },
      state,
      leadId,
    };
  }

  if (name === "remember_customer_facts") {
    if (asString(args.name) && !/^\+?\d[\d\s-]{5,}$/.test(asString(args.name))) {
      state.name = asString(args.name).slice(0, 80);
    }
    const phone = classifyPhone(asString(args.phone) || state.phone);
    if (phone.status === "VALID") {
      state.phone = phone.e164 || state.phone;
      state.contactStatus = "VALID";
    } else if (asString(args.phone) && phone.status === "INCOMPLETE") state.contactStatus = "INCOMPLETE";
    if (asString(args.email) && asString(args.email).includes("@")) state.email = asString(args.email).slice(0, 120);
    if (asString(args.location)) state.location = asString(args.location).slice(0, 120);
    if (asString(args.propertyType)) state.propertyType = asString(args.propertyType).slice(0, 40);
    if (asString(args.service) && asString(args.service) !== "unknown") state.service = asString(args.service);
    if (asString(args.problem)) state.problem = asString(args.problem).slice(0, 500);
    if (asString(args.intent)) state.intent = asString(args.intent).slice(0, 40);
    recordFunnelEvent(ctx.conversationId, "LeadUpdated", { intent: state.intent || "", service: state.service });
    return {
      result: {
        saved: {
          name: state.name || null,
          phone: state.contactStatus === "VALID" ? "valid" : state.contactStatus.toLowerCase(),
          email: state.email || null,
          location: state.location || null,
          service: state.service || null,
          problem: state.problem || null,
        },
      },
      state,
      leadId,
    };
  }

  if (name === "search_services") {
    const found = searchCatalog(asString(args.query) || state.problem);
    if (found.slug) {
      state.service = found.slug;
      state.detectedServices = mergeDetectedServices(state.detectedServices || [], [found.slug, ...(found.also || [])]);
      state.primaryService = choosePrimary(state.detectedServices, found.slug);
      state.needsReview = Boolean(found.needsReview);
      state.bookingStrategy = getPlaybook(state.primaryService || found.slug).bookingStrategy;
    }
    return { result: found, state, leadId };
  }

  if (name === "create_or_update_lead") {
    const userText = ctx.userText || ctx.summary || "";
    const intent = classifyActionableServiceIntent(userText, state);
    if (intent.informationalOnly && !state.activeLeadId) {
      return {
        result: { ok: false, reason: "no_actionable_service_intent" },
        state,
        leadId,
      };
    }
    if (!state.activeLeadId && !hasValidServiceIntent(state, userText)) {
      return {
        result: { ok: false, reason: "no_actionable_service_intent" },
        state,
        leadId,
      };
    }
    const targetLead = state.activeLeadId || leadId;
    const created = await createLeadFromConcierge({
      conversationId: ctx.conversationId,
      state,
      summary: ctx.summary,
      existingLeadId: targetLead,
      utm: ctx.utm,
    });
    leadId = created || targetLead;
    if (leadId) state.activeLeadId = leadId;
    return {
      result: created
        ? { ok: true, publicId: created }
        : { ok: false, reason: canHandoffLead(state) ? "disabled" : "need_valid_phone_and_problem" },
      state,
      leadId,
    };
  }

  if (name === "check_availability") {
    if (isTestInjectionActive("CALENDAR_READ_FAILURE")) {
      logInfo("TEST_INJECT_CALENDAR_READ_FAILURE", { contentJobId: ctx.conversationId.slice(0, 8) });
      return {
        result: {
          ok: false,
          reason: "calendar_unavailable",
          queryExecuted: false,
          instruction:
            "El calendario no pudo consultarse ahora. NO inventes horarios. Explica con naturalidad que la solicitud sigue y que puedes reintentar revisar disponibilidad.",
        },
        state,
        leadId,
      };
    }
    const playbook = getPlaybook(state.primaryService || state.service);
    if (!shouldOfferAvailability(playbook, state) && !state.bookingIntent) {
      return {
        result: {
          ok: false,
          reason: playbook.bookingStrategy === "PHOTO_REVIEW_FIRST" ? "photo_review_first" : "tech_review_first",
          guidance: playbook.photoGuidance,
        },
        state,
        leadId,
      };
    }
    const reschedule = hasRescheduleSignal(
      `${asString(args.dateText)} ${asString(args.timeText)} ${state.facts?.lastBotQuestion || ""}`,
    );
    if (isSlotConfirmed(state) && !reschedule) {
      return {
        result: {
          ok: true,
          slots: state.offeredSlots,
          requested: { date: state.pendingSlot?.date || state.preferredDate, time: state.pendingSlot?.time || state.preferredTime },
          instruction:
            "El cliente ya eligió un horario. NO vuelvas a listar opciones salvo que pida cambiar fecha/hora.",
          queryExecuted: false,
        },
        state,
        leadId,
      };
    }
    const availability = checkAvailability({
      dateText: asString(args.dateText) || state.preferredDate || undefined,
      timeText: asString(args.timeText) || state.preferredTime || undefined,
      logId: ctx.conversationId,
    });
    let slots = availability.slots;
    if (availability.exactDayRequested) {
      const mismatched = slots.filter((slot) => slot.date !== availability.requested.date);
      if (mismatched.length) {
        logInfo("AVAILABILITY_DATE_MISMATCH", {
          contentJobId: ctx.conversationId.slice(0, 8),
          stage: availability.requested.date,
        });
      }
      slots = slots.filter((slot) => slot.date === availability.requested.date);
    }
    state = activateOfferedSlots(state, slots as OfferedSlot[]);
    state.preferredDate = availability.requested.date || state.preferredDate;
    if (availability.requested.time) state.preferredTime = availability.requested.time;
    ctx.lastSlots.splice(0, ctx.lastSlots.length, ...slots);
    recordFunnelEvent(ctx.conversationId, "AvailabilityChecked", {
      date: availability.requested.date,
      slots: slots.length,
    });
    return {
      result: {
        timezone: availability.timezone,
        slots,
        requested: availability.requested,
        requestedAvailable: availability.requestedAvailable,
        requestedSlotBusy: availability.requestedSlotBusy,
        exactDayRequested: availability.exactDayRequested,
        requestedDateUnavailable: availability.requestedDateUnavailable,
        sameDayFull: availability.sameDayFull,
        nextAvailableDate: availability.nextAvailableDate,
        message: availability.message || null,
        queryExecuted: availability.queryExecuted,
        instruction: availability.requestedSlotBusy
          ? "Di que ese horario está ocupado y ofrece SOLO los slots devueltos. Espera que el cliente elija. NO agendes automáticamente."
          : availability.requestedAvailable
            ? "Confirma que ese horario está disponible. Si faltan datos para agendar, pídelos sin reiniciar la agenda."
            : availability.requestedDateUnavailable
              ? "Di claramente que esa fecha no tiene horarios. Ofrece las alternativas devueltas si las hay."
              : availability.exactDayRequested
                ? `Ofrece SOLO horarios del ${availability.requested.date}. No sustituyas por otra fecha.`
                : null,
      },
      state,
      leadId,
    };
  }

  if (name === "create_appointment") {
    const date = asString(args.date);
    const time = asString(args.time);
    const confirmed = Boolean(args.customerConfirmed);
    recordFunnelEvent(ctx.conversationId, "AppointmentRequested", { date, time });
    if (!confirmed) {
      return { result: { ok: false, reason: "need_customer_confirmation" }, state, leadId };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return { result: { ok: false, reason: "invalid_datetime" }, state, leadId };
    }
    const slotCheck = validateActiveSlotBooking(state, date, time);
    if (!slotCheck.ok) {
      return {
        result: { ok: false, reason: slotCheck.reason, message: slotCheck.message, slots: state.offeredSlots },
        state: clearActiveTransactionState(state),
        leadId,
      };
    }
    if (!isSlotStillOpen(date, time, state.appointmentId)) {
      recordFunnelEvent(ctx.conversationId, "AppointmentFailed", { reason: "slot_taken_race" });
      return {
        result: {
          ok: false,
          reason: "slot_taken",
          message: "Ese horario acaba de ocuparse. Puedo revisar otras opciones disponibles.",
          instruction: "Llama check_availability de nuevo y ofrece alternativas reales. NO digas que quedó agendada.",
        },
        state: clearActiveTransactionState(state),
        leadId,
      };
    }
    const readiness = getAppointmentReadiness(state, { date, time });
    if (!readiness.ready) {
      logInfo("APPOINTMENT_BLOCKED_INCOMPLETE", {
        contentJobId: ctx.conversationId.slice(0, 8),
        stage: readiness.missingFields.join(","),
      });
      return {
        result: {
          ok: false,
          reason: "missing_visit_data",
          missingFields: readiness.missingFields,
          knownFields: readiness.knownFields,
          message: firstMissingQuestion(readiness),
          instruction:
            "NO digas que la visita quedó agendada. Pide de forma natural los datos que faltan. Cuando estén listos, resume y espera confirmación antes de volver a create_appointment.",
        },
        state,
        leadId,
      };
    }
    const bookingLeadId =
      resolveAuthoritativeRequestId(state, leadId) ||
      state.activeLeadId ||
      leadId;
    if (bookingLeadId && !isRequestEligibleForAppointment(bookingLeadId)) {
      return {
        result: {
          ok: false,
          reason: "request_not_bookable",
          instruction: "La solicitud ya no admite citas. NO digas que quedó agendada.",
        },
        state,
        leadId: bookingLeadId,
      };
    }
    if (!bookingLeadId) {
      const created = await createLeadFromConcierge({
        conversationId: ctx.conversationId,
        state,
        summary: ctx.summary,
        existingLeadId: "",
        utm: ctx.utm,
      });
      leadId = created;
      if (created) state.activeLeadId = created;
    } else {
      leadId = bookingLeadId;
      state = rehydrateRequestFromAppointment({ ...state, activeLeadId: bookingLeadId });
    }
    if (!leadId) {
      recordFunnelEvent(ctx.conversationId, "AppointmentFailed", { reason: "no_lead" });
      return { result: { ok: false, reason: "need_valid_phone_and_problem" }, state, leadId };
    }
    if (isTestInjectionActive("APPOINTMENT_WRITE_FAILURE")) {
      logInfo("TEST_INJECT_APPOINTMENT_WRITE_FAILURE", { contentJobId: ctx.conversationId.slice(0, 8) });
      recordFunnelEvent(ctx.conversationId, "AppointmentFailed", { reason: "write_injected" });
      return {
        result: {
          ok: false,
          reason: "write_failed",
          instruction:
            "La disponibilidad pudo revisarse, pero la cita NO quedó guardada. NO digas que quedó confirmada. Explica el fallo y ofrece reintentar.",
        },
        state,
        leadId,
      };
    }
    const existing = latestAppointment(leadId);
    if (existing && ["REQUESTED", "PROPOSED", "CONFIRMED", "RESCHEDULED"].includes(existing.status)) {
      const moved = rescheduleAppointment(existing.appointment_id, date, time);
      if (!moved.ok) return { result: { ok: false, reason: moved.reason || "reschedule_failed" }, state, leadId };
      state = consumeOfferedSlots(state, { date, time, label: `${date} ${time}` });
      state.appointmentId = existing.appointment_id;
      saveLeadPreference(leadId, date, time);
      if (!isConciergeDryRun() && (existing.status === "CONFIRMED" || existing.status === "RESCHEDULED")) {
        await notifyAppointmentEvent(existing.appointment_id, "RESCHEDULED", {
          previousDate: existing.date,
          previousTime: existing.start_time,
        });
      }
      ctx.bookedThisTurn = true;
      return { result: { ok: true, appointmentId: existing.appointment_id, date, time, status: moved.status }, state, leadId };
    }
    const id = createAppointment(leadId, date, time, "CONFIRMED", {
      source: "CHAT",
      notes: state.problem.slice(0, 280),
    });
    if (!id) {
      recordFunnelEvent(ctx.conversationId, "AppointmentFailed", { reason: "insert_failed" });
      return { result: { ok: false, reason: "create_failed" }, state, leadId };
    }
    setAppointmentStatus(id, "CONFIRMED");
    state = consumeOfferedSlots(state, { date, time, label: `${date} ${time}` });
    state.appointmentId = id;
    saveLeadPreference(leadId, date, time);
    if (!isConciergeDryRun()) {
      recordFunnelEvent(ctx.conversationId, "TelegramNotificationRequested", { stage: "appointment" });
      await notifyAppointmentEvent(id, "CONFIRMED");
    }
    recordFunnelEvent(ctx.conversationId, "AppointmentCreated", { appointmentId: id });
    ctx.bookedThisTurn = true;
    return { result: { ok: true, appointmentId: id, date, time, status: "CONFIRMED" }, state, leadId };
  }

  if (name === "reschedule_appointment") {
    if (!Boolean(args.customerConfirmed) || !state.appointmentId) {
      return { result: { ok: false, reason: "need_existing_appointment_and_confirmation" }, state, leadId };
    }
    const date = asString(args.date);
    const time = asString(args.time);
    const current = latestAppointment(leadId);
    const id = state.appointmentId || current?.appointment_id;
    if (!id) return { result: { ok: false, reason: "no_appointment" }, state, leadId };
    const hs = resolveAuthoritativeRequestId(state, leadId) || leadId;
    if (hs && !isRequestEligibleForAppointment(hs)) {
      return { result: { ok: false, reason: "request_not_bookable" }, state, leadId };
    }
    const moved = rescheduleAppointment(id, date, time, { actor: "concierge" });
    if (!moved.ok) return { result: { ok: false, reason: moved.reason || "reschedule_failed" }, state, leadId };
    if (!isConciergeDryRun()) {
      await notifyAppointmentEvent(id, "RESCHEDULED", { previousDate: moved.previousDate, previousTime: moved.previousTime });
    }
    ctx.bookedThisTurn = true;
    return { result: { ok: true, appointmentId: id, date, time, status: moved.status }, state, leadId };
  }

  if (name === "cancel_appointment") {
    if (!Boolean(args.customerConfirmed) || !state.appointmentId) {
      return { result: { ok: false, reason: "need_existing_appointment_and_confirmation" }, state, leadId };
    }
    const cancelled = cancelAppointmentOnly({
      appointmentId: state.appointmentId,
      actor: "CUSTOMER_AI",
      source: "CUSTOMER_AI",
      requestId: state.activeLeadId || leadId,
    });
    if (!cancelled.success) {
      return { result: { ok: false, reason: cancelled.errorCode || "cancel_failed" }, state, leadId };
    }
    if (!isConciergeDryRun() && !cancelled.alreadyCancelled) {
      await notifyAppointmentEvent(state.appointmentId, "CANCELLED");
    }
    state = applyAppointmentOnlyCancelledState(state);
    return {
      result: {
        ok: true,
        appointmentId: cancelled.appointmentId,
        status: "CANCELLED",
        alreadyCancelled: cancelled.alreadyCancelled,
        requestStillActive: cancelled.requestStillActive,
      },
      state,
      leadId,
    };
  }

  if (name === "cancel_service_request") {
    if (!Boolean(args.customerConfirmed)) {
      return { result: { ok: false, reason: "need_customer_confirmation" }, state, leadId };
    }
    const requested = asString(args.requestId).toUpperCase();
    const target = requested || state.activeLeadId || leadId;
    if (!target || !requestOwnedByConversation(target, state, leadId)) {
      return { result: { ok: false, reason: "not_authorized" }, state, leadId };
    }
    const cancelled = cancelServiceRequest({
      requestId: target,
      actor: "CUSTOMER_AI",
      source: "CUSTOMER_AI",
      reason: asString(args.reason),
      conversationId: ctx.conversationId,
      idempotencyKey: `service_request.cancelled:${target}`,
      notify: true,
    });
    if (cancelled.success && !cancelled.alreadyCancelled) {
      state = applyRequestCancelledConversationState(state, target);
    }
    return {
      result: {
        ok: cancelled.success,
        requestId: cancelled.requestId,
        previousStatus: cancelled.previousStatus,
        newStatus: cancelled.newStatus,
        cancelledAppointmentIds: cancelled.cancelledAppointmentIds,
        calendarReleased: cancelled.calendarReleased,
        alreadyCancelled: cancelled.alreadyCancelled,
        auditEventId: cancelled.auditEventId,
        errorCode: cancelled.errorCode,
      },
      state,
      leadId: cancelled.success && !cancelled.alreadyCancelled ? "" : leadId,
    };
  }

  if (name === "get_customer_context") {
    const requestedPhone = asString(args.phone) || state.phone;
    const assessed = classifyPhone(requestedPhone);
    if (assessed.status !== "VALID") {
      return { result: { ok: false, reason: "need_valid_phone" }, state, leadId };
    }
    if (state.contactStatus === "VALID" && state.phone) {
      const stateDigits = classifyPhone(state.phone).digits;
      if (stateDigits && assessed.digits && stateDigits !== assessed.digits) {
        logInfo("CUSTOMER_CONTEXT_BLOCKED_CROSS_PHONE", {
          contentJobId: ctx.conversationId.slice(0, 8),
          stage: "isolation",
        });
        return { result: { ok: false, reason: "phone_mismatch_isolation" }, state, leadId };
      }
    }
    const memory = retrieveCustomerMemory({ ...state, phone: requestedPhone, contactStatus: "VALID" });
    if (!memory) {
      return { result: { ok: true, found: false, priorRequests: [] }, state, leadId };
    }
    state = {
      ...state,
      facts: {
        ...(state.facts || {}),
        retrievedCustomerContext: JSON.stringify(memory.snapshot),
        historicalRequestIds: memory.historicalRequestIds.filter((id) => id !== state.activeLeadId).join("|"),
      },
    };
    logInfo("CUSTOMER_CONTEXT_RETRIEVED", {
      contentJobId: ctx.conversationId.slice(0, 8),
      stage: String(memory.snapshot.customerId),
    });
    return {
      result: {
        ok: true,
        found: true,
        customerId: memory.snapshot.customerId,
        generalLocation: memory.snapshot.generalLocation,
        priorRequests: memory.snapshot.priorRequests,
        historicalOnly: true,
        activeRequestId: state.activeLeadId || null,
      },
      state,
      leadId,
    };
  }

  if (name === "escalate_human") {
    state.humanRequested = true;
    state.humanHandoffRequested = true;
    if (!leadId && canHandoffLead(state)) {
      leadId = await createLeadFromConcierge({
        conversationId: ctx.conversationId,
        state,
        summary: ctx.summary,
        existingLeadId: "",
        utm: ctx.utm,
        escalate: true,
      });
    }
    return { result: { ok: true, handoff: true, reason: asString(args.reason) || "human" }, state, leadId };
  }

  return { result: { ok: false, reason: "unknown_tool" }, state, leadId };
}

export function mergeParsedWhen(state: ConversationState, text: string) {
  const parsed = parseNaturalDateTime(text);
  const locked = isSlotConfirmed(state);
  const reschedule = hasRescheduleSignal(text);

  if (parsed.date) {
    if (locked && !reschedule) {
      // Do not reinterpret date from unrelated turns (e.g. customer name).
    } else if (state.preferredDate && state.preferredDate !== parsed.date) {
      const previousSlots = state.offeredSlots || [];
      state = {
        ...clearSlotSelection(state),
        offeredSlots: [],
        awaitingSlotSelection: false,
        slotOfferToken: "",
        historicalSlotLabels: [
          ...new Set([...(state.historicalSlotLabels || []), ...previousSlots.map((s) => s.label)]),
        ].slice(-6),
      };
      state.preferredDate = parsed.date;
    } else if (!locked || reschedule) {
      state.preferredDate = parsed.date;
    }
  }
  if (parsed.time && (!locked || reschedule)) state.preferredTime = parsed.time;
  return state;
}
