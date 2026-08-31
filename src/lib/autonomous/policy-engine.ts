import type { PolicyDecision, PolicyInput, PolicyOutput, SignalType } from "@/lib/autonomous/types";

const HIGH_IMPACT_TYPES = new Set<SignalType>([
  "APPOINTMENT_CANCELLED_NEEDS_ATTENTION",
  "APPOINTMENT_CONFLICT",
  "AUTOMATION_FAILURE",
  "UNRESOLVED_OPERATIONAL_ERROR",
]);

const DIGEST_TYPES = new Set<SignalType>(["REQUEST_AGING", "REQUEST_WITHOUT_NEXT_STEP"]);

export function evaluateAutonomousPolicy(input: PolicyInput): PolicyOutput {
  const { signal, autonomyLevel, actionRisk } = input;

  if (actionRisk === "HIGH_IMPACT") {
    return {
      decision: "REQUEST_CONFIRMATION",
      deliveryMode: "IMMEDIATE",
      reason: "High-impact action always requires human confirmation",
    };
  }

  if (autonomyLevel === "AUTONOMY_L0_OBSERVE") {
    return { decision: "LOG_ONLY", deliveryMode: "LOG_ONLY", reason: "Autonomy L0 observe only" };
  }

  if (signal.severity === "LOW" && DIGEST_TYPES.has(signal.signalType)) {
    return { decision: "RECOMMEND", deliveryMode: "DIGEST", reason: "Low severity digest routing" };
  }

  if (HIGH_IMPACT_TYPES.has(signal.signalType) || signal.severity === "CRITICAL") {
    if (autonomyLevel === "AUTONOMY_L1_NOTIFY") {
      return { decision: "NOTIFY", deliveryMode: "IMMEDIATE", reason: "Critical/high-impact notify" };
    }
    return { decision: "RECOMMEND", deliveryMode: "IMMEDIATE", reason: "Critical requires recommendation" };
  }

  if (autonomyLevel === "AUTONOMY_L1_NOTIFY") {
    return { decision: "NOTIFY", deliveryMode: "IMMEDIATE", reason: "L1 notify" };
  }

  if (autonomyLevel === "AUTONOMY_L2_RECOMMEND" || autonomyLevel === "AUTONOMY_L4_HIGH_IMPACT") {
    return {
      decision: "RECOMMEND",
      deliveryMode: DIGEST_TYPES.has(signal.signalType) ? "DIGEST" : "IMMEDIATE",
      reason: "L2 recommend",
    };
  }

  if (autonomyLevel === "AUTONOMY_L3_LOW_RISK_ACTION" && actionRisk === "LOW_RISK") {
    return { decision: "EXECUTE_LOW_RISK", deliveryMode: "LOG_ONLY", reason: "L3 low-risk auto" };
  }

  return { decision: "NOTIFY", deliveryMode: "IMMEDIATE", reason: "Default notify" };
}

export function isHighImpactAction(action: string): boolean {
  const a = action.toLowerCase();
  return (
    a.includes("cancel") ||
    a.includes("reschedule") ||
    a.includes("reprogram") ||
    a.includes("close") ||
    a.includes("delete") ||
    a.includes("send_customer") ||
    a.includes("modify_permission")
  );
}

export function policyDecisionAllowsNotify(decision: PolicyDecision): boolean {
  return decision === "NOTIFY" || decision === "RECOMMEND" || decision === "REQUEST_CONFIRMATION";
}
