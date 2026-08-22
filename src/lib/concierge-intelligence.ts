import { getHomesteadDb } from "@/lib/service-requests";
import { logInfo } from "@/lib/log";

export const FUNNEL_EVENTS = [
  "ConversationStarted",
  "IntentDetected",
  "LeadUpdated",
  "ServiceRequestCreated",
  "AvailabilityChecked",
  "AppointmentRequested",
  "AppointmentCreated",
  "AppointmentFailed",
  "TelegramNotificationRequested",
  "ConversationCompleted",
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

export const OUTCOMES = [
  "BOOKED",
  "LEAD_NOT_BOOKED",
  "INFORMATION_ONLY",
  "ABANDONED",
  "UNSUPPORTED",
] as const;

export type ConversationOutcome = (typeof OUTCOMES)[number];

export function recordFunnelEvent(
  conversationId: string,
  event: FunnelEvent,
  detail: Record<string, string | number | boolean | null> = {},
) {
  getHomesteadDb()
    .prepare(
      "INSERT INTO concierge_intelligence (conversation_id, event, detail_json, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(conversationId, event, JSON.stringify(detail), new Date().toISOString());
  logInfo(event, {
    contentJobId: conversationId.slice(0, 8),
    stage: String(detail.intent || detail.service || detail.outcome || ""),
  });
}

export function setConversationOutcome(conversationId: string, outcome: ConversationOutcome) {
  getHomesteadDb()
    .prepare("UPDATE concierge_conversations SET outcome = ?, updated_at = ? WHERE id = ?")
    .run(outcome, new Date().toISOString(), conversationId);
  recordFunnelEvent(conversationId, "ConversationCompleted", { outcome });
}

export function inferOutcome(input: { appointmentId: string; leadId: string; ended: boolean; unsupported: boolean }) {
  if (input.appointmentId) return "BOOKED" as const;
  if (input.unsupported) return "UNSUPPORTED" as const;
  if (input.leadId) return "LEAD_NOT_BOOKED" as const;
  if (input.ended) return "ABANDONED" as const;
  return "INFORMATION_ONLY" as const;
}
