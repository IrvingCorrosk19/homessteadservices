import { listAppointments } from "@/lib/revenue-store";
import { businessHoursRange, businessYmd, DEFAULT_APPOINTMENT_SLOT_TIMES } from "@/lib/appointment-time";
import { isBusinessClock, parseNaturalDateTime, todayInPanama } from "@/lib/concierge-datetime";

export const DEFAULT_SLOT_TIMES = DEFAULT_APPOINTMENT_SLOT_TIMES;

export type AvailabilitySlot = {
  date: string;
  time: string;
  label: string;
};

const BLOCKED = new Set(["CANCELLED", "COMPLETED"]);

function occupiedKeys(from: string, to: string) {
  const busy = new Set<string>();
  for (const item of listAppointments({ from, to })) {
    if (BLOCKED.has(item.status)) continue;
    busy.add(`${item.date}|${item.startTime}`);
  }
  return busy;
}

function addYmd(ymd: string, days: number) {
  const utc = Date.parse(`${ymd}T12:00:00Z`) + days * 86400000;
  return new Date(utc).toISOString().slice(0, 10);
}

function slotHours() {
  const hours = businessHoursRange();
  return DEFAULT_SLOT_TIMES.filter((time) => time >= hours.start && time < hours.end);
}

function isPastSlot(date: string, time: string, now = new Date()) {
  const today = todayInPanama(now);
  if (date > today) return false;
  if (date < today) return true;
  const current = new Intl.DateTimeFormat("en-CA", {
    timeZone: hoursTimezone(),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return time <= current;
}

function hoursTimezone() {
  return businessHoursRange().timezone;
}

function labelFor(date: string, time: string) {
  const day = new Intl.DateTimeFormat("es-PA", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T12:00:00Z`));
  const [hours, minutes] = time.split(":").map(Number);
  const clock = new Intl.DateTimeFormat("es-PA", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(Date.UTC(2026, 0, 1, hours, minutes || 0)));
  return `${day}, ${clock}`;
}

export function checkAvailability(input: { dateText?: string; timeText?: string; now?: Date } = {}): {
  timezone: string;
  slots: AvailabilitySlot[];
  requested: { date: string; time: string };
  requestedAvailable: boolean;
  exactDayRequested: boolean;
  requestedDateUnavailable: boolean;
  message?: string;
} {
  const now = input.now || new Date();
  const parsed = parseNaturalDateTime(`${input.dateText || ""} ${input.timeText || ""}`.trim(), now);
  const today = todayInPanama(now);
  const exactDayRequested = Boolean(parsed.exactDay && parsed.date);
  let date = "";
  if (exactDayRequested) {
    date = parsed.date;
  } else if (parsed.date && parsed.date >= today) {
    date = parsed.date;
  } else {
    date = addYmd(today, 1);
  }

  const hours = slotHours();
  const from = today;
  const to = businessYmd(now, 21);
  const busy = occupiedKeys(from, to);
  const requestedTime = parsed.time && isBusinessClock(parsed.time) ? parsed.time : "";

  if (exactDayRequested && date < today) {
    return {
      timezone: hoursTimezone(),
      slots: [],
      requested: { date, time: requestedTime },
      requestedAvailable: false,
      exactDayRequested: true,
      requestedDateUnavailable: true,
      message: `Esa fecha (${date}) ya pasó. Si quieres, puedo revisar otro día.`,
    };
  }

  const requestedAvailable = Boolean(
    requestedTime && !busy.has(`${date}|${requestedTime}`) && !isPastSlot(date, requestedTime, now),
  );

  const slots: AvailabilitySlot[] = [];
  if (requestedAvailable) {
    slots.push({ date, time: requestedTime, label: labelFor(date, requestedTime) });
  }

  const considerDates = exactDayRequested ? [date] : [date, addYmd(date, 1), addYmd(date, 2)];
  for (const day of considerDates) {
    for (const time of hours) {
      if (slots.length >= 4) break;
      if (busy.has(`${day}|${time}`)) continue;
      if (isPastSlot(day, time, now)) continue;
      if (slots.some((item) => item.date === day && item.time === time)) continue;
      if (exactDayRequested && day !== date) continue;
      slots.push({ date: day, time, label: labelFor(day, time) });
    }
    if (slots.length >= 4) break;
  }

  const requestedDateUnavailable = exactDayRequested && slots.length === 0;
  return {
    timezone: hoursTimezone(),
    slots,
    requested: { date, time: requestedTime },
    requestedAvailable,
    exactDayRequested,
    requestedDateUnavailable,
    message: requestedDateUnavailable
      ? `El ${date.slice(8, 10)} no tengo horarios disponibles. Si quieres, puedo revisar el día anterior o el siguiente.`
      : undefined,
  };
}

export function isOfferedSlot(slots: AvailabilitySlot[], date: string, time: string) {
  return slots.some((item) => item.date === date && item.time === time);
}
