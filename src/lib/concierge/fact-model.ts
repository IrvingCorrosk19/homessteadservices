/**
 * Cognitive fact model — confidence, status, provenance, supersession.
 * Backend-owned; LLM may infer but cannot auto-promote to CONFIRMED without rules.
 */
import type { ConversationState } from "@/lib/concierge-store";
import type { FactConfidence } from "@/lib/concierge/packed-extraction";
import { isPresent } from "@/lib/concierge/canonical-state";

export type FactStatus =
  | "UNKNOWN"
  | "INFERRED"
  | "KNOWN"
  | "CONFIRMED"
  | "DECLINED"
  | "NOT_REQUIRED"
  | "INVALID"
  | "SUPERSEDED";

export type FactSource = "USER_EXPLICIT" | "USER_INFERRED" | "TOOL" | "SYSTEM" | "LLM";

export type CognitiveFact = {
  field: string;
  value: string | null;
  status: FactStatus;
  confidence: FactConfidence;
  source: FactSource;
  messageId?: string;
  timestamp?: string;
  serviceContextId?: string;
};

const TOP_LEVEL_FIELDS = [
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
] as const;

function statusFromConfidence(conf: FactConfidence, explicit: boolean): FactStatus {
  if (explicit) return "CONFIRMED";
  if (conf === "EXPLICIT") return "CONFIRMED";
  if (conf === "HIGH_CONFIDENCE") return "KNOWN";
  return "INFERRED";
}

export function readTopLevelFact(state: ConversationState, field: string): string | null {
  const v = (state as Record<string, unknown>)[field];
  return typeof v === "string" && isPresent(v) ? v.trim() : null;
}

/** Build a fact graph from authoritative conversation state. */
export function buildFactGraph(state: ConversationState, now = new Date().toISOString()): Record<string, CognitiveFact> {
  const ctx = state.facts?.serviceContextId || "";
  const graph: Record<string, CognitiveFact> = {};

  for (const field of TOP_LEVEL_FIELDS) {
    const value = readTopLevelFact(state, field);
    if (!value) continue;
    const conf = state.factConfidence?.[field] || "HIGH_CONFIDENCE";
    graph[field] = {
      field,
      value,
      status: statusFromConfidence(conf, conf === "EXPLICIT"),
      confidence: conf,
      source: conf === "EXPLICIT" ? "USER_EXPLICIT" : "USER_INFERRED",
      timestamp: now,
      serviceContextId: ctx,
    };
  }

  const factKeys = ["building", "ph", "unit", "apartment", "tower", "reference", "units", "symptom", "quantity", "goal"];
  for (const key of factKeys) {
    const value = state.facts?.[key];
    if (!isPresent(value)) continue;
    if (value === "DECLINED" || value === "SUPERSEDED") {
      graph[key] = {
        field: key,
        value,
        status: value === "DECLINED" ? "DECLINED" : "SUPERSEDED",
        confidence: "EXPLICIT",
        source: "USER_EXPLICIT",
        timestamp: now,
        serviceContextId: ctx,
      };
      continue;
    }
    const conf = state.factConfidence?.[key] || "HIGH_CONFIDENCE";
    graph[key] = {
      field: key,
      value,
      status: statusFromConfidence(conf, false),
      confidence: conf,
      source: "USER_INFERRED",
      timestamp: now,
      serviceContextId: ctx,
    };
  }

  if (state.facts?.diagnosisStatus === "UNKNOWN" || !state.facts?.diagnosis) {
    graph.diagnosis = {
      field: "diagnosis",
      value: null,
      status: "UNKNOWN",
      confidence: "UNCERTAIN",
      source: "SYSTEM",
      timestamp: now,
      serviceContextId: ctx,
    };
  }

  return graph;
}

export function supersedeFact(
  graph: Record<string, CognitiveFact>,
  field: string,
  newValue: string,
  opts: { source?: FactSource; serviceContextId?: string; timestamp?: string } = {},
): Record<string, CognitiveFact> {
  const next = { ...graph };
  const prev = next[field];
  if (prev && prev.value && prev.value !== newValue) {
    next[`${field}__prev`] = { ...prev, status: "SUPERSEDED" };
  }
  next[field] = {
    field,
    value: newValue,
    status: "CONFIRMED",
    confidence: "EXPLICIT",
    source: opts.source || "USER_EXPLICIT",
    timestamp: opts.timestamp || new Date().toISOString(),
    serviceContextId: opts.serviceContextId || prev?.serviceContextId,
  };
  return next;
}

export function factGraphToStatePatch(graph: Record<string, CognitiveFact>): {
  facts: Record<string, string>;
  factConfidence: Record<string, FactConfidence>;
} {
  const facts: Record<string, string> = {};
  const factConfidence: Record<string, FactConfidence> = {};
  for (const fact of Object.values(graph)) {
    if (fact.status === "SUPERSEDED" || fact.status === "INVALID") continue;
    if (!fact.value || fact.status === "UNKNOWN") continue;
    facts[fact.field] = fact.value;
    factConfidence[fact.field] = fact.confidence;
  }
  return { facts, factConfidence };
}

export function serializeFactGraph(graph: Record<string, CognitiveFact>): string {
  const slim: Record<string, { v: string | null; s: FactStatus }> = {};
  for (const [k, f] of Object.entries(graph)) {
    if (f.status === "SUPERSEDED") continue;
    slim[k] = { v: f.value, s: f.status };
  }
  return JSON.stringify(slim);
}
