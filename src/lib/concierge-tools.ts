import { conciergeKnowledge } from "@/lib/concierge-knowledge";
import { checkAvailability, type AvailabilitySlot } from "@/lib/concierge-availability";
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
import { logInfo } from "@/lib/log";
import {
  activateOfferedSlots,
  clearActiveTransactionState,
  consumeOfferedSlots,
  detectNewTransactionSignal,
  validateActiveSlotBooking,
} from "@/lib/concierge-transaction";

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
      description: "Cancela la cita existente si el cliente lo pide.",
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
    const availability = checkAvailability({
      dateText: asString(args.dateText) || state.preferredDate || undefined,
      timeText: asString(args.timeText) || state.preferredTime || undefined,
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
        requestedAvailable: availability.requestedAvailable,
        exactDayRequested: availability.exactDayRequested,
        requestedDateUnavailable: availability.requestedDateUnavailable,
        message: availability.message || null,
        instruction: availability.requestedDateUnavailable
          ? "Di claramente que esa fecha no tiene horarios. Ofrece revisar días cercanos SOLO si el cliente acepta. NO presentes otro día como si fuera la fecha pedida."
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
    const bookingLeadId = state.activeLeadId || leadId;
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
    }
    if (!leadId) {
      recordFunnelEvent(ctx.conversationId, "AppointmentFailed", { reason: "no_lead" });
      return { result: { ok: false, reason: "need_valid_phone_and_problem" }, state, leadId };
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
    setAppointmentStatus(state.appointmentId, "CANCELLED");
    if (!isConciergeDryRun()) await notifyAppointmentEvent(state.appointmentId, "CANCELLED");
    return { result: { ok: true, appointmentId: state.appointmentId, status: "CANCELLED" }, state, leadId };
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
  if (parsed.date) {
    if (state.preferredDate && state.preferredDate !== parsed.date) {
      const previousSlots = state.offeredSlots || [];
      state = {
        ...state,
        offeredSlots: [],
        awaitingSlotSelection: false,
        slotOfferToken: "",
        pendingSlot: null,
        historicalSlotLabels: [
          ...new Set([...(state.historicalSlotLabels || []), ...previousSlots.map((s) => s.label)]),
        ].slice(-6),
      };
    }
    state.preferredDate = parsed.date;
  }
  if (parsed.time) state.preferredTime = parsed.time;
  return state;
}
