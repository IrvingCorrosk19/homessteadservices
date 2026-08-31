import { REPROGRAM_APPOINTMENT_RE } from "@/lib/concierge/appointment-reprogram";

const TIME_OR_DATE_SIGNAL =
  /\b(a\s+las|las\s+\d|:\d{2}\s*(?:a\.?\s*m|p\.?\s*m)?|\d{1,2}\s*(?:a\.?\s*m|p\.?\s*m|am|pm)|ma[ñn]ana|pasado\s+ma[ñn]ana|este\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)|el\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo))\b/i;

const LOCATION_CUE =
  /\b(estoy en|vivo en|me encuentro en|ubicad[oa] en|la zona es|no estoy en|me equivoqu[eé]|mejor dicho|en realidad es|realmente es|c[aá]mbialo a|c[aá]mbia a)\b/i;

/** User message is only about time/date change, not location. */
export function isScheduleOrTimeOnlyMessage(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.length > 100) return false;
  if (/\b\d{7,8}\b/.test(trimmed)) return false;
  if (/\b(soy|me llamo|mi nombre es|vivo en|vivo por|estoy en)\b/i.test(trimmed)) return false;
  if (/\b(edison\s+park|betania|el\s+dorado|san\s+francisco|bella\s+vista)\b/i.test(trimmed)) return false;
  if (/\b(aire|fuga|gotea|pintura|plomer[ií]a|cerradura)\b/i.test(trimmed) && TIME_OR_DATE_SIGNAL.test(trimmed)) {
    return false;
  }
  if (LOCATION_CUE.test(trimmed) && TIME_OR_DATE_SIGNAL.test(trimmed)) return false;
  if (REPROGRAM_APPOINTMENT_RE.test(trimmed)) {
    if (/\b(perd[oó]n|disculp)\b/i.test(trimmed) && !TIME_OR_DATE_SIGNAL.test(trimmed)) {
      return /\b(mejor|cambiar|reprogram|c[aá]mbial|mover\s+la\s+cita)\b/i.test(trimmed);
    }
    return true;
  }
  if (TIME_OR_DATE_SIGNAL.test(trimmed) && /\d|ma[ñn]ana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo/i.test(trimmed)) {
    if (LOCATION_CUE.test(trimmed)) return false;
    return true;
  }
  return false;
}

/** Candidate extracted as "location" is actually a schedule phrase. */
export function looksLikeScheduleLocationCandidate(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed) return false;
  if (isScheduleOrTimeOnlyMessage(trimmed)) return true;
  return /\b(mejor\s+a\s+las|a\s+las\s+\d|las\s+\d|:\d{2})\b/i.test(trimmed);
}

/** "mejor en Betania" / "mejor en San Francisco" — location, not schedule. */
export function isBetterInLocationPhrase(text: string): boolean {
  return /\bmejor\s+en\s+/i.test(text) && !TIME_OR_DATE_SIGNAL.test(text);
}

/** Quality/result feedback — "quedó mejor", not a schedule change. */
export function isQualityFeedbackNotSchedule(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/\b(qued[oó]|sal[ií]o|est[aá]|result[oó]|arregl[oó]|pint[oó])\s+mejor\b/i.test(trimmed)) return true;
  if (/\bmejor\s+(ahora|que\s+antes|as[ií])\b/i.test(trimmed)) return true;
  if (/\bmejor\s+a\s+las\s+(?:cuatro|tres|dos|cinco|seis|siete|ocho|nueve|diez)\s+horas?\b/i.test(trimmed)) return true;
  return false;
}

/** True when user explicitly corrects location (not time-only "perdón, mejor a las…"). */
export function isLocationExplicitCorrection(text: string): boolean {
  if (isScheduleOrTimeOnlyMessage(text)) return false;
  if (isBetterInLocationPhrase(text)) return true;
  return /\b(no estoy en|no\s+es\s+[^,]+,?\s*es|me equivoqu[eé]|mejor dicho|en realidad es|realmente es|c[aá]mbialo a|c[aá]mbia a|disculpa,?\s*es|perd[oó]n,?\s*(?:es|estoy en|la zona|ubicad))/i.test(
    text,
  );
}
