import { businessHoursRange, businessTimezone, businessYmd } from "@/lib/appointment-time";

const WEEKDAYS: Array<{ re: RegExp; index: number }> = [
  { re: /\bdomingos?\b/, index: 0 },
  { re: /\blunes\b/, index: 1 },
  { re: /\bmartes\b/, index: 2 },
  { re: /\bmi[eé]rcoles\b/, index: 3 },
  { re: /\bjueves\b/, index: 4 },
  { re: /\bviernes\b/, index: 5 },
  { re: /\bs[áa]bados?\b/, index: 6 },
];

export type ParsedVisitWhen = {
  date: string;
  time: string;
  window: string;
  raw: string;
  /** True when user named an exact calendar day (e.g. "el 27 de este mes"). */
  exactDay: boolean;
};

function panamaParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: businessTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return {
    ymd: `${read("year")}-${read("month")}-${read("day")}`,
    weekday: read("weekday"),
    hour: Number(read("hour")),
    minute: Number(read("minute")),
  };
}

function weekdayIndex(ymd: string) {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

function addYmd(ymd: string, days: number) {
  const utc = Date.parse(`${ymd}T12:00:00Z`) + days * 86400000;
  return new Date(utc).toISOString().slice(0, 10);
}

function nextWeekday(fromYmd: string, target: number) {
  const current = weekdayIndex(fromYmd);
  const delta = (target - current + 7) % 7 || 7;
  return addYmd(fromYmd, delta);
}

function padTime(hours: number, minutes = 0) {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseClock(text: string) {
  const lower = text.toLowerCase();
  const hm = lower.match(/\b(\d{1,2}):(\d{2})\b/);
  if (hm) {
    const hours = Number(hm[1]);
    const minutes = Number(hm[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) return padTime(hours, minutes);
  }
  const ampm = lower.match(/\b(\d{1,2})\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)\b/);
  if (ampm) {
    let hours = Number(ampm[1]);
    const afternoon = /p/.test(ampm[2]);
    if (hours === 12) hours = afternoon ? 12 : 0;
    else if (afternoon) hours += 12;
    if (hours >= 0 && hours <= 23) return padTime(hours);
  }
  const las = lower.match(/\ba las\s+(\d{1,2})\b/);
  if (las) {
    let hours = Number(las[1]);
    if (hours >= 1 && hours <= 7) hours += 12;
    if (hours >= 0 && hours <= 23) return padTime(hours);
  }
  return "";
}

function parseWindow(text: string) {
  const lower = text.toLowerCase();
  if (/\btemprano\b|\bpor la ma[ñn]ana\b|\ben la ma[ñn]ana\b/.test(lower) && !/\bma[ñn]ana a las\b|\bpasado ma[ñn]ana\b/.test(lower)) {
    return "morning";
  }
  if (/\btarde\b|\bpor la tarde\b|\bdespu[eé]s de las\b/.test(lower)) return "afternoon";
  if (/\bnoche\b|\bpor la noche\b/.test(lower)) return "evening";
  return "";
}

const MONTHS: Array<{ re: RegExp; month: number }> = [
  { re: /\beneros?\b/, month: 1 },
  { re: /\bfebreros?\b/, month: 2 },
  { re: /\bmarzos?\b/, month: 3 },
  { re: /\babriles?\b/, month: 4 },
  { re: /\bmayos?\b/, month: 5 },
  { re: /\bjunios?\b/, month: 6 },
  { re: /\bjulios?\b/, month: 7 },
  { re: /\bagostos?\b/, month: 8 },
  { re: /\bseptiembres?\b/, month: 9 },
  { re: /\boctubres?\b/, month: 10 },
  { re: /\bnoviembres?\b/, month: 11 },
  { re: /\bdiciembres?\b/, month: 12 },
];

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function ymdFromParts(year: number, month: number, day: number) {
  if (day < 1 || day > daysInMonth(year, month)) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parse exact calendar day: "el 27", "el 27 de este mes", "27 de agosto", "día 27". */
export function parseExactCalendarDay(text: string, todayYmd: string): string {
  const lower = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const year = Number(todayYmd.slice(0, 4));
  const monthNow = Number(todayYmd.slice(5, 7));
  const dayNow = Number(todayYmd.slice(8, 10));

  const iso = lower.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return ymdFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const esteMes = lower.match(/\b(?:el\s+|dia\s+|d[ií]a\s+)?(\d{1,2})\s+de\s+este\s+mes\b/);
  if (esteMes) return ymdFromParts(year, monthNow, Number(esteMes[1]));

  const dayMonth = lower.match(/\b(?:el\s+|dia\s+|d[ií]a\s+)?(\d{1,2})\s+de\s+([a-z]+)\b/);
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const monthToken = dayMonth[2];
    for (const entry of MONTHS) {
      if (entry.re.test(monthToken)) {
        let y = year;
        if (entry.month < monthNow || (entry.month === monthNow && day < dayNow)) y += 1;
        return ymdFromParts(y, entry.month, day);
      }
    }
  }

  const bareDay = lower.match(/\b(?:el|dia|d[ií]a)\s+(\d{1,2})\b(?!\s*(?:am|pm|a\.?\s*m|p\.?\s*m|:))/);
  if (bareDay) {
    const day = Number(bareDay[1]);
    if (day >= 1 && day <= 31) {
      let y = year;
      let m = monthNow;
      if (day < dayNow) {
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
      }
      return ymdFromParts(y, m, day);
    }
  }
  return "";
}

export function parseNaturalDateTime(text: string, now = new Date()): ParsedVisitWhen {
  const raw = text.trim().replace(/\s+/g, " ").slice(0, 120);
  const lower = raw.toLowerCase();
  const today = panamaParts(now).ymd;
  let date = "";
  let exactDay = false;

  const exact = parseExactCalendarDay(raw, today);
  if (exact) {
    date = exact;
    exactDay = true;
  } else if (/\bhoy\b/.test(lower)) date = today;
  else if (/\bpasado\s+ma[ñn]ana\b/.test(lower)) date = addYmd(today, 2);
  else if (/\bma[ñn]ana\b/.test(lower)) date = addYmd(today, 1);
  else {
    for (const day of WEEKDAYS) {
      if (day.re.test(lower)) {
        date = nextWeekday(today, day.index);
        break;
      }
    }
  }
  const time = parseClock(lower);
  const window = parseWindow(lower);
  let inferred = time;
  if (!inferred && window === "morning") inferred = "09:00";
  if (!inferred && window === "afternoon") inferred = "15:00";
  if (!inferred && window === "evening") inferred = "18:00";
  return { date, time: inferred, window, raw, exactDay };
}

export function isBusinessClock(hm: string) {
  if (!/^\d{2}:\d{2}$/.test(hm)) return false;
  const hours = businessHoursRange();
  return hm >= hours.start && hm < hours.end;
}

export function todayInPanama(now = new Date()) {
  return businessYmd(now);
}

export function formatPanamaSlot(date: string, time: string) {
  const day = new Intl.DateTimeFormat("es-PA", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${date}T12:00:00Z`));
  const [hours, minutes] = time.split(":").map(Number);
  const clock = new Intl.DateTimeFormat("es-PA", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(Date.UTC(2026, 0, 1, hours, minutes || 0)));
  return `${day} a las ${clock}`;
}
