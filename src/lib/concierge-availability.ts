import { listAppointments } from "@/lib/revenue-store";
import { businessHoursRange, businessYmd, DEFAULT_APPOINTMENT_SLOT_TIMES } from "@/lib/appointment-time";
import { isOpenAppointmentSlot } from "@/lib/appointment-slot";
import {
  isBusinessClock,
  parseMinTimeFromText,
  parseNaturalDateTime,
  todayInPanama,
  type ParsedVisitWhen,
} from "@/lib/concierge-datetime";
import { logInfo } from "@/lib/log";

export const DEFAULT_SLOT_TIMES = DEFAULT_APPOINTMENT_SLOT_TIMES;

export type AvailabilitySlot = {
  date: string;
  time: string;
  label: string;
};

const BLOCKED = new Set(["CANCELLED", "COMPLETED"]);
const SEARCH_HORIZON_DAYS = 7;
const MAX_OFFER = 4;

export type AvailabilityQueryResult = {
  timezone: string;
  slots: AvailabilitySlot[];
  requested: { date: string; time: string };
  requestedAvailable: boolean;
  requestedSlotBusy: boolean;
  exactDayRequested: boolean;
  requestedDateUnavailable: boolean;
  sameDayFull: boolean;
  nextAvailableDate: string;
  message?: string;
  queryExecuted: true;
};

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

function filterHoursForPreference(hours: string[], parsed: ParsedVisitWhen, raw: string) {
  const minTime = parseMinTimeFromText(raw);
  if (minTime) return hours.filter((time) => time >= minTime);
  if (parsed.window === "morning") return hours.filter((time) => time < "12:00");
  if (parsed.window === "afternoon") return hours.filter((time) => time >= "12:00" && time < "18:00");
  if (parsed.window === "evening") return hours.filter((time) => time >= "17:00");
  return hours;
}

function slotIsOpen(date: string, time: string, busy: Set<string>, now: Date) {
  if (busy.has(`${date}|${time}`)) return false;
  if (isPastSlot(date, time, now)) return false;
  return isOpenAppointmentSlot(date, time);
}

function collectDaySlots(
  day: string,
  hours: string[],
  busy: Set<string>,
  now: Date,
  exclude?: { date: string; time: string },
  max = MAX_OFFER,
) {
  const out: AvailabilitySlot[] = [];
  for (const time of hours) {
    if (exclude && exclude.date === day && exclude.time === time) continue;
    if (!slotIsOpen(day, time, busy, now)) continue;
    out.push({ date: day, time, label: labelFor(day, time) });
    if (out.length >= max) break;
  }
  return out;
}

function formatClock(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return new Intl.DateTimeFormat("es-PA", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(Date.UTC(2026, 0, 1, hours, minutes || 0)));
}

function buildBusyMessage(date: string, requestedTime: string, alternatives: AvailabilitySlot[]) {
  const when = formatClock(requestedTime);
  const sameDay = alternatives.filter((s) => s.date === date);
  if (sameDay.length) {
    const list = sameDay.map((s) => formatClock(s.time)).join(" y ");
    return `A las ${when} ya está ocupado. Tengo ${list}. ¿Alguno te funciona?`;
  }
  if (alternatives.length) {
    const first = alternatives[0];
    const list = alternatives.slice(0, 3).map((s) => formatClock(s.time)).join(", ");
    return `Para ese día ya estamos completos. El ${first.date.slice(8, 10)} tengo ${list}. ¿Te funciona alguno?`;
  }
  return `Para ese horario no tengo disponibilidad ahora mismo.`;
}

/** Real calendar query — LLM must not invent slots outside this result. */
export function checkAvailability(input: { dateText?: string; timeText?: string; now?: Date; logId?: string } = {}): AvailabilityQueryResult {
  const now = input.now || new Date();
  const raw = `${input.dateText || ""} ${input.timeText || ""}`.trim();
  const parsed = parseNaturalDateTime(raw, now);
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

  const hoursAll = slotHours();
  const hours = filterHoursForPreference(hoursAll, parsed, raw);
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
      requestedSlotBusy: false,
      exactDayRequested: true,
      requestedDateUnavailable: true,
      sameDayFull: true,
      nextAvailableDate: "",
      message: `Esa fecha (${date}) ya pasó. Si quieres, puedo revisar otro día.`,
      queryExecuted: true,
    };
  }

  const requestedAvailable = Boolean(
    requestedTime && slotIsOpen(date, requestedTime, busy, now),
  );
  const requestedSlotBusy = Boolean(requestedTime && !requestedAvailable);

  const slots: AvailabilitySlot[] = [];
  if (requestedAvailable) {
    slots.push({ date, time: requestedTime, label: labelFor(date, requestedTime) });
  }

  if (requestedSlotBusy && exactDayRequested) {
    const sameDay = collectDaySlots(date, hours, busy, now, { date, time: requestedTime });
    for (const slot of sameDay) {
      if (slots.length >= MAX_OFFER) break;
      if (!slots.some((s) => s.date === slot.date && s.time === slot.time)) slots.push(slot);
    }
  } else if (!requestedTime || !exactDayRequested) {
    const considerDates = exactDayRequested ? [date] : [date, addYmd(date, 1), addYmd(date, 2)];
    for (const day of considerDates) {
      const daySlots = collectDaySlots(day, hours, busy, now, undefined, MAX_OFFER - slots.length);
      for (const slot of daySlots) {
        if (slots.length >= MAX_OFFER) break;
        if (!slots.some((s) => s.date === slot.date && s.time === slot.time)) slots.push(slot);
      }
      if (slots.length >= MAX_OFFER) break;
    }
  }

  let sameDayFull = false;
  let nextAvailableDate = "";
  if (exactDayRequested && slots.length === 0) {
    sameDayFull = true;
    for (let offset = 1; offset <= SEARCH_HORIZON_DAYS; offset++) {
      const day = addYmd(date, offset);
      const found = collectDaySlots(day, hours, busy, now, undefined, MAX_OFFER);
      if (found.length) {
        nextAvailableDate = day;
        slots.push(...found);
        break;
      }
    }
  }

  const requestedDateUnavailable = exactDayRequested && sameDayFull && slots.length === 0;
  let message: string | undefined;
  if (requestedSlotBusy) {
    message = buildBusyMessage(date, requestedTime, slots);
  } else if (requestedDateUnavailable) {
    message = `Para el ${date.slice(8, 10)} no tengo horarios disponibles en los próximos días. Si quieres, revisamos otra fecha.`;
  } else if (sameDayFull && slots.length) {
    message = `Para el ${date.slice(8, 10)} ya estamos completos. Tengo opciones el ${nextAvailableDate.slice(8, 10)}. ¿Te funciona alguna?`;
  }

  if (input.logId) {
    logInfo("AVAILABILITY_QUERY_EXECUTED", {
      contentJobId: input.logId.slice(0, 8),
      stage: `${date}${requestedTime ? ` ${requestedTime}` : ""}`,
      phone: String(slots.length),
    });
  }

  return {
    timezone: hoursTimezone(),
    slots,
    requested: { date, time: requestedTime },
    requestedAvailable,
    requestedSlotBusy,
    exactDayRequested,
    requestedDateUnavailable,
    sameDayFull,
    nextAvailableDate,
    message,
    queryExecuted: true,
  };
}

export function isOfferedSlot(slots: AvailabilitySlot[], date: string, time: string) {
  return slots.some((item) => item.date === date && item.time === time);
}

export function isSlotStillOpen(date: string, time: string, excludeAppointmentId?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return false;
  if (isPastSlot(date, time)) return false;
  return isOpenAppointmentSlot(date, time, excludeAppointmentId);
}
