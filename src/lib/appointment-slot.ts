import { businessHoursRange, businessYmd } from "@/lib/appointment-time";
import { isBusinessClock, todayInPanama } from "@/lib/concierge-datetime";
import { getHomesteadDb } from "@/lib/service-requests";

const OPEN_STATUSES = ["REQUESTED", "PROPOSED", "CONFIRMED", "RESCHEDULED"] as const;

export function isPastAppointmentSlot(date: string, time: string, now = new Date()) {
  const today = todayInPanama(now);
  if (date > today) return false;
  if (date < today) return true;
  const current = new Intl.DateTimeFormat("en-CA", {
    timeZone: businessHoursRange().timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return time <= current;
}

export function isOpenAppointmentSlot(date: string, startTime: string, excludeAppointmentId?: string) {
  const row = getHomesteadDb()
    .prepare(
      `SELECT appointment_id FROM revenue_appointments
       WHERE date = ? AND start_time = ? AND status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED')
       LIMIT 1`,
    )
    .get(date, startTime) as { appointment_id: string } | undefined;
  if (!row) return true;
  if (excludeAppointmentId && row.appointment_id === excludeAppointmentId) return true;
  return false;
}

export function validateRescheduleSlot(
  date: string,
  startTime: string,
  excludeAppointmentId?: string,
  now = new Date(),
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime)) {
    return { ok: false as const, reason: "invalid_time" as const };
  }
  if (!isBusinessClock(startTime)) {
    return { ok: false as const, reason: "invalid_time" as const };
  }
  if (date < businessYmd(now)) {
    return { ok: false as const, reason: "past_slot" as const };
  }
  if (isPastAppointmentSlot(date, startTime, now)) {
    return { ok: false as const, reason: "past_slot" as const };
  }
  if (!isOpenAppointmentSlot(date, startTime, excludeAppointmentId)) {
    return { ok: false as const, reason: "slot_taken" as const };
  }
  return { ok: true as const };
}

export { OPEN_STATUSES };
