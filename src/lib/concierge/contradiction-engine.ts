/**
 * Contradiction engine — supersede facts on explicit corrections.
 */
import type { ConversationState } from "@/lib/concierge-store";
import { mergeConfirmedFacts } from "@/lib/concierge/canonical-state";
import { applyLocationCorrection } from "@/lib/concierge/playbook-engine";
import { isLocationExplicitCorrection, isScheduleOrTimeOnlyMessage } from "@/lib/concierge/schedule-phrases";
import { buildFactGraph, supersedeFact } from "@/lib/concierge/fact-model";
import { isPresent, isValidPersonName } from "@/lib/concierge/canonical-state";

const NAME_CORRECTION_RE =
  /\b(?:perd[oó]n|disculp|mejor dicho)?,?\s*(?:me llamo|mi nombre es)\s+([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,2})/i;

const QUANTITY_CORRECTION_RE =
  /\b(me\s+equivoqu[eé]|en\s+realidad|son|tengo)\s+(\d+|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i;

const WORD_NUM: Record<string, string> = {
  un: "1",
  uno: "1",
  una: "1",
  dos: "2",
  tres: "3",
  cuatro: "4",
  cinco: "5",
};

function parseQuantityCorrection(text: string): string {
  const m = text.match(QUANTITY_CORRECTION_RE);
  if (!m) return "";
  const raw = m[2].toLowerCase();
  return WORD_NUM[raw] || (/^\d+$/.test(raw) ? raw : "");
}

export function applyContradictionResolution(state: ConversationState, text: string): ConversationState {
  let next = { ...state, facts: { ...(state.facts || {}) }, corrections: [...(state.corrections || [])] };
  const graph = buildFactGraph(next);
  let graphChanged = false;

  if (isLocationExplicitCorrection(text)) {
    const corrected = applyLocationCorrection(text, next.location);
    if (corrected && corrected !== next.location) {
      next.location = corrected;
      next.facts.location = corrected;
      supersedeFact(graph, "location", corrected, { source: "USER_EXPLICIT" });
      next.corrections.push(`location:${corrected}`);
      graphChanged = true;
    }
  } else if (!isScheduleOrTimeOnlyMessage(text)) {
    const corrected = applyLocationCorrection(text, next.location);
    if (corrected && isPresent(next.location) && corrected !== next.location && /perd[oó]n|disculp|mejor\s+en/i.test(text)) {
      next.location = corrected;
      next.facts.location = corrected;
      supersedeFact(graph, "location", corrected, { source: "USER_EXPLICIT" });
      next.corrections.push(`location:${corrected}`);
      graphChanged = true;
    }
  }

  const nameMatch = text.match(NAME_CORRECTION_RE);
  if (nameMatch?.[1]) {
    const correctedName = nameMatch[1].trim();
    if (isValidPersonName(correctedName) && correctedName !== next.name) {
      next.name = correctedName;
      next.facts.customer_name = correctedName;
      next.facts.name = correctedName;
      supersedeFact(graph, "name", correctedName, { source: "USER_EXPLICIT" });
      next.corrections.push(`name:${correctedName}`);
      graphChanged = true;
    }
  }

  const qty = parseQuantityCorrection(text);
  if (qty) {
    next.facts.units = qty;
    next.facts.quantity = qty;
    supersedeFact(graph, "units", qty, { source: "USER_EXPLICIT" });
    next.corrections.push(`units:${qty}`);
    graphChanged = true;
  }

  if (graphChanged) {
    next = mergeConfirmedFacts(next, { facts: next.facts }, { explicitCorrection: true });
    next.facts._factGraph = JSON.stringify(
      Object.fromEntries(
        Object.entries(graph)
          .filter(([, f]) => f.status !== "SUPERSEDED")
          .map(([k, f]) => [k, { v: f.value, s: f.status }]),
      ),
    );
  }

  return next;
}
