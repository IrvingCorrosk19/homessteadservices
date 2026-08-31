/**
 * Referential language resolution for slots, options, and entities.
 */
import type { AvailabilitySlot } from "@/lib/concierge-availability";
import type { OfferedSlot } from "@/lib/concierge-store";
import { parseClock } from "@/lib/concierge-datetime";

const ORDINAL_MAP: Record<string, number> = {
  primera: 1,
  primer: 1,
  primero: 1,
  segundo: 2,
  segunda: 2,
  tercer: 3,
  tercera: 3,
  cuarto: 4,
  cuarta: 4,
};

export type ReferentialResolution<T> = {
  resolved: T | null;
  ambiguous: boolean;
  needsClarification: boolean;
};

function fold(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function resolveOrdinalIndex(text: string): number | null {
  const blob = fold(text);
  const digit = blob.match(/\b(?:la|el)\s+(\d)(?:a|o|er)?\b/);
  if (digit) return Number(digit[1]);
  for (const [word, idx] of Object.entries(ORDINAL_MAP)) {
    if (new RegExp(`\\b${word}\\b`).test(blob)) return idx;
  }
  if (/\b(?:la|el)\s+del\s+medio\b/.test(blob)) return 2;
  return null;
}

export function resolveOfferedSlotReference(
  text: string,
  slots: OfferedSlot[] | AvailabilitySlot[],
  preferredDate = "",
): ReferentialResolution<AvailabilitySlot> {
  if (!slots.length) return { resolved: null, ambiguous: false, needsClarification: false };

  const lower = text.toLowerCase();
  const deLas = lower.match(/la de las (\d{1,2})/);
  if (deLas) {
    const hour = Number(deLas[1]);
    const match = slots.find((slot) => {
      const h = Number(slot.time.split(":")[0]);
      return h === hour || h === hour + 12;
    });
    if (match) return { resolved: match, ambiguous: false, needsClarification: false };
  }

  const parsedTime = parseClock(text);
  if (parsedTime) {
    const sameDate = preferredDate
      ? slots.filter((s) => s.date === preferredDate && s.time === parsedTime)
      : slots.filter((s) => s.time === parsedTime);
    if (sameDate.length === 1) return { resolved: sameDate[0], ambiguous: false, needsClarification: false };
  }

  const prefieroLas = lower.match(/prefiero\s+las\s+(\d{1,2})/);
  if (prefieroLas) {
    let hour = Number(prefieroLas[1]);
    if (hour >= 1 && hour <= 7) hour += 12;
    const target = `${String(hour).padStart(2, "0")}:00`;
    const match = slots.find((s) => s.time === target);
    if (match) return { resolved: match, ambiguous: false, needsClarification: false };
  }

  const blob = fold(text);
  if (/\bmediod[ií]a\b/.test(blob)) {
    const noon = slots.find((s) => s.time === "12:00" || /12/.test(s.label));
    if (noon) return { resolved: noon, ambiguous: false, needsClarification: false };
  }

  const ordinal = resolveOrdinalIndex(text);
  if (ordinal && ordinal >= 1 && ordinal <= slots.length) {
    return { resolved: slots[ordinal - 1], ambiguous: false, needsClarification: false };
  }

  if (/\b(ese|esa|ese horario|esa hora)\b/.test(blob) && slots.length === 1) {
    return { resolved: slots[0], ambiguous: false, needsClarification: false };
  }
  if (/\b(ese|esa)\b/.test(blob) && slots.length > 1) {
    return { resolved: null, ambiguous: true, needsClarification: true };
  }

  return { resolved: null, ambiguous: false, needsClarification: false };
}

export function resolveCancelReferent(
  text: string,
  state: { appointmentId?: string; activeLeadId?: string },
): ReferentialResolution<"appointment" | "request"> {
  if (!/\b(cancel|cancela|anul|canc[eé]lalo)\b/i.test(text)) {
    return { resolved: null, ambiguous: false, needsClarification: false };
  }
  const hasAppt = Boolean(state.appointmentId);
  const hasHs = Boolean(state.activeLeadId);
  if (hasAppt && !hasHs) return { resolved: "appointment", ambiguous: false, needsClarification: false };
  if (!hasAppt && hasHs) return { resolved: "request", ambiguous: false, needsClarification: false };
  if (hasAppt && hasHs) {
    if (/\b(cita|visita|hora)\b/i.test(text)) return { resolved: "appointment", ambiguous: false, needsClarification: false };
    if (/\b(solicitud|pedido|todo)\b/i.test(text)) return { resolved: "request", ambiguous: false, needsClarification: false };
    return { resolved: null, ambiguous: true, needsClarification: true };
  }
  return { resolved: null, ambiguous: false, needsClarification: false };
}
