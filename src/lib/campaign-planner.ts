import { getContentSettings, listJobsByStatus, type ContentSettings } from "@/lib/content-catalog";
import type { PieceFormat, PiecePillar } from "@/lib/campaign-types";

export type PlannedSlot = {
  index: number;
  pillar: PiecePillar;
  format: PieceFormat;
  at: string;
  reason: string;
};

function partsInZone(date: Date, timeZone: string) {
  const bits = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: string) => bits.find((part) => part.type === type)?.value || "";
  const weekday = read("weekday");
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    weekday: map[weekday] || 0,
    stamp: `${read("year")}-${read("month")}-${read("day")}`,
    hour: Number(read("hour")),
    minute: Number(read("minute")),
  };
}

function formatPanama(iso: string, settings: ContentSettings) {
  return new Intl.DateTimeFormat("es-PA", {
    timeZone: settings.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

export function occupiedPublishTimes(settings = getContentSettings()) {
  return listJobsByStatus(["SCHEDULED", "PUBLISHING", "PUBLISHED", "AWAITING_APPROVAL", "APPROVED"])
    .map((job) => job.recommendedPublishAt)
    .filter((value): value is string => Boolean(value));
}

export function nextPublishSlot(input: {
  occupied: string[];
  settings?: ContentSettings;
  from?: Date;
}) {
  const settings = input.settings || getContentSettings();
  const occupied = [...input.occupied].filter(Boolean).sort();
  let cursor = new Date((input.from || new Date()).getTime() + 60 * 60 * 1000);
  for (let step = 0; step < 21 * 48; step += 1) {
    const local = partsInZone(cursor, settings.timezone);
    const inDay = settings.daysEnabled.includes(local.weekday);
    const minutes = local.hour * 60 + local.minute;
    const inWindow = settings.windows.some((window) => {
      const [sh, sm] = window.start.split(":").map(Number);
      const [eh, em] = window.end.split(":").map(Number);
      return minutes >= sh * 60 + sm && minutes <= eh * 60 + em;
    });
    const dayPosts = occupied.filter((iso) => {
      return partsInZone(new Date(iso), settings.timezone).stamp === local.stamp;
    }).length;
    const last = occupied.at(-1);
    const gapOk =
      !last || cursor.getTime() - new Date(last).getTime() >= settings.minHoursBetweenPosts * 3600 * 1000;
    if (inDay && inWindow && dayPosts < settings.maxPostsPerDay && gapOk) {
      return {
        at: cursor.toISOString(),
        reason: `${formatPanama(cursor.toISOString(), settings)} — ventana ${settings.windows[0]?.start || "18:00"}–${settings.windows[0]?.end || "20:00"} ${settings.timezone}.`,
      };
    }
    cursor = new Date(cursor.getTime() + 30 * 60 * 1000);
  }
  const fallback = new Date((input.from || new Date()).getTime() + settings.minHoursBetweenPosts * 3600 * 1000);
  return {
    at: fallback.toISOString(),
    reason: `${formatPanama(fallback.toISOString(), settings)} — siguiente hueco estimado.`,
  };
}

const PILLARS: PiecePillar[] = ["discovery", "explain", "trust", "explain", "ask"];

/**
 * 5 feed slots using live content_settings.
 * A 7-day ask with 1/day and 36h gap usually expands; the note explains that.
 */
export function planCampaignSlots(input: {
  count: number;
  requestedDays: number;
  now?: Date;
  occupied?: string[];
  settings?: ContentSettings;
}) {
  const settings = input.settings || getContentSettings();
  const occupied = [...(input.occupied || occupiedPublishTimes(settings))];
  const slots: PlannedSlot[] = [];
  let from = input.now ? new Date(input.now) : new Date();
  for (let i = 0; i < input.count; i += 1) {
    const rec = nextPublishSlot({ occupied, settings, from });
    occupied.push(rec.at);
    slots.push({
      index: i,
      pillar: PILLARS[i] || "ask",
      format: "SINGLE_IMAGE",
      at: rec.at,
      reason: rec.reason,
    });
    from = new Date(Date.parse(rec.at) + 60 * 60 * 1000);
  }
  const first = Date.parse(slots[0]?.at || new Date().toISOString());
  const last = Date.parse(slots[slots.length - 1]?.at || new Date().toISOString());
  const scheduledDays = Math.max(1, Math.ceil((last - first) / 86400000) + 1);
  const note =
    scheduledDays > input.requestedDays
      ? `Pediste ${input.requestedDays} días y ${input.count} piezas. Con ${settings.maxPostsPerDay} publicación/día y ${settings.minHoursBetweenPosts} h de separación, el calendario queda en ${scheduledDays} días (ventanas ${settings.windows[0]?.start || "18:00"}–${settings.windows[0]?.end || "20:00"} ${settings.timezone}, lun–sáb).`
      : `Calendario de ${scheduledDays} días, ${settings.maxPostsPerDay} pieza/día, separación ${settings.minHoursBetweenPosts} h.`;
  return { slots, scheduledDays, note, settings };
}
