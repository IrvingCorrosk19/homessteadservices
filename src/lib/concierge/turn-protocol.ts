/**
 * Recoverable turn protocol for n8n-coordinated concierge.
 * One short-lived turn per user message — never hold an n8n execution open across the whole chat.
 */

export type TurnStatus =
  | "ACCEPTED"
  | "CONTEXT_LOADED"
  | "INTERPRETING"
  | "TOOLS"
  | "PERSISTING"
  | "DONE"
  | "FAILED"
  | "TIMED_OUT"
  | "SUPERSEDED";

export type ConciergeTurnRecord = {
  turnId: string;
  conversationId: string;
  messageId: string;
  engine: "legacy" | "n8n";
  status: TurnStatus;
  stateVersion: number;
  userText: string;
  replyJson: string;
  errorCode: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string;
};

export type StructuredIntent = {
  primaryIntent: string;
  createServiceRequest: boolean;
  informationalOnly: boolean;
  cancelRequest: boolean;
  cancelAppointmentOnly: boolean;
  reschedule: boolean;
  humanHandoff: boolean;
  businessContactQuestion: boolean;
  extracted: {
    name?: string;
    phone?: string;
    location?: string;
    service?: string;
    problem?: string;
    preferredDate?: string;
    preferredTime?: string;
  };
  missingFields: string[];
  confidence: "low" | "medium" | "high";
};

export type ToolResultEnvelope = {
  ok: boolean;
  tool: string;
  code?: string;
  message?: string;
  data?: Record<string, unknown>;
  persistedIds?: { requestId?: string; appointmentId?: string };
  idempotentReplay?: boolean;
};

export type TurnReplyPayload = {
  ok: boolean;
  reply: string;
  turnId: string;
  status: TurnStatus;
  processing?: boolean;
  leadId?: string | null;
  requestCard?: Record<string, unknown> | null;
  chips?: string[];
  historicalChips?: string[];
  awaitingSlotSelection?: boolean;
  bookingPending?: boolean;
  slotGroups?: unknown[];
  serviceContext?: unknown;
  showResumeBooking?: boolean;
  showPhotoCta?: boolean;
  photosRemaining?: number;
  contactUrl?: string | null;
  whatsappUrl?: string | null;
  ended?: boolean;
  requiresHuman?: boolean;
  dryLead?: boolean;
  nextAction?: string;
  error?: string;
  engine?: string;
};
