import type { ConversationState } from "@/lib/concierge-store";
import { getPlaybook, type ServicePlaybook } from "@/lib/concierge/service-playbooks";
import { missingUsefulFacts } from "@/lib/concierge/playbook-engine";
import type { FactConfidence } from "@/lib/concierge/packed-extraction";

export type TurnUnderstanding = {
  intent: string;
  detectedServices: string[];
  primaryService: string;
  extractedFacts: Record<string, string>;
  corrections: string[];
  urgency: "normal" | "elevated" | "safety";
  safetySignals: boolean;
  bookingIntent: boolean;
  humanHandoffIntent: boolean;
  priceIntent: boolean;
  needsReview: boolean;
  nextRecommendedAction: string;
  factConfidence: Record<string, FactConfidence>;
};

const URGENCY = ["normal", "elevated", "safety"] as const;

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function sanitizeFacts(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim().slice(0, 240);
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

function sanitizeConfidence(raw: unknown): Record<string, FactConfidence> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, FactConfidence> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === "EXPLICIT" || value === "HIGH_CONFIDENCE" || value === "UNCERTAIN") {
      out[key] = value;
    }
  }
  return out;
}

export function parseTurnIntelligence(raw: unknown): TurnUnderstanding | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const services = Array.isArray(data.detectedServices)
    ? data.detectedServices.map((item) => String(item).trim()).filter(Boolean).slice(0, 8)
    : [];
  const facts = sanitizeFacts(data.facts ?? data.extractedFacts);
  const confidence = sanitizeConfidence(data.factConfidence);
  return {
    intent: String(data.intent || data.nextAction || "OTHER").slice(0, 40),
    detectedServices: services,
    primaryService: String(data.primaryService || "").slice(0, 40),
    extractedFacts: facts,
    corrections: Array.isArray(data.corrections)
      ? data.corrections.filter((item): item is string => typeof item === "string").slice(0, 8)
      : [],
    urgency: oneOf(data.urgency, URGENCY, "normal"),
    safetySignals: Boolean(data.safetySignals ?? data.safetyFlag),
    bookingIntent: Boolean(data.bookingIntent),
    humanHandoffIntent: Boolean(data.humanHandoffIntent ?? data.requiresHuman),
    priceIntent: Boolean(data.priceIntent),
    needsReview: Boolean(data.needsReview),
    nextRecommendedAction: String(data.nextRecommendedAction || data.nextAction || "").slice(0, 60),
    factConfidence: confidence,
  };
}

export function applyTurnIntelligence(state: ConversationState, intel: TurnUnderstanding): ConversationState {
  const next: ConversationState = {
    ...state,
    facts: { ...(state.facts || {}) },
    factConfidence: { ...(state.factConfidence || {}) },
    corrections: [...(state.corrections || [])],
    detectedServices: [...(state.detectedServices || [])],
  };
  if (intel.detectedServices.length) {
    next.detectedServices = [...new Set([...next.detectedServices, ...intel.detectedServices])];
  }
  if (intel.primaryService) {
    next.primaryService = intel.primaryService;
    next.service = intel.primaryService;
  }
  next.secondaryServices = next.detectedServices.filter((id) => id !== next.primaryService);
  for (const [key, value] of Object.entries(intel.extractedFacts)) {
    next.facts[key] = value;
    if (intel.factConfidence[key]) {
      next.factConfidence = { ...(next.factConfidence || {}), [key]: intel.factConfidence[key] };
    } else if (!next.factConfidence?.[key]) {
      next.factConfidence = { ...(next.factConfidence || {}), [key]: "HIGH_CONFIDENCE" };
    }
  }
  if (intel.extractedFacts.location && !next.location) next.location = intel.extractedFacts.location;
  if (intel.corrections.length) {
    next.corrections = [...new Set([...(next.corrections || []), ...intel.corrections])];
    const last = intel.corrections[intel.corrections.length - 1];
    if (last) {
      next.location = last;
      next.facts.location = last;
    }
  }
  if (intel.urgency !== "normal" || !next.urgency) next.urgency = intel.urgency;
  next.bookingIntent = next.bookingIntent || intel.bookingIntent;
  next.needsReview = next.needsReview || intel.needsReview;
  if (intel.humanHandoffIntent) {
    next.humanRequested = true;
    next.humanHandoffRequested = true;
  }
  const playbook = getPlaybook(next.primaryService || next.service);
  next.bookingStrategy = playbook.bookingStrategy;
  if ((intel.extractedFacts.symptom || intel.extractedFacts.need || intel.extractedFacts.what) && !next.problem) {
    next.problem = (intel.extractedFacts.need || intel.extractedFacts.symptom || intel.extractedFacts.what).slice(0, 500);
  }
  return next;
}

const REASK_PATTERNS: Array<{ key: string; re: RegExp }> = [
  { key: "name", re: /(?:c[oó]mo te llamas|tu nombre|me das tu nombre)/i },
  { key: "location", re: /(?:en qu[eé] zona|qu[eé] zona|d[oó]nde est[aá]s|cu[aá]l es tu zona)/i },
  { key: "phone", re: /(?:tu tel[eé]fono|n[uú]mero de contacto|me das tu n[uú]mero|a qu[eé] n[uú]mero)/i },
  { key: "symptom", re: /(?:qu[eé] problema|qu[eé] s[ií]ntoma|qu[eé] le pasa|qu[eé] pasa con)/i },
  { key: "units", re: /(?:cu[aá]ntos equipos|cu[aá]ntas unidades|cu[aá]ntos aires)/i },
  { key: "photos", re: /(?:env[ií]a(?:me)? una foto|mand[aá] una foto|tienes foto)/i },
];

export function detectRepeatedQuestion(reply: string, state: ConversationState): string[] {
  const repeated: string[] = [];
  for (const pattern of REASK_PATTERNS) {
    if (!pattern.re.test(reply)) continue;
    if (pattern.key === "name" && state.name) repeated.push("name");
    if (pattern.key === "location" && (state.location || state.facts?.location)) repeated.push("location");
    if (pattern.key === "phone" && state.contactStatus === "VALID") repeated.push("phone");
    if (pattern.key === "symptom" && (state.facts?.symptom || state.facts?.need || state.problem)) repeated.push("symptom");
    if (pattern.key === "units" && state.facts?.units) repeated.push("units");
    if (pattern.key === "photos" && (state.photoCount || 0) > 0) repeated.push("photos");
  }
  return repeated;
}

export function hasSufficientContext(state: ConversationState, playbook: ServicePlaybook) {
  const missing = missingUsefulFacts(state, playbook);
  const critical = missing.filter((key) => {
    const meta = playbook.facts[key];
    return meta?.need === "REQUIRED";
  });
  if (critical.length) return false;
  if (playbook.bookingStrategy === "PHOTO_REVIEW_FIRST" && (state.photoCount || 0) < 1) return false;
  if (state.contactStatus !== "VALID") return false;
  return Boolean(state.problem || state.service || state.facts?.symptom || state.facts?.need);
}

export function shouldFlagOverquestioning(
  state: ConversationState,
  questionsAsked: number,
  leadId: string,
  appointmentId: string,
) {
  if (leadId || appointmentId) return false;
  const playbook = getPlaybook(state.primaryService || state.service);
  if (hasSufficientContext(state, playbook) && questionsAsked >= 3) return true;
  return questionsAsked > 5;
}

export function questionEconomyBlock(state: ConversationState, playbook: ServicePlaybook) {
  const known = {
    name: state.name || null,
    location: state.location || state.facts?.location || null,
    phone: state.contactStatus === "VALID" ? "valid" : state.contactStatus,
    service: state.primaryService || state.service || null,
    symptom: state.facts?.symptom || state.facts?.need || null,
    units: state.facts?.units || null,
    duration: state.facts?.duration || null,
    photos: state.photoCount || 0,
    contactPreference: state.facts?.contactPreference || state.preferredTime || null,
  };
  const missing = missingUsefulFacts(state, playbook);
  const combined =
    playbook.serviceId === "locksmith" &&
    (state.photoCount || 0) > 0 &&
    missing.includes("location") &&
    missing.includes("contact");
  return `ECONOMÍA DE PREGUNTAS
Ya sabemos (NO volver a preguntar ni confirmar uno por uno): ${JSON.stringify(known)}
Falta de verdad: ${missing.join(", ") || "nada crítico"}
${combined ? "Cerrajería con foto: puedes pedir zona y teléfono en UNA sola pregunta natural." : "Una pregunta útil por turno; combina solo si encaja naturalmente."}
Si ya hay suficiente contexto: micro-cierre (solicitud, fotos faltantes, o agenda real) — no más interrogatorio.`;
}
