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
};

export function getCopilotSession(operatorId: number): CopilotContext {
  ensureCopilotSchema();
  const row = getHomesteadDb()
    .prepare("SELECT context_json, expires_at FROM copilot_sessions WHERE operator_id = ?")
    .get(operatorId) as { context_json: string; expires_at: string } | undefined;
  if (!row) return { active: false, recentTurns: [] };
  if (Date.parse(row.expires_at) < Date.now()) {
    clearCopilotSession(operatorId);
    return { active: false, recentTurns: [] };
  }
  try {
    const ctx = JSON.parse(row.context_json || "{}") as CopilotContext;
    return { recentTurns: [], ...ctx, active: Boolean(ctx.active) };
  } catch {
    return { active: false, recentTurns: [] };
  }
}

export function saveCopilotSession(
  operatorId: number,
  telegramUserId: string,
  context: CopilotContext,
) {
  ensureCopilotSchema();
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + COPILOT_SESSION_TTL_MS).toISOString();
  const turns = (context.recentTurns || []).slice(-8);
  const payload = { ...context, recentTurns: turns };
  getHomesteadDb()
    .prepare(
      `INSERT INTO copilot_sessions (operator_id, telegram_user_id, context_json, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(operator_id) DO UPDATE SET
         telegram_user_id = excluded.telegram_user_id,
         context_json = excluded.context_json,
         updated_at = excluded.updated_at,
         expires_at = excluded.expires_at`,
    )
    .run(operatorId, telegramUserId, JSON.stringify(payload), now, expires);
}

export function clearCopilotSession(operatorId: number) {
  ensureCopilotSchema();
  getHomesteadDb().prepare("DELETE FROM copilot_sessions WHERE operator_id = ?").run(operatorId);
}

export function touchCopilotTurn(
  operatorId: number,
  telegramUserId: string,
  userText: string,
  assistantText: string,
  patch: Partial<CopilotContext> = {},
) {
  const prev = getCopilotSession(operatorId);
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
  });
}
