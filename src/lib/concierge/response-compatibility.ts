/**
 * Last-line defense: block customer-visible replies incompatible with authoritative state.
 */
import type { ConversationState } from "@/lib/concierge-store";
import { getDigitalLockChecklist } from "@/lib/concierge/digital-lock-vision";
import { responseReferencesStaleService } from "@/lib/concierge/service-transition";
import { logInfo } from "@/lib/log";

export type ResponseCompatibility = {
  compatible: boolean;
  reason: string;
  blockedPattern?: string;
};

const LOCK_PHOTO_SPEECH =
  /esta imagen no muestra|foto de frente de la puerta|solo me falta.*(frente|interior|canto|pestillo)|me sirve como|canto donde|cerradura digital|pestillo/i;

export function validateResponseCompatibility(
  reply: string,
  state: ConversationState,
  opts: { attachmentCount?: number } = {},
): ResponseCompatibility {
  if (!reply.trim()) return { compatible: true, reason: "empty" };

  const service = state.primaryService || state.service || "";
  const lock = getDigitalLockChecklist(state);
  const abandoned = state.facts?.digitalLockAbandoned === "1";

  if ((opts.attachmentCount ?? 0) === 0 && LOCK_PHOTO_SPEECH.test(reply)) {
    if (abandoned || service !== "locksmith" || !lock.active) {
      return {
        compatible: false,
        reason: "NO_CURRENT_IMAGE_PHOTO_REPLY",
        blockedPattern: "lock_photo_without_attachment",
      };
    }
  }

  if (responseReferencesStaleService(reply, state)) {
    return {
      compatible: false,
      reason: "STALE_SERVICE_SPEECH",
      blockedPattern: "stale_service",
    };
  }

  if (service === "ac" && LOCK_PHOTO_SPEECH.test(reply)) {
    return { compatible: false, reason: "AC_CONTEXT_LOCK_SPEECH", blockedPattern: "ac_lock" };
  }

  if (service === "painting" && /canto|pestillo|cerradura digital/i.test(reply) && /falta|foto|imagen/i.test(reply)) {
    return { compatible: false, reason: "PAINT_CONTEXT_LOCK_SPEECH", blockedPattern: "paint_lock" };
  }

  return { compatible: true, reason: "ok" };
}

export function logIncompatibleResponse(
  conversationId: string,
  compatibility: ResponseCompatibility,
  responseSource: string,
) {
  if (compatibility.compatible) return;
  logInfo("INCOMPATIBLE_RESPONSE_BLOCKED", {
    contentJobId: conversationId.slice(0, 8),
    stage: `${responseSource}:${compatibility.reason}`,
  });
}
