/**
 * Web Operations AI service — bridges admin UI to certified copilot stack.
 */
import { handleCopilotTurn, type CopilotReply } from "@/lib/copilot/service";
import { executeCopilotTool } from "@/lib/copilot/tools";
import { formatToolResultForTelegram, matchDeterministicIntent, runDeterministic } from "@/lib/copilot/deterministic";
import { getCopilotSession, clearCopilotSession } from "@/lib/copilot/session";
import { confirmCopilotAction, cancelCopilotAction } from "@/lib/copilot/confirmations";
import {
  buildOperationsContext,
  formatPageContextHint,
  sanitizeForModel,
  type OperationsPageContext,
} from "@/lib/operations/context";
import { perceiveOperationsQuery } from "@/lib/operations/perception";
import { planOperationsTurn } from "@/lib/operations/planner";
import { resolveWebOperationsOperator, webOperatorSessionKey } from "@/lib/operations/web-operator";
import { recordCopilotAudit } from "@/lib/copilot/schema";
import { randomUUID } from "node:crypto";

export type OperationsAiCard =
  | { type: "request"; publicId: string; name: string; service: string; status: string; href: string }
  | { type: "appointment"; appointmentId: string; time: string; customerName: string; service: string; href: string }
  | { type: "customer"; customerId: number; name: string; href: string }
  | { type: "attention"; id: string; title: string; kind: string; detail?: string }
  | { type: "summary"; label: string; value: string | number };

export type WebOperationsReply = {
  ok: true;
  conversationId: string;
  reply: string;
  cards: OperationsAiCard[];
  confirmation?: { token: string; summary: string };
  openaiUsed: boolean;
  deterministic: boolean;
  plan?: ReturnType<typeof planOperationsTurn>;
};

function cardsFromTool(toolName: string, data: unknown): OperationsAiCard[] {
  const d = data as Record<string, unknown>;
  const cards: OperationsAiCard[] = [];
  if (toolName === "get_appointments") {
    for (const a of (d.appointments as Array<Record<string, string>>) || []) {
      cards.push({
        type: "appointment",
        appointmentId: a.appointmentId || "",
        time: a.startTime || "",
        customerName: a.customerName || "",
        service: a.service || "",
        href: "/admin/citas",
      });
    }
  }
  if (toolName === "get_pending_requests" || toolName === "get_overdue_requests") {
    for (const r of (d.items as Array<Record<string, string>>) || []) {
      cards.push({
        type: "request",
        publicId: r.publicId || "",
        name: r.name || "",
        service: r.service || "",
        status: r.status || "",
        href: `/admin/solicitudes/${encodeURIComponent(r.publicId || "")}`,
      });
    }
  }
  if (toolName === "get_attention_items") {
    for (const i of (d.items as Array<Record<string, string>>) || []) {
      cards.push({
        type: "attention",
        id: i.id || "",
        title: i.title || "",
        kind: i.kind || "",
        detail: i.detail,
      });
    }
  }
  if (toolName === "get_customer") {
    if (d.id) {
      cards.push({
        type: "customer",
        customerId: Number(d.id),
        name: String(d.name || ""),
        href: `/admin/clientes/${d.id}`,
      });
    }
  }
  if (toolName === "get_operations_summary" || toolName === "get_business_summary") {
    const brief = d.brief as Record<string, number> | undefined;
    if (brief) {
      cards.push(
        { type: "summary", label: "Pendientes", value: brief.pendingRequests ?? d.openRequests ?? 0 },
        { type: "summary", label: "Citas hoy", value: brief.appointmentsToday ?? d.scheduledVisits ?? 0 },
      );
    }
  }
  return cards;
}

function cardsFromSession(
  session: ReturnType<typeof getCopilotSession>,
  lastToolData?: unknown,
): OperationsAiCard[] {
  const tool = session.lastToolName;
  const rs = session.lastResultSet;
  if (lastToolData) return cardsFromTool(tool || "", lastToolData);
  if (!tool && !rs) return [];
  if (tool === "get_appointments" || rs?.kind === "appointments") {
    return cardsFromTool("get_appointments", { appointments: rs?.items || [] });
  }
  if (
    tool === "get_pending_requests" ||
    tool === "get_overdue_requests" ||
    rs?.kind === "requests"
  ) {
    return cardsFromTool("get_pending_requests", { items: rs?.items || [] });
  }
  if (tool === "get_attention_items" || rs?.kind === "attention") {
    return cardsFromTool("get_attention_items", { items: rs?.items || [] });
  }
  if (tool === "get_customer" && session.customerId) {
    return cardsFromTool("get_customer", { id: session.customerId, name: session.customerLabel || "" });
  }
  return [];
}

function applyConfirmationPatch(
  confirmation?: { token: string; summary: string },
): Partial<import("@/lib/copilot/session").CopilotContext> {
  return confirmation ? { pendingConfirmationToken: confirmation.token } : { pendingConfirmationToken: undefined };
}

async function runToolTurn(input: {
  operator: ReturnType<typeof resolveWebOperationsOperator>;
  sessionKey: string;
  conversationId: string;
  message: string;
  tool: string;
  args: Record<string, unknown>;
  plan?: ReturnType<typeof planOperationsTurn>;
}): Promise<WebOperationsReply> {
  const result = executeCopilotTool({ operator: input.operator, name: input.tool, args: input.args });
  const text = formatToolResultForTelegram(input.tool, result.data);
  const { touchCopilotTurn } = await import("@/lib/copilot/session");
  touchCopilotTurn(
    input.operator.id,
    input.sessionKey,
    input.message,
    text,
    {
      active: true,
      ...result.sessionPatch,
      lastToolName: input.tool,
      ...applyConfirmationPatch(result.confirmation),
    },
    input.conversationId,
  );
  return {
    ok: true,
    conversationId: input.conversationId,
    reply: text,
    cards: cardsFromTool(input.tool, result.data),
    confirmation: result.confirmation,
    openaiUsed: false,
    deterministic: true,
    plan: input.plan,
  };
}

export async function handleWebOperationsTurn(input: {
  message: string;
  conversationId?: string;
  pageContext?: OperationsPageContext;
  confirmation?: { token: string; accept: boolean };
}): Promise<WebOperationsReply> {
  const operator = resolveWebOperationsOperator();
  const conversationId = input.conversationId?.trim() || randomUUID();
  const sessionKey = webOperatorSessionKey(operator);
  const opsContext = buildOperationsContext({
    operator,
    conversationId,
    page: input.pageContext,
  });

  if (input.confirmation?.token) {
    const result = input.confirmation.accept
      ? confirmCopilotAction({ operator, token: input.confirmation.token })
      : cancelCopilotAction({ operator, token: input.confirmation.token });
    const { touchCopilotTurn } = await import("@/lib/copilot/session");
    touchCopilotTurn(
      operator.id,
      sessionKey,
      input.confirmation.accept ? "Sí" : "No",
      result.message,
      { pendingConfirmationToken: undefined },
      conversationId,
    );
    return {
      ok: true,
      conversationId,
      reply: result.message,
      cards: [],
      openaiUsed: false,
      deterministic: true,
    };
  }

  const pageHint = formatPageContextHint(opsContext.page);
  const enrichedMessage = pageHint ? `${pageHint}\n\n${input.message}` : input.message;
  const perception = perceiveOperationsQuery(input.message, opsContext.page);
  const session = getCopilotSession(operator.id, conversationId);

  // Text-only confirm/cancel — only if bound pending token exists
  if (perception.goal === "CONFIRM") {
    const token = session.pendingConfirmationToken;
    if (!token) {
      return {
        ok: true,
        conversationId,
        reply: perception.isCancellation
          ? "No hay ninguna acción pendiente para cancelar."
          : "No hay ninguna acción pendiente para confirmar.",
        cards: [],
        openaiUsed: false,
        deterministic: true,
      };
    }
    const result = perception.isCancellation
      ? cancelCopilotAction({ operator, token })
      : confirmCopilotAction({ operator, token });
    const { touchCopilotTurn } = await import("@/lib/copilot/session");
    touchCopilotTurn(
      operator.id,
      sessionKey,
      input.message,
      result.message,
      { pendingConfirmationToken: undefined },
      conversationId,
    );
    return {
      ok: true,
      conversationId,
      reply: result.message,
      cards: [],
      openaiUsed: false,
      deterministic: true,
    };
  }

  // Follow-up resolution before planner
  if (perception.goal === "FOLLOW_UP") {
    const items = session.lastResultSet?.items || [];
    if (perception.followUpReference === "first" && items[0]) {
      if (session.lastResultSet?.kind === "appointments") {
        const appointmentId = String((items[0] as { appointmentId?: string }).appointmentId || "");
        if (appointmentId) {
          return runToolTurn({
            operator,
            sessionKey,
            conversationId,
            message: input.message,
            tool: "get_appointment",
            args: { appointmentId },
          });
        }
      }
    }
    if (
      (perception.followUpReference === "that" || /cliente|historial|contratado|trabajo/.test(input.message.toLowerCase())) &&
      session.customerId
    ) {
      return runToolTurn({
        operator,
        sessionKey,
        conversationId,
        message: input.message,
        tool: "get_customer",
        args: { customerId: session.customerId },
      });
    }
  }

  const plan = planOperationsTurn({
    perception,
    message: input.message,
    opsContext,
    session,
  });

  recordCopilotAudit({
    operatorId: operator.id,
    telegramUserId: sessionKey,
    event: "OPS_AI_PLAN",
    result: "ok",
    detail: sanitizeForModel({
      goal: plan.goal,
      tools: plan.toolPlan.map((t) => t.tool),
      risk: plan.riskLevel,
      conversationId,
    }) as Record<string, unknown>,
  });

  if (plan.toolPlan.length === 1 && matchDeterministicIntent(enrichedMessage, session).kind === "none") {
    const tool = plan.toolPlan[0];
    return runToolTurn({
      operator,
      sessionKey,
      conversationId,
      message: input.message,
      tool: tool.tool,
      args: tool.args,
      plan,
    });
  }

  const copilot: CopilotReply = await handleCopilotTurn({
    operator,
    telegramUserId: sessionKey,
    text: enrichedMessage,
    conversationId,
  });

  const lastSession = getCopilotSession(operator.id, conversationId);
  const cards = cardsFromSession(lastSession);

  return {
    ok: true,
    conversationId,
    reply: copilot.text,
    cards,
    confirmation: copilot.confirmation,
    openaiUsed: copilot.openaiUsed,
    deterministic: copilot.deterministic,
    plan,
  };
}

/** Test helper — reset web conversation scope. */
export function resetWebOperationsConversation(conversationId: string, operatorId?: number) {
  const op = operatorId ?? resolveWebOperationsOperator().id;
  clearCopilotSession(op, conversationId);
}
