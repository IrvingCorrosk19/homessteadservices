/**
 * Wave G — AI Business Copilot schema + audit/usage.
 * Separate from customer concierge.
 */
import { getHomesteadDb } from "@/lib/service-requests";

export const COPILOT_PROMPT_VERSION = "business-copilot-v1";
export const COPILOT_SESSION_TTL_MS = 30 * 60_000;
export const COPILOT_CONFIRM_TTL_MS = 10 * 60_000;
export const COPILOT_MAX_TOOL_CALLS = 4;
export const COPILOT_MAX_TURNS_CONTEXT = 8;
export const COPILOT_TIMEOUT_MS = 25_000;

export function migrateCopilotWaveG(database: import("better-sqlite3").Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS copilot_sessions (
      operator_id INTEGER PRIMARY KEY,
      telegram_user_id TEXT NOT NULL,
      context_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS copilot_confirmations (
      token TEXT PRIMARY KEY,
      operator_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      expected_state_json TEXT NOT NULL DEFAULT '{}',
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      executed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_copilot_confirm_op ON copilot_confirmations (operator_id, status);
    CREATE TABLE IF NOT EXISTS copilot_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operator_id INTEGER NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      tool_calls INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS copilot_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operator_id INTEGER NOT NULL,
      telegram_user_id TEXT NOT NULL DEFAULT '',
      event TEXT NOT NULL,
      tool TEXT NOT NULL DEFAULT '',
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_copilot_audit_op ON copilot_audit (operator_id, created_at);
    CREATE TABLE IF NOT EXISTS copilot_sessions_scoped (
      session_scope TEXT PRIMARY KEY,
      operator_id INTEGER NOT NULL,
      telegram_user_id TEXT NOT NULL DEFAULT '',
      context_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_copilot_sessions_scoped_op ON copilot_sessions_scoped (operator_id);
    CREATE TABLE IF NOT EXISTS copilot_metrics (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
  const keys = [
    "copilot_requests",
    "copilot_success",
    "copilot_failure",
    "copilot_tool_calls",
    "copilot_tool_failure",
    "copilot_action_proposed",
    "copilot_action_confirmed",
    "copilot_action_denied",
    "copilot_unauthorized_query",
    "copilot_prompt_injection_detected",
  ];
  const now = new Date().toISOString();
  const insert = database.prepare(
    "INSERT OR IGNORE INTO copilot_metrics (key, value, updated_at) VALUES (?, 0, ?)",
  );
  for (const key of keys) insert.run(key, now);
}

export function ensureCopilotSchema() {
  migrateCopilotWaveG(getHomesteadDb());
}

export function incrementCopilotMetric(key: string, by = 1) {
  try {
    ensureCopilotSchema();
    getHomesteadDb()
      .prepare("UPDATE copilot_metrics SET value = value + ?, updated_at = ? WHERE key = ?")
      .run(by, new Date().toISOString(), key);
  } catch {
    /* never break ops */
  }
}

export function recordCopilotAudit(input: {
  operatorId: number;
  telegramUserId?: string;
  event: string;
  tool?: string;
  entityType?: string;
  entityId?: string;
  result?: string;
  detail?: Record<string, unknown>;
}) {
  ensureCopilotSchema();
  getHomesteadDb()
    .prepare(
      `INSERT INTO copilot_audit
        (operator_id, telegram_user_id, event, tool, entity_type, entity_id, result, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.operatorId,
      input.telegramUserId || "",
      input.event,
      input.tool || "",
      input.entityType || "",
      input.entityId || "",
      input.result || "",
      JSON.stringify(input.detail || {}),
      new Date().toISOString(),
    );
}

export function recordCopilotUsage(input: {
  operatorId: number;
  promptTokens: number;
  completionTokens: number;
  toolCalls: number;
  latencyMs: number;
  model: string;
}) {
  ensureCopilotSchema();
  getHomesteadDb()
    .prepare(
      `INSERT INTO copilot_usage
        (operator_id, prompt_tokens, completion_tokens, tool_calls, latency_ms, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.operatorId,
      input.promptTokens,
      input.completionTokens,
      input.toolCalls,
      input.latencyMs,
      input.model,
      new Date().toISOString(),
    );
}
