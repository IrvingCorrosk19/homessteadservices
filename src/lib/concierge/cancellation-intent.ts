/**
 * Customer cancellation / adjacent intent classifier.
 * Regex assists; backend still validates target and lifecycle.
 */
import { PUBLIC_ID_PATTERN } from "@/lib/admin-format";
import type { ConversationState } from "@/lib/concierge-store";
import { detectFullConversationReset } from "@/lib/concierge/conversation-reset";
import { hasRescheduleSignal } from "@/lib/concierge/canonical-state";
import { resolvePrimaryFromMessage } from "@/lib/concierge/service-intent";
import { classifyPhone } from "@/lib/phone";
import {
  getRequestByPublicId,
  listCancellableRequestsForCustomer,
} from "@/lib/service-requests";
import { resolveShortReplyIntent } from "@/lib/concierge/affirmative-context";

export const CANCELLATION_REASON_CATEGORIES = [
  "NO_LONGER_NEEDED",
  "RESOLVED_BY_CUSTOMER",
  "FOUND_OTHER_PROVIDER",
  "PRICE",
  "SCHEDULE",
  "DUPLICATE_REQUEST",
  "CREATED_BY_MISTAKE",
  "CUSTOMER_CHANGED_MIND",
  "OTHER",
  "NOT_PROVIDED",
] as const;

export type CancellationReasonCategory = (typeof CANCELLATION_REASON_CATEGORIES)[number];

const RESCHEDULE_RE =
  /\b(perd[oó]n|disculp|mejor\s+(a\s+las|el|ma[ñn]ana|pasado|este|la\s+de)|prefiero\s+(las|el|a\s+las|ma[ñn]ana|las\s+cuatro|las\s+\d)|puede\s+ser\s+(?:a\s+las|el)|quiero\s+cambiar|cambiar\s+la\s+hora|cambi[eé]mosla|c[aá]mbial[ao]|reprogram|mover\s+la\s+cita|ponla\s+a\s+las|mejor\s+el\s+viernes)\b/i;

function sanitizeReason(raw: string) {
  return raw.replace(/\s+/g, " ").trim().slice(0, 280);
}

export function classifyCancellationReason(text: string): {
  category: CancellationReasonCategory;
  reason: string;
} {
  const blob = fold(text);
  const trimmed = sanitizeReason(text);
  if (!trimmed) return { category: "NOT_PROVIDED", reason: "" };
  if (/\b(ya\s+lo\s+resolv|ya\s+resolvi|ya\s+lo\s+arregle|por\s+mi\s+cuenta)\b/.test(blob)) {
    return { category: "RESOLVED_BY_CUSTOMER", reason: trimmed };
  }
  if (/\b(consegu[ií]|otra\s+persona|otro\s+proveedor|quien\s+lo\s+arregla)\b/.test(blob)) {
    return { category: "FOUND_OTHER_PROVIDER", reason: trimmed };
  }
  if (/\b(caro|precio|cotiz|presupuesto|tarifa)\b/.test(blob)) {
    return { category: "PRICE", reason: trimmed };
  }
  if (/\b(horario|no\s+puedo|fecha|agenda)\b/.test(blob) && !/\b(solicitud|servicio|trabajo)\b/.test(blob)) {
    return { category: "SCHEDULE", reason: trimmed };
  }
  if (/\b(duplicad|ya\s+ten[ií]a|por\s+error|sin\s+querer|me\s+equivo)\b/.test(blob)) {
    return { category: "CREATED_BY_MISTAKE", reason: trimmed };
  }
  if (/\b(ya\s+no\s+(lo\s+)?necesito|ya\s+no\s+quiero|cambie\s+de\s+opinion|mejor\s+no)\b/.test(blob)) {
    return { category: "NO_LONGER_NEEDED", reason: trimmed };
  }
  if (/\b(cambio\s+de\s+servicio|mejor\s+(pint|plomer|aire|gypsum))\b/.test(blob)) {
    return { category: "CUSTOMER_CHANGED_MIND", reason: trimmed };
  }
  return { category: "OTHER", reason: trimmed };
}

export type CustomerCancellationIntentKind =
  | "CANCEL_REQUEST"
  | "CANCEL_APPOINTMENT_ONLY"
  | "RESCHEDULE_APPOINTMENT"
  | "DELETE_DATA_REQUEST"
  | "RESET_CONVERSATION"
  | "END_CONVERSATION"
  | "SWITCH_SERVICE"
  | "ADD_SERVICE"
  | "PAUSE_SERVICE"
  | "CONTINUE_SERVICE"
  | "CORRECT_INFORMATION"
  | "GENERAL_QUESTION"
  | "REJECT_SLOT"
  | "AMBIGUOUS_TOMORROW"
  | "AMBIGUOUS_CANCEL_TARGET"
  | "NONE";

export type CustomerCancellationIntent = {
  kind: CustomerCancellationIntentKind;
  reason: string;
  reasonCategory: CancellationReasonCategory;
  explicitRequestId: string;
  confidence: "high" | "medium" | "low";
  explainedAsDelete: boolean;
};

function fold(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const DELETE_DATA_RE =
  /\b(borr(en|ar|a)?\s+(todos\s+)?mis\s+datos|elimin(en|ar|a)?\s+(todos\s+)?mis\s+datos|quiero\s+que\s+(borren|eliminen)\s+mis\s+datos|datos\s+personales)\b/i;

const END_CHAT_RE =
  /\b(gracias[,\s]+eso\s+es\s+todo|adios|adi[oó]s|cerrar\s+(el\s+)?chat|hasta\s+luego|eso\s+ser[ií]a\s+todo)\b/i;

const CANCEL_REQUEST_RE =
  /\b(cancela(r)?\s+(mi\s+)?(solicitud|pedido|trabajo|servicio)|cancela(r)?\s+(eso|la\s+solicitud|el\s+servicio)|ya\s+no\s+(kiero|quiero)\s+(el\s+)?servicio|ya\s+no\s+(nesesito|necesito)\s+que\s+vengan|ya\s+no\s+lo\s+(nesesito|necesito)|no\s+necesito\s+que\s+vengan|mejor\s+no\s+vengan|olvida\s+el\s+trabajo|olvidalo,?\s+ya\s+no|ya\s+lo\s+resolv|ya\s+resolvi|consegui\s+(a\s+)?otra\s+persona|consegu[ií]\s+quien|elimin(a|e|ar)\s+mi\s+solicitud|cansela\s+(la\s+)?(solicitud|eso|servicio)|ya\s+no\s+kiero)\b/i;

const CANCEL_APPOINTMENT_RE =
  /\b(cancela(r)?\s+(la\s+)?(cita|visita|sita)|no\s+necesito\s+la\s+(cita|visita)|cancel(a|ar)\s+la\s+cita|ya\s+no\s+quiero\s+(la\s+)?cita)\b/i;

const KEEP_REQUEST_RE =
  /\b(pero\s+(todav[ií]a|a[uú]n)\s+quiero|mantener\s+la\s+solicitud|la\s+solicitud\s+(sigue|contin[uú]a)|quiero\s+(hacer|mantener)\s+el\s+trabajo)\b/i;

const REJECT_SLOT_RE =
  /\b(no\s+quiero\s+esa\s+hora|esa\s+hora\s+no|otro\s+horario|no\s+me\s+sirve\s+esa\s+hora)\b/i;

const TOMORROW_NO_RE = /^(ma[ñn]ana\s+no|no\s+ma[ñn]ana)[\s!.?]*$/i;

const UNCERTAIN_RE = /\b(creo\s+que\s+ya\s+no|quiz[aá]s\s+no|tal\s+vez\s+no\s+voy)\b/i;

const HS_ID_RE = /HS-\d{4}-\d{6}/i;

export function extractExplicitRequestId(text: string) {
  const match = text.match(HS_ID_RE);
  return match && PUBLIC_ID_PATTERN.test(match[0].toUpperCase()) ? match[0].toUpperCase() : "";
}

export function detectCustomerCancellationIntent(
  text: string,
  state: ConversationState,
): CustomerCancellationIntent {
  const trimmed = text.trim();
  const blob = fold(trimmed);
  const classified = classifyCancellationReason(trimmed);
  const explicitRequestId = extractExplicitRequestId(trimmed);
  const base = {
    reason: classified.reason,
    reasonCategory: classified.category,
    explicitRequestId,
    explainedAsDelete: false,
  };

  if (!trimmed) {
    return { kind: "NONE", ...base, confidence: "low" };
  }

  if (detectFullConversationReset(trimmed)) {
    return { kind: "RESET_CONVERSATION", ...base, confidence: "high" };
  }

  if (DELETE_DATA_RE.test(trimmed)) {
    return { kind: "DELETE_DATA_REQUEST", ...base, confidence: "high" };
  }

  if (END_CHAT_RE.test(trimmed) && !CANCEL_REQUEST_RE.test(blob) && !CANCEL_APPOINTMENT_RE.test(blob)) {
    return { kind: "END_CONVERSATION", ...base, confidence: "high" };
  }

  const nextService = resolvePrimaryFromMessage(trimmed);
  const previous = state.primaryService || state.service || "";
  if (
    nextService &&
    previous &&
    nextService !== previous &&
    /\b(olvid(emos|alo|a\s+lo)|mejor\s+(ayudame|quiero|necesito|vamos|pint|plomer|aire|gypsum)|ahora\s+(quiero|necesito)|vamos\s+con)\b/i.test(trimmed)
  ) {
    return { kind: "SWITCH_SERVICE", ...base, confidence: "high" };
  }

  if (
    state.appointmentId &&
    (RESCHEDULE_RE.test(trimmed) || hasRescheduleSignal(trimmed))
  ) {
    return { kind: "RESCHEDULE_APPOINTMENT", ...base, confidence: "high" };
  }

  if (REJECT_SLOT_RE.test(trimmed)) {
    return { kind: "REJECT_SLOT", ...base, confidence: "high" };
  }

  if (UNCERTAIN_RE.test(blob)) {
    return { kind: "AMBIGUOUS_CANCEL_TARGET", ...base, confidence: "low" };
  }

  const short = resolveShortReplyIntent(trimmed, state);
  if (short === "PRESERVE_APPOINTMENT") {
    return { kind: "CONTINUE_SERVICE", ...base, confidence: "high" };
  }
  if (short === "CONFIRM_CANCEL") {
    const lastQ = state.facts?.lastBotQuestion || "";
    if (/cita|visita/.test(lastQ) && !/solicitud/.test(lastQ)) {
      return { kind: "CANCEL_APPOINTMENT_ONLY", ...base, confidence: "high" };
    }
    return { kind: "CANCEL_REQUEST", ...base, confidence: "high" };
  }
  if (/^(no|nop)[\s!.?]*$/i.test(trimmed)) {
    return { kind: "NONE", ...base, confidence: "low" };
  }

  if (TOMORROW_NO_RE.test(trimmed) && state.appointmentId) {
    return { kind: "AMBIGUOUS_TOMORROW", ...base, confidence: "medium" };
  }

  const appointmentOnly = CANCEL_APPOINTMENT_RE.test(blob) || /\bcancela\s+la\s+sita\b/.test(blob);
  const keepRequest = KEEP_REQUEST_RE.test(blob);
  const requestCancel = CANCEL_REQUEST_RE.test(blob) || /\belimina(r)?\s+mi\s+solicitud\b/.test(blob);

  if (appointmentOnly && keepRequest) {
    return { kind: "CANCEL_APPOINTMENT_ONLY", ...base, confidence: "high" };
  }
  if (appointmentOnly && !requestCancel) {
    if (state.appointmentId && state.activeLeadId && /\b(cancel[ae]|anul)/i.test(trimmed) && !/\b(cita|visita|sita|hora)\b/i.test(trimmed)) {
      return { kind: "AMBIGUOUS_CANCEL_TARGET", ...base, confidence: "medium" };
    }
    return { kind: "CANCEL_APPOINTMENT_ONLY", ...base, confidence: "high" };
  }
  if (requestCancel) {
    return {
      kind: "CANCEL_REQUEST",
      ...base,
      explainedAsDelete: /\belimin/.test(blob),
      confidence: "high",
    };
  }

  if (/\b(cancel|cancela|anul|canc[eé]lalo|cansela)\b/i.test(trimmed)) {
    if (state.appointmentId && state.activeLeadId) {
      if (/\b(solicitud|pedido|todo|servicio|trabajo)\b/i.test(trimmed)) {
        return { kind: "CANCEL_REQUEST", ...base, confidence: "high" };
      }
      if (/\b(cita|visita|sita|hora)\b/i.test(trimmed)) {
        return { kind: "CANCEL_APPOINTMENT_ONLY", ...base, confidence: "high" };
      }
      return { kind: "AMBIGUOUS_CANCEL_TARGET", ...base, confidence: "medium" };
    }
    if (state.activeLeadId) return { kind: "CANCEL_REQUEST", ...base, confidence: "high" };
    if (state.appointmentId) return { kind: "CANCEL_APPOINTMENT_ONLY", ...base, confidence: "high" };
  }

  return { kind: "NONE", ...base, confidence: "low" };
}

export type CancellationTarget =
  | { ok: true; requestId: string }
  | { ok: false; errorCode: "NEEDS_CLARIFICATION" | "NOT_AUTHORIZED" | "NOT_FOUND"; options?: Array<{ publicId: string; service: string }> };

function phonesMatch(a: string, b: string) {
  const da = classifyPhone(a).digits || a.replace(/\D/g, "");
  const db = classifyPhone(b).digits || b.replace(/\D/g, "");
  if (da.length < 8 || db.length < 8) return false;
  return da.slice(-8) === db.slice(-8);
}

export function requestOwnedByConversation(
  requestId: string,
  state: ConversationState,
  conversationLeadId = "",
) {
  const request = getRequestByPublicId(requestId);
  if (!request) return false;
  if (requestId === state.activeLeadId || requestId === conversationLeadId) return true;
  if (state.contactStatus === "VALID" && state.phone && phonesMatch(state.phone, request.phone)) {
    return true;
  }
  return false;
}

export function resolveCancellationTarget(
  intent: CustomerCancellationIntent,
  state: ConversationState,
  conversationLeadId = "",
): CancellationTarget {
  const explicit = intent.explicitRequestId;
  if (explicit) {
    const request = getRequestByPublicId(explicit);
    if (!request || !requestOwnedByConversation(explicit, state, conversationLeadId)) {
      return { ok: false, errorCode: "NOT_AUTHORIZED" };
    }
    return { ok: true, requestId: explicit };
  }

  const contextual = (state.activeLeadId || conversationLeadId || "").trim();
  if (contextual && !contextual.startsWith("DRY-") && PUBLIC_ID_PATTERN.test(contextual)) {
    if (!requestOwnedByConversation(contextual, state, conversationLeadId) && contextual !== state.activeLeadId) {
      return { ok: false, errorCode: "NOT_AUTHORIZED" };
    }
    return { ok: true, requestId: contextual };
  }

  if (state.contactStatus === "VALID" && state.phone) {
    const open = listCancellableRequestsForCustomer(state.phone);
    if (open.length === 1) return { ok: true, requestId: open[0].publicId };
    if (open.length > 1) {
      return {
        ok: false,
        errorCode: "NEEDS_CLARIFICATION",
        options: open.slice(0, 4).map((row) => ({ publicId: row.publicId, service: row.service })),
      };
    }
  }

  return { ok: false, errorCode: "NOT_FOUND" };
}

export function formatMultiRequestClarification(options: Array<{ publicId: string; service: string }>) {
  const labels: Record<string, string> = {
    plumbing: "plomería",
    ac: "aire acondicionado",
    locksmith: "cerradura",
    painting: "pintura",
    electrical: "eléctrico",
    gypsum: "gypsum",
  };
  const named = options.map((row) => labels[row.service] || row.service);
  if (named.length === 2) {
    return `Veo que tienes más de una solicitud activa. ¿Quieres cancelar la de ${named[0]} o la de ${named[1]}?`;
  }
  return `Veo que tienes más de una solicitud activa. ¿Cuál quieres cancelar: ${named.join(", ")}?`;
}
