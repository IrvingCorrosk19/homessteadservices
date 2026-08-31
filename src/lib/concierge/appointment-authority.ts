/**
 * DB-authoritative appointment facts — summary/memory cannot override.
 */
import { formatPanamaSlot } from "@/lib/concierge-datetime";
import type { ConversationState } from "@/lib/concierge-store";
import { resolveAuthoritativeRequestId } from "@/lib/concierge/appointment-reprogram";
import { getHomesteadDb } from "@/lib/service-requests";
import { getAppointment } from "@/lib/revenue-store";

export function getAuthoritativeAppointment(state: ConversationState) {
  if (state.appointmentId) {
    const direct = getAppointment(state.appointmentId);
    if (direct && direct.status !== "CANCELLED" && direct.status !== "COMPLETED") return direct;
  }
  const leadId = resolveAuthoritativeRequestId(state);
  if (!leadId) return null;
  const row = getHomesteadDb()
    .prepare(
      `SELECT appointment_id FROM revenue_appointments
       WHERE lead_id = ? AND status NOT IN ('CANCELLED', 'COMPLETED')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(leadId) as { appointment_id: string } | undefined;
  if (!row?.appointment_id) return null;
  return getAppointment(row.appointment_id);
}

export function answerAppointmentTimeQuestion(text: string, state: ConversationState): { handled: boolean; reply: string } {
  if (!/\b(a qu[eé] hora|para qu[eé] hora|cu[aá]ndo es mi cita|hora de mi cita|qued[oó] mi visita)\b/i.test(text)) {
    return { handled: false, reply: "" };
  }
  const appt = getAuthoritativeAppointment(state);
  if (!appt || appt.status === "CANCELLED" || appt.status === "COMPLETED") {
    return {
      handled: true,
      reply: "No veo una cita activa en este momento. Si quieres, revisamos juntos si hay una visita programada.",
    };
  }
  const when = formatPanamaSlot(appt.date, appt.startTime);
  return {
    handled: true,
    reply: `Según el calendario, tu visita está para ${when}.`,
  };
}

export function repairSummaryAppointmentTime(state: ConversationState): ConversationState {
  const appt = getAuthoritativeAppointment(state);
  if (!appt) return state;
  const when = `${appt.date} ${appt.startTime}`;
  const raw = state.facts?._conversationSummary;
  if (!raw) return state;
  try {
    const summary = JSON.parse(raw) as { appointments?: string[]; confirmedFacts?: string[] };
    summary.appointments = [state.appointmentId];
    const facts = summary.confirmedFacts || [];
    const filtered = facts.filter((f) => !f.startsWith("appointmentTime:"));
    filtered.push(`appointmentTime:${when}`);
    summary.confirmedFacts = filtered;
    return {
      ...state,
      facts: {
        ...(state.facts || {}),
        _conversationSummary: JSON.stringify(summary),
        authoritativeAppointmentTime: when,
      },
      preferredDate: appt.date,
      preferredTime: appt.startTime,
    };
  } catch {
    return state;
  }
}
