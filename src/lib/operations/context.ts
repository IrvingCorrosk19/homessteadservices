/**
 * OperationsContext — safe references for Operations AI (never full DB dump).
 */
import type { TelegramOperator } from "@/lib/telegram-operators";
import { hasTelegramPermission, type TelegramPermission } from "@/lib/telegram-operators";

export type OperationsPageContext = {
  route?: string;
  entityType?: "request" | "appointment" | "customer" | "job" | "";
  entityId?: string;
  selectedDate?: string;
  selectedCustomerId?: number;
};

export type OperationsContext = {
  operator: {
    id: number;
    role: string;
    displayName: string;
  };
  permissions: TelegramPermission[];
  page: OperationsPageContext;
  conversationId: string;
};

export function buildOperationsContext(input: {
  operator: TelegramOperator;
  conversationId: string;
  page?: OperationsPageContext;
}): OperationsContext {
  const allPerms: TelegramPermission[] = [
    "dashboard.read",
    "analytics.read",
    "requests.read",
    "requests.manage",
    "leads.read",
    "leads.manage",
    "appointments.read",
    "appointments.manage",
    "customers.read",
    "retention.read",
    "recovery.read",
    "content.read",
  ];
  const permissions = allPerms.filter((p) => hasTelegramPermission(input.operator, p));
  return {
    operator: {
      id: input.operator.id,
      role: input.operator.role,
      displayName: input.operator.displayName || "Operador",
    },
    permissions,
    page: input.page || {},
    conversationId: input.conversationId,
  };
}

export function formatPageContextHint(page: OperationsPageContext): string {
  const parts: string[] = [];
  if (page.route) parts.push(`Ruta: ${page.route}`);
  if (page.entityType && page.entityId) {
    parts.push(`En pantalla: ${page.entityType} ${page.entityId}`);
  }
  if (page.selectedDate) parts.push(`Fecha seleccionada: ${page.selectedDate}`);
  if (page.selectedCustomerId) parts.push(`Cliente en pantalla: #${page.selectedCustomerId}`);
  return parts.length ? `[Contexto UI] ${parts.join(" · ")}` : "";
}

export function sanitizeForModel(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+\S+/gi, "[REDACTED]")
      .replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]")
      .slice(0, 4000);
  }
  if (Array.isArray(value)) return value.slice(0, 50).map(sanitizeForModel);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/password|secret|token|hash|api_key/i.test(k)) continue;
      out[k] = sanitizeForModel(v);
    }
    return out;
  }
  return value;
}
