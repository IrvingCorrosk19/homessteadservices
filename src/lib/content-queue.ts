import {
  getContentSettings,
  listJobsByStatus,
  recordContentEvent,
  updateJob,
  type ContentSettings,
} from "@/lib/content-catalog";
import type { ContentJob } from "@/lib/content-types";

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
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour: Number(read("hour")),
    minute: Number(read("minute")),
    stamp: `${read("year")}-${read("month")}-${read("day")}`,
  };
}

export function formatPanama(iso: string, settings: ContentSettings) {
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

export function recommendPublishAt(job: ContentJob, settings = getContentSettings()) {
  const now = new Date();
  const scheduled = listJobsByStatus(["SCHEDULED", "PUBLISHING", "PUBLISHED", "AWAITING_APPROVAL"]);
  const recentTypes = scheduled
    .map((item) => (item.serviceType || item.mixType || "").toLowerCase())
    .filter(Boolean)
    .slice(0, 3);
  const sameTypeCount = recentTypes.filter((item) => item === (job.serviceType || "").toLowerCase()).length;
  let cursor = new Date(now.getTime() + 60 * 60 * 1000);
  for (let step = 0; step < 21 * 48; step += 1) {
    const local = partsInZone(cursor, settings.timezone);
    const inDay = settings.daysEnabled.includes(local.weekday);
    const minutes = local.hour * 60 + local.minute;
    const inWindow = settings.windows.some((window) => {
      const [sh, sm] = window.start.split(":").map(Number);
      const [eh, em] = window.end.split(":").map(Number);
      return minutes >= sh * 60 + sm && minutes <= eh * 60 + em;
    });
    const dayPosts = scheduled.filter((item) => {
      if (!item.recommendedPublishAt) return false;
      return partsInZone(new Date(item.recommendedPublishAt), settings.timezone).stamp === local.stamp;
    }).length;
    const last = scheduled
      .map((item) => item.recommendedPublishAt)
      .filter(Boolean)
      .sort()
      .at(-1);
    const gapOk =
      !last ||
      cursor.getTime() - new Date(last).getTime() >= settings.minHoursBetweenPosts * 3600 * 1000;
    if (inDay && inWindow && dayPosts < settings.maxPostsPerDay && gapOk) {
      const reason =
        sameTypeCount >= 2
          ? `${formatPanama(cursor.toISOString(), settings)} — próximo espacio y evita repetir ${job.serviceType || "el mismo servicio"}.`
          : `${formatPanama(cursor.toISOString(), settings)} — horario recomendado por estrategia inicial (3–5 publicaciones por semana).`;
      return { at: cursor.toISOString(), reason };
    }
    cursor = new Date(cursor.getTime() + 30 * 60 * 1000);
  }
  const fallback = new Date(now.getTime() + 36 * 3600 * 1000);
  return {
    at: fallback.toISOString(),
    reason: `${formatPanama(fallback.toISOString(), settings)} — próximo espacio disponible (estrategia inicial).`,
  };
}

export function enqueueForApproval(job: ContentJob) {
  const settings = getContentSettings();
  const slot = recommendPublishAt(job, settings);
  updateJob(job.publicId, {
    status: "AWAITING_APPROVAL",
    recommendedPublishAt: slot.at,
    recommendationReason: slot.reason,
  });
  recordContentEvent(job.publicId, "CONTENT_RECOMMENDED", slot.reason);
  return slot;
}

export function parsePanamaDateTime(text: string) {
  const cleaned = text.trim().toLowerCase().replace(/\s+/g, " ");
  const match = cleaned.match(
    /(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i,
  );
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = match[3] ? Number(match[3]) : new Date().getFullYear();
  if (year < 100) year += 2000;
  let hour = Number(match[4]);
  const minute = Number(match[5] || "0");
  const ampm = (match[6] || "").replace(/\./g, "");
  if (ampm.startsWith("p") && hour < 12) hour += 12;
  if (ampm.startsWith("a") && hour === 12) hour = 0;
  const isoGuess = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-05:00`;
  const date = new Date(isoGuess);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
