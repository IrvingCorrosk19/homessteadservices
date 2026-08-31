/**
 * Appointment reprogramming — preserve HS identity; HA is rescheduled, not recreated.
 */
import { parseNaturalDateTime, parseClock, formatPanamaSlot } from "@/lib/concierge-datetime";
import type { ConversationState } from "@/lib/concierge-store";
import { checkAvailability } from "@/lib/concierge-availability";
import { hasRescheduleSignal } from "@/lib/concierge/canonical-state";
import { getPlaybook } from "@/lib/concierge/service-playbooks";
import { isConciergeDryRun } from "@/lib/concierge-flags";
import { logInfo } from "@/lib/log";
import { notifyAppointmentEvent } from "@/lib/revenue-telegram";
import {
  getAppointment,
  rescheduleAppointment,
  saveLeadPreference,
  type AppointmentRecord,
} from "@/lib/revenue-store";
import { clearSlotSelection, lockSelectedSlot } from "@/lib/concierge/canonical-state";
import type { OfferedSlot } from "@/lib/concierge-store";
import { isQualityFeedbackNotSchedule } from "@/lib/concierge/schedule-phrases";

export const REPROGRAM_APPOINTMENT_RE =
  /\b(perd[oó]n|disculp|mejor\s+(a\s+las|el|ma[ñn]ana|pasado|este|la\s+de)|prefiero\s+(las|el|a\s+las|ma[ñn]ana|las\s+cuatro|las\s+\d)|puede\s+ser\s+(?:a\s+las|el)|quiero\s+cambiar|cambiar\s+la\s+hora|cambi[eé]mosla|c[aá]mbial[ao]|reprogram|mover\s+la\s+cita|ponla\s+a\s+las)\b/i;

const TIME_CHANGE_ONLY =
  /\b(mejor\s+a\s+las|a\s+las\s+\d|las\s+\d|:\d{2}\s*(a\.?\s*m|p\.?\s*m)|\d{1,2}\s*(a\.?\s*m|p\.?\s*m|am|pm))\b/i;

export function getActiveAppointment(state: ConversationState): AppointmentRecord | null {
  if (!state.appointmentId) return null;
  const appt = getAppointment(state.appointmentId);
  if (!appt) return null;
  if (appt.status === "CANCELLED" || appt.status === "COMPLETED") return null;
  return appt;
}

export function hasActiveBookedAppointment(state: ConversationState): boolean {
  return getActiveAppointment(state) !== null;
}

export function resolveAuthoritativeRequestId(
  state: ConversationState,
  conversationLeadId = "",
): string {
  const active = state.activeLeadId?.trim() || "";
  if (active && !active.startsWith("DRY-")) return active;
  const column = conversationLeadId?.trim() || "";
  if (column && !column.startsWith("DRY-")) return column;
  const appt = getActiveAppointment(state);
  if (appt?.leadId) return appt.leadId;
  return "";
}

export function rehydrateRequestFromAppointment(state: ConversationState): ConversationState {
  const leadId = resolveAuthoritativeRequestId(state);
  if (!leadId || state.activeLeadId === leadId) return state;
  return {
    ...state,
    activeLeadId: leadId,
    facts: {
      ...(state.facts || {}),
      activeRequestCleared: "",
      lastActiveRequestId: leadId,
    },
  };
}

export function detectReprogramAppointmentIntent(
  text: string,
  state: ConversationState,
  apptOverride?: AppointmentRecord | null,
): boolean {
  const hasAppointmentContext =
    apptOverride !== undefined
      ? Boolean(apptOverride)
      : Boolean(getActiveAppointment(state)) || Boolean(state.appointmentId?.trim());
  if (!hasAppointmentContext) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (isQualityFeedbackNotSchedule(trimmed)) return false;
  if (REPROGRAM_APPOINTMENT_RE.test(trimmed)) return true;
  if (hasRescheduleSignal(trimmed)) return true;
  if (TIME_CHANGE_ONLY.test(trimmed) && /\d/.test(trimmed)) return true;
  return false;
}

export function parseReprogramTarget(
  text: string,
  state: ConversationState,
  appt: AppointmentRecord,
): { date: string; time: string } {
  const parsed = parseNaturalDateTime(text);
  const clock = parseClock(text);
  const date = parsed.date || state.preferredDate || appt.date;
  const time = parsed.time || clock || state.preferredTime || "";
  return { date, time };
}

export function formatReprogramSuccessReply(
  publicId: string,
  previousWhen: string,
  newWhen: string,
  serviceLabel: string,
) {
  const svc = serviceLabel ? ` (${serviceLabel.toLowerCase()})` : "";
  return `Listo. Tu solicitud ${publicId}${svc} quedó reprogramada para ${newWhen}. Antes estaba para ${previousWhen}.`;
}

export function formatReprogramUnavailableReply(
  publicId: string,
  currentWhen: string,
  requestedWhen: string,
  alternatives: string[],
) {
  const alt =
    alternatives.length > 0
      ? `\n\nTengo estas alternativas: ${alternatives.slice(0, 4).join(", ")}.`
      : "";
  return `Las ${requestedWhen} no están disponibles. Tu cita de ${publicId} para ${currentWhen} sigue confirmada.${alt}`;
}

export type ReprogramAttemptResult =
  | {
      ok: true;
      state: ConversationState;
      leadId: string;
      reply: string;
      previousDate: string;
      previousTime: string;
      newDate: string;
      newTime: string;
    }
  | {
      ok: false;
      state: ConversationState;
      leadId: string;
      reply: string;
      reason: string;
    };

export async function tryReprogramAppointment(input: {
  conversationId: string;
  state: ConversationState;
  text: string;
  leadId?: string;
}): Promise<ReprogramAttemptResult | null> {
  let state = rehydrateRequestFromAppointment(input.state);
  if (!detectReprogramAppointmentIntent(input.text, state)) return null;

  const appt = getActiveAppointment(state);
  if (!appt) return null;

  const leadId = resolveAuthoritativeRequestId(state, input.leadId || "") || appt.leadId;
  state = { ...state, activeLeadId: leadId };

  const target = parseReprogramTarget(input.text, state, appt);
  if (!target.date || !target.time) {
    return {
      ok: false,
      state,
      leadId,
      reason: "need_datetime",
      reply: "Claro. ¿Para qué día y hora prefieres reprogramar la visita?",
    };
  }

  if (target.date === appt.date && target.time === appt.startTime) {
    const when = formatPanamaSlot(appt.date, appt.startTime);
    return {
      ok: false,
      state,
      leadId,
      reason: "same_slot",
      reply: `Tu cita ${leadId} ya está confirmada para ${when}. Si quieres otro horario, dime cuál.`,
    };
  }

  logInfo("REPROGRAM_APPOINTMENT_STARTED", {
    contentJobId: input.conversationId.slice(0, 8),
    stage: `${leadId}:${appt.appointmentId}`,
  });

  const availability = checkAvailability({
    dateText: `${target.date} ${target.time}`,
    timeText: `${target.date} ${target.time}`,
    logId: input.conversationId,
  });

  const exactFree =
    availability.requestedAvailable &&
    availability.requested.date === target.date &&
    availability.requested.time === target.time;

  if (!exactFree) {
    const currentWhen = formatPanamaSlot(appt.date, appt.startTime);
    const requestedWhen = formatPanamaSlot(target.date, target.time);
    const alternatives = availability.slots
      .filter((s) => s.date === target.date || s.date === appt.date)
      .map((s) => s.label || formatPanamaSlot(s.date, s.time))
      .slice(0, 4);
    logInfo("REPROGRAM_APPOINTMENT_SLOT_BUSY", {
      contentJobId: input.conversationId.slice(0, 8),
      stage: target.time,
    });
    return {
      ok: false,
      state,
      leadId,
      reason: "slot_unavailable",
      reply: formatReprogramUnavailableReply(leadId, currentWhen, requestedWhen, alternatives),
    };
  }

  const moved = rescheduleAppointment(appt.appointmentId, target.date, target.time, { actor: "concierge" });
  if (!moved.ok) {
    const currentWhen = formatPanamaSlot(appt.date, appt.startTime);
    return {
      ok: false,
      state,
      leadId,
      reason: moved.reason,
      reply: `No pude mover la cita a ese horario. Tu visita de ${currentWhen} sigue confirmada en ${leadId}.`,
    };
  }

  const slot: OfferedSlot = {
    date: target.date,
    time: target.time,
    label: formatPanamaSlot(target.date, target.time),
  };
  state = clearSlotSelection(state);
  state = lockSelectedSlot(state, slot);
  state = {
    ...state,
    appointmentId: appt.appointmentId,
    preferredDate: target.date,
    preferredTime: target.time,
    funnelStage: "BOOKED",
    facts: {
      ...(state.facts || {}),
      lastReprogramAt: new Date().toISOString(),
      lastReprogramFrom: `${appt.date}|${appt.startTime}`,
      lastReprogramTo: `${target.date}|${target.time}`,
    },
  };
  saveLeadPreference(leadId, target.date, target.time);

  if (!isConciergeDryRun()) {
    await notifyAppointmentEvent(appt.appointmentId, "RESCHEDULED", {
      previousDate: moved.previousDate,
      previousTime: moved.previousTime,
    });
  }

  const previousWhen = formatPanamaSlot(moved.previousDate, moved.previousTime);
  const newWhen = formatPanamaSlot(target.date, target.time);
  const playbook = getPlaybook(state.primaryService || state.service);
  const reply = formatReprogramSuccessReply(leadId, previousWhen, newWhen, playbook?.label || appt.serviceLabel);

  logInfo("REPROGRAM_APPOINTMENT_SUCCEEDED", {
    contentJobId: input.conversationId.slice(0, 8),
    stage: `${leadId}:${target.date} ${target.time}`,
  });

  return {
    ok: true,
    state,
    leadId,
    reply,
    previousDate: moved.previousDate,
    previousTime: moved.previousTime,
    newDate: target.date,
    newTime: target.time,
  };
}
