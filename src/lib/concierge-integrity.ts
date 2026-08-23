import type { AvailabilitySlot } from "@/lib/concierge-availability";

const PRICE_CLAIM = /\$\s*\d|\b\d+\s*(usd|balboas?|d[oó]lares?)\b|\b(desde|cuesta|cobramos)\s+\d+/i;
const BOOKED_CLAIM =
  /\b(cita|visita)\b.{0,40}\b(agendad[ao]|confirmad[ao]|qued[oó] (agendad|confirmad)|ya est[aá] (agendad|confirmad))/i;
const INVENTED_CLOCK = /\b(?:a las\s+)?(\d{1,2}(?::\d{2})?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?|\d{2}:\d{2})\b/gi;

export function stripHallucinatedPrices(reply: string) {
  if (!PRICE_CLAIM.test(reply)) return { text: reply, removed: false };
  return {
    text: "El costo depende de lo que encontremos en sitio. Para no darte un número que después cambie, primero coordinamos la visita de evaluación.",
    removed: true,
  };
}

export function enforceBookingIntegrity(reply: string, booked: boolean) {
  if (booked || !BOOKED_CLAIM.test(reply)) return { text: reply, stripped: false };
  return {
    text: "Todavía no confirmé esa visita en el calendario. Si te parece, reviso horarios reales y te los ofrezco para que elijas.",
    stripped: true,
  };
}

function normalizeClock(value: string) {
  const raw = value.toLowerCase().replace(/\s+/g, "");
  const hm = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) return `${String(Number(hm[1])).padStart(2, "0")}:${hm[2]}`;
  const ampm = raw.match(/^(\d{1,2})(?::(\d{2}))?(a\.?m\.?|p\.?m\.?|am|pm)$/);
  if (ampm) {
    let hours = Number(ampm[1]);
    const afternoon = /p/.test(ampm[3]);
    if (hours === 12) hours = afternoon ? 12 : 0;
    else if (afternoon) hours += 12;
    return `${String(hours).padStart(2, "0")}:${ampm[2] || "00"}`;
  }
  const hourOnly = raw.match(/^(\d{1,2})$/);
  if (hourOnly) {
    let hours = Number(hourOnly[1]);
    if (hours >= 1 && hours <= 7) hours += 12;
    return `${String(hours).padStart(2, "0")}:00`;
  }
  return "";
}

export function enforceAvailabilityIntegrity(
  reply: string,
  slots: AvailabilitySlot[],
  options?: { skipRewrite?: boolean; allowResumeHint?: boolean },
) {
  if (options?.skipRewrite || !slots.length) {
    return { text: reply, stripped: false };
  }
  const clocks = [...reply.matchAll(INVENTED_CLOCK)]
    .map((item) => normalizeClock(item[1] || item[0]))
    .filter(Boolean);
  if (!slots.length) {
    if (clocks.length >= 2) {
      return {
        text: "Para no ofrecerte un horario que no esté libre, déjame revisar la agenda real y te digo qué opciones hay.",
        stripped: true,
      };
    }
    return { text: reply, stripped: false };
  }
  const allowed = new Set(slots.map((item) => item.time));
  const invented = clocks.some((clock) => !allowed.has(clock));
  if (!invented) return { text: reply, stripped: false };
  if (options?.allowResumeHint) {
    return { text: reply, stripped: false };
  }
  const offered = slots.map((item) => item.label).join("; ");
  return {
    text: `Revisé la agenda. Estos horarios sí están libres: ${offered}. ¿Cuál te queda mejor?`,
    stripped: true,
  };
}

export function injectionDeniedReply() {
  return "Estoy aquí para ayudarte con servicios de Homestead en tu propiedad. Cuéntame qué hay que reparar, mantener o instalar.";
}
