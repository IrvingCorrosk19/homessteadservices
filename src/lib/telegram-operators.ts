/**
 * Telegram operator identity + RBAC.
 * Bot token is NOT identity. telegram_user_id is.
 */
import type Database from "better-sqlite3";
import { getHomesteadDb } from "@/lib/service-requests";
import { logInfo, logError } from "@/lib/log";

export type TelegramRole = "OWNER" | "ADMIN" | "PENDING" | "SALES" | "CONTENT" | "TECHNICIAN";

export type TelegramPermission =
  | "dashboard.read"
  | "requests.read"
  | "requests.manage"
  | "appointments.read"
  | "appointments.manage"
  | "leads.read"
  | "leads.manage"
  | "content.read"
  | "content.approve"
  | "jobs.read"
  | "jobs.manage"
  | "operators.read"
  | "operators.manage"
  | "operators.promote_owner";

export type NotifyPref =
  | "notify_requests"
  | "notify_appointments"
  | "notify_leads"
  | "notify_sla"
  | "notify_content"
  | "notify_daily_brief";

export type TelegramOperator = {
  id: number;
  telegramUserId: string;
  telegramChatId: string;
  displayName: string;
  role: TelegramRole;
  isActive: boolean;
  notifyRequests: boolean;
  notifyAppointments: boolean;
  notifyLeads: boolean;
  notifySla: boolean;
  notifyContent: boolean;
  notifyDailyBrief: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
  approvedAt: string | null;
  approvedByOperatorId: number | null;
  deactivatedAt: string | null;
};

const ROLE_PERMISSIONS: Record<TelegramRole, ReadonlySet<TelegramPermission>> = {
  OWNER: new Set([
    "dashboard.read",
    "requests.read",
    "requests.manage",
    "appointments.read",
    "appointments.manage",
    "leads.read",
    "leads.manage",
    "content.read",
    "content.approve",
    "jobs.read",
    "jobs.manage",
    "operators.read",
    "operators.manage",
    "operators.promote_owner",
  ]),
  ADMIN: new Set([
    "dashboard.read",
    "requests.read",
    "requests.manage",
    "appointments.read",
    "appointments.manage",
    "leads.read",
    "leads.manage",
    "content.read",
    "content.approve",
    "jobs.read",
    "jobs.manage",
    "operators.read",
  ]),
  SALES: new Set([
    "dashboard.read",
    "requests.read",
    "requests.manage",
    "appointments.read",
    "appointments.manage",
    "leads.read",
    "leads.manage",
  ]),
  CONTENT: new Set(["dashboard.read", "content.read", "content.approve"]),
  TECHNICIAN: new Set(["dashboard.read", "jobs.read", "jobs.manage", "appointments.read"]),
  PENDING: new Set(),
};

const METRIC_KEYS = [
  "active_telegram_operators",
  "pending_telegram_operators",
  "telegram_delivery_success",
  "telegram_delivery_failure",
  "telegram_permission_denied",
  "telegram_stale_callback",
] as const;

export type TelegramMetric = (typeof METRIC_KEYS)[number];

type OperatorRow = {
  id: number;
  telegram_user_id: string;
  telegram_chat_id: string;
  display_name: string;
  role: string;
  is_active: number;
  notify_requests: number;
  notify_appointments: number;
  notify_leads: number;
  notify_sla: number;
  notify_content: number;
  notify_daily_brief: number;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  approved_at: string | null;
  approved_by_operator_id: number | null;
  deactivated_at: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function defaultsForRole(role: TelegramRole) {
  const active = role === "OWNER" || role === "ADMIN";
  return {
    notify_requests: active ? 1 : 0,
    notify_appointments: active ? 1 : 0,
    notify_leads: active ? 1 : 0,
    notify_sla: active ? 1 : 0,
    notify_content: role === "OWNER" || role === "ADMIN" || role === "CONTENT" ? 1 : 0,
    notify_daily_brief: active ? 1 : 0,
  };
}

function mapRow(row: OperatorRow): TelegramOperator {
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    telegramChatId: row.telegram_chat_id,
    displayName: row.display_name || `Usuario ${row.telegram_user_id.slice(-4)}`,
    role: row.role as TelegramRole,
    isActive: row.is_active === 1,
    notifyRequests: row.notify_requests === 1,
    notifyAppointments: row.notify_appointments === 1,
    notifyLeads: row.notify_leads === 1,
    notifySla: row.notify_sla === 1,
    notifyContent: row.notify_content === 1,
    notifyDailyBrief: row.notify_daily_brief === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    approvedAt: row.approved_at,
    approvedByOperatorId: row.approved_by_operator_id,
    deactivatedAt: row.deactivated_at,
  };
}

export function migrateTelegramOperators(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS telegram_operators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id TEXT NOT NULL UNIQUE,
      telegram_chat_id TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'PENDING',
      is_active INTEGER NOT NULL DEFAULT 0,
      notify_requests INTEGER NOT NULL DEFAULT 0,
      notify_appointments INTEGER NOT NULL DEFAULT 0,
      notify_leads INTEGER NOT NULL DEFAULT 0,
      notify_sla INTEGER NOT NULL DEFAULT 0,
      notify_content INTEGER NOT NULL DEFAULT 0,
      notify_daily_brief INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT,
      approved_at TEXT,
      approved_by_operator_id INTEGER,
      deactivated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_telegram_operators_active
      ON telegram_operators (is_active, role);
    CREATE INDEX IF NOT EXISTS idx_telegram_operators_chat
      ON telegram_operators (telegram_chat_id);
    CREATE TABLE IF NOT EXISTS telegram_operator_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operator_id INTEGER,
      telegram_user_id TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_telegram_operator_audit_entity
      ON telegram_operator_audit (entity_type, entity_id, created_at);
    CREATE TABLE IF NOT EXISTS telegram_operator_metrics (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
  for (const key of METRIC_KEYS) {
    database
      .prepare(
        "INSERT OR IGNORE INTO telegram_operator_metrics (key, value, updated_at) VALUES (?, 0, ?)",
      )
      .run(key, nowIso());
  }
  bootstrapOperatorsFromEnv(database);
}

function envAllowlistIds() {
  const admin = (process.env.HOMESTEAD_TELEGRAM_ADMIN_CHAT_IDS || "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const primary = (process.env.HOMESTEAD_TELEGRAM_CHAT_ID || "").trim();
  const ids = [...admin];
  if (primary && !ids.includes(primary)) ids.push(primary);
  return ids;
}

/** Migrate legacy env allowlist into OWNER rows without revoking access. */
export function bootstrapOperatorsFromEnv(database: Database.Database = getHomesteadDb()) {
  const ids = envAllowlistIds();
  if (!ids.length) return { seeded: 0 };
  const now = nowIso();
  let seeded = 0;
  const existing = database.prepare("SELECT COUNT(*) AS c FROM telegram_operators WHERE role = 'OWNER' AND is_active = 1").get() as {
    c: number;
  };
  for (const id of ids) {
    const row = database
      .prepare("SELECT id, role, is_active FROM telegram_operators WHERE telegram_user_id = ? OR telegram_chat_id = ?")
      .get(id, id) as { id: number; role: string; is_active: number } | undefined;
    if (row) continue;
    const prefs = defaultsForRole("OWNER");
    database
      .prepare(
        `INSERT INTO telegram_operators (
          telegram_user_id, telegram_chat_id, display_name, role, is_active,
          notify_requests, notify_appointments, notify_leads, notify_sla, notify_content, notify_daily_brief,
          created_at, updated_at, approved_at
        ) VALUES (?, ?, ?, 'OWNER', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        id,
        existing.c === 0 && seeded === 0 ? "Owner" : `Operator ${id.slice(-4)}`,
        prefs.notify_requests,
        prefs.notify_appointments,
        prefs.notify_leads,
        prefs.notify_sla,
        prefs.notify_content,
        prefs.notify_daily_brief,
        now,
        now,
        now,
      );
    seeded += 1;
  }
  if (seeded) logInfo("TelegramOperatorsBootstrapped", { stage: "env", attempt: seeded });
  return { seeded };
}

export function hasTelegramPermission(
  operator: TelegramOperator | null | undefined,
  permission: TelegramPermission,
): boolean {
  if (!operator || !operator.isActive) return false;
  if (operator.role === "PENDING") return false;
  const set = ROLE_PERMISSIONS[operator.role];
  if (!set) return false;
  return set.has(permission);
}

export function incrementTelegramMetric(key: TelegramMetric, by = 1) {
  try {
    getHomesteadDb()
      .prepare(
        "UPDATE telegram_operator_metrics SET value = value + ?, updated_at = ? WHERE key = ?",
      )
      .run(by, nowIso(), key);
  } catch {
    /* metrics must never break auth */
  }
}

export function getTelegramMetric(key: TelegramMetric) {
  const row = getHomesteadDb()
    .prepare("SELECT value FROM telegram_operator_metrics WHERE key = ?")
    .get(key) as { value: number } | undefined;
  return row?.value ?? 0;
}

export function refreshOperatorCountMetrics() {
  const db = getHomesteadDb();
  const active = (
    db.prepare("SELECT COUNT(*) AS c FROM telegram_operators WHERE is_active = 1 AND role != 'PENDING'").get() as {
      c: number;
    }
  ).c;
  const pending = (
    db.prepare("SELECT COUNT(*) AS c FROM telegram_operators WHERE role = 'PENDING'").get() as { c: number }
  ).c;
  const now = nowIso();
  db.prepare("UPDATE telegram_operator_metrics SET value = ?, updated_at = ? WHERE key = ?").run(
    active,
    now,
    "active_telegram_operators",
  );
  db.prepare("UPDATE telegram_operator_metrics SET value = ?, updated_at = ? WHERE key = ?").run(
    pending,
    now,
    "pending_telegram_operators",
  );
}

export function recordTelegramOperatorAudit(input: {
  operator?: TelegramOperator | null;
  telegramUserId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  result?: string;
  detail?: string;
}) {
  getHomesteadDb()
    .prepare(
      `INSERT INTO telegram_operator_audit
        (operator_id, telegram_user_id, role, action, entity_type, entity_id, result, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.operator?.id ?? null,
      (input.operator?.telegramUserId || input.telegramUserId || "").slice(0, 40),
      input.operator?.role || "",
      input.action.slice(0, 80),
      (input.entityType || "").slice(0, 40),
      (input.entityId || "").slice(0, 80),
      (input.result || "").slice(0, 40),
      (input.detail || "").slice(0, 180),
      nowIso(),
    );
}

export function actorLabel(operator: TelegramOperator | null | undefined) {
  if (!operator) return "telegram";
  return `op:${operator.id}:${operator.role}`.slice(0, 40);
}

export function getOperatorByUserId(telegramUserId: string) {
  bootstrapOperatorsFromEnv();
  const row = getHomesteadDb()
    .prepare("SELECT * FROM telegram_operators WHERE telegram_user_id = ?")
    .get(String(telegramUserId)) as OperatorRow | undefined;
  return row ? mapRow(row) : null;
}

export function getOperatorByChatId(telegramChatId: string) {
  bootstrapOperatorsFromEnv();
  const row = getHomesteadDb()
    .prepare(
      "SELECT * FROM telegram_operators WHERE telegram_chat_id = ? OR telegram_user_id = ? ORDER BY is_active DESC, id ASC LIMIT 1",
    )
    .get(String(telegramChatId), String(telegramChatId)) as OperatorRow | undefined;
  return row ? mapRow(row) : null;
}

export function resolveTelegramOperator(userId: string | number, chatId: string | number) {
  bootstrapOperatorsFromEnv();
  const uid = String(userId);
  const cid = String(chatId);
  let op = getOperatorByUserId(uid);
  if (!op && cid !== uid) op = getOperatorByChatId(cid);
  return op;
}

export function touchOperatorSeen(operatorId: number, chatId?: string) {
  const now = nowIso();
  if (chatId) {
    getHomesteadDb()
      .prepare("UPDATE telegram_operators SET last_seen_at = ?, telegram_chat_id = ?, updated_at = ? WHERE id = ?")
      .run(now, String(chatId), now, operatorId);
  } else {
    getHomesteadDb()
      .prepare("UPDATE telegram_operators SET last_seen_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, operatorId);
  }
}

export function listOperators(options: { includeInactive?: boolean } = {}) {
  bootstrapOperatorsFromEnv();
  const rows = getHomesteadDb()
    .prepare(
      options.includeInactive
        ? "SELECT * FROM telegram_operators ORDER BY role = 'OWNER' DESC, is_active DESC, id ASC"
        : "SELECT * FROM telegram_operators WHERE is_active = 1 OR role = 'PENDING' ORDER BY role = 'OWNER' DESC, id ASC",
    )
    .all() as OperatorRow[];
  return rows.map(mapRow);
}

export function countActiveOwners() {
  return (
    getHomesteadDb()
      .prepare("SELECT COUNT(*) AS c FROM telegram_operators WHERE role = 'OWNER' AND is_active = 1")
      .get() as { c: number }
  ).c;
}

export function maskTelegramId(id: string) {
  const s = String(id);
  if (s.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

export function registerPendingOperator(input: {
  telegramUserId: string;
  telegramChatId: string;
  displayName?: string;
}) {
  bootstrapOperatorsFromEnv();
  const existing = getOperatorByUserId(input.telegramUserId);
  if (existing) {
    if (input.telegramChatId && existing.telegramChatId !== input.telegramChatId) {
      getHomesteadDb()
        .prepare("UPDATE telegram_operators SET telegram_chat_id = ?, updated_at = ? WHERE id = ?")
        .run(input.telegramChatId, nowIso(), existing.id);
    }
    return { operator: getOperatorByUserId(input.telegramUserId)!, created: false };
  }
  const now = nowIso();
  const name = (input.displayName || "").trim().slice(0, 80) || `Usuario ${input.telegramUserId.slice(-4)}`;
  const prefs = defaultsForRole("PENDING");
  const result = getHomesteadDb()
    .prepare(
      `INSERT INTO telegram_operators (
        telegram_user_id, telegram_chat_id, display_name, role, is_active,
        notify_requests, notify_appointments, notify_leads, notify_sla, notify_content, notify_daily_brief,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'PENDING', 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.telegramUserId,
      input.telegramChatId,
      name,
      prefs.notify_requests,
      prefs.notify_appointments,
      prefs.notify_leads,
      prefs.notify_sla,
      prefs.notify_content,
      prefs.notify_daily_brief,
      now,
      now,
    );
  refreshOperatorCountMetrics();
  recordTelegramOperatorAudit({
    telegramUserId: input.telegramUserId,
    action: "OPERATOR_PENDING_CREATED",
    entityType: "operator",
    entityId: String(result.lastInsertRowid),
    result: "pending",
  });
  return { operator: getOperatorByUserId(input.telegramUserId)!, created: true };
}

export function approveOperator(input: {
  operatorId: number;
  role: "OWNER" | "ADMIN";
  actor: TelegramOperator;
}) {
  if (!hasTelegramPermission(input.actor, "operators.manage")) {
    return { ok: false as const, reason: "forbidden" };
  }
  if (input.role === "OWNER" && !hasTelegramPermission(input.actor, "operators.promote_owner")) {
    return { ok: false as const, reason: "owner_only" };
  }
  const target = getHomesteadDb()
    .prepare("SELECT * FROM telegram_operators WHERE id = ?")
    .get(input.operatorId) as OperatorRow | undefined;
  if (!target) return { ok: false as const, reason: "missing" };
  const prefs = defaultsForRole(input.role);
  const now = nowIso();
  getHomesteadDb()
    .prepare(
      `UPDATE telegram_operators SET
        role = ?, is_active = 1, approved_at = ?, approved_by_operator_id = ?, deactivated_at = NULL,
        notify_requests = ?, notify_appointments = ?, notify_leads = ?, notify_sla = ?,
        notify_content = ?, notify_daily_brief = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.role,
      now,
      input.actor.id,
      prefs.notify_requests,
      prefs.notify_appointments,
      prefs.notify_leads,
      prefs.notify_sla,
      prefs.notify_content,
      prefs.notify_daily_brief,
      now,
      input.operatorId,
    );
  refreshOperatorCountMetrics();
  recordTelegramOperatorAudit({
    operator: input.actor,
    action: "OPERATOR_APPROVED",
    entityType: "operator",
    entityId: String(input.operatorId),
    result: "ok",
    detail: input.role,
  });
  return { ok: true as const, operator: getOperatorByUserId(target.telegram_user_id)! };
}

export function rejectOperator(input: { operatorId: number; actor: TelegramOperator }) {
  if (!hasTelegramPermission(input.actor, "operators.manage")) {
    return { ok: false as const, reason: "forbidden" };
  }
  const target = getHomesteadDb()
    .prepare("SELECT * FROM telegram_operators WHERE id = ?")
    .get(input.operatorId) as OperatorRow | undefined;
  if (!target) return { ok: false as const, reason: "missing" };
  const now = nowIso();
  getHomesteadDb()
    .prepare(
      `UPDATE telegram_operators SET role = 'PENDING', is_active = 0, deactivated_at = ?, updated_at = ? WHERE id = ?`,
    )
    .run(now, now, input.operatorId);
  refreshOperatorCountMetrics();
  recordTelegramOperatorAudit({
    operator: input.actor,
    action: "OPERATOR_REJECTED",
    entityType: "operator",
    entityId: String(input.operatorId),
    result: "rejected",
  });
  return { ok: true as const };
}

export function deactivateOperator(input: { operatorId: number; actor: TelegramOperator }) {
  if (!hasTelegramPermission(input.actor, "operators.manage")) {
    return { ok: false as const, reason: "forbidden" };
  }
  const target = getHomesteadDb()
    .prepare("SELECT * FROM telegram_operators WHERE id = ?")
    .get(input.operatorId) as OperatorRow | undefined;
  if (!target) return { ok: false as const, reason: "missing" };
  if (target.role === "OWNER" && target.is_active === 1 && countActiveOwners() <= 1) {
    return { ok: false as const, reason: "last_owner" };
  }
  const now = nowIso();
  getHomesteadDb()
    .prepare(
      `UPDATE telegram_operators SET is_active = 0, deactivated_at = ?, updated_at = ? WHERE id = ?`,
    )
    .run(now, now, input.operatorId);
  refreshOperatorCountMetrics();
  recordTelegramOperatorAudit({
    operator: input.actor,
    action: "OPERATOR_DEACTIVATED",
    entityType: "operator",
    entityId: String(input.operatorId),
    result: "ok",
  });
  return { ok: true as const };
}

export function activateOperator(input: { operatorId: number; actor: TelegramOperator }) {
  if (!hasTelegramPermission(input.actor, "operators.manage")) {
    return { ok: false as const, reason: "forbidden" };
  }
  const target = getHomesteadDb()
    .prepare("SELECT * FROM telegram_operators WHERE id = ?")
    .get(input.operatorId) as OperatorRow | undefined;
  if (!target) return { ok: false as const, reason: "missing" };
  if (target.role === "PENDING") return { ok: false as const, reason: "still_pending" };
  const now = nowIso();
  getHomesteadDb()
    .prepare(`UPDATE telegram_operators SET is_active = 1, deactivated_at = NULL, updated_at = ? WHERE id = ?`)
    .run(now, input.operatorId);
  refreshOperatorCountMetrics();
  recordTelegramOperatorAudit({
    operator: input.actor,
    action: "OPERATOR_ACTIVATED",
    entityType: "operator",
    entityId: String(input.operatorId),
    result: "ok",
  });
  return { ok: true as const };
}

export function setOperatorRole(input: {
  operatorId: number;
  role: "OWNER" | "ADMIN";
  actor: TelegramOperator;
}) {
  if (!hasTelegramPermission(input.actor, "operators.manage")) {
    return { ok: false as const, reason: "forbidden" };
  }
  if (input.role === "OWNER" && !hasTelegramPermission(input.actor, "operators.promote_owner")) {
    return { ok: false as const, reason: "owner_only" };
  }
  const target = getHomesteadDb()
    .prepare("SELECT * FROM telegram_operators WHERE id = ?")
    .get(input.operatorId) as OperatorRow | undefined;
  if (!target) return { ok: false as const, reason: "missing" };
  if (
    target.role === "OWNER" &&
    input.role !== "OWNER" &&
    target.is_active === 1 &&
    countActiveOwners() <= 1
  ) {
    return { ok: false as const, reason: "last_owner" };
  }
  const now = nowIso();
  getHomesteadDb()
    .prepare(`UPDATE telegram_operators SET role = ?, updated_at = ? WHERE id = ?`)
    .run(input.role, now, input.operatorId);
  recordTelegramOperatorAudit({
    operator: input.actor,
    action: "OPERATOR_ROLE_CHANGED",
    entityType: "operator",
    entityId: String(input.operatorId),
    result: "ok",
    detail: `${target.role}->${input.role}`,
  });
  return { ok: true as const };
}

export function updateOperatorNotifyPrefs(
  operatorId: number,
  prefs: Partial<Record<NotifyPref, boolean>>,
  actor?: TelegramOperator | null,
) {
  const current = getHomesteadDb()
    .prepare("SELECT * FROM telegram_operators WHERE id = ?")
    .get(operatorId) as OperatorRow | undefined;
  if (!current) return { ok: false as const, reason: "missing" };
  const now = nowIso();
  getHomesteadDb()
    .prepare(
      `UPDATE telegram_operators SET
        notify_requests = ?, notify_appointments = ?, notify_leads = ?, notify_sla = ?,
        notify_content = ?, notify_daily_brief = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      prefs.notify_requests === undefined ? current.notify_requests : prefs.notify_requests ? 1 : 0,
      prefs.notify_appointments === undefined
        ? current.notify_appointments
        : prefs.notify_appointments
          ? 1
          : 0,
      prefs.notify_leads === undefined ? current.notify_leads : prefs.notify_leads ? 1 : 0,
      prefs.notify_sla === undefined ? current.notify_sla : prefs.notify_sla ? 1 : 0,
      prefs.notify_content === undefined ? current.notify_content : prefs.notify_content ? 1 : 0,
      prefs.notify_daily_brief === undefined
        ? current.notify_daily_brief
        : prefs.notify_daily_brief
          ? 1
          : 0,
      now,
      operatorId,
    );
  if (actor) {
    recordTelegramOperatorAudit({
      operator: actor,
      action: "OPERATOR_PREFS_UPDATED",
      entityType: "operator",
      entityId: String(operatorId),
      result: "ok",
    });
  }
  return { ok: true as const };
}

export type DeliveryKind =
  | "requests"
  | "appointments"
  | "leads"
  | "sla"
  | "content"
  | "daily_brief"
  | "jobs"
  | "recovery";

function prefForKind(op: TelegramOperator, kind: DeliveryKind) {
  switch (kind) {
    case "requests":
      return op.notifyRequests;
    case "appointments":
      return op.notifyAppointments;
    case "leads":
      return op.notifyLeads;
    case "sla":
      return op.notifySla;
    case "content":
      return op.notifyContent;
    case "daily_brief":
      return op.notifyDailyBrief;
    case "jobs":
    case "recovery":
      return op.notifyRequests || op.notifyLeads;
    default:
      return false;
  }
}

function permissionForKind(kind: DeliveryKind): TelegramPermission {
  switch (kind) {
    case "requests":
    case "sla":
    case "recovery":
      return "requests.read";
    case "appointments":
      return "appointments.read";
    case "leads":
      return "leads.read";
    case "content":
      return "content.read";
    case "daily_brief":
      return "dashboard.read";
    case "jobs":
      return "jobs.read";
    default:
      return "dashboard.read";
  }
}

/** Active operator chat_ids eligible for a notification kind (fan-out recipients). */
export function eligibleOperatorChatIds(kind: DeliveryKind) {
  bootstrapOperatorsFromEnv();
  const permission = permissionForKind(kind);
  const ops = listOperators({ includeInactive: false }).filter(
    (op) =>
      op.isActive &&
      op.role !== "PENDING" &&
      op.telegramChatId &&
      hasTelegramPermission(op, permission) &&
      prefForKind(op, kind),
  );
  const chats = [...new Set(ops.map((op) => op.telegramChatId))];
  if (chats.length) return chats;
  // Break-glass: env allowlist if DB empty of active delivery targets
  return envAllowlistIds();
}

/**
 * Emergency allowlist (env) remains as bootstrap + break-glass.
 * Authorization for mutations uses DB operators first; env IDs only grant access
 * when no DB row exists yet for that id (bootstrap path) or as last-resort delivery.
 */
export function isEmergencyAllowlisted(userId: string, chatId: string) {
  const allowed = new Set(envAllowlistIds());
  if (!allowed.size) return false;
  return allowed.has(String(userId)) || allowed.has(String(chatId));
}

export function isAuthorizedTelegramOperator(userId: string | number, chatId: string | number) {
  const op = resolveTelegramOperator(userId, chatId);
  if (op?.isActive && op.role !== "PENDING") return true;
  // Transitional break-glass: env allowlist while migration settles
  if (isEmergencyAllowlisted(String(userId), String(chatId))) {
    bootstrapOperatorsFromEnv();
    const again = resolveTelegramOperator(userId, chatId);
    return Boolean(again?.isActive && again.role !== "PENDING");
  }
  return false;
}

export function requireOperatorPermission(
  userId: string | number,
  chatId: string | number,
  permission: TelegramPermission,
) {
  const op = resolveTelegramOperator(userId, chatId);
  if (!op || !op.isActive || op.role === "PENDING") {
    incrementTelegramMetric("telegram_permission_denied");
    return { ok: false as const, operator: op, reason: "unauthorized" as const };
  }
  if (!hasTelegramPermission(op, permission)) {
    incrementTelegramMetric("telegram_permission_denied");
    recordTelegramOperatorAudit({
      operator: op,
      action: "PERMISSION_DENIED",
      result: "denied",
      detail: permission,
    });
    return { ok: false as const, operator: op, reason: "forbidden" as const };
  }
  return { ok: true as const, operator: op };
}

export function listOwnersForNotify() {
  return listOperators({ includeInactive: false }).filter(
    (op) => op.isActive && op.role === "OWNER" && hasTelegramPermission(op, "operators.manage"),
  );
}

export function getOperatorById(id: number) {
  const row = getHomesteadDb()
    .prepare("SELECT * FROM telegram_operators WHERE id = ?")
    .get(id) as OperatorRow | undefined;
  return row ? mapRow(row) : null;
}

export function ensureTelegramOperatorsReady() {
  try {
    bootstrapOperatorsFromEnv();
    refreshOperatorCountMetrics();
  } catch (error) {
    logError("TelegramOperatorsBootstrapFailed", {
      stage: error instanceof Error ? error.message.slice(0, 80) : "unknown",
    });
  }
}
