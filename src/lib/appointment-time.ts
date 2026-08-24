import { revenueConfig } from "@/lib/revenue-score";

export const APPOINTMENT_STATUSES = [
  "REQUESTED",
  "PROPOSED",
  "CONFIRMED",
  "RESCHEDULED",
  "COMPLETED",
  "CANCELLED",
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  REQUESTED: "Solicitada",
  PROPOSED: "Propuesta",
  CONFIRMED: "Confirmada",
  RESCHEDULED: "Reprogramada",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
};

export const APPOINTMENT_ID_PATTERN = /^HA-[a-f0-9]{8}$/;

export function isAppointmentStatus(value: string): value is AppointmentStatus {
  return APPOINTMENT_STATUSES.includes(value as AppointmentStatus);
}

export const DEFAULT_APPOINTMENT_SLOT_TIMES = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"] as const;

export function businessTimezone() {
  return (
    process.env.HOMESTEAD_TIMEZONE?.trim() ||
    revenueConfig.businessHours.timezone ||
    "UTC"
  );
}

export function businessHoursRange() {
  return {
    start: revenueConfig.businessHours.start || "08:00",
    end: revenueConfig.businessHours.end || "22:00",
    timezone: businessTimezone(),
  };
}

function reminderDefaults() {
  const configured = (
    revenueConfig as {
      appointmentReminders?: { enabled?: boolean; offsets?: string[] };
    }
  ).appointmentReminders;
  return {
    enabled: configured?.enabled !== false,
    offsets: configured?.offsets?.length ? configured.offsets : ["24h", "2h"],
  };
}

export function parseDurationMs(value: string) {
  const match = String(value || "")
    .trim()
    .toLowerCase()
    .match(/^(\d+)\s*(h|m|d)$/);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (match[2] === "d") return amount * 24 * 60 * 60 * 1000;
  if (match[2] === "h") return amount * 60 * 60 * 1000;
  return amount * 60 * 1000;
}

export function appointmentReminderConfig() {
  const defaults = reminderDefaults();
  const enabledEnv = process.env.APPOINTMENT_REMINDER_ENABLED;
  const enabled = enabledEnv !== undefined ? enabledEnv !== "false" : defaults.enabled;
  const offsetsRaw = process.env.APPOINTMENT_REMINDER_OFFSETS?.trim() || defaults.offsets.join(",");
  const offsets = offsetsRaw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((label) => ({ label, ms: parseDurationMs(label) }))
    .filter((item) => item.ms > 0)
    .sort((a, b) => b.ms - a.ms);
  return { enabled, offsets, timezone: businessTimezone() };
}

export function zonedLocalToUtcMs(ymd: string, hm: string, timeZone = businessTimezone()) {
  const time = hm.length === 5 ? `${hm}:00` : hm;
  const utcGuess = Date.parse(`${ymd}T${time}Z`);
  if (!Number.isFinite(utcGuess)) return NaN;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcGuess));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asIf = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second"));
  return utcGuess + (utcGuess - asIf);
}

export function formatInBusinessZone(
  value: Date | number | string,
  options: Intl.DateTimeFormatOptions,
) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-PA", { timeZone: businessTimezone(), ...options }).format(date);
}

export function formatAppointmentClock(hm: string) {
  const [hours, minutes] = hm.split(":").map(Number);
  if (!Number.isFinite(hours)) return hm;
  const date = new Date(Date.UTC(2026, 0, 1, hours, minutes || 0));
  return new Intl.DateTimeFormat("es-PA", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatAppointmentDay(ymd: string) {
  const utc = Date.parse(`${ymd}T12:00:00Z`);
  if (!Number.isFinite(utc)) return ymd;
  return formatInBusinessZone(utc, { weekday: "long", day: "numeric", month: "long" });
}

export function businessYmd(date = new Date(), addDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: businessTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(date.getTime() + addDays * 0))
    .split("-")
    .map(Number);
  const utc = Date.UTC(parts[0], parts[1] - 1, parts[2] + addDays);
  return new Date(utc).toISOString().slice(0, 10);
}

export function reminderEligibleStatus(status: string) {
  return status === "CONFIRMED" || status === "RESCHEDULED";
}

export function dueReminderOffset(remainingMs: number, offsets: Array<{ label: string; ms: number }>) {
  if (remainingMs <= 0) return null;
  const sorted = [...offsets].sort((a, b) => b.ms - a.ms);
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];
    const minRemaining = next ? next.ms : 0;
    if (remainingMs > minRemaining && remainingMs <= current.ms) return current;
  }
  return null;
}

export function formatRemaining(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  if (hours < 24) return hours === 1 ? "1 hora" : `${hours} horas`;
  const days = Math.round((hours / 24) * 10) / 10;
  return days === 1 ? "1 día" : `${days} días`;
}

export function appointmentNoticeKey(appointmentId: string, eventType: string, version: number, extra = "") {
  return [appointmentId, eventType, String(version), extra].filter(Boolean).join(":");
}

export function firstName(name: string) {
  return String(name || "").trim().split(/\s+/)[0] || "Cliente";
}

export function appointmentServiceLabel(service: string, problem = "") {
  const blob = `${service} ${problem}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/pintar|pintur/.test(blob) && /repar/.test(blob)) return "Reparación y pintura";
  if (/repar/.test(blob) && /cielo\s*raso|cielo\s*razo|falso\s+techo/.test(blob)) return "Reparaciones";
  const labels: Record<string, string> = {
    ac: "Aire acondicionado",
    plumbing: "Plomería",
    painting: "Pintura",
    electrical: "Electricidad",
    locksmith: "Cerrajería",
    repairs: "Reparaciones",
    remodeling: "Remodelación",
    multiple: "Varios servicios",
  };
  return labels[service] || service || "Servicio Homestead";
}
