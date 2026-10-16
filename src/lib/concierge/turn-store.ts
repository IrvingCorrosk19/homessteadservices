/**
 * Concierge turn persistence — short-lived turn rows, no long SQLite locks across AI/network.
 */
import { randomUUID } from "node:crypto";
import { getHomesteadDb } from "@/lib/service-requests";
import type { ConciergeTurnRecord, TurnStatus } from "@/lib/concierge/turn-protocol";

let ensured = false;

export function ensureConciergeTurnTables() {
  if (ensured) return;
  const db = getHomesteadDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS concierge_turns (
      turn_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL DEFAULT '',
      engine TEXT NOT NULL DEFAULT 'legacy',
      status TEXT NOT NULL DEFAULT 'ACCEPTED',
      state_version INTEGER NOT NULL DEFAULT 0,
      user_text TEXT NOT NULL DEFAULT '',
      reply_json TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_concierge_turns_conv
      ON concierge_turns (conversation_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_concierge_turns_idem
      ON concierge_turns (idempotency_key) WHERE idempotency_key != '';
  `);
  // Conversation engine pin + state version (additive; never rewrite business tables).
  const cols = db
    .prepare(`PRAGMA table_info(concierge_conversations)`)
    .all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("engine")) {
    db.exec(`ALTER TABLE concierge_conversations ADD COLUMN engine TEXT NOT NULL DEFAULT ''`);
  }
  if (!names.has("state_version")) {
    db.exec(`ALTER TABLE concierge_conversations ADD COLUMN state_version INTEGER NOT NULL DEFAULT 0`);
  }
  ensured = true;
}

function nowIso() {
  return new Date().toISOString();
}

export function createTurn(input: {
  conversationId: string;
  userText: string;
  engine: "legacy" | "n8n";
  idempotencyKey?: string;
  messageId?: string;
}): ConciergeTurnRecord {
  ensureConciergeTurnTables();
  const db = getHomesteadDb();
  const key = (input.idempotencyKey || "").trim();
  if (key) {
    const existing = db
      .prepare(`SELECT * FROM concierge_turns WHERE idempotency_key = ?`)
      .get(key) as Record<string, unknown> | undefined;
    if (existing) return rowToTurn(existing);
  }
  const turnId = randomUUID();
  const messageId = input.messageId || randomUUID();
  const at = nowIso();
  const versionRow = db
    .prepare(`SELECT COALESCE(state_version, 0) AS v FROM concierge_conversations WHERE id = ?`)
    .get(input.conversationId) as { v: number } | undefined;
  const stateVersion = Number(versionRow?.v || 0);
  db.prepare(
    `INSERT INTO concierge_turns (
      turn_id, conversation_id, message_id, engine, status, state_version,
      user_text, reply_json, error_code, idempotency_key, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, 'ACCEPTED', ?, ?, '', '', ?, ?, ?, '')`,
  ).run(
    turnId,
    input.conversationId,
    messageId,
    input.engine,
    stateVersion,
    input.userText,
    key,
    at,
    at,
  );
  return {
    turnId,
    conversationId: input.conversationId,
    messageId,
    engine: input.engine,
    status: "ACCEPTED",
    stateVersion,
    userText: input.userText,
    replyJson: "",
    errorCode: "",
    idempotencyKey: key,
    createdAt: at,
    updatedAt: at,
    completedAt: "",
  };
}

function rowToTurn(row: Record<string, unknown>): ConciergeTurnRecord {
  return {
    turnId: String(row.turn_id || ""),
    conversationId: String(row.conversation_id || ""),
    messageId: String(row.message_id || ""),
    engine: row.engine === "n8n" ? "n8n" : "legacy",
    status: String(row.status || "ACCEPTED") as TurnStatus,
    stateVersion: Number(row.state_version || 0),
    userText: String(row.user_text || ""),
    replyJson: String(row.reply_json || ""),
    errorCode: String(row.error_code || ""),
    idempotencyKey: String(row.idempotency_key || ""),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
    completedAt: String(row.completed_at || ""),
  };
}

export function getTurn(turnId: string): ConciergeTurnRecord | null {
  ensureConciergeTurnTables();
  const row = getHomesteadDb()
    .prepare(`SELECT * FROM concierge_turns WHERE turn_id = ?`)
    .get(turnId) as Record<string, unknown> | undefined;
  return row ? rowToTurn(row) : null;
}

export function updateTurn(
  turnId: string,
  patch: Partial<{
    status: TurnStatus;
    replyJson: string;
    errorCode: string;
    stateVersion: number;
    completed: boolean;
  }>,
) {
  ensureConciergeTurnTables();
  const db = getHomesteadDb();
  const current = getTurn(turnId);
  if (!current) return null;
  const at = nowIso();
  const status = patch.status || current.status;
  const replyJson = patch.replyJson !== undefined ? patch.replyJson : current.replyJson;
  const errorCode = patch.errorCode !== undefined ? patch.errorCode : current.errorCode;
  const stateVersion = patch.stateVersion !== undefined ? patch.stateVersion : current.stateVersion;
  const completedAt = patch.completed ? at : current.completedAt;
  db.prepare(
    `UPDATE concierge_turns
     SET status = ?, reply_json = ?, error_code = ?, state_version = ?, updated_at = ?, completed_at = ?
     WHERE turn_id = ?`,
  ).run(status, replyJson, errorCode, stateVersion, at, completedAt, turnId);
  return getTurn(turnId);
}

export function bumpConversationStateVersion(conversationId: string): number {
  ensureConciergeTurnTables();
  const db = getHomesteadDb();
  db.prepare(
    `UPDATE concierge_conversations
     SET state_version = COALESCE(state_version, 0) + 1, updated_at = ?
     WHERE id = ?`,
  ).run(nowIso(), conversationId);
  const row = db
    .prepare(`SELECT COALESCE(state_version, 0) AS v FROM concierge_conversations WHERE id = ?`)
    .get(conversationId) as { v: number } | undefined;
  return Number(row?.v || 0);
}

export function pinConversationEngine(conversationId: string, engine: "legacy" | "n8n") {
  ensureConciergeTurnTables();
  const db = getHomesteadDb();
  const row = db
    .prepare(`SELECT engine FROM concierge_conversations WHERE id = ?`)
    .get(conversationId) as { engine: string } | undefined;
  const pinned = String(row?.engine || "").trim();
  if (pinned && pinned !== engine) {
    return { ok: false as const, pinned: pinned as "legacy" | "n8n", reason: "engine_pinned" };
  }
  if (!pinned) {
    db.prepare(`UPDATE concierge_conversations SET engine = ? WHERE id = ?`).run(engine, conversationId);
  }
  return { ok: true as const, pinned: (pinned || engine) as "legacy" | "n8n" };
}

export function getConversationEngine(conversationId: string): "legacy" | "n8n" | "" {
  ensureConciergeTurnTables();
  const row = getHomesteadDb()
    .prepare(`SELECT engine FROM concierge_conversations WHERE id = ?`)
    .get(conversationId) as { engine: string } | undefined;
  const e = String(row?.engine || "").trim();
  if (e === "n8n" || e === "legacy") return e;
  return "";
}

/** True when the conversation already has transcript or lead work — keep legacy on n8n rollout. */
export function conversationHasPriorWork(conversationId: string): boolean {
  ensureConciergeTurnTables();
  const db = getHomesteadDb();
  const msg = db
    .prepare(`SELECT COUNT(*) AS n FROM concierge_messages WHERE conversation_id = ?`)
    .get(conversationId) as { n: number } | undefined;
  if (Number(msg?.n || 0) > 0) return true;
  const conv = db
    .prepare(`SELECT lead_public_id, state_json FROM concierge_conversations WHERE id = ?`)
    .get(conversationId) as { lead_public_id?: string; state_json?: string } | undefined;
  if (!conv) return false;
  if (String(conv.lead_public_id || "").trim()) return true;
  try {
    const state = JSON.parse(conv.state_json || "{}") as Record<string, unknown>;
    if (state.activeLeadId || state.primaryService || state.service || state.problem) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Pin once per conversation. Existing unpinned chats stay on legacy when desired=n8n
 * so flipping the global flag does not migrate in-flight customers mid-thread.
 */
export function resolveAndPinConversationEngine(
  conversationId: string,
  desired: "legacy" | "n8n",
): "legacy" | "n8n" {
  const pinned = getConversationEngine(conversationId);
  if (pinned) return pinned;
  const choose =
    desired === "n8n" && conversationHasPriorWork(conversationId) ? "legacy" : desired;
  pinConversationEngine(conversationId, choose);
  return choose;
}

/** Drop stale in-flight results when a newer turn for the same conversation completed. */
export function shouldAcceptTurnResult(turnId: string): boolean {
  const turn = getTurn(turnId);
  if (!turn) return false;
  if (turn.status === "SUPERSEDED" || turn.status === "TIMED_OUT") return false;
  const newer = getHomesteadDb()
    .prepare(
      `SELECT turn_id FROM concierge_turns
       WHERE conversation_id = ? AND created_at > ? AND status = 'DONE'
       LIMIT 1`,
    )
    .get(turn.conversationId, turn.createdAt) as { turn_id: string } | undefined;
  return !newer;
}
