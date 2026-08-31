import { getHomesteadDb } from "@/lib/service-requests";
import {
  COPILOT_SESSION_TTL_MS,
  ensureCopilotSchema,
} from "@/lib/copilot/schema";

export type CopilotContext = {
  active: boolean;
  customerId?: number;
  customerLabel?: string;
  lastEntityType?: string;
  lastEntityId?: string;
  pendingDisambiguation?: Array<{ id: number; label: string }>;
  recentTurns?: Array<{ role: "user" | "assistant"; text: string }>;
  lastResultSet?: {
    kind: "appointments" | "requests" | "customers" | "attention";
    items: Array<Record<string, unknown>>;
  };
  lastToolName?: string;
  pendingConfirmationToken?: string;
  conversationId?: string;
};

/** Telegram: op:{operatorId}. Web Operations AI: web:{conversationId}. */
export function copilotSessionScope(operatorId: number, conversationId?: string): string {
  const cid = conversationId?.trim();
  if (cid) return `web:${cid}`;
  return `op:${operatorId}`;
}

function migrateLegacySessionsOnce() {
  const db = getHomesteadDb();
  const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='copilot_sessions'").get();
  if (!legacy) return;
  const rows = db
    .prepare(
      "SELECT operator_id, telegram_user_id, context_json, updated_at, expires_at FROM copilot_sessions",
    )
    .all() as Array<{
    operator_id: number;
    telegram_user_id: string;
    context_json: string;
    updated_at: string;
    expires_at: string;
  }>;
  const ins = db.prepare(
    `INSERT OR IGNORE INTO copilot_sessions_scoped
      (session_scope, operator_id, telegram_user_id, context_json, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    ins.run(
      copilotSessionScope(row.operator_id),
      row.operator_id,
      row.telegram_user_id,
      row.context_json,
      row.updated_at,
      row.expires_at,
    );
  }
}

export function getCopilotSession(operatorId: number, conversationId?: string): CopilotContext {
  ensureCopilotSchema();
  migrateLegacySessionsOnce();
  const scope = copilotSessionScope(operatorId, conversationId);
  const row = getHomesteadDb()
    .prepare("SELECT context_json, expires_at FROM copilot_sessions_scoped WHERE session_scope = ?")
    .get(scope) as { context_json: string; expires_at: string } | undefined;
  if (!row) return { active: false, recentTurns: [] };
  if (Date.parse(row.expires_at) < Date.now()) {
    clearCopilotSession(operatorId, conversationId);
    return { active: false, recentTurns: [] };
  }
  try {
    const ctx = JSON.parse(row.context_json || "{}") as CopilotContext;
    return { recentTurns: [], ...ctx, active: Boolean(ctx.active), conversationId: conversationId?.trim() || undefined };
  } catch {
    return { active: false, recentTurns: [] };
  }
}

export function saveCopilotSession(
  operatorId: number,
  telegramUserId: string,
  context: CopilotContext,
  conversationId?: string,
) {
  ensureCopilotSchema();
  migrateLegacySessionsOnce();
  const scope = copilotSessionScope(operatorId, conversationId);
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + COPILOT_SESSION_TTL_MS).toISOString();
  const turns = (context.recentTurns || []).slice(-8);
  const payload = { ...context, recentTurns: turns, conversationId: conversationId?.trim() || undefined };
  getHomesteadDb()
    .prepare(
      `INSERT INTO copilot_sessions_scoped
        (session_scope, operator_id, telegram_user_id, context_json, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_scope) DO UPDATE SET
         operator_id = excluded.operator_id,
         telegram_user_id = excluded.telegram_user_id,
         context_json = excluded.context_json,
         updated_at = excluded.updated_at,
         expires_at = excluded.expires_at`,
    )
    .run(scope, operatorId, telegramUserId, JSON.stringify(payload), now, expires);
}

export function clearCopilotSession(operatorId: number, conversationId?: string) {
  ensureCopilotSchema();
  const scope = copilotSessionScope(operatorId, conversationId);
  getHomesteadDb().prepare("DELETE FROM copilot_sessions_scoped WHERE session_scope = ?").run(scope);
}

export function touchCopilotTurn(
  operatorId: number,
  telegramUserId: string,
  userText: string,
  assistantText: string,
  patch: Partial<CopilotContext> = {},
  conversationId?: string,
) {
  const prev = getCopilotSession(operatorId, conversationId);
  const recentTurns = [
    ...(prev.recentTurns || []),
    { role: "user" as const, text: userText.slice(0, 500) },
    { role: "assistant" as const, text: assistantText.slice(0, 800) },
  ].slice(-8);
  saveCopilotSession(operatorId, telegramUserId, {
    ...prev,
    ...patch,
    active: true,
    recentTurns,
  }, conversationId);
}
