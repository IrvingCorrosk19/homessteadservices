/**
 * Conversational context identity + compatibility guards.
 * Current user message and current service context outrank stale pending actions.
 */
import { parseConciergePhotoMessage } from "@/lib/concierge-photo-message";
import type { ConversationState } from "@/lib/concierge-store";
import { getDigitalLockChecklist } from "@/lib/concierge/digital-lock-vision";
import { resolvePrimaryFromMessage } from "@/lib/concierge/service-intent";

export type VisionJobIdentity = {
  conversationId: string;
  photoId: string;
  serviceContextId: string;
  stateVersion: string;
  requestId?: string;
};

export type DigitalLockTurnPolicy = {
  attachmentCount: number;
  photoIds: string[];
  currentTurnHasImage: boolean;
  runVision: boolean;
  emitPhotoReply: boolean;
  reason: string;
};

type HistoryItem = { role: string; body: string };

export function bumpStateVersion(state: ConversationState): ConversationState {
  const current = Number(state.facts?.stateVersion || "0") || 0;
  return {
    ...state,
    facts: {
      ...(state.facts || {}),
      stateVersion: String(current + 1),
    },
  };
}

export function currentTurnPhotoIds(input: {
  text: string;
  history: HistoryItem[];
  skipUserMessage?: boolean;
}): string[] {
  const fromText = parseConciergePhotoMessage(input.text);
  if (fromText) return [fromText.photoId];
  if (!input.skipUserMessage) return [];
  const ids: string[] = [];
  for (let i = input.history.length - 1; i >= 0; i -= 1) {
    const item = input.history[i];
    if (item.role === "assistant") break;
    const parsed = parseConciergePhotoMessage(item.body);
    if (parsed) ids.unshift(parsed.photoId);
  }
  return [...new Set(ids)];
}

export function currentTurnHasImage(input: {
  text: string;
  history: HistoryItem[];
  skipUserMessage?: boolean;
}): boolean {
  return currentTurnPhotoIds(input).length > 0;
}

export function canEmitPhotoValidationReply(input: {
  currentTurnHasImage: boolean;
  activeService: string;
  lockActive: boolean;
  abandoned: boolean;
}): boolean {
  if (!input.currentTurnHasImage) return false;
  if (input.abandoned) return false;
  if (!input.lockActive) return false;
  if (input.activeService && input.activeService !== "locksmith") return false;
  return true;
}

export function isStaleVisionResult(
  job: VisionJobIdentity,
  current: {
    conversationId: string;
    serviceContextId: string;
    stateVersion?: string;
    digitalLockAbandoned?: boolean;
    primaryService?: string;
    lockActive?: boolean;
  },
): boolean {
  if (job.conversationId !== current.conversationId) return true;
  if (current.digitalLockAbandoned) return true;
  if (current.lockActive === false) return true;
  if (job.serviceContextId && current.serviceContextId && job.serviceContextId !== current.serviceContextId) {
    return true;
  }
  if (current.primaryService && current.primaryService !== "locksmith") return true;
  return false;
}

export function resolveDigitalLockTurnPolicy(input: {
  text: string;
  history: HistoryItem[];
  skipUserMessage?: boolean;
  state: ConversationState;
  transitionKind: string;
}): DigitalLockTurnPolicy {
  const photoIds = currentTurnPhotoIds({
    text: input.text,
    history: input.history,
    skipUserMessage: input.skipUserMessage,
  });
  const lock = getDigitalLockChecklist(input.state);
  const abandoned = input.state.facts?.digitalLockAbandoned === "1";
  const activeService = input.state.primaryService || input.state.service || "";
  const switched = input.transitionKind === "SWITCH_SERVICE" || input.transitionKind === "CANCEL_CURRENT_SERVICE";
  const messageService = resolvePrimaryFromMessage(input.text);
  const incompatibleMessage =
    Boolean(messageService && messageService !== "locksmith") ||
    Boolean(activeService && activeService !== "locksmith");
  const emit = canEmitPhotoValidationReply({
    currentTurnHasImage: photoIds.length > 0,
    activeService,
    lockActive: lock.active,
    abandoned,
  });
  const runVision =
    emit &&
    !switched &&
    !incompatibleMessage &&
    photoIds.length > 0;

  let reason = "ok";
  if (!photoIds.length) reason = "NO_CURRENT_IMAGE";
  else if (abandoned || switched) reason = "LOCK_CONTEXT_INVALIDATED";
  else if (incompatibleMessage) reason = "INCOMPATIBLE_SERVICE";
  else if (!lock.active) reason = "LOCK_INACTIVE";
  else if (!runVision) reason = "VISION_BLOCKED";

  return {
    attachmentCount: photoIds.length,
    photoIds,
    currentTurnHasImage: photoIds.length > 0,
    runVision,
    emitPhotoReply: runVision,
    reason,
  };
}

export function pendingActionMatchesCurrentContext(state: ConversationState): boolean {
  const pendingService = state.facts?.pendingActionService || "";
  const pendingCtx = state.facts?.pendingActionServiceContextId || "";
  const currentService = state.primaryService || state.service || "";
  const currentCtx = state.facts?.serviceContextId || "";
  if (pendingService && currentService && pendingService !== currentService) return false;
  if (pendingCtx && currentCtx && pendingCtx !== currentCtx) return false;
  return true;
}

export function lockPhotoReplyIncompatibleWithState(reply: string, state: ConversationState): boolean {
  if (!reply.trim()) return false;
  const service = state.primaryService || state.service || "";
  const lock = getDigitalLockChecklist(state);
  const abandoned = state.facts?.digitalLockAbandoned === "1";
  const lockSpeech =
    /esta imagen no muestra|foto de frente de la puerta|solo me falta.*(frente|interior|canto|pestillo)|me sirve como|canto donde|cerradura digital|pestillo/i.test(
      reply,
    );
  if (!lockSpeech) return false;
  if (abandoned) return true;
  if (service && service !== "locksmith") return true;
  if (!lock.active && lockSpeech) return true;
  return false;
}
