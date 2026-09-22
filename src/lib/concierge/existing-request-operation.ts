/**
 * Speech-act gate for operations on EXISTING service requests / appointments.
 *
 * Retrieved business data is context. It is not new customer intent.
 * High-confidence commands establish the action boundary BEFORE generic
 * service detection, transaction-reconcile, or ensureActiveServiceRequest
 * can create or switch HS.
 */
import { PUBLIC_ID_PATTERN } from "@/lib/admin-format";
import { resolvePrimaryFromMessage } from "@/lib/concierge/service-intent";
import type { PlaybookServiceId } from "@/lib/concierge/service-playbooks";
import { foldLex } from "@/lib/concierge/lexical-match";
import {
  isHypotheticalSpeech,
  isQuotedThirdPartyCommand,
  looksLikeMalformedHsId,
  speechAfterSelfCorrection,
} from "@/lib/concierge/speech-act-safety";

const HS_ID_RE = /HS-\d{4}-\d{6}/gi;

const CANCEL_VERB_RE =
  /\b(cancel[aeá]r?|anul[aeá]r?|cansela|canc[eé]lalo)\b/i;

const APPOINTMENT_OBJECT_RE = /\b(cita|visita|sita|hora)\b/i;

const REQUEST_OBJECT_RE = /\b(solicitud|pedido|trabajo|folio)\b/i;

const PRESERVE_RE =
  /\b(dej(a|ala|e|emos|en)?l?a?\s+(activa|abierta|asi|as[ií]|como\s+est[aá])|no\s+la\s+cancel|mant[eé]n(la|er)?|sigue\s+activa|d[eé]jala\s+activa|la\s+otra\s+(s[ií]|sigue|queda|no)|no\s+me\s+crees?\s+otra|esa\s+d[eé]jala|solo\s+cancela|no\s+quiero\s+cambiar\s+la)\b/i;

const NEW_REQUEST_OPERATOR_RE =
  /\b(crea(me|nos)?\s+(otra|una(\s+nueva)?)|abre(me)?\s+(otra|una(\s+nueva)?)|nueva\s+solicitud|otra\s+solicitud|dame\s+otra\s+solicitud|haceme\s+otra|mejor\s+(quiero|necesito|vamos|ayudame|pint)|ahora\s+(quiero|necesito)|vamos\s+con)\b/i;

const STATUS_RE =
  /\b(cu[aá]ntas?\s+solicitudes|cu[aá]les?\s+(tengo\s+)?(activas|solicitudes)|mis\s+solicitudes|n[uú]meros?\s+de\s+(mis\s+)?solicitudes|list(a|ame|me)\s+mis\s+solicitudes|estado\s+de\s+(mi\s+)?solicitud|dame los n[uú]meros|cu[aá]l sigue activa|cu[aá]l (es|sigue|fue) la(\s+(del|de la|otra|primera|ultima|última|solicitud|activa)))\b/i;

const RESCHEDULE_RE =
  /\b(cambiar?\s+la\s+hora|reprogram|mover\s+la\s+cita|otro\s+horario)\b/i;

const CONTEXT_RESET_RE =
  /\b(olv[ií]da(lo|mos)?\s+lo\s+que\s+hablamos|olv[ií]da\s+esa\s+parte|cambiemos\s+de\s+tema)\b/i;

const KEEP_REQUEST_RE =
  /\b(pero\s+(todav[ií]a|a[uú]n)\s+quiero|mantener\s+la\s+solicitud|no\s+la\s+solicitud|pero\s+no\s+la\s+solicitud)\b/i;

const ORDINAL_WORD: Record<string, number> = {
  primera: 1,
  primer: 1,
  primero: 1,
  segunda: 2,
  segundo: 2,
  tercera: 3,
  tercer: 3,
  ultima: -1,
  ultimo: -1,
};

export type ExistingRequestPrimaryAction =
  | "CANCEL_REQUEST"
  | "CANCEL_APPOINTMENT_ONLY"
  | "RESCHEDULE_APPOINTMENT"
  | "CHECK_STATUS"
  | "RESET_CONTEXT"
  | "NONE";

export type ExistingRequestOperation = {
  primaryAction: ExistingRequestPrimaryAction;
  isExistingRequestOperation: boolean;
  blocksRequestCreation: boolean;
  blocksServiceSwitch: boolean;
  explicitRequestIds: string[];
  preserveConstraint: boolean;
  hasExplicitNewRequestOperator: boolean;
  appointmentOnly: boolean;
};

export type AuthorizedRequestRef = {
  publicId: string;
  service: string;
  createdAt?: string;
};

export function extractExplicitRequestIds(text: string): string[] {
  const found: string[] = [];
  const re = new RegExp(HS_ID_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const id = match[0].toUpperCase();
    if (PUBLIC_ID_PATTERN.test(id) && !found.includes(id)) found.push(id);
  }
  return found;
}

export function hasCancelVerb(text: string) {
  const blob = foldLex(text);
  return CANCEL_VERB_RE.test(blob) || /\bya\s+no\s+(lo\s+|la\s+)?(quiero|kiero|necesito)\b/.test(blob);
}

export function hasExplicitNewRequestOperator(text: string) {
  return NEW_REQUEST_OPERATOR_RE.test(foldLex(text));
}

/** Clause before an explicit new-job operator — existing-request work, not CREATE. */
export function operationClauseText(text: string) {
  const blob = foldLex(text);
  const match = blob.match(NEW_REQUEST_OPERATOR_RE);
  if (!match || match.index == null) return blob;
  return blob.slice(0, match.index).trim();
}

/** Remainder after an explicit new-job operator — the only text that may CREATE. */
export function newRequestClauseText(text: string) {
  const blob = foldLex(text);
  const match = blob.match(NEW_REQUEST_OPERATOR_RE);
  if (!match || match.index == null) return "";
  return blob.slice(match.index + match[0].length).trim();
}

/** Service tokens for a NEW request. Cancel-clause trades are not new intent. */
export function speechTextForNewWork(text: string) {
  if (!hasExplicitNewRequestOperator(text)) return text;
  return newRequestClauseText(text);
}

export function serviceAfterNewRequestOperator(text: string): PlaybookServiceId | "" {
  return resolvePrimaryFromMessage(newRequestClauseText(text)) || "";
}

export function hasSpecificRequestReferent(text: string) {
  const clause = operationClauseText(text);
  if (extractExplicitRequestIds(text).length || extractExplicitRequestIds(clause).length) return true;
  if (/\b(?:la|el)\s+\d{2,6}\b/.test(clause)) return true;
  if (/\bla otra\b/.test(clause)) return true;
  if (/\b(esa|ese|eso)\b/.test(clause) && CANCEL_VERB_RE.test(clause)) return true;
  if (Object.keys(ORDINAL_WORD).some((word) => new RegExp(`\\b${word}\\b`).test(clause))) return true;
  if (resolvePrimaryFromMessage(clause) && (hasCancelVerb(text) || /\b(cita|visita|hora|solicitud)\b/.test(clause))) {
    return true;
  }
  return false;
}

export function classifyExistingRequestOperation(text: string): ExistingRequestOperation {
  const trimmed = speechAfterSelfCorrection((text || "").trim());
  if (isHypotheticalSpeech(text) || isQuotedThirdPartyCommand(text)) {
    return {
      primaryAction: "NONE",
      isExistingRequestOperation: false,
      blocksRequestCreation: false,
      blocksServiceSwitch: false,
      explicitRequestIds: extractExplicitRequestIds(trimmed),
      preserveConstraint: false,
      hasExplicitNewRequestOperator: false,
      appointmentOnly: false,
    };
  }
  const blob = foldLex(trimmed);
  const explicitRequestIds = extractExplicitRequestIds(trimmed);
  const preserveConstraint = PRESERVE_RE.test(blob);
  const newOp = hasExplicitNewRequestOperator(trimmed);
  const appointmentOnly =
    (APPOINTMENT_OBJECT_RE.test(blob) && hasCancelVerb(trimmed) && !REQUEST_OBJECT_RE.test(blob)) ||
    (APPOINTMENT_OBJECT_RE.test(blob) && KEEP_REQUEST_RE.test(blob));
  const doNotCreate = /\bno\s+me\s+crees?\s+otra\b/.test(blob) && !newOp;
  const statusOnly = STATUS_RE.test(blob) && !hasCancelVerb(trimmed);
  const contextReset = CONTEXT_RESET_RE.test(blob) && !REQUEST_OBJECT_RE.test(blob);
  const reschedule = RESCHEDULE_RE.test(blob) && !hasCancelVerb(trimmed);

  let primaryAction: ExistingRequestPrimaryAction = "NONE";
  if (contextReset) primaryAction = "RESET_CONTEXT";
  else if (statusOnly) primaryAction = "CHECK_STATUS";
  else if (reschedule) primaryAction = "RESCHEDULE_APPOINTMENT";
  else if (appointmentOnly) primaryAction = "CANCEL_APPOINTMENT_ONLY";
  else if (
    hasCancelVerb(trimmed) &&
    (REQUEST_OBJECT_RE.test(blob) ||
      explicitRequestIds.length > 0 ||
      hasSpecificRequestReferent(trimmed) ||
      /\b(solicitud|pedido|trabajo|folio|servicio)\b/.test(blob))
  ) {
    primaryAction = "CANCEL_REQUEST";
  }

  const isExistingRequestOperation =
    primaryAction !== "NONE" || explicitRequestIds.length > 0 || preserveConstraint;

  const blocksRequestCreation =
    (primaryAction === "CANCEL_REQUEST" ||
      primaryAction === "CANCEL_APPOINTMENT_ONLY" ||
      primaryAction === "RESCHEDULE_APPOINTMENT" ||
      primaryAction === "CHECK_STATUS" ||
      primaryAction === "RESET_CONTEXT" ||
      doNotCreate ||
      preserveConstraint ||
      (explicitRequestIds.length > 0 && !newOp)) &&
    !newOp;

  const blocksServiceSwitch =
    blocksRequestCreation || (primaryAction === "CANCEL_REQUEST" && !newOp);

  return {
    primaryAction,
    isExistingRequestOperation,
    blocksRequestCreation,
    blocksServiceSwitch,
    explicitRequestIds,
    preserveConstraint,
    hasExplicitNewRequestOperator: newOp,
    appointmentOnly,
  };
}

function listedOrder(authorized: AuthorizedRequestRef[], listedIds: string[]) {
  if (listedIds.length) {
    const byId = new Map(authorized.map((row) => [row.publicId, row]));
    const ordered = listedIds.map((id) => byId.get(id)).filter(Boolean) as AuthorizedRequestRef[];
    const rest = authorized.filter((row) => !listedIds.includes(row.publicId));
    return [...ordered, ...rest];
  }
  return [...authorized].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

function serviceSelector(text: string): string {
  const fromMessage = resolvePrimaryFromMessage(text);
  return fromMessage || "";
}

function shortFolioMatch(text: string, authorized: AuthorizedRequestRef[]): string {
  if (extractExplicitRequestIds(text).length) return "";
  if (looksLikeMalformedHsId(text)) return "";
  const blob = foldLex(text);
  const digit = blob.match(/\b(?:la|el)\s+(\d{2,6})\b/) || blob.match(/\bhs-?\s*(\d{3,6})\b/);
  if (!digit) return "";
  const n = Number(digit[1]);
  if (!Number.isFinite(n) || n < 1) return "";
  const hits = authorized.filter((row) => Number(row.publicId.slice(-6)) === n);
  return hits.length === 1 ? hits[0].publicId : "";
}

export type RequestReferenceResolution =
  | { ok: true; requestId: string }
  | { ok: false; errorCode: "NEEDS_CLARIFICATION" | "NOT_FOUND" | "NOT_AUTHORIZED" };

/**
 * Resolve which authorized request a cancel/preserve/reschedule clause refers to.
 * Uses folio, short number, service selector, ordinal, chronology, or "la otra".
 */
export function resolveReferencedRequest(input: {
  text: string;
  authorized: AuthorizedRequestRef[];
  listedIds?: string[];
  activeRequestId?: string;
  excludeId?: string;
}): RequestReferenceResolution {
  const { authorized, listedIds = [], activeRequestId = "", excludeId = "" } = input;
  const text = hasExplicitNewRequestOperator(input.text)
    ? operationClauseText(input.text) || input.text
    : input.text;
  const pool = excludeId ? authorized.filter((row) => row.publicId !== excludeId) : authorized;
  const ids = extractExplicitRequestIds(input.text).length
    ? extractExplicitRequestIds(input.text)
    : extractExplicitRequestIds(text);
  if (ids.length) {
    const hit = pool.find((row) => row.publicId === ids[0]) || authorized.find((row) => row.publicId === ids[0]);
    if (!hit) return { ok: false, errorCode: "NOT_AUTHORIZED" };
    return { ok: true, requestId: hit.publicId };
  }

  const short = shortFolioMatch(text, pool.length ? pool : authorized);
  if (short) return { ok: true, requestId: short };

  const blob = foldLex(text);
  const ordered = listedOrder(pool.length ? pool : authorized, listedIds);

  if (/\bla otra\b/.test(blob) && ordered.length === 1) {
    return { ok: true, requestId: ordered[0].publicId };
  }
  if (/\bla otra\b/.test(blob) && ordered.length > 1) {
    if (excludeId) {
      const other = ordered.filter((row) => row.publicId !== excludeId);
      if (other.length === 1) return { ok: true, requestId: other[0].publicId };
    }
    if (activeRequestId) {
      const other = ordered.filter((row) => row.publicId !== activeRequestId);
      if (other.length === 1) return { ok: true, requestId: other[0].publicId };
    }
    return { ok: false, errorCode: "NEEDS_CLARIFICATION" };
  }

  if (/\b(esa|ese|eso)\b/.test(blob) && !ids.length) {
    if (ordered.length === 1) return { ok: true, requestId: ordered[0].publicId };
    if (ordered.length > 1) return { ok: false, errorCode: "NEEDS_CLARIFICATION" };
  }

  for (const [word, idx] of Object.entries(ORDINAL_WORD)) {
    if (new RegExp(`\\b${word}\\b`).test(blob)) {
      if (!ordered.length) return { ok: false, errorCode: "NOT_FOUND" };
      if (idx === -1) return { ok: true, requestId: ordered[ordered.length - 1].publicId };
      if (idx >= 1 && idx <= ordered.length) return { ok: true, requestId: ordered[idx - 1].publicId };
      return { ok: false, errorCode: "NEEDS_CLARIFICATION" };
    }
  }

  const service = serviceSelector(text);
  if (service) {
    const matches = (pool.length ? pool : authorized).filter((row) => row.service === service);
    if (matches.length === 1) return { ok: true, requestId: matches[0].publicId };
    if (matches.length > 1) return { ok: false, errorCode: "NEEDS_CLARIFICATION" };
  }

  return { ok: false, errorCode: "NOT_FOUND" };
}
