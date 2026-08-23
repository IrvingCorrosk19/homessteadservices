import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

let failed = 0;
function check(name, ok) {
  if (!ok) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

const rbacSrc = readFileSync(join(root, "src/lib/telegram-operators.ts"), "utf8");
const handler = readFileSync(join(root, "src/lib/content-handler.ts"), "utf8");
const flow = readFileSync(join(root, "src/lib/telegram-operator-flow.ts"), "utf8");
const fanout = readFileSync(join(root, "src/lib/telegram-fanout.ts"), "utf8");
const opsTg = readFileSync(join(root, "src/lib/ops-telegram.ts"), "utf8");
const dispatch = readFileSync(join(root, "src/lib/automation-dispatch.ts"), "utf8");

check("single bot webhook path preserved", readFileSync(join(root, "src/lib/content-telegram.ts"), "utf8").includes("homestead-content-studio"));
check("hasTelegramPermission deny default", rbacSrc.includes("hasTelegramPermission") && rbacSrc.includes("PENDING: new Set()"));
check("operator table unique user id", rbacSrc.includes("telegram_user_id TEXT NOT NULL UNIQUE"));
check("last owner protection", rbacSrc.includes("last_owner") && rbacSrc.includes("countActiveOwners"));
check("pending registration", flow.includes("registerPendingOperator") && flow.includes("NUEVO OPERADOR"));
check("start handler", handler.includes("/start") && handler.includes("handleStartCommand"));
check("group chat deny", handler.includes("isPrivateTelegramChat") && handler.includes("group"));
check("gate before command center", handler.includes("gateOperator") && handler.indexOf("gateOperator") < handler.indexOf("sendCommandCenter"));
check("no auto approve pending", !flow.includes("is_active = 1") || flow.includes("approveOperator"));
check("fanout does not create HS", !fanout.includes("saveServiceRequest") && fanout.includes("adminChatIds(\"requests\")"));
check("dispatch calls fanout after n8n", dispatch.includes("fanOutServiceRequestTelegram"));
check("delivery isolation loop", opsTg.includes("telegram_delivery_failure") && opsTg.includes("sent ? { ok: true"));
check("content atomic approve", readFileSync(join(root, "src/lib/content-catalog.ts"), "utf8").includes("tryApproveContentJob"));
check("operators ui callback", opsTg.includes("cc:op:") || opsTg.includes('action === "op"'));
check("config menu", opsTg.includes("Configuración") && opsTg.includes("cc:cfg"));
check("break glass script exists", readFileSync(join(root, "scripts/telegram-break-glass-owner.mjs"), "utf8").includes("BREAK_GLASS_OK"));
check("admin operadores page", readFileSync(join(root, "src/app/admin/configuracion/operadores/page.tsx"), "utf8").includes("Operadores"));

const dir = mkdtempSync(join(tmpdir(), "hs-multi-op-"));
process.env.DATA_DIR = dir;
process.env.HOMESTEAD_TELEGRAM_ADMIN_CHAT_IDS = "111111111";
process.env.HOMESTEAD_TELEGRAM_CHAT_ID = "111111111";

// Dynamic import of compiled TS is not available; exercise SQL migration logic via sqlite mirror of migrateTelegramOperators
const db = new Database(join(dir, "homestead.sqlite"));
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
`);
const now = new Date().toISOString();
db.prepare(
  `INSERT INTO telegram_operators (telegram_user_id, telegram_chat_id, display_name, role, is_active,
    notify_requests, notify_appointments, notify_leads, notify_sla, notify_content, notify_daily_brief,
    created_at, updated_at, approved_at) VALUES (?,?,?,?,1,1,1,1,1,1,1,?,?,?)`,
).run("111111111", "111111111", "Owner", "OWNER", now, now, now);
db.prepare(
  `INSERT INTO telegram_operators (telegram_user_id, telegram_chat_id, display_name, role, is_active,
    notify_requests, notify_appointments, notify_leads, notify_sla, notify_content, notify_daily_brief,
    created_at, updated_at) VALUES (?,?,?,?,0,0,0,0,0,0,0,?,?)`,
).run("222222222", "222222222", "Pending User", "PENDING", now, now);

const owners = db.prepare("SELECT COUNT(*) AS c FROM telegram_operators WHERE role='OWNER' AND is_active=1").get().c;
check("seed owner count", owners === 1);
const pending = db.prepare("SELECT COUNT(*) AS c FROM telegram_operators WHERE role='PENDING'").get().c;
check("pending count", pending === 1);

// last owner cannot deactivate
const onlyOwner = db.prepare("SELECT id FROM telegram_operators WHERE role='OWNER'").get();
const activeOwners = () =>
  db.prepare("SELECT COUNT(*) AS c FROM telegram_operators WHERE role='OWNER' AND is_active=1").get().c;
function tryDeactivate(id) {
  const row = db.prepare("SELECT role, is_active FROM telegram_operators WHERE id=?").get(id);
  if (row.role === "OWNER" && row.is_active === 1 && activeOwners() <= 1) return false;
  db.prepare("UPDATE telegram_operators SET is_active=0 WHERE id=?").run(id);
  return true;
}
check("last owner deactivate denied", tryDeactivate(onlyOwner.id) === false);

// approve pending as ADMIN
db.prepare(
  `UPDATE telegram_operators SET role='ADMIN', is_active=1, approved_at=?, notify_requests=1, notify_appointments=1,
    notify_leads=1, notify_sla=1, notify_content=1, notify_daily_brief=1 WHERE telegram_user_id='222222222'`,
).run(now);
check("second operator active", db.prepare("SELECT is_active FROM telegram_operators WHERE telegram_user_id='222222222'").get().is_active === 1);

// permission matrix (logic mirror)
const ROLE_PERMS = {
  OWNER: new Set(["operators.manage", "operators.promote_owner", "requests.manage", "content.approve"]),
  ADMIN: new Set(["operators.read", "requests.manage", "content.approve"]),
  PENDING: new Set(),
};
function hasPerm(role, perm) {
  return ROLE_PERMS[role]?.has(perm) || false;
}
check("deny default pending", !hasPerm("PENDING", "requests.manage"));
check("admin cannot promote owner", !hasPerm("ADMIN", "operators.promote_owner"));
check("owner can promote", hasPerm("OWNER", "operators.promote_owner"));

// content race via SQL
db.exec(`CREATE TABLE content_jobs (public_id TEXT PRIMARY KEY, status TEXT, approved_at TEXT, updated_at TEXT)`);
db.prepare("INSERT INTO content_jobs VALUES ('CS-1','READY_FOR_REVIEW',NULL,?)").run(now);
function tryApprove(id) {
  const r = db.prepare(
    `UPDATE content_jobs SET status='APPROVED', approved_at=?, updated_at=? WHERE public_id=? AND status IN ('READY_FOR_REVIEW','AWAITING_APPROVAL')`,
  ).run(now, now, id);
  return r.changes === 1;
}
check("content first approve wins", tryApprove("CS-1") === true);
check("content second approve loses", tryApprove("CS-1") === false);

writeFileSync(join(dir, "note.txt"), "multi-op unit ok");
const bg = spawnSync(
  process.execPath,
  [join(root, "scripts/telegram-break-glass-owner.mjs"), "333333333", "Rescue"],
  { env: { ...process.env, DATA_DIR: dir }, encoding: "utf8" },
);
check("break glass exit 0", bg.status === 0);
check("break glass inserted", String(bg.stdout).includes("BREAK_GLASS_OK"));

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log("ALL_PASS telegram-multi-operator");
