export const SIGNAL_TYPES = [
  "REQUEST_AGING",
  "APPOINTMENT_UPCOMING",
  "APPOINTMENT_TODAY",
  "APPOINTMENT_CONFLICT",
  "CUSTOMER_WAITING",
  "REQUEST_WITHOUT_NEXT_STEP",
  "AUTOMATION_FAILURE",
  "APPOINTMENT_CANCELLED_NEEDS_ATTENTION",
  "SCHEDULE_CHANGED",
  "REQUIREMENT_MISSING_BEFORE_VISIT",
  "UNRESOLVED_OPERATIONAL_ERROR",
] as const;

export type SignalType = (typeof SIGNAL_TYPES)[number];

export const SIGNAL_STATUSES = [
  "DETECTED",
  "EVALUATING",
  "IGNORED",
  "ACTIONABLE",
  "NOTIFIED",
  "ACKNOWLEDGED",
  "RESOLVED",
  "EXPIRED",
  "SUPERSEDED",
  "FAILED",
] as const;

export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

export const SIGNAL_SEVERITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
export type SignalSeverity = (typeof SIGNAL_SEVERITIES)[number];

export const AUTONOMY_LEVELS = [
  "AUTONOMY_L0_OBSERVE",
  "AUTONOMY_L1_NOTIFY",
  "AUTONOMY_L2_RECOMMEND",
  "AUTONOMY_L3_LOW_RISK_ACTION",
  "AUTONOMY_L4_HIGH_IMPACT",
] as const;

export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const POLICY_DECISIONS = [
  "IGNORE",
  "LOG_ONLY",
  "NOTIFY",
  "RECOMMEND",
  "REQUEST_CONFIRMATION",
  "EXECUTE_LOW_RISK",
] as const;

export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

export const DELIVERY_MODES = ["IMMEDIATE", "DIGEST", "LOG_ONLY"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export type SignalFacts = Record<string, string | number | boolean | null>;
export type SignalEvidence = Record<string, unknown>;

export type OperationalSignal = {
  signalId: string;
  signalType: SignalType;
  source: string;
  entityType?: string;
  entityId?: string;
  customerId?: number;
  requestId?: string;
  appointmentId?: string;
  detectedAt: string;
  businessTime?: string;
  severity: SignalSeverity;
  priority: number;
  facts: SignalFacts;
  evidence: SignalEvidence;
  aiAssessment?: {
    classification?: string;
    importance?: string;
    reasoningSummary?: string;
    recommendedAction?: string;
    riskLevel?: string;
    enrichedAt?: string;
    openaiUsed?: boolean;
  };
  deduplicationKey: string;
  stateVersion: string;
  status: SignalStatus;
  recommendedAction?: string;
  reasoningSummary?: string;
  deliveryMode: DeliveryMode;
  notifiedAt?: string;
  acknowledgedAt?: string;
  acknowledgedByOperatorId?: number;
  resolvedAt?: string;
  lastNotifiedAt?: string;
  notificationCount: number;
  cooldownUntil?: string;
  supersededBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type SignalCandidate = Omit<
  OperationalSignal,
  "signalId" | "status" | "notificationCount" | "createdAt" | "updatedAt" | "deliveryMode"
> & { deliveryMode?: DeliveryMode };

export type PolicyInput = {
  signal: OperationalSignal;
  autonomyLevel: AutonomyLevel;
  actionRisk: "READ" | "LOW_RISK" | "HIGH_IMPACT";
  operatorAuthorized: boolean;
};

export type PolicyOutput = {
  decision: PolicyDecision;
  deliveryMode: DeliveryMode;
  reason: string;
};
