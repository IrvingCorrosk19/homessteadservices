import {
  getPlaybook,
  playbookById,
  SERVICE_PLAYBOOKS,
  type BookingStrategy,
  type PlaybookServiceId,
  type ServicePlaybook,
} from "@/lib/concierge/service-playbooks";
import { resolvePrimaryFromMessage, serviceNeedDetail } from "@/lib/concierge/service-intent";
import type { ConversationState } from "@/lib/concierge-store";

const PHONE_MASK = /\+?\d[\d\s\-()]{6,}\d/g;
const EMAIL_MASK = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export type ServiceIntel = {
  detectedServices: PlaybookServiceId[];
  primaryService: PlaybookServiceId | "";
  secondaryServices: PlaybookServiceId[];
  facts: Record<string, string>;
  urgency: "normal" | "elevated" | "safety";
  bookingIntent: boolean;
  needsReview: boolean;
};

export function emptyIntel(): ServiceIntel {
  return {
    detectedServices: [],
    primaryService: "",
    secondaryServices: [],
    facts: {},
    urgency: "normal",
    bookingIntent: false,
    needsReview: false,
  };
}

function fold(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function aliasHits(blob: string, alias: string) {
  const needle = fold(alias);
  if (!needle) return false;
  if (needle.length <= 4) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}`).test(blob);
  }
  return blob.includes(needle);
}

export function detectServices(text: string): PlaybookServiceId[] {
  const blob = fold(text);
  const found: PlaybookServiceId[] = [];
  for (const playbook of SERVICE_PLAYBOOKS) {
    if (playbook.serviceId === "other") continue;
    const hit = playbook.aliases.some((alias) => aliasHits(blob, alias));
    if (hit && !found.includes(playbook.serviceId)) found.push(playbook.serviceId);
  }
  return found;
}

export function detectUnknownOpportunity(text: string): boolean {
  if (detectServices(text).length) return false;
  const blob = fold(text);
  const other = playbookById("other");
  return Boolean(other?.aliases.some((alias) => aliasHits(blob, alias)));
}

export function mergeDetectedServices(current: string[], incoming: string[]): PlaybookServiceId[] {
  const ids = [...current, ...incoming].filter((id): id is PlaybookServiceId => Boolean(playbookById(id)));
  return [...new Set(ids)];
}

export function choosePrimary(detected: string[], current: string, latestText = ""): PlaybookServiceId | "" {
  const ids = detected.filter((id): id is PlaybookServiceId => Boolean(playbookById(id)));
  const latestIntent = latestText ? resolvePrimaryFromMessage(latestText) : "";

  if (latestIntent && current && latestIntent !== current) {
    return latestIntent;
  }
  if (latestIntent) return latestIntent;

  if (current && ids.includes(current as PlaybookServiceId)) return current as PlaybookServiceId;
  if (ids[0]) return ids[0];
  if (current && playbookById(current) && current !== "other") return current as PlaybookServiceId;
  return "";
}

export function applyFactPatch(facts: Record<string, string>, patch: Record<string, unknown>) {
  const next = { ...facts };
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim().slice(0, 240);
    if (!trimmed) continue;
    next[key] = trimmed;
  }
  return next;
}

export function applyLocationCorrection(text: string, current: string) {
  const match = text.match(
    /(?:perd[oó]n[,.]?|mejor dicho|no[,.]?\s*estoy en|no[,.]?\s*es)\s+(?:es\s+|estoy en\s+)?([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,3})/i,
  );
  if (match) return match[1].trim();
  return current;
}

export function detectUrgency(text: string, playbook: ServicePlaybook): ServiceIntel["urgency"] {
  const blob = text.toLowerCase();
  if (/chispa|humo|olor a quemado|electroc|incendio|gas(olina)?\s*(fug|olor)|inundaci[oó]n grave/.test(blob)) {
    return "safety";
  }
  if (playbook.urgencySignals.some((signal) => blob.includes(signal.toLowerCase()))) return "elevated";
  return "normal";
}

export function missingUsefulFacts(state: ConversationState, playbook: ServicePlaybook): string[] {
  const facts = state.facts || {};
  const missing: string[] = [];
  for (const [key, meta] of Object.entries(playbook.facts)) {
    if (meta.need !== "USEFUL" && meta.need !== "REQUIRED") continue;
    if (key === "contact") {
      if (state.contactStatus !== "VALID") missing.push(key);
      continue;
    }
    if (key === "location") {
      if (!state.location && !facts.location) missing.push(key);
      continue;
    }
    if (key === "photos") {
      if ((state.photoCount || 0) < 1) missing.push(key);
      continue;
    }
    if (!facts[key] && !(key === "need" && state.problem) && !(key === "what" && state.problem) && !(key === "symptom" && state.problem)) {
      missing.push(key);
    }
  }
  return missing;
}

export function usefulQuestionHint(playbook: ServicePlaybook, missing: string[]): string {
  if (!missing.length) return "";
  const first = missing.find((key) => key !== "contact") || missing[0];
  const meta = playbook.facts[first];
  return meta?.hint || playbook.recommendedQuestions[0] || "";
}

export function shouldOfferAvailability(playbook: ServicePlaybook, state: ConversationState) {
  if (state.facts?.digitalLockFlow === "1") {
    try {
      const checklist = JSON.parse(state.facts.digitalLockChecklist || "{}") as {
        front?: { status?: string };
        inside?: { status?: string };
        edge?: { status?: string };
        compatibility?: string;
      };
      const photosReady =
        checklist.front?.status === "PASS" &&
        checklist.inside?.status === "PASS" &&
        checklist.edge?.status === "PASS";
      if (!photosReady) return false;
      if (
        checklist.compatibility === "NEEDS_MORE_INFO" ||
        checklist.compatibility === "REQUIRES_TECHNICIAN_REVIEW" ||
        checklist.compatibility === "PHOTO_PRECHECK_INCOMPLETE"
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }
  if (playbook.bookingStrategy === "PHOTO_REVIEW_FIRST" && (state.photoCount || 0) < 1) return false;
  if (playbook.bookingStrategy === "TECH_REVIEW_FIRST" && state.urgency === "safety") return false;
  if (state.facts?.digitalLockFlow === "1") {
    // already handled above — keep incomplete from offering slots
  }
  return true;
}

export function bookingStrategyOf(state: ConversationState): BookingStrategy {
  return (state.bookingStrategy as BookingStrategy) || getPlaybook(state.primaryService || state.service).bookingStrategy;
}

export function redactForModel(text: string) {
  return text.replace(EMAIL_MASK, "[email]").replace(PHONE_MASK, "[teléfono]");
}

export function countQuestions(reply: string) {
  return (reply.match(/¿/g) || []).length || (reply.match(/\?/g) || []).length;
}

export function playbookPromptBlock(playbook: ServicePlaybook, state: ConversationState, missing: string[]) {
  return `PLAYBOOK ACTIVO: ${playbook.label} (${playbook.serviceId})
Objetivo: ${playbook.objective}
Estrategia de cierre: ${playbook.bookingStrategy}
Urgencia actual: ${state.urgency || "normal"}
Fotos recibidas: ${state.photoCount || 0}
Hechos: ${JSON.stringify(state.facts || {})}
Falta (útil, no interrogatorio): ${missing.join(", ") || "nada crítico"}
Guía de fotos: ${playbook.photoGuidance}
Por qué las fotos: ${playbook.photoWhy}
Seguridad: ${playbook.safetyRules}
${playbook.unknownCatalog ? "Servicio posiblemente fuera de catálogo: captura oportunidad, NO afirmes que sí ni que no." : ""}
NO preguntes campos NOT_NEEDED. NO bloquees por USEFUL. Contacto REQUIRED solo para crear HS o cita.
Si PHOTO_REVIEW_FIRST y aún no hay fotos, invita a enviarlas con naturalidad. No prometas cita hasta que el cliente la pida y haya disponibilidad real.
Si ya hay suficiente contexto, haz micro-cierre: propone el siguiente paso en vez de otra pregunta.`;
}

export function formatRequestBrief(state: ConversationState, playbook: ServicePlaybook) {
  const facts = state.facts || {};
  const lines = [`${playbook.label}${facts.need || facts.symptom || facts.what ? ` — ${facts.need || facts.symptom || facts.what}` : ""}`];
  if (state.location) lines.push(`Zona: ${state.location}`);
  if (state.photoCount) lines.push(`Fotos: ${state.photoCount}`);
  if (state.urgency && state.urgency !== "normal") lines.push(`Urgencia: ${state.urgency}`);
  if (state.humanHandoffRequested) lines.push("El cliente pidió continuar con una persona.");
  if (playbook.unknownCatalog) lines.push("Clasificación: NEEDS_REVIEW");
  if (state.problem) lines.push(state.problem);
  return lines.filter(Boolean).join("\n");
}

export function countPhotosJson(json: string | undefined | null) {
  try {
    const parsed = JSON.parse(json || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export function telegramServiceLines(input: {
  service: string;
  message: string;
  photoCount: number;
  urgency?: string;
  factsJson?: string;
}) {
  let digitalLockExtra: string[] = [];
  try {
    const parsed = JSON.parse(input.factsJson || "{}") as { facts?: Record<string, string> };
    const raw = parsed.facts?.digitalLockChecklist;
    if (raw) {
      const checklist = JSON.parse(raw) as {
        active?: boolean;
        front?: { status?: string };
        inside?: { status?: string };
        edge?: { status?: string };
        compatibility?: string;
        rejected?: unknown[];
        doorNotes?: string;
        lockNotes?: string;
      };
      if (checklist.active) {
        const mark = (status: string | undefined, label: string) =>
          status === "PASS" ? `✅ ${label}` : status === "RETAKE" ? `⚠ ${label} (retake)` : `❌ ${label} pendiente`;
        const valid =
          (checklist.front?.status === "PASS" ? 1 : 0) +
          (checklist.inside?.status === "PASS" ? 1 : 0) +
          (checklist.edge?.status === "PASS" ? 1 : 0);
        digitalLockExtra = [
          "🔐 CERRADURA DIGITAL",
          "Evidencia visual:",
          mark(checklist.front?.status, "Frente"),
          mark(checklist.inside?.status, "Interior"),
          mark(checklist.edge?.status, "Canto"),
          `Válidas: ${valid}/3` +
            (Array.isArray(checklist.rejected) && checklist.rejected.length
              ? ` · Rechazadas: ${checklist.rejected.length}`
              : ""),
          `Estado: ${
            valid === 3
              ? checklist.compatibility === "REQUIRES_TECHNICIAN_REVIEW"
                ? "LISTO PARA REVISIÓN TÉCNICA"
                : checklist.compatibility || "NEEDS_MORE_INFO"
              : "PHOTO_PRECHECK_INCOMPLETE"
          }`,
        ].filter(Boolean);
      }
    }
  } catch {
    digitalLockExtra = [];
  }
  const playbook = getPlaybook(input.service);
  const lines = digitalLockExtra.length ? [...digitalLockExtra] : [`🛠 ${playbook.label}`];
  if (!digitalLockExtra.length) {
    const detail = serviceNeedDetail(input.message, input.service);
    if (detail && !fold(detail).includes(fold(playbook.label))) {
      lines.push(`📝 ${detail}`);
    }
  }
  if (input.photoCount > 0 && !digitalLockExtra.length) {
    lines.push(`📸 ${input.photoCount} ${input.photoCount === 1 ? "foto" : "fotos"} para revisión`);
  }
  if (input.urgency === "safety") lines.push("⚠️ Señal de riesgo — priorizar");
  else if (input.urgency === "elevated") lines.push("Urgencia elevada");
  const snippet = input.message.replace(/\s+/g, " ").trim().slice(0, 160);
  if (snippet && !digitalLockExtra.length) lines.push(snippet);
  return lines;
}

export function adminFactRows(input: {
  service: string;
  photos: number;
  factsJson?: string;
  location?: string;
}) {
  const playbook = getPlaybook(input.service);
  let parsed: {
    facts?: Record<string, string>;
    urgency?: string;
    location?: string;
    needsReview?: boolean;
    photoCount?: number;
  } = {};
  try {
    parsed = JSON.parse(input.factsJson || "{}") as typeof parsed;
  } catch {
    parsed = {};
  }
  const facts = parsed.facts || {};
  const rows: Array<{ label: string; value: string }> = [{ label: "Servicio", value: playbook.label }];
  const need = facts.need || facts.symptom || facts.what || facts.goal || "";
  if (need) rows.push({ label: "Necesidad", value: need });
  try {
    if (facts.digitalLockChecklist) {
      const checklist = JSON.parse(facts.digitalLockChecklist) as {
        active?: boolean;
        front?: { status?: string };
        inside?: { status?: string };
        edge?: { status?: string };
        compatibility?: string;
        doorNotes?: string;
        lockNotes?: string;
        measurementRequired?: boolean;
        measurementComplete?: boolean;
      };
      if (checklist.active) {
        rows.push({ label: "Flujo", value: "Cerradura digital" });
        const valid =
          (checklist.front?.status === "PASS" ? 1 : 0) +
          (checklist.inside?.status === "PASS" ? 1 : 0) +
          (checklist.edge?.status === "PASS" ? 1 : 0);
        rows.push({
          label: "Evidencia cerradura digital",
          value: `Válidas ${valid}/3 · Frente ${checklist.front?.status === "PASS" ? "✅" : "❌"} · Interior ${checklist.inside?.status === "PASS" ? "✅" : "❌"} · Canto ${checklist.edge?.status === "PASS" ? "✅" : "❌"}`,
        });
        if (checklist.compatibility) rows.push({ label: "Compatibilidad IA", value: checklist.compatibility });
        if (checklist.doorNotes) rows.push({ label: "Puerta (obs.)", value: checklist.doorNotes });
        if (checklist.lockNotes) rows.push({ label: "Cerradura (obs.)", value: checklist.lockNotes });
        if (checklist.measurementRequired) {
          rows.push({
            label: "Medida",
            value: checklist.measurementComplete ? "Completa" : "Pendiente (grosor)",
          });
        }
      }
    }
  } catch {
    // ignore malformed checklist
  }
  const photos = input.photos || Number(parsed.photoCount || 0);
  if (photos > 0) rows.push({ label: "Fotos", value: String(photos) });
  const zona = parsed.location || facts.location || input.location || "";
  if (zona) rows.push({ label: "Zona", value: zona });
  if (facts.units) rows.push({ label: "Unidades", value: facts.units });
  if (facts.interiorExterior) rows.push({ label: "Ámbito", value: facts.interiorExterior });
  if (facts.spaces) rows.push({ label: "Espacios", value: facts.spaces });
  if (facts.activeLeak) rows.push({ label: "Fuga", value: facts.activeLeak });
  if (facts.hazard) rows.push({ label: "Riesgo", value: facts.hazard });
  if (parsed.urgency && parsed.urgency !== "normal") rows.push({ label: "Urgencia", value: parsed.urgency });
  if (parsed.needsReview) rows.push({ label: "Clasificación", value: "Por revisar" });
  return rows;
}

export function intelFromState(state: ConversationState): ServiceIntel {
  const detected = (state.detectedServices || []).filter((id) => playbookById(id)) as PlaybookServiceId[];
  return {
    detectedServices: detected,
    primaryService: (state.primaryService as PlaybookServiceId) || "",
    secondaryServices: detected.filter((id) => id !== state.primaryService),
    facts: state.facts || {},
    urgency: (state.urgency as ServiceIntel["urgency"]) || "normal",
    bookingIntent: Boolean(state.bookingIntent),
    needsReview: Boolean(state.needsReview),
  };
}
