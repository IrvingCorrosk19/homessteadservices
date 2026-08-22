import { businessTimezone } from "@/lib/appointment-time";

function positiveInt(value: string | undefined, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function opsConfig() {
  return {
    timezone: businessTimezone() || "America/Panama",
    rescueAfterMinutes: positiveInt(process.env.LEAD_RESCUE_AFTER_MINUTES, 15),
    rescueLookbackHours: positiveInt(process.env.LEAD_RESCUE_LOOKBACK_HOURS, 24),
    slaFirstMinutes: positiveInt(process.env.SLA_FIRST_RESPONSE_MINUTES, 15),
    slaEscalationMinutes: positiveInt(process.env.SLA_ESCALATION_MINUTES, 30),
    slaLookbackHours: positiveInt(process.env.SLA_LOOKBACK_HOURS, 24),
    dailyBriefHour: positiveInt(process.env.DAILY_BRIEF_HOUR, 8),
    quietStartHour: positiveInt(process.env.OPS_QUIET_START_HOUR, 22),
    quietEndHour: positiveInt(process.env.OPS_QUIET_END_HOUR, 7),
    pageSize: 5,
  };
}

export function panamaParts(date = new Date()) {
  const tz = opsConfig().timezone;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return {
    ymd: `${read("year")}-${read("month")}-${read("day")}`,
    hour: Number(read("hour")),
    weekday: read("weekday"),
  };
}

export function isQuietHours(date = new Date()) {
  const { quietStartHour, quietEndHour } = opsConfig();
  const hour = panamaParts(date).hour;
  if (quietStartHour === quietEndHour) return false;
  if (quietStartHour > quietEndHour) return hour >= quietStartHour || hour < quietEndHour;
  return hour >= quietStartHour && hour < quietEndHour;
}

export function nextQuietEndIso(date = new Date()) {
  const { timezone, quietEndHour } = opsConfig();
  const { ymd, hour } = panamaParts(date);
  const dayOffset = hour >= quietEndHour ? 1 : 0;
  const base = new Date(`${ymd}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + dayOffset);
  const nextYmd = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
  const local = `${nextYmd}T${String(quietEndHour).padStart(2, "0")}:00:00`;
  const asUtc = Date.parse(local + "Z");
  const shown = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date(asUtc));
  const driftHours = Number(shown) - quietEndHour;
  return new Date(asUtc - driftHours * 3600_000).toISOString();
}

export function agoLabel(iso: string) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "Ahora";
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `Hace ${days} d`;
}
