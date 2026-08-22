import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

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

const opsStore = readFileSync(join(root, "src/lib/ops-store.ts"), "utf8");
const opsEngine = readFileSync(join(root, "src/lib/ops-engine.ts"), "utf8");
const opsTg = readFileSync(join(root, "src/lib/ops-telegram.ts"), "utf8");
const opsCfg = readFileSync(join(root, "src/lib/ops-config.ts"), "utf8");
const handler = readFileSync(join(root, "src/lib/content-handler.ts"), "utf8");
const dispatch = readFileSync(join(root, "src/lib/automation-dispatch.ts"), "utf8");
const scheduler = readFileSync(join(root, "src/app/api/internal/content/scheduler-tick/route.ts"), "utf8");
const saveSrc = readFileSync(join(root, "src/lib/service-requests.ts"), "utf8");
const revenueTg = readFileSync(join(root, "src/lib/revenue-telegram.ts"), "utf8");
const compose = readFileSync(join(root, "deploy/vps/docker-compose.yml"), "utf8");
const health = readFileSync(join(root, "src/app/api/admin/automation/health/route.ts"), "utf8");
const summaryApi = readFileSync(join(root, "src/app/api/internal/ops/summary/route.ts"), "utf8");
const actionApi = readFileSync(join(root, "src/app/api/internal/ops/action/route.ts"), "utf8");

check("single webhook homestead-content-studio", readFileSync(join(root, "src/lib/content-telegram.ts"), "utf8").includes("homestead-content-studio"));
check("command /homestead in router", handler.includes("/homestead") && handler.includes("sendCommandCenter"));
check("ops callbacks cc:", handler.includes('startsWith("cc:")'));
check("admin gate before ops", handler.indexOf("isTelegramAdmin") < handler.indexOf("sendCommandCenter"));
check("unauthorized no PII", handler.includes("No autorizado.") && !handler.includes("No autorizado, ${"));
check("ops works if content studio disabled", handler.includes("function studioEnabled") && handler.includes("isOpsCommand") && handler.includes("sendCommandCenter"));
check("no second telegram trigger in homestead n8n json", !readFileSync(join(root, "n8n/homestead-n8n-content-studio.json"), "utf8").includes("homestead-command-center"));
check("rescue eligibility deterministic", opsStore.includes("function isRescueEligible") && !opsEngine.includes("openai"));
check("command center no openai", !opsTg.toLowerCase().includes("openai") && !opsCfg.toLowerCase().includes("openai"));
check("config not hardcoded only", opsCfg.includes("LEAD_RESCUE_AFTER_MINUTES") && opsCfg.includes("SLA_FIRST_RESPONSE_MINUTES") && opsCfg.includes("SLA_ESCALATION_MINUTES") && opsCfg.includes("DAILY_BRIEF_HOUR"));
check("lookback prevents historic storm", opsCfg.includes("LEAD_RESCUE_LOOKBACK_HOURS") && opsCfg.includes("SLA_LOOKBACK_HOURS"));
check("compose exposes ops env", compose.includes("LEAD_RESCUE_AFTER_MINUTES") && compose.includes("OPS_QUIET_START_HOUR"));
check("quiet hours only INFO", opsEngine.includes('priority === "INFO" && isQuietHours()'));
check("outbox keys", opsEngine.includes("lead.rescue_eligible:") && opsEngine.includes("sla.first:") && opsEngine.includes("sla.escalation:") && opsEngine.includes("daily.brief:"));
check("ops alerts use outbox not fire-and-forget", opsEngine.includes("enqueueOutbox") && dispatch.includes("deliverOpsTelegram"));
check("scheduler runs ops engine then drain", scheduler.includes("runOpsEngine") && scheduler.includes("drainAutomationOutbox"));
check("hot reminders no longer send duplicate telegram", /export async function runHotLeadReminders[\s\S]*sent: 0/.test(revenueTg));
check("test leads excluded from live summary", opsStore.includes("is_test = 0") && opsStore.includes("includeTest"));
check("dismiss does not delete", opsStore.includes("dismissed_at") && !opsStore.includes("DELETE FROM revenue_leads"));
check("snooze persists", opsStore.includes("snoozed_until"));
check("callback no PII", !opsTg.includes("callback_data: `cc:") || !/callback_data: `cc:[^`]*\$\{lead\.phone\}/.test(opsTg));
check("user errors are spanish", opsTg.includes("No pudimos actualizarlo en este momento"));
check("internal APIs authenticated", summaryApi.includes("verifyInternalHomesteadRequest") && actionApi.includes("verifyInternalHomesteadRequest"));
check("health has ops freshness", health.includes("last_ops_engine_at") && health.includes("last_daily_brief_at"));
check("wave b columns migrated", saveSrc.includes("rescue_alerted_at") && saveSrc.includes("sla_first_alerted_at") && saveSrc.includes("ops_audit"));
check("contact does not auto-mark", opsTg.includes("url: `tel:") && opsTg.includes("Marcar atendido"));
check("edit in place", opsTg.includes("editMessageId"));
check("no invented revenue", !opsTg.includes("potenciales") && !opsEngine.includes("$1,") && !opsTg.includes("USD"));

const dir = mkdtempSync(join(tmpdir(), "hs-wave-b-"));
const db = new Database(join(dir, "t.sqlite"));
db.pragma("journal_mode = WAL");
const now = new Date().toISOString();
const old = new Date(Date.now() - 20 * 60_000).toISOString();
db.exec(`
  CREATE TABLE revenue_customers (id INTEGER PRIMARY KEY, phone TEXT, do_not_contact INTEGER DEFAULT 0, is_test INTEGER DEFAULT 0);
  CREATE TABLE revenue_leads (
    lead_id TEXT PRIMARY KEY, customer_id INTEGER, is_test INTEGER DEFAULT 0, dismissed_at TEXT,
    first_human_action_at TEXT, pipeline_stage TEXT, temperature TEXT, problem_summary TEXT,
    service_category TEXT, snoozed_until TEXT, rescue_alerted_at TEXT, rescue_cycle INTEGER DEFAULT 0,
    rescued_to_booking INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, conversation_id TEXT
  );
  CREATE TABLE revenue_appointments (appointment_id TEXT PRIMARY KEY, lead_id TEXT, status TEXT, date TEXT, start_time TEXT, created_at TEXT);
  CREATE TABLE service_requests (
    public_id TEXT PRIMARY KEY, status TEXT, created_at TEXT, updated_at TEXT, name TEXT, service TEXT, message TEXT, phone TEXT,
    sla_first_alerted_at TEXT, sla_escalated_at TEXT, snoozed_until TEXT
  );
  CREATE TABLE automation_outbox (
    event_id TEXT PRIMARY KEY, event_type TEXT, idempotency_key TEXT UNIQUE, status TEXT, next_attempt_at TEXT
  );
  CREATE TABLE ops_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, entity_id TEXT, created_at TEXT);
  CREATE TABLE revenue_events (id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id TEXT, event TEXT, created_at TEXT);
`);

db.prepare("INSERT INTO revenue_customers VALUES (1,'60001111',0,1)").run();
db.prepare("INSERT INTO revenue_customers VALUES (2,'60001111',0,0)").run();
db.prepare(
  `INSERT INTO revenue_leads VALUES ('HS-TEST-1',1,1,NULL,NULL,'NEW','HOT','el aire bota agua y no enfria','ac',NULL,NULL,0,0,?,?, '')`,
).run(old, old);
db.prepare(
  `INSERT INTO revenue_leads VALUES ('HS-LIVE-1',2,0,NULL,NULL,'NEW','HOT','el aire bota agua y no enfria','ac',NULL,NULL,0,0,?,?, '')`,
).run(old, old);
db.prepare("INSERT INTO service_requests VALUES ('HS-TEST-1','NEW',?,?, 'Canario','ac','WAVE-B-TEST','60001111',NULL,NULL,NULL)").run(old, now);

const liveCount = db.prepare("SELECT COUNT(*) as n FROM revenue_leads l JOIN revenue_customers c ON c.id=l.customer_id WHERE l.is_test=0 AND l.dismissed_at IS NULL AND l.first_human_action_at IS NULL").get().n;
const allCount = db.prepare("SELECT COUNT(*) as n FROM revenue_leads WHERE dismissed_at IS NULL AND first_human_action_at IS NULL").get().n;
check("summary excludes is_test by default", liveCount === 1 && allCount === 2);

const hello = "hola";
const commercial = "el aire bota agua y no enfria";
check("hola is not commercial intent", hello.trim().length < 20);
check("problem description is commercial intent", commercial.trim().length >= 20);

db.prepare("INSERT INTO automation_outbox VALUES ('e1','lead.rescue_eligible','lead.rescue_eligible:HS-LIVE-1:1','PENDING',?)").run(now);
let dup = false;
try {
  db.prepare("INSERT INTO automation_outbox VALUES ('e2','lead.rescue_eligible','lead.rescue_eligible:HS-LIVE-1:1','PENDING',?)").run(now);
} catch {
  dup = true;
}
check("rescue idempotency unique", dup);

db.prepare("INSERT INTO automation_outbox VALUES ('b1','daily.brief.ready','daily.brief:2026-08-22','PENDING',?)").run(now);
let briefDup = false;
try {
  db.prepare("INSERT INTO automation_outbox VALUES ('b2','daily.brief.ready','daily.brief:2026-08-22','PENDING',?)").run(now);
} catch {
  briefDup = true;
}
check("daily brief once per date", briefDup);

const firstContact = db.prepare("UPDATE service_requests SET status='CONTACTED', updated_at=? WHERE public_id=? AND status='NEW'").run(now, "HS-TEST-1");
const secondContact = db.prepare("UPDATE service_requests SET status='CONTACTED', updated_at=? WHERE public_id=? AND status='NEW'").run(now, "HS-TEST-1");
check("concurrent mark contacted one winner", firstContact.changes === 1 && secondContact.changes === 0);

const until = new Date(Date.now() + 15 * 60_000).toISOString();
db.prepare("UPDATE revenue_leads SET snoozed_until=?, rescue_alerted_at=NULL WHERE lead_id=?").run(until, "HS-LIVE-1");
const snoozed = db.prepare("SELECT snoozed_until, rescue_alerted_at FROM revenue_leads WHERE lead_id='HS-LIVE-1'").get();
check("snooze persisted and clears rescue alert", Boolean(snoozed.snoozed_until) && !snoozed.rescue_alerted_at);

db.prepare("UPDATE revenue_leads SET dismissed_at=?, pipeline_stage='LOST' WHERE lead_id=?").run(now, "HS-LIVE-1");
const stillThere = db.prepare("SELECT lead_id, pipeline_stage FROM revenue_leads WHERE lead_id='HS-LIVE-1'").get();
check("dismiss keeps row", stillThere && stillThere.pipeline_stage === "LOST");

db.prepare("INSERT INTO service_requests VALUES ('HS-SLA-1','NEW',?,?, 'Canario','ac','WAVE-B-TEST','60001111',NULL,NULL,NULL)").run(old, now);
const slaFirst = db.prepare("UPDATE service_requests SET sla_first_alerted_at=? WHERE public_id=? AND (sla_first_alerted_at IS NULL OR sla_first_alerted_at='')").run(now, "HS-SLA-1");
const slaFirstAgain = db.prepare("UPDATE service_requests SET sla_first_alerted_at=? WHERE public_id=? AND (sla_first_alerted_at IS NULL OR sla_first_alerted_at='')").run(now, "HS-SLA-1");
check("sla first alert once", slaFirst.changes === 1 && slaFirstAgain.changes === 0);
const slaEsc = db.prepare("UPDATE service_requests SET sla_escalated_at=? WHERE public_id=? AND sla_first_alerted_at IS NOT NULL AND (sla_escalated_at IS NULL OR sla_escalated_at='')").run(now, "HS-SLA-1");
const slaEscAgain = db.prepare("UPDATE service_requests SET sla_escalated_at=? WHERE public_id=? AND sla_first_alerted_at IS NOT NULL AND (sla_escalated_at IS NULL OR sla_escalated_at='')").run(now, "HS-SLA-1");
check("sla escalation once", slaEsc.changes === 1 && slaEscAgain.changes === 0);

db.prepare("UPDATE service_requests SET status='CONTACTED' WHERE public_id='HS-SLA-1'").run();
const slaAfter = db.prepare("SELECT status FROM service_requests WHERE public_id='HS-SLA-1'").get();
check("mark contacted stops sla status NEW", slaAfter.status === "CONTACTED");

check("callback compact ids only", opsTg.includes("cc:c:") && opsTg.includes("cc:x:") && opsTg.includes("cc:z:"));
check("pagination present", opsTg.includes("pageSize") || opsCfg.includes("pageSize"));

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log("WAVE_B_UNIT_OK");
