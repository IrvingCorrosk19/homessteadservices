/**
 * Customer memory — retrieve prior context without activating historical HS/HA.
 */
import type { ConversationState } from "@/lib/concierge-store";
import { classifyPhone } from "@/lib/phone";
import { getCustomerContextByPhone, type CustomerContextSnapshot } from "@/lib/concierge/customer-context-read";
import { logInfo } from "@/lib/log";

export type RetrievedCustomerMemory = {
  snapshot: CustomerContextSnapshot;
  historicalRequestIds: string[];
  relatedServices: string[];
};

export function retrieveCustomerMemory(state: ConversationState): RetrievedCustomerMemory | null {
  if (state.contactStatus !== "VALID" || !state.phone?.trim()) return null;
  const assessed = classifyPhone(state.phone);
  if (assessed.status !== "VALID") return null;
  const snapshot = getCustomerContextByPhone(state.phone);
  if (!snapshot) return null;
  if (snapshot.phone && assessed.e164 && snapshot.phone.replace(/\D/g, "") !== assessed.digits) {
    logInfo("CUSTOMER_CONTEXT_REJECTED_PHONE_MISMATCH", {
      contentJobId: (state.facts?.serviceContextId || "").slice(0, 8),
      stage: "isolation",
    });
    return null;
  }
  return {
    snapshot,
    historicalRequestIds: snapshot.priorRequests.map((r) => r.publicId),
    relatedServices: [...new Set(snapshot.priorRequests.map((r) => r.service).filter(Boolean))],
  };
}

export function applyRetrievedMemory(state: ConversationState, memory: RetrievedCustomerMemory): ConversationState {
  const activeId = state.activeLeadId || "";
  const historicalOnly = memory.historicalRequestIds.filter((id) => id !== activeId);
  return {
    ...state,
    facts: {
      ...(state.facts || {}),
      retrievedCustomerContext: JSON.stringify({
        customerId: memory.snapshot.customerId,
        priorRequests: memory.snapshot.priorRequests,
        generalLocation: memory.snapshot.generalLocation,
      }),
      historicalRequestIds: historicalOnly.join("|"),
      // Never promote historical request to active
      activeRequestCleared: activeId ? "" : state.facts?.activeRequestCleared || "",
    },
  };
}

export function formatPriorServiceAcknowledgment(
  text: string,
  state: ConversationState,
  memory: RetrievedCustomerMemory,
): string {
  const blob = text.toLowerCase();
  const acAgain = /\b(otra vez|de nuevo|otra\s+vez)\b/.test(blob) && /\b(aire|ac|equipo)\b/i.test(blob);
  const priorAc = memory.snapshot.priorRequests.some((r) => r.service === "ac");
  if (!acAgain || !priorAc) return "";
  const prior = memory.snapshot.priorRequests.find((r) => r.service === "ac");
  if (!prior) return "";
  return `Veo que anteriormente tuvimos una solicitud relacionada con aire acondicionado (${prior.publicId}). Cuéntame qué está pasando ahora y lo revisamos sin asumir que es exactamente la misma falla.`;
}

export function customerMemoryBlocksCrossLeak(
  memoryA: RetrievedCustomerMemory | null,
  memoryB: RetrievedCustomerMemory | null,
): boolean {
  if (!memoryA || !memoryB) return true;
  if (memoryA.snapshot.customerId === memoryB.snapshot.customerId) return false;
  const idsA = new Set(memoryA.historicalRequestIds);
  return !memoryB.historicalRequestIds.some((id) => idsA.has(id));
}
