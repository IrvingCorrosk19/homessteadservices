/**
 * OperationsPerception — deterministic intent/entity extraction for ops queries.
 */
import type { OperationsPageContext } from "@/lib/operations/context";

export type OperationsGoal =
  | "QUERY_OPERATIONS"
  | "QUERY_APPOINTMENTS"
  | "QUERY_REQUESTS"
  | "QUERY_CUSTOMER"
  | "QUERY_ANALYTICS"
  | "QUERY_PRIORITY"
  | "EXPLAIN_REQUEST"
  | "MUTATION"
  | "FOLLOW_UP"
  | "CONFIRM"
  | "UNKNOWN";

export type OperationsPerception = {
  goal: OperationsGoal;
  timeRange?: "today" | "tomorrow" | "week" | "month" | "7d" | "30d";
  location?: string;
  service?: string;
  customerQuery?: string;
  requestId?: string;
  appointmentId?: string;
  followUpOrdinal?: number;
  followUpReference?: "first" | "second" | "that" | "previous";
  requestedAction?: string;
  isConfirmation: boolean;
  isCancellation: boolean;
};

export function perceiveOperationsQuery(text: string, page: OperationsPageContext): OperationsPerception {
  const t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();

  const perception: OperationsPerception = {
    goal: "UNKNOWN",
    isConfirmation: /^(s[ií]|confirmo|confirmar|ok|dale|hazlo)\b/.test(t),
    isCancellation: /^(no|cancelar|olvida)\b/.test(t),
  };

  const hs = text.match(/\b(HS-\d{4}-\d{6})\b/i);
  if (hs) {
    perception.requestId = hs[1].toUpperCase();
    perception.goal = /por que|atasc|stuck|no avanza|falta/.test(t) ? "EXPLAIN_REQUEST" : "QUERY_REQUESTS";
  }

  if (/^(la|el)\s+(primera|segunda|tercera|1|2|3)\b/.test(t) || /cual es la primera/.test(t)) {
    perception.goal = "FOLLOW_UP";
    if (/primera|1\b/.test(t)) perception.followUpReference = "first";
    if (/segunda|2\b/.test(t)) perception.followUpReference = "second";
  }
  if (
    /^(esa|ese|esa cita|el cliente anterior|ese cliente)\b/.test(t) ||
    /quien es (ese|el) cliente/.test(t) ||
    /(habia|ya nos habia|nos habia) contratado/.test(t) ||
    /que trabajo hicimos/.test(t) ||
    /cuentame mas del cliente/.test(t)
  ) {
    perception.goal = "FOLLOW_UP";
    perception.followUpReference = "that";
  }

  if (perception.isConfirmation && !perception.isCancellation) {
    perception.goal = "CONFIRM";
  }
  if (perception.isCancellation) {
    perception.goal = "CONFIRM";
  }

  if (/manana|mañana/.test(t)) perception.timeRange = "tomorrow";
  else if (/hoy|paso hoy|que paso/.test(t)) perception.timeRange = "today";
  else if (/semana/.test(t)) perception.timeRange = "week";
  else if (/mes/.test(t)) perception.timeRange = "month";

  const locMatch = t.match(
    /(?:en|de)\s+(edison\s*park|betania|costa del este|el dorado|san francisco|clayton|arraijan)/i,
  );
  if (locMatch?.[1]) perception.location = locMatch[1].replace(/\s+/g, " ");

  if (/aire|ac|plomer|pintur|electric|cerra/.test(t)) {
    if (/aire|ac/.test(t)) perception.service = "ac";
    else if (/plomer/.test(t)) perception.service = "plumbing";
    else if (/pintur/.test(t)) perception.service = "painting";
  }

  if (/pendiente|atencion|prioridad|primero|resolver/.test(t)) perception.goal = "QUERY_PRIORITY";
  else if (/cita|visita|agenda|calendario/.test(t)) perception.goal = "QUERY_APPOINTMENTS";
  else if (/servicio|zona|metric|cuant/.test(t)) perception.goal = "QUERY_ANALYTICS";
  else if (/reprogram|mover|cambiar|cancel/.test(t)) perception.goal = "MUTATION";
  else if (perception.goal === "UNKNOWN") perception.goal = "QUERY_OPERATIONS";

  if (page.entityId && page.entityType === "request") {
    if (/aqui|aquí|pasando|falta|pasa con|estado/.test(t) || perception.goal === "QUERY_OPERATIONS") {
      perception.requestId = page.entityId;
      perception.goal = /falta|atasc|no avanza/.test(t) ? "EXPLAIN_REQUEST" : "QUERY_REQUESTS";
    }
  }

  if (perception.goal !== "FOLLOW_UP" && perception.goal !== "CONFIRM") {
    if (/cliente|historial|carlos|ana|busca/.test(t)) perception.goal = "QUERY_CUSTOMER";
  }

  const busca = t.match(/(?:cliente|resumen de|dame)\s+(.+)$/) || t.match(/busca(?:r)?(?: a| al)?\s+(.+)$/);
  if (busca) perception.customerQuery = busca[1].trim();

  return perception;
}
