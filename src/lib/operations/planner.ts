/**
 * OperationsPlanner — structured plan (no hidden chain-of-thought).
 */
import type { OperationsContext } from "@/lib/operations/context";
import type { OperationsPerception } from "@/lib/operations/perception";
import type { CopilotContext } from "@/lib/copilot/session";

export type OperationsRiskLevel = "READ_ONLY" | "LOW_IMPACT_WRITE" | "HIGH_IMPACT_WRITE";

export type OperationsPlan = {
  goal: string;
  understanding: string;
  dataNeeded: string[];
  toolPlan: Array<{ tool: string; args: Record<string, unknown> }>;
  riskLevel: OperationsRiskLevel;
  confirmationRequired: boolean;
  responseStrategy: string;
};

export function planOperationsTurn(input: {
  perception: OperationsPerception;
  message: string;
  opsContext: OperationsContext;
  session: CopilotContext;
}): OperationsPlan {
  const { perception, message, opsContext, session } = input;
  const toolPlan: OperationsPlan["toolPlan"] = [];
  let riskLevel: OperationsRiskLevel = "READ_ONLY";
  let confirmationRequired = false;

  if (perception.isConfirmation) {
    return {
      goal: "CONFIRM_PENDING_ACTION",
      understanding: "Operador confirma acción pendiente",
      dataNeeded: [],
      toolPlan: [],
      riskLevel: "HIGH_IMPACT_WRITE",
      confirmationRequired: true,
      responseStrategy: "Ejecutar confirmación vinculada si token válido",
    };
  }

  if (perception.goal === "FOLLOW_UP" && session.lastResultSet?.items?.length) {
    const items = session.lastResultSet.items;
    if (perception.followUpReference === "first" && items[0]) {
      if (session.lastResultSet.kind === "appointments") {
        toolPlan.push({
          tool: "get_appointment",
          args: { appointmentId: (items[0] as { appointmentId?: string }).appointmentId },
        });
      }
      if (session.lastResultSet.kind === "customers" && (items[0] as { id?: number }).id) {
        toolPlan.push({ tool: "get_customer", args: { customerId: (items[0] as { id: number }).id } });
      }
    }
    if (perception.followUpReference === "that" && session.customerId) {
      toolPlan.push({ tool: "get_customer", args: { customerId: session.customerId } });
    }
  }

  if (perception.requestId) {
    toolPlan.push({ tool: "get_request_detail", args: { publicId: perception.requestId } });
  } else if (opsContext.page.entityType === "request" && opsContext.page.entityId) {
    toolPlan.push({ tool: "get_request_detail", args: { publicId: opsContext.page.entityId } });
  }

  if (!toolPlan.length) {
    if (perception.goal === "QUERY_PRIORITY") {
      toolPlan.push({ tool: "get_attention_items", args: { limit: 10 } });
    } else if (perception.goal === "QUERY_APPOINTMENTS" || perception.timeRange === "tomorrow") {
      toolPlan.push({
        tool: "get_appointments",
        args: { day: perception.timeRange === "tomorrow" ? "tomorrow" : "today" },
      });
    } else if (perception.timeRange === "today" && /paso|hoy|resumen/.test(message.toLowerCase())) {
      toolPlan.push({ tool: "get_operations_summary", args: { range: "today" } });
    } else if (perception.customerQuery) {
      toolPlan.push({ tool: "search_customers", args: { query: perception.customerQuery } });
    } else if (perception.location) {
      toolPlan.push({ tool: "get_requests_by_location", args: { location: perception.location, limit: 15 } });
    } else if (perception.service) {
      toolPlan.push({ tool: "get_requests_by_service", args: { service: perception.service, range: "30d" } });
    } else if (/pendiente|abiert|sin atender/.test(message.toLowerCase())) {
      toolPlan.push({ tool: "get_pending_requests", args: { limit: 10 } });
    } else if (/atrasad|overdue|antigu/.test(message.toLowerCase())) {
      toolPlan.push({ tool: "get_overdue_requests", args: { limit: 10 } });
    } else if (/outbox|automat|fallo/.test(message.toLowerCase())) {
      toolPlan.push({ tool: "get_outbox_status", args: {} });
    } else if (/carga|workload|semana/.test(message.toLowerCase())) {
      toolPlan.push({ tool: "get_workload_summary", args: { range: perception.timeRange || "week" } });
    } else {
      toolPlan.push({ tool: "get_operations_summary", args: { range: perception.timeRange || "today" } });
    }
  }

  if (perception.goal === "MUTATION") {
    riskLevel = "HIGH_IMPACT_WRITE";
    confirmationRequired = true;
  }

  return {
    goal: perception.goal,
    understanding: message.slice(0, 200),
    dataNeeded: toolPlan.map((t) => t.tool),
    toolPlan,
    riskLevel,
    confirmationRequired,
    responseStrategy:
      riskLevel === "READ_ONLY"
        ? "Responder con hechos del tool; separar recomendaciones"
        : "Preview + confirmación explícita antes de mutar",
  };
}
