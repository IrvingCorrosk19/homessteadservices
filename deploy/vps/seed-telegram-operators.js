const Database = require("better-sqlite3");
const db = new Database("/app/data/homestead.sqlite");
console.log("INTEGRITY=" + db.pragma("integrity_check", { simple: true }));
const now = new Date().toISOString();
db.exec(`
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
  CREATE INDEX IF NOT EXISTS idx_telegram_operators_active ON telegram_operators (is_active, role);
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
  CREATE TABLE IF NOT EXISTS telegram_operator_metrics (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
`);
for (const key of [
  "active_telegram_operators",
  "pending_telegram_operators",
  "telegram_delivery_success",
  "telegram_delivery_failure",
  "telegram_permission_denied",
  "telegram_stale_callback",
]) {
  db.prepare(
    "INSERT OR IGNORE INTO telegram_operator_metrics (key, value, updated_at) VALUES (?, 0, ?)",
  ).run(key, now);
}
const ids = [
  ...(process.env.HOMESTEAD_TELEGRAM_ADMIN_CHAT_IDS || "").split(/[,\s]+/),
  process.env.HOMESTEAD_TELEGRAM_CHAT_ID || "",
]
  .map((x) => x.trim())
  .filter(Boolean);
let seeded = 0;
for (const id of [...new Set(ids)]) {
  const row = db
    .prepare("SELECT id FROM telegram_operators WHERE telegram_user_id = ? OR telegram_chat_id = ?")
    .get(id, id);
  if (row) continue;
  db.prepare(
    `INSERT INTO telegram_operators (
      telegram_user_id, telegram_chat_id, display_name, role, is_active,
      notify_requests, notify_appointments, notify_leads, notify_sla, notify_content, notify_daily_brief,
      created_at, updated_at, approved_at
    ) VALUES (?, ?, ?, 'OWNER', 1, 1, 1, 1, 1, 1, 1, ?, ?, ?)`,
  ).run(id, id, "Owner", now, now, now);
  seeded += 1;
}
console.log("SEEDED=" + seeded);
console.log(
  "OPS=" +
    JSON.stringify(
      db.prepare("SELECT role, is_active, COUNT(*) AS n FROM telegram_operators GROUP BY role, is_active").all(),
    ),
);
console.log(
  "OWNER_ACTIVE=" +
    db.prepare("SELECT COUNT(*) AS c FROM telegram_operators WHERE role='OWNER' AND is_active=1").get().c,
);
console.log(
  "PENDING=" + db.prepare("SELECT COUNT(*) AS c FROM telegram_operators WHERE role='PENDING'").get().c,
);
