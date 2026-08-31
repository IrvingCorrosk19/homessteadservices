/**
 * Tool registry — typed metadata for concierge tools (permissions, idempotency class).
 */
export type ToolRisk = "READ" | "LOW_RISK_WRITE" | "HIGH_IMPACT_WRITE";

export type ToolDescriptor = {
  name: string;
  risk: ToolRisk;
  requiresExplicitIntent: boolean;
  idempotent: boolean;
  description: string;
};

export const HOMESTEAD_TOOL_REGISTRY: Record<string, ToolDescriptor> = {
  record_service_intelligence: {
    name: "record_service_intelligence",
    risk: "LOW_RISK_WRITE",
    requiresExplicitIntent: false,
    idempotent: true,
    description: "Persist structured understanding from LLM",
  },
  remember_customer_facts: {
    name: "remember_customer_facts",
    risk: "LOW_RISK_WRITE",
    requiresExplicitIntent: false,
    idempotent: true,
    description: "Merge customer facts safely",
  },
  search_services: {
    name: "search_services",
    risk: "READ",
    requiresExplicitIntent: false,
    idempotent: true,
    description: "Catalog lookup",
  },
  create_or_update_lead: {
    name: "create_or_update_lead",
    risk: "LOW_RISK_WRITE",
    requiresExplicitIntent: false,
    idempotent: true,
    description: "Ensure HS folio",
  },
  check_availability: {
    name: "check_availability",
    risk: "READ",
    requiresExplicitIntent: false,
    idempotent: true,
    description: "Query real calendar",
  },
  create_appointment: {
    name: "create_appointment",
    risk: "HIGH_IMPACT_WRITE",
    requiresExplicitIntent: true,
    idempotent: true,
    description: "Book visit after validation",
  },
  reschedule_appointment: {
    name: "reschedule_appointment",
    risk: "HIGH_IMPACT_WRITE",
    requiresExplicitIntent: true,
    idempotent: true,
    description: "Reprogram same HA",
  },
  cancel_appointment: {
    name: "cancel_appointment",
    risk: "HIGH_IMPACT_WRITE",
    requiresExplicitIntent: true,
    idempotent: true,
    description: "Cancel active visit",
  },
  escalate_human: {
    name: "escalate_human",
    risk: "LOW_RISK_WRITE",
    requiresExplicitIntent: true,
    idempotent: true,
    description: "Human handoff",
  },
  get_customer_context: {
    name: "get_customer_context",
    risk: "READ",
    requiresExplicitIntent: false,
    idempotent: true,
    description: "Customer 360 lookup (read-only)",
  },
};

export function getToolDescriptor(name: string): ToolDescriptor | null {
  return HOMESTEAD_TOOL_REGISTRY[name] || null;
}

export function isToolAllowed(name: string, opts: { explicitUserIntent?: boolean } = {}): boolean {
  const desc = getToolDescriptor(name);
  if (!desc) return false;
  if (desc.requiresExplicitIntent && !opts.explicitUserIntent) return false;
  return true;
}
