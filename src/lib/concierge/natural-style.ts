/**
 * Natural-style guard — strip robotic repetition, do not rotate canned openers.
 */
import type { ConversationState } from "@/lib/concierge-store";
import { isPresent } from "@/lib/concierge/canonical-state";

const ROBOTIC_OPENERS = [
  /^entendido[,.]?\s+/i,
  /^perfecto[,.]?\s+/i,
  /^excelente[,.]?\s+/i,
  /^gracias por (proporcionar|la informaci[oó]n|compartir)[^.]{0,40}[.!]?\s+/i,
  /^claro[,.]?\s+entendido[,.]?\s+/i,
];

export function openingPhrase(reply: string): string {
  const first = reply.trim().split(/[\n.!?]/)[0] || "";
  const word = first.trim().split(/\s+/)[0] || "";
  return word.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function recentOpeningsFromFacts(state: ConversationState): string[] {
  const raw = state.facts?._recentOpenings;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map((x) => String(x)).slice(-4) : [];
  } catch {
    return [];
  }
}

export function recordOpening(state: ConversationState, reply: string): ConversationState {
  const openings = [...recentOpeningsFromFacts(state), openingPhrase(reply)].slice(-4);
  return {
    ...state,
    facts: {
      ...(state.facts || {}),
      _recentOpenings: JSON.stringify(openings),
    },
  };
}

export function stripRepeatedRoboticOpener(reply: string, recentOpenings: string[]): {
  text: string;
  stripped: boolean;
} {
  const current = openingPhrase(reply);
  const lastTwo = recentOpenings.slice(-2);
  const repeating =
    lastTwo.length >= 2 &&
    lastTwo.every((o) => o === current) &&
    /^(perfecto|entendido|excelente|gracias)$/.test(current);
  if (!repeating && lastTwo.slice(-1)[0] === current && /^(perfecto|entendido|excelente)$/.test(current)) {
    for (const re of ROBOTIC_OPENERS) {
      if (re.test(reply.trim())) {
        return { text: reply.trim().replace(re, ""), stripped: true };
      }
    }
  }
  if (repeating) {
    for (const re of ROBOTIC_OPENERS) {
      if (re.test(reply.trim())) {
        return { text: reply.trim().replace(re, ""), stripped: true };
      }
    }
  }
  return { text: reply, stripped: false };
}

/** Customer just stated facts — echoing name+location+phone is robotic unless confirming a booking. */
export function detectKnownFactEcho(reply: string, state: ConversationState, bookedThisTurn: boolean): boolean {
  if (bookedThisTurn || state.appointmentId) return false;
  const name = (state.name || "").trim();
  const loc = (state.location || state.facts?.location || "").trim();
  const phoneDigits = (state.phone || "").replace(/\D/g, "");
  if (!name && !loc) return false;
  let hits = 0;
  if (name && name.length >= 3 && reply.toLowerCase().includes(name.toLowerCase())) hits += 1;
  if (loc && loc.length >= 4 && reply.toLowerCase().includes(loc.toLowerCase())) hits += 1;
  if (phoneDigits.length >= 7 && reply.replace(/\D/g, "").includes(phoneDigits.slice(-7))) hits += 1;
  return hits >= 2;
}

export function compressKnownFactEcho(reply: string, state: ConversationState): string {
  const name = (state.name || "").trim();
  const first = name.split(/\s+/)[0];
  if (first && isPresent(first)) {
    return `Listo, ${first}. Ya tengo tus datos.`;
  }
  return "Listo. Ya tengo tus datos.";
}

export function applyNaturalStyleGuard(
  reply: string,
  state: ConversationState,
  opts: { bookedThisTurn?: boolean } = {},
): { reply: string; styleFlags: string[] } {
  const flags: string[] = [];
  let text = reply;
  const stripped = stripRepeatedRoboticOpener(text, recentOpeningsFromFacts(state));
  if (stripped.stripped) {
    text = stripped.text;
    flags.push("repeated_opener_stripped");
  }
  if (detectKnownFactEcho(text, state, Boolean(opts.bookedThisTurn))) {
    text = compressKnownFactEcho(text, state);
    flags.push("known_fact_echo_compressed");
  }
  return { reply: text, styleFlags: flags };
}
