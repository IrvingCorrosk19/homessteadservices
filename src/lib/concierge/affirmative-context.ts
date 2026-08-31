/**
 * Resolve short affirmations/negations against pending conversational context.
 */
import type { ConversationState } from "@/lib/concierge-store";
import { isAffirmativeResponse } from "@/lib/concierge/calendar-action";
import { PENDING_QUERY_AVAILABILITY } from "@/lib/concierge/calendar-action";

export type ResolvedShortReply =
  | "QUERY_AVAILABILITY"
  | "CONFIRM_QUANTITY"
  | "CONFIRM_CANCEL"
  | "DECLINE_OPTIONAL"
  | "PRESERVE_APPOINTMENT"
  | "SELECT_SLOT"
  | "UNKNOWN";

const NEGATIVE_RE = /^(no|nop|nel|para\s+nada|negativo)[\s!.?]*$/i;

export function isNegativeResponse(text: string): boolean {
  return NEGATIVE_RE.test(text.trim());
}

export function resolveShortReplyIntent(text: string, state: ConversationState): ResolvedShortReply {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 48) return "UNKNOWN";

  if (isNegativeResponse(trimmed)) {
    const lastQ = state.facts?.lastBotQuestion || "";
    const field = state.facts?.lastAskedField || "";
    if (/cancelar|anular|cambiar\s+la\s+cita/.test(lastQ)) return "PRESERVE_APPOINTMENT";
    if (field === "reference" || /referencia|otra referencia/.test(lastQ)) return "DECLINE_OPTIONAL";
    return "UNKNOWN";
  }

  if (!isAffirmativeResponse(trimmed)) return "UNKNOWN";

  if (state.facts?.pendingAction === PENDING_QUERY_AVAILABILITY) return "QUERY_AVAILABILITY";
  if (state.awaitingSlotSelection && state.offeredSlots?.length) return "SELECT_SLOT";

  const lastQ = state.facts?.lastBotQuestion || "";
  const field = state.facts?.lastAskedField || "";
  if (field === "units" || /cu[aá]ntos (aires|equipos)/i.test(lastQ)) return "CONFIRM_QUANTITY";
  if (/cancelar|anular/.test(lastQ)) return "CONFIRM_CANCEL";
  if (/revis(ar|o)\s+(la\s+)?disponib|horarios/.test(lastQ)) return "QUERY_AVAILABILITY";

  return "UNKNOWN";
}
