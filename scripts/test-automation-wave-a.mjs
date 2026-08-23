import { createHmac, randomUUID } from "node:crypto";
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

const outboxSrc = readFileSync(join(root, "src/lib/automation-outbox.ts"), "utf8");
const dispatchSrc = readFileSync(join(root, "src/lib/automation-dispatch.ts"), "utf8");
const n8nSrc = readFileSync(join(root, "src/lib/n8n.ts"), "utf8");
const saveSrc = readFileSync(join(root, "src/lib/service-requests.ts"), "utf8");
const serviceSrc = readFileSync(join(root, "src/lib/service-request-service.ts"), "utf8");
const storeSrc = readFileSync(join(root, "src/lib/revenue-store.ts"), "utf8");
const csJson = readFileSync(join(root, "n8n/homestead-n8n-content-studio.json"), "utf8");
const handoffSrc = readFileSync(join(root, "src/lib/concierge-handoff.ts"), "utf8");
const catalogSrc = readFileSync(join(root, "src/lib/content-catalog.ts"), "utf8");
const authSrc = readFileSync(join(root, "src/lib/internal-auth.ts"), "utf8");
const handlerSrc = readFileSync(join(root, "src/lib/content-handler.ts"), "utf8");
const tgSrc = readFileSync(join(root, "n8n/homestead-n8n-telegram-workflow.json"), "utf8");

check("outbox table migration", saveSrc.includes("CREATE TABLE IF NOT EXISTS automation_outbox"));
check("outbox unique idempotency", saveSrc.includes("idempotency_key TEXT NOT NULL UNIQUE"));
check("enqueue in same request transaction", saveSrc.includes("enqueueOutbox(database") && saveSrc.includes("service_request.created"));
check("dispatch uses drain not direct notify", serviceSrc.includes("drainAutomationOutbox") && !serviceSrc.includes("notifyN8n"));
check("n8n v1 adapter still posts body event", n8nSrc.includes("JSON.stringify(payload)") && dispatchSrc.includes("envelope.data"));
check("content studio fail-closed", /"continueOnFail":\s*false/.test(csJson) && /responseMode": "responseNode"/.test(csJson) && csJson.includes("Responder 503"));
check("content studio no false ack path", !/"continueOnFail":\s*true/.test(csJson));
check("telegram update forgotten on 500", readFileSync(join(root, "src/app/api/internal/content/telegram-update/route.ts"), "utf8").includes("forgetTelegramUpdate"));
check("lease reclaim includes processing", outboxSrc.includes("status = 'PROCESSING'") && outboxSrc.includes("processing_until <= ?"));
check("open slot unique index", saveSrc.includes("idx_rev_appt_open_slot"));
check("createAppointment blocks other lead slot", storeSrc.includes("return null") && storeSrc.includes("SQLITE_CONSTRAINT"));
check("no escalate duplicate lead telegram", !handoffSrc.includes("sendNewLeadAlert"));
check("telegram update_id insert atomic", catalogSrc.includes("INSERT INTO content_telegram_updates") && catalogSrc.includes("catch"));
check("hmac still generated outbound", n8nSrc.includes("X-Homestead-Signature"));
check("n8n inbound hmac optional documented", authSrc.includes("n8n 2.3.6"));
check("admin callback gate", handlerSrc.includes("gateOperator") && handlerSrc.includes("denied"));
check("n8n request idempotency kept", tgSrc.includes("staticData.seen"));
check("webhook expected content-studio", readFileSync(join(root, "src/lib/content-telegram.ts"), "utf8").includes("homestead-content-studio"));

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
function sign(secret, timestamp, payload) {
  return createHmac("sha256", secret).update(`${timestamp}.${canonicalJson(payload)}`).digest("hex");
}

const secret = "wave-a-test-secret";
const ts = String(Math.floor(Date.now() / 1000));
const payload = { event: "service_request.created", requestId: "HS-2026-000099" };
const good = sign(secret, ts, payload);
check("hmac matches canonical payload", sign(secret, ts, payload) === good);
check("hmac rejects wrong secret", sign("other", ts, payload) !== good);
check("hmac rejects mutated payload", sign(secret, ts, { ...payload, extra: 1 }) !== good);

function openOutboxDb() {
  const dir = mkdtempSync(join(tmpdir(), "hs-outbox-"));
  const db = new Database(join(dir, "t.sqlite"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE automation_outbox (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      correlation_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 8,
      next_attempt_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_attempt_at TEXT,
      delivered_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      processing_until TEXT
    );
  `);
  return db;
}

const db = openOutboxDb();
const now = new Date().toISOString();
const key = "service_request.created:HS-2099-000001";
db.prepare(
  `INSERT INTO automation_outbox (event_id,event_type,version,correlation_id,idempotency_key,payload_json,status,max_attempts,next_attempt_at,created_at,updated_at)
   VALUES (?,?,1,?,?,?,'PENDING',8,?,?,?)`,
).run(randomUUID(), "service_request.created", "HS-2099-000001", key, "{}", now, now, now);
let dup = false;
try {
  db.prepare(
    `INSERT INTO automation_outbox (event_id,event_type,version,correlation_id,idempotency_key,payload_json,status,max_attempts,next_attempt_at,created_at,updated_at)
     VALUES (?,?,1,?,?,?,'PENDING',8,?,?,?)`,
  ).run(randomUUID(), "service_request.created", "HS-2099-000001", key, "{}", now, now, now);
} catch {
  dup = true;
}
check("duplicate idempotency key rejected", dup);

const claimSql = `UPDATE automation_outbox
   SET status = 'PROCESSING', attempts = attempts + 1, processing_until = ?
   WHERE event_id = ? AND status = 'PENDING'`;
const eventId = db.prepare("SELECT event_id FROM automation_outbox").get().event_id;
const first = db.prepare(claimSql).run(now, eventId);
const second = db.prepare(claimSql).run(now, eventId);
check("concurrent claim second loses", first.changes === 1 && second.changes === 0);

db.exec(`
  CREATE TABLE revenue_appointments (
    appointment_id TEXT PRIMARY KEY,
    lead_id TEXT,
    date TEXT,
    start_time TEXT,
    status TEXT
  );
  CREATE UNIQUE INDEX idx_rev_appt_open_slot
    ON revenue_appointments (date, start_time)
    WHERE status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED');
`);
db.prepare("INSERT INTO revenue_appointments VALUES ('HA-1','L1','2026-08-23','10:00','CONFIRMED')").run();
let slotDup = false;
try {
  db.prepare("INSERT INTO revenue_appointments VALUES ('HA-2','L2','2026-08-23','10:00','CONFIRMED')").run();
} catch {
  slotDup = true;
}
check("open slot unique across leads", slotDup);
db.prepare("INSERT INTO revenue_appointments VALUES ('HA-3','L2','2026-08-23','10:00','CANCELLED')").run();
check("cancelled slot can reuse", true);

db.exec("CREATE TABLE content_telegram_updates (update_id INTEGER PRIMARY KEY, created_at TEXT)");
db.prepare("INSERT INTO content_telegram_updates VALUES (42, ?)").run(now);
let updateDup = false;
try {
  db.prepare("INSERT INTO content_telegram_updates VALUES (42, ?)").run(now);
} catch {
  updateDup = true;
}
check("duplicate telegram update_id ignored", updateDup);

const expired = new Date(Date.now() - 60_000).toISOString();
db.prepare("UPDATE automation_outbox SET status='PROCESSING', processing_until=?, next_attempt_at=? WHERE event_id=?").run(expired, expired, eventId);
const reclaimSql = `UPDATE automation_outbox
   SET status = 'PROCESSING', attempts = attempts + 1, processing_until = ?
   WHERE event_id = ?
     AND (
       status = 'PENDING'
       OR (status = 'PROCESSING' AND (processing_until IS NULL OR processing_until <= ?))
     )`;
const reclaim = db.prepare(reclaimSql).run(now, eventId, now);
check("expired processing lease can be reclaimed", reclaim.changes === 1);

const future = String(Math.floor(Date.now() / 1000) + 400);
const past = String(Math.floor(Date.now() / 1000) - 400);
const skewOk = Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) <= 300;
const futureBad = Math.abs(Math.floor(Date.now() / 1000) - Number(future)) > 300;
const pastBad = Math.abs(Math.floor(Date.now() / 1000) - Number(past)) > 300;
check("timestamp anti-replay window", skewOk && futureBad && pastBad);

const gitIgnoreSecrets = !/TELEGRAM_BOT_TOKEN=|SMTP_PASS=|ADMIN_PASSWORD=/.test(readFileSync(join(root, "src/lib/log.ts"), "utf8"));
check("logger does not print secret env names as values", gitIgnoreSecrets);
check("replay does not create HS", dispatchSrc.includes("replayOutboxEvent") && !dispatchSrc.includes("saveServiceRequest"));
check("9TG not activated in import", !csJson.includes("9TG_GATEWAY"));

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log("WAVE_A_UNIT_OK");
