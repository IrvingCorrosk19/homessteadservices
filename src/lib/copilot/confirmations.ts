import { randomBytes } from "node:crypto";
import { getHomesteadDb } from "@/lib/service-requests";
import {
  COPILOT_CONFIRM_TTL_MS,
  ensureCopilotSchema,
  incrementCopilotMetric,
  recordCopilotAudit,
} from "@/lib/copilot/schema";
import { markEntityContacted, snoozeEntity } from "@/lib/ops-store";
import type { TelegramOperator } from "@/lib/telegram-operators";
import { hasTelegramPermission } from "@/lib/telegram-operators";

export type CopilotAction = "mark_contacted" | "snooze_lead";

export function proposeCopilotAction(input: {
  operator: TelegramOperator;
  action: CopilotAction;
  entityType: string;
  entityId: string;
  expectedState: Record<string, unknown>;
  payload?: Record<string, unknown>;
  summary: string;
}) {
  ensureCopilotSchema();
  if (input.action === "mark_contacted" || input.action === "snooze_lead") {
    if (!hasTelegramPermission(input.operator, "leads.manage") && !hasTelegramPermission(input.operator, "requests.manage")) {
      incrementCopilotMetric("copilot_unauthorized_query");
      recordCopilotAudit({
        operatorId: input.operator.id,
        telegramUserId: input.operator.telegramUserId,
        event: "COPILOT_ACTION_DENIED",
        entityType: input.entityType,
        entityId: input.entityId,
        result: "forbidden",
      });
      return { ok: false as const, reason: "forbidden" as const };
    }
  }
  const token = randomBytes(16).toString("hex");
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + COPILOT_CONFIRM_TTL_MS).toISOString();
  getHomesteadDb()
    .prepare(
      `INSERT INTO copilot_confirmations
        (token, operator_id, action, entity_type, entity_id, expected_state_json, payload_json, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
    )
    .run(
      token,
      input.operator.id,
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify(input.expectedState),
      JSON.stringify(input.payload || {}),
      now,
      expires,
    );
  incrementCopilotMetric("copilot_action_proposed");
  recordCopilotAudit({
    operatorId: input.operator.id,
    telegramUserId: input.operator.telegramUserId,
    event: "COPILOT_ACTION_PROPOSED",
    entityType: input.entityType,
    entityId: input.entityId,
    result: "pending",
    detail: { action: input.action, tokenPrefix: token.slice(0, 8) },
  });
  return {
    ok: true as const,
    token,
    summary: input.summary,
    expiresAt: expires,
  };
}

function readConfirmation(token: string) {
  ensureCopilotSchema();
  return getHomesteadDb()
    .prepare("SELECT * FROM copilot_confirmations WHERE token = ?")
    .get(token) as
    | {
        token: string;
        operator_id: number;
        action: string;
        entity_type: string;
        entity_id: string;
        expected_state_json: string;
        payload_json: string;
        status: string;
        expires_at: string;
      }
    | undefined;
}

function currentEntityState(entityId: string): Record<string, unknown> {
  const db = getHomesteadDb();
  const req = db
    .prepare("SELECT status, snoozed_until FROM service_requests WHERE public_id = ?")
    .get(entityId) as { status: string; snoozed_until: string | null } | undefined;
  const lead = db
    .prepare("SELECT pipeline_stage, first_human_action_at, snoozed_until FROM revenue_leads WHERE lead_id = ?")
    .get(entityId) as
    | { pipeline_stage: string; first_human_action_at: string | null; snoozed_until: string | null }
    | undefined;
  return {
    requestStatus: req?.status || null,
    leadStage: lead?.pipeline_stage || null,
    firstHumanActionAt: lead?.first_human_action_at || null,
    snoozedUntil: req?.snoozed_until || lead?.snoozed_until || null,
  };
}

function stateMatches(expected: Record<string, unknown>, current: Record<string, unknown>) {
  for (const key of Object.keys(expected)) {
    if (String(expected[key] ?? "") !== String(current[key] ?? "")) return false;
  }
  return true;
}

export function confirmCopilotAction(input: {
  operator: TelegramOperator;
  token: string;
}): { ok: true; message: string } | { ok: false; reason: string; message: string } {
  ensureCopilotSchema();
  const row = readConfirmation(input.token);
  if (!row) {
    return { ok: false, reason: "missing", message: "Esta confirmación ya no es válida." };
  }
  if (row.operator_id !== input.operator.id) {
    incrementCopilotMetric("copilot_action_denied");
    recordCopilotAudit({
      operatorId: input.operator.id,
      event: "COPILOT_ACTION_DENIED",
      entityId: row.entity_id,
      result: "wrong_operator",
    });
    return { ok: false, reason: "wrong_operator", message: "No tienes acceso a esa confirmación." };
  }
  if (row.status !== "PENDING") {
    return {
      ok: false,
      reason: "already",
      message: "Esta acción ya fue procesada.",
    };
  }
  if (Date.parse(row.expires_at) < Date.now()) {
    getHomesteadDb().prepare("UPDATE copilot_confirmations SET status = 'EXPIRED' WHERE token = ?").run(input.token);
    incrementCopilotMetric("copilot_action_denied");
    return { ok: false, reason: "expired", message: "La confirmación expiró. Vuelve a pedirlo." };
  }

  const expected = JSON.parse(row.expected_state_json || "{}") as Record<string, unknown>;
  const current = currentEntityState(row.entity_id);
  if (!stateMatches(expected, current)) {
    getHomesteadDb().prepare("UPDATE copilot_confirmations SET status = 'STALE' WHERE token = ?").run(input.token);
    incrementCopilotMetric("copilot_action_denied");
    recordCopilotAudit({
      operatorId: input.operator.id,
      event: "COPILOT_ACTION_DENIED",
      entityType: row.entity_type,
      entityId: row.entity_id,
      result: "stale",
    });
    return {
      ok: false,
      reason: "stale",
      message: "El estado cambió desde que solicitaste esta acción. No ejecuté nada.",
    };
  }

  // Claim atomically
  const claimed = getHomesteadDb()
    .prepare("UPDATE copilot_confirmations SET status = 'EXECUTING' WHERE token = ? AND status = 'PENDING'")
    .run(input.token);
  if (claimed.changes !== 1) {
    return { ok: false, reason: "race", message: "Esta acción ya fue procesada." };
  }

  const actor = `copilot:${input.operator.id}:${input.operator.role}`;
  const payload = JSON.parse(row.payload_json || "{}") as { minutes?: number };
  let message = "Listo.";
  try {
    if (row.action === "mark_contacted") {
      const result = markEntityContacted(row.entity_id, actor);
      if (!result.ok) {
        getHomesteadDb().prepare("UPDATE copilot_confirmations SET status = 'FAILED' WHERE token = ?").run(input.token);
        return { ok: false, reason: "missing", message: "No encontré esa solicitud." };
      }
      message = result.already
        ? `Ya estaba marcada como atendida.\n${row.entity_id}`
        : `Marqué como atendida.\n${row.entity_id}`;
    } else if (row.action === "snooze_lead") {
      const minutes = Number(payload.minutes || 30);
      const until = snoozeEntity(row.entity_id, minutes, actor);
      message = `Pospuesta ${minutes} min hasta ${until}.\n${row.entity_id}`;
    } else {
      getHomesteadDb().prepare("UPDATE copilot_confirmations SET status = 'DENIED' WHERE token = ?").run(input.token);
      return { ok: false, reason: "unsupported", message: "Acción no soportada." };
    }
  } catch {
    getHomesteadDb().prepare("UPDATE copilot_confirmations SET status = 'FAILED' WHERE token = ?").run(input.token);
    return { ok: false, reason: "error", message: "No pude completar la acción en este momento." };
  }

  getHomesteadDb()
    .prepare("UPDATE copilot_confirmations SET status = 'EXECUTED', executed_at = ? WHERE token = ?")
    .run(new Date().toISOString(), input.token);
  incrementCopilotMetric("copilot_action_confirmed");
  recordCopilotAudit({
    operatorId: input.operator.id,
    telegramUserId: input.operator.telegramUserId,
    event: "COPILOT_ACTION_EXECUTED",
    entityType: row.entity_type,
    entityId: row.entity_id,
    result: "ok",
    detail: { action: row.action },
  });
  return { ok: true, message };
}

export function cancelCopilotAction(input: { operator: TelegramOperator; token: string }) {
  ensureCopilotSchema();
  const row = readConfirmation(input.token);
  if (!row || row.operator_id !== input.operator.id) {
    return { ok: false as const, message: "Confirmación no válida." };
  }
  if (row.status === "PENDING") {
    getHomesteadDb().prepare("UPDATE copilot_confirmations SET status = 'CANCELLED' WHERE token = ?").run(input.token);
  }
  incrementCopilotMetric("copilot_action_denied");
  recordCopilotAudit({
    operatorId: input.operator.id,
    event: "COPILOT_ACTION_DENIED",
    entityId: row.entity_id,
    result: "cancelled",
  });
  return { ok: true as const, message: "No cancelé / no ejecuté la acción." };
}

export function snapshotEntityForConfirm(entityId: string) {
  return currentEntityState(entityId);
}
