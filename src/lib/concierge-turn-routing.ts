import type { ConversationState, OfferedSlot } from "@/lib/concierge-store";
import { formatPanamaSlot } from "@/lib/concierge-datetime";
import { getPlaybook } from "@/lib/concierge/service-playbooks";
import { areOfferedSlotsActive, resolveSlotFromMessage } from "@/lib/concierge-transaction";

export type TurnRoute = {
  priceIntent: boolean;
  bookingPauseIntent: boolean;
  newNeedIntent: boolean;
  humanHandoffIntent: boolean;
  serviceQuestionIntent: boolean;
  socialAckIntent: boolean;
  photoIntent: boolean;
  slotSelectionIntent: boolean;
  resumeBookingIntent: boolean;
  bookingDateChangeIntent: boolean;
  objectionIntent: boolean;
  isInterruption: boolean;
};

const PRICE =
  /\b(cu[aá]nto|cuesta|precio|costo|valor|tarifa|m[aá]s o menos|aproximadamente|cotiz|presupuesto|caro|barato)\b/i;
const BOOKING_PAUSE =
  /\b(no quiero agendar|no agendar|todav[ií]a no|despu[eé]s veo|quiero pensarlo|mejor no agendar|cancelar la cita|no estoy seguro)\b/i;
const NEW_NEED =
  /\b(otra cosa|algo m[aá]s|quiero otra|diferente|tambi[eé]n necesito|mejor primero|cambiar de|otra solicitud|necesito otra|olvidemos|olvidalo|dejemos eso|mejor ayudame|ya no quiero eso)\b/i;
const HUMAN = /persona|humano|asesor|hablar con alguien|un t[eé]cnico|alguien real/i;
const SERVICE_Q =
  /\b(qu[eé] incluye|cu[aá]nto demora|cu[aá]nto tarda|garant[ií]a|c[oó]mo funciona|qu[eé] hacen|antes quiero saber)\b/i;
const PHOTO = /\b(foto|imagen|mandar foto|enviar foto|adjunt|puedo mandar)\b/i;
const RESUME =
  /\b(seguir con la cita|continuar con la cita|sobre el aire|retomar la cita|volvamos a la cita|dame la de|me sirve la|quiero el de|la de las)\b/i;
const DATE_CHANGE = /\b(mejor ma[nñ]ana|otro d[ií]a|otra fecha|la pr[oó]xima semana|revisar otro d[ií]a)\b/i;
const OBJECTION = /\b(muy caro|caro|pensarlo|despu[eé]s|no estoy seguro|dud)\b/i;

function isSocialAck(text: string) {
  const trimmed = text.trim();
  if (trimmed.length > 40) return false;
  return /^(gracias|ok|perfecto|listo|entendido|de acuerdo|bueno|vale|genial)[\s!.?]*$/i.test(trimmed);
}

export function isExplicitSlotSelection(text: string, slots: OfferedSlot[]) {
  if (!slots.length) return false;
  if (resolveSlotFromMessage(text, slots)) return true;
  const trimmed = text.trim();
  if (/^(la )?(primera|segunda|tercera|cuarta|[uú]ltima)$/i.test(trimmed)) return true;
  if (/^\d{1,2}(:\d{2})?\s*(am|pm|a\.?\s*m\.?|p\.?\s*m\.?)?$/i.test(trimmed)) return true;
  if (/\b(me sirve|confirmo|ese horario|la de las|a las \d|quiero (el|la) de|agendar (a las|el))\b/i.test(text)) {
    return true;
  }
  return false;
}

export function interpretTurnRoute(text: string, state: ConversationState): TurnRoute {
  const priceIntent = PRICE.test(text);
  const bookingPauseIntent = BOOKING_PAUSE.test(text);
  const newNeedIntent = NEW_NEED.test(text);
  const humanHandoffIntent = HUMAN.test(text);
  const serviceQuestionIntent = SERVICE_Q.test(text);
  const socialAckIntent = isSocialAck(text);
  const photoIntent = PHOTO.test(text);
  const resumeBookingIntent = RESUME.test(text) && areOfferedSlotsActive(state);
  const bookingDateChangeIntent = DATE_CHANGE.test(text);
  const objectionIntent = OBJECTION.test(text) && !priceIntent;

  const dominated =
    priceIntent ||
    bookingPauseIntent ||
    newNeedIntent ||
    humanHandoffIntent ||
    serviceQuestionIntent ||
    photoIntent ||
    bookingDateChangeIntent ||
    objectionIntent ||
    (socialAckIntent && !resumeBookingIntent);

  const slotSelectionIntent =
    !dominated && areOfferedSlotsActive(state) && isExplicitSlotSelection(text, state.offeredSlots);

  const isInterruption = dominated && areOfferedSlotsActive(state) && !slotSelectionIntent;

  return {
    priceIntent,
    bookingPauseIntent,
    newNeedIntent,
    humanHandoffIntent,
    serviceQuestionIntent,
    socialAckIntent,
    photoIntent,
    slotSelectionIntent,
    resumeBookingIntent,
    bookingDateChangeIntent,
    objectionIntent,
    isInterruption,
  };
}

export function priceGuidanceReply(state: ConversationState, resumeSlots = false) {
  const service = state.primaryService || state.service;
  const playbook = service ? getPlaybook(service) : null;
  const serviceName = playbook?.label || "el servicio";
  let body =
    `El costo de ${serviceName.toLowerCase()} depende de lo que esté presentando el equipo y del trabajo que sea necesario hacer. ` +
    "Con la revisión en sitio te damos el monto antes de realizar cualquier trabajo.";
  if (resumeSlots && areOfferedSlotsActive(state)) {
    const times = state.offeredSlots.map((s) => s.label.match(/\d{1,2}:\d{2}\s*(a\.\s*m\.|p\.\s*m\.)?/i)?.[0] || s.time).join(", ");
    body += `\n\nSi quieres, seguimos con la cita. Tenía disponibles ${times}.`;
  } else if (resumeSlots && state.offeredSlots.length) {
    body += "\n\nSi quieres, podemos seguir con la cita cuando te quede bien.";
  }
  return body;
}

export function newNeedReply() {
  return "Claro. Cuéntame qué más necesitas y lo vemos.";
}

export function bookingPauseReply() {
  return "Está bien. Podemos seguir revisando tu caso por aquí cuando quieras.";
}

export function socialAckReply(state: ConversationState) {
  if (areOfferedSlotsActive(state) && state.bookingSuspended) {
    return "Con gusto. Si quieres retomar la cita, dime qué horario te funciona.";
  }
  return "Con gusto. Sigo aquí si necesitas algo más.";
}

export function serviceContextLabel(state: ConversationState) {
  const service = state.primaryService || state.service;
  if (!service) return null;
  const playbook = getPlaybook(service);
  return playbook?.label || null;
}

export type SlotGroup = {
  date: string;
  dateLabel: string;
  times: Array<{ label: string; date: string; time: string }>;
};

export function buildSlotGroups(slots: OfferedSlot[]): SlotGroup[] {
  const map = new Map<string, SlotGroup>();
  for (const slot of slots) {
    if (!map.has(slot.date)) {
      const when = slot.date && slot.time ? formatPanamaSlot(slot.date, slot.time) : slot.label;
      const dateLabel = when.replace(/\d{1,2}:\d{2}\s*(a\.\s*m\.|p\.\s*m\.)?/i, "").trim() || slot.date;
      map.set(slot.date, { date: slot.date, dateLabel, times: [] });
    }
    const timeLabel =
      slot.label.match(/\d{1,2}:\d{2}\s*(a\.\s*m\.|p\.\s*m\.)?/i)?.[0]?.trim() || slot.time;
    map.get(slot.date)!.times.push({ label: timeLabel, date: slot.date, time: slot.time });
  }
  return [...map.values()];
}

export function looksLikeAvailabilityLoop(text: string) {
  return /revis[eé] la agenda|estos horarios s[ií] est[aá]n libres|cu[aá]l te queda mejor|cu[aá]l te funciona/i.test(
    text,
  );
}
