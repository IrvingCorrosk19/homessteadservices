/**
 * Canonical conversational state — safe merge, slot lifecycle, field confirmation.
 * LLM extracts language; this module owns fact persistence rules.
 */
import type { ConversationState, OfferedSlot } from "@/lib/concierge-store";
import type { FactConfidence } from "@/lib/concierge/packed-extraction";
import { logInfo } from "@/lib/log";

export type FieldStatus = "UNKNOWN" | "INFERRED" | "CONFIRMED";

const EMPTY = new Set(["", "null", "undefined", "unknown", "none", "n/a"]);

export function isPresent(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !EMPTY.has(trimmed.toLowerCase());
}

export function isValidPersonName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 3 || trimmed.length > 80) return false;
  if (!/^[A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]*(?:\s+[A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]*){0,3}$/.test(trimmed)) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  const bad =
    /\b(esquina|ll[aá]mame|llamame|apartamento|apto|edison|panam[aá]|ma[nñ]ana|hoy|viernes|tarde|manana|casa\s+\d|al\s+\d)\b/i.test(
      lower,
    ) || /^(pm|am|si|sí|no|ok|hola)$/i.test(lower);
  return !bad;
}

/** Merge patch into state without null/empty erasing confirmed values. */
export function mergeConfirmedFacts(
  previous: ConversationState,
  patch: Partial<ConversationState> & { facts?: Record<string, string> },
  opts: { explicitCorrection?: boolean } = {},
): ConversationState {
  const next: ConversationState = {
    ...previous,
    facts: { ...(previous.facts || {}) },
    factConfidence: { ...(previous.factConfidence || {}) },
  };

  const topLevelKeys: Array<keyof ConversationState> = [
    "name",
    "phone",
    "email",
    "location",
    "propertyType",
    "preferredDate",
    "preferredTime",
    "problem",
    "primaryService",
    "service",
  ];

  for (const key of topLevelKeys) {
    const value = patch[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && !isPresent(value) && !opts.explicitCorrection) continue;
    if (key === "name" && typeof value === "string" && isPresent(value) && !isValidPersonName(value)) {
      if (!opts.explicitCorrection && isPresent(previous.name)) continue;
      if (!opts.explicitCorrection) continue;
    }
    const prev = previous[key];
    if (typeof prev === "string" && isPresent(prev) && typeof value === "string" && !isPresent(value)) continue;
    if (
      key === "name" &&
      typeof prev === "string" &&
      isPresent(prev) &&
      typeof value === "string" &&
      isPresent(value) &&
      !opts.explicitCorrection &&
      !isValidPersonName(value)
    ) {
      continue;
    }
    // @ts-expect-error indexed assign
    next[key] = value;
  }

  if (patch.facts) {
    for (const [key, value] of Object.entries(patch.facts)) {
      if (!isPresent(value) && !opts.explicitCorrection) continue;
      const prev = previous.facts?.[key];
      if (isPresent(prev) && !isPresent(value) && !opts.explicitCorrection) continue;
      if (isPresent(value)) next.facts[key] = value.trim();
    }
  }

  if (patch.pendingSlot !== undefined) next.pendingSlot = patch.pendingSlot;
  if (patch.offeredSlots !== undefined) next.offeredSlots = patch.offeredSlots;
  if (patch.awaitingSlotSelection !== undefined) next.awaitingSlotSelection = patch.awaitingSlotSelection;
  if (patch.contactStatus !== undefined) next.contactStatus = patch.contactStatus;

  return next;
}

export function mergeFactPatchSafe(
  facts: Record<string, string>,
  patch: Record<string, string>,
  confidence: Record<string, FactConfidence> = {},
  opts: { explicitCorrection?: boolean } = {},
): { facts: Record<string, string>; factConfidence: Record<string, FactConfidence> } {
  const next = { ...facts };
  const nextConf = { ...confidence };
  for (const [key, value] of Object.entries(patch)) {
    if (!isPresent(value) && !opts.explicitCorrection) continue;
    if (isPresent(facts[key]) && !isPresent(value) && !opts.explicitCorrection) continue;
    if (isPresent(value)) {
      next[key] = value.trim();
      if (!nextConf[key] || nextConf[key] === "UNCERTAIN") {
        nextConf[key] = opts.explicitCorrection ? "EXPLICIT" : "HIGH_CONFIDENCE";
      }
    }
  }
  return { facts: next, factConfidence: nextConf };
}

const CORRECTION_RE =
  /\b(no es|no estoy en|me equivoqu[eé]|mejor dicho|perd[oó]n|c[aá]mbialo a|c[aá]mbia a|realmente es|en realidad es|disculpa,?\s*es)\b/i;

export function detectExplicitCorrection(text: string): boolean {
  return CORRECTION_RE.test(text);
}

export function isSlotConfirmed(state: ConversationState): boolean {
  return Boolean(
    (state.pendingSlot?.date && state.pendingSlot?.time) ||
      state.facts?.slotConfirmed === "1" ||
      state.facts?.slotStatus === "SELECTED",
  );
}

export function lockSelectedSlot(state: ConversationState, slot: OfferedSlot): ConversationState {
  return mergeConfirmedFacts(state, {
    preferredDate: slot.date,
    preferredTime: slot.time,
    pendingSlot: slot,
    awaitingSlotSelection: false,
    facts: {
      ...(state.facts || {}),
      slotConfirmed: "1",
      slotStatus: "SELECTED",
      selectedDate: slot.date,
      selectedTime: slot.time,
      selectedSlotLabel: slot.label,
    },
  });
}

export function clearSlotSelection(state: ConversationState): ConversationState {
  return mergeConfirmedFacts(state, {
    pendingSlot: null,
    awaitingSlotSelection: false,
    facts: {
      ...(state.facts || {}),
      slotConfirmed: "",
      slotStatus: "",
      selectedDate: "",
      selectedTime: "",
      selectedSlotLabel: "",
    },
  });
}

export function hasRescheduleSignal(text: string): boolean {
  return /\b(reprogram|cambiar (la )?cita|mover (la )?cita|otro horario|otra hora|mejor el|mejor a las|prefiero otro)\b/i.test(
    text,
  );
}

export function shouldBlockDuplicateAsk(
  field: string,
  state: ConversationState,
): boolean {
  const conf = state.factConfidence || {};
  if (field === "location") {
    const ok =
      isPresent(state.location) ||
      isPresent(state.facts?.location) ||
      (isPresent(state.facts?.building) && isPresent(state.facts?.unit));
    if (ok && (conf.location === "EXPLICIT" || conf.location === "HIGH_CONFIDENCE" || conf.building === "EXPLICIT")) {
      return true;
    }
  }
  if (field === "customer_name" && isPresent(state.name) && conf.name !== "UNCERTAIN") return true;
  if (field === "contact" && state.contactStatus === "VALID") return true;
  if (field === "unit" && isPresent(state.facts?.unit)) return true;
  if (field === "building" && isPresent(state.facts?.building)) return true;
  if (field === "slot" && isSlotConfirmed(state)) return true;
  return false;
}

export function logStateTransition(
  conversationId: string,
  extra: Record<string, string | number | boolean | undefined>,
) {
  logInfo("ConciergeStateTransition", {
    contentJobId: conversationId.slice(0, 8),
    ...Object.fromEntries(
      Object.entries(extra)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, typeof v === "boolean" ? (v ? "1" : "0") : String(v)]),
    ),
  });
}

/** Reject unit inferred only from trailing digits on PH name (e.g. "PH El Mare 3000"). */
export function sanitizeInferredUnit(text: string, unit: string, building: string): string {
  if (!unit || !building) return unit;
  if (!/^\d{2,5}$/.test(unit)) return unit;
  if (/\b(?:apto|apartamento|unidad|apt\.?)\s*/i.test(text)) return unit;
  const trailing = text.match(new RegExp(`${building.replace(/\s+/g, "\\s+")}\\s+(\\d{2,5})\\b`, "i"));
  if (trailing && trailing[1] === unit) return "";
  return unit;
}
