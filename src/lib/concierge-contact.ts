import { classifyPhone, looksLikePhoneAttempt, extractEmbeddedPhone, type PhoneStatus } from "@/lib/phone";
import { isStopSignal } from "@/lib/revenue-score";

const PASSIVE_CLOSE =
  /nos pondremos en contacto|te contactamos pronto|en breve te (llamo|contact)|nuestro equipo te contactar/i;

const PREFERENCE =
  /\b(hoy|mañana|manana|tarde|mañana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[áa]bado|domingo|despu[eé]s de|antes de|a las|horario|fin de semana)\b/i;

export function incompleteContactReply() {
  return "Gracias. Parece que al número le faltan algunos dígitos. ¿Puedes enviarme tu número completo para coordinar la visita?";
}

export function invalidContactReply() {
  return "No pude registrar ese número. ¿Me lo envías con todos los dígitos, incluyendo el código de área si lo tienes?";
}

export function visitPreferenceReply(state: { problem: string; location: string; service: string }) {
  const need = state.problem || "el trabajo";
  const zone = state.location ? ` en ${state.location}` : "";
  return `Perfecto, ya tengo tus datos para coordinar la evaluación de ${need}${zone}. ¿Hay algún día u horario que te resulte más conveniente para la visita?`;
}

export function preferenceAckReply(preference: string) {
  return `Perfecto. Tomé como preferencia ${preference}. La verificaremos para coordinar la visita.`;
}

export function isPassiveClose(reply: string) {
  return PASSIVE_CLOSE.test(reply);
}

export function looksLikeSchedulingPreference(text: string) {
  if (looksLikePhoneAttempt(text)) return false;
  return PREFERENCE.test(text);
}

export function parseVisitPreference(text: string) {
  const raw = text.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!raw) return { preferredDate: "", preferredTimeWindow: "" };
  const lower = raw.toLowerCase();
  let preferredDate = "";
  if (/\bhoy\b/.test(lower)) preferredDate = "hoy";
  else if (/\bmañana\b|\bmanana\b/.test(lower)) preferredDate = "mañana";
  return { preferredDate, preferredTimeWindow: raw };
}

export function assessUserContact(text: string, extractedPhone: string): { status: PhoneStatus; raw: string } {
  if (looksLikePhoneAttempt(text)) {
    const assessed = classifyPhone(text);
    return { status: assessed.status, raw: text };
  }
  const embedded = extractEmbeddedPhone(text);
  if (embedded) {
    const assessed = classifyPhone(embedded);
    return { status: assessed.status, raw: embedded };
  }
  if (extractedPhone.trim()) {
    const assessed = classifyPhone(extractedPhone);
    return { status: assessed.status, raw: extractedPhone };
  }
  return { status: "UNKNOWN", raw: "" };
}

export function shouldStopCommercial(text: string) {
  return isStopSignal(text) || /\bno quiero que me contacten\b/i.test(text);
}
