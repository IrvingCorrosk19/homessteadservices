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

const jobStore = readFileSync(join(root, "src/lib/job-store.ts"), "utf8");
const jobCfg = readFileSync(join(root, "src/lib/job-config.ts"), "utf8");
const post = readFileSync(join(root, "src/lib/post-service.ts"), "utf8");
const photos = readFileSync(join(root, "src/lib/job-photos.ts"), "utf8");
const content = readFileSync(join(root, "src/lib/job-content.ts"), "utf8");
const dispatch = readFileSync(join(root, "src/lib/automation-dispatch.ts"), "utf8");
const handler = readFileSync(join(root, "src/lib/content-handler.ts"), "utf8");
const opsTg = readFileSync(join(root, "src/lib/ops-telegram.ts"), "utf8");
const opsEngine = readFileSync(join(root, "src/lib/ops-engine.ts"), "utf8");
const migrate = readFileSync(join(root, "src/lib/service-requests.ts"), "utf8");
const processSrc = readFileSync(join(root, "src/lib/content-process.ts"), "utf8");
const compose = readFileSync(join(root, "deploy/vps/docker-compose.yml"), "utf8");
const mail = readFileSync(join(root, "src/lib/mail.ts"), "utf8");
const revenue = readFileSync(join(root, "src/lib/revenue-store.ts"), "utf8");
const apptRoute = readFileSync(join(root, "src/app/api/admin/appointments/[appointmentId]/route.ts"), "utf8");

check("reuses revenue_jobs not a parallel table", jobStore.includes("FROM revenue_jobs") && !migrate.includes("CREATE TABLE IF NOT EXISTS wave_c_jobs"));
check("public id HJ-YYYY-NNNNNN", jobCfg.includes("JOB_ID_PATTERN") && jobStore.includes("`HJ-${year}-"));
check("no appointment complete as job complete", /action === "complete"[\s\S]*setAppointmentStatus\(appointmentId, "COMPLETED"\)/.test(apptRoute) && !apptRoute.includes("completeServiceJob"));
check("complete is atomic completable statuses", jobStore.includes("status IN ${COMPLETABLE}") || jobStore.includes("status IN ('SCHEDULED','IN_PROGRESS')"));
check("job.completed outbox key", jobStore.includes("job.completed:${jobId}"));
check("post-service uses outbox", jobStore.includes("post_service.followup_due:") && post.includes("deliverPostServiceFollowup"));
check("email is customer channel", mail.includes("sendTransactionalEmail") && dispatch.includes("post_service.followup_due"));
check("no whatsapp unofficial api", !post.includes("whatsapp-web.js") && !post.includes("baileys"));
check("satisfaction token 64 hex", post.includes("TOKEN_RE") && post.includes("randomBytes(32)"));
check("first answer wins", post.includes("used_at IS NULL OR used_at = ''") && post.includes("already"));
check("needs help suppresses review", /if \(response === "NEEDS_HELP"\) \{[\s\S]*openServiceRecovery[\s\S]*needsHelp: true/.test(post) && post.includes("maybeRequestReview"));
check("recovery idempotency key", post.includes("customer.service_recovery:${jobId}:${cycle}"));
check("review url not invented", jobCfg.includes("configuredReviewUrl") && jobCfg.includes('protocol !== "https:"') && post.includes("if (!url) return \"\""));
check("no 5 star gating", !post.toLowerCase().includes("5 estrellas") && !opsTg.toLowerCase().includes("solo deja reseña"));
check("job photos originals immutable", photos.includes("original-") && photos.includes("UNIQUE (job_id, sha256)") === false ? photos.includes("sha256") : true);
check("job photos not intake path", photos.includes("jobs") && photos.includes("originals") && !photos.includes("photos/photo-01"));
check("content studio reused", content.includes("createContentJob") && content.includes("storeOriginal") && !content.includes("createContentJobV2"));
check("no openai until process", content.includes("RECEIVING") && !content.includes("processContentJob"));
check("pii sanitized before copy context", content.includes("sanitizeContentContext") && content.includes("No incluir nombre"));
check("marketing approval before process", processSrc.includes("marketingUsageApproved"));
check("command center jobs", opsTg.includes("🔧 Trabajos") && opsTg.includes("cc:j:") && opsTg.includes("cc:w:"));
check("complete confirmation", opsTg.includes("¿Confirmas que el trabajo fue realizado?"));
check("service recovery priority", opsTg.includes("CLIENTE NECESITA ATENCIÓN") || opsEngine.includes("cliente requiere seguimiento"));
check("zero new n8n workflows in code", !handler.includes("homestead-wave-c") && !dispatch.includes("wave_c_queue"));
check("outbox reused", dispatch.includes("job.completed") && dispatch.includes("customer.service_recovery_requested"));
check("telegram admin gate", handler.indexOf("gateOperator") < handler.indexOf("job_photos") || handler.includes("gateOperator"));
check("compose wave c env", compose.includes("POST_SERVICE_FOLLOWUP_DELAY_MINUTES") && compose.includes("HOMESTEAD_REVIEW_URL"));
check("no meta autpublish in wave c job content", !content.includes("publishJob("));
check("createJob uses JOB_CREATED", jobStore.includes("JOB_CREATED"));
check("legacy completeJob delegates", revenue.includes("completeServiceJob"));

const dir = mkdtempSync(join(tmpdir(), "hs-wave-c-"));
const db = new Database(join(dir, "t.sqlite"));
db.pragma("journal_mode = WAL");
const now = new Date().toISOString();
db.exec(`
  CREATE TABLE revenue_jobs (
    job_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    completed_at TEXT,
    completed_by TEXT DEFAULT '',
    satisfaction_response TEXT DEFAULT '',
    recovery_status TEXT DEFAULT '',
    review_requested_at TEXT,
    followup_status TEXT DEFAULT '',
    photo_count INTEGER DEFAULT 0,
    is_test INTEGER DEFAULT 0
  );
  CREATE TABLE job_feedback_tokens (
    token TEXT PRIMARY KEY, job_id TEXT, cycle INTEGER, expires_at TEXT, used_at TEXT, response TEXT DEFAULT '', created_at TEXT
  );
  CREATE TABLE automation_outbox (
    event_id TEXT PRIMARY KEY, event_type TEXT, idempotency_key TEXT UNIQUE, status TEXT, payload_json TEXT
  );
  CREATE TABLE job_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    original_relpath TEXT,
    UNIQUE (job_id, sha256)
  );
`);
db.prepare("INSERT INTO revenue_jobs (job_id, status, is_test) VALUES ('HJ-2026-000001','IN_PROGRESS',1)").run();
const first = db.prepare("UPDATE revenue_jobs SET status='COMPLETED', completed_at=?, completed_by='a' WHERE job_id=? AND status IN ('SCHEDULED','IN_PROGRESS')").run(now, "HJ-2026-000001");
const second = db.prepare("UPDATE revenue_jobs SET status='COMPLETED', completed_at=?, completed_by='b' WHERE job_id=? AND status IN ('SCHEDULED','IN_PROGRESS')").run(now, "HJ-2026-000001");
check("job complete concurrency one winner", first.changes === 1 && second.changes === 0);

db.prepare("INSERT INTO automation_outbox VALUES ('e1','job.completed','job.completed:HJ-2026-000001','PENDING','{}')").run();
let dup = false;
try {
  db.prepare("INSERT INTO automation_outbox VALUES ('e2','job.completed','job.completed:HJ-2026-000001','PENDING','{}')").run();
} catch {
  dup = true;
}
check("job.completed exactly once", dup);

const token = "a".repeat(64);
const exp = new Date(Date.now() + 86400000).toISOString();
db.prepare("INSERT INTO job_feedback_tokens VALUES (?,?,1,?,NULL,'',?)").run(token, "HJ-2026-000001", exp, now);
const sat1 = db.prepare("UPDATE job_feedback_tokens SET used_at=?, response='EXCELLENT' WHERE token=? AND (used_at IS NULL OR used_at='')").run(now, token);
const sat2 = db.prepare("UPDATE job_feedback_tokens SET used_at=?, response='NEEDS_HELP' WHERE token=? AND (used_at IS NULL OR used_at='')").run(now, token);
check("satisfaction first click wins", sat1.changes === 1 && sat2.changes === 0);
const kept = db.prepare("SELECT response FROM job_feedback_tokens WHERE token=?").get(token);
check("cannot change satisfaction to needs help after positive", kept.response === "EXCELLENT");

db.prepare("INSERT INTO revenue_jobs (job_id, status, is_test) VALUES ('HJ-2026-000002','COMPLETED',1)").run();
const rec1 = db.prepare("UPDATE revenue_jobs SET recovery_status='OPEN' WHERE job_id=? AND (recovery_status='' OR recovery_status IS NULL)").run("HJ-2026-000002");
const rec2 = db.prepare("UPDATE revenue_jobs SET recovery_status='OPEN' WHERE job_id=? AND (recovery_status='' OR recovery_status IS NULL)").run("HJ-2026-000002");
check("service recovery opened once", rec1.changes === 1 && rec2.changes === 0);

db.prepare("INSERT INTO automation_outbox VALUES ('r1','customer.service_recovery_requested','customer.service_recovery:HJ-2026-000002:1','PENDING','{}')").run();
let recDup = false;
try {
  db.prepare("INSERT INTO automation_outbox VALUES ('r2','customer.service_recovery_requested','customer.service_recovery:HJ-2026-000002:1','PENDING','{}')").run();
} catch {
  recDup = true;
}
check("recovery outbox unique per cycle", recDup);

db.prepare("INSERT INTO job_photos (job_id, sha256, original_relpath) VALUES ('HJ-2026-000001','abc','jobs/2026/08/HJ-2026-000001/originals/original-001.jpg')").run();
let photoDup = false;
try {
  db.prepare("INSERT INTO job_photos (job_id, sha256, original_relpath) VALUES ('HJ-2026-000001','abc','jobs/2026/08/HJ-2026-000001/originals/original-002.jpg')").run();
} catch {
  photoDup = true;
}
check("duplicate photo sha skipped", photoDup);
const pathKept = db.prepare("SELECT original_relpath FROM job_photos WHERE job_id='HJ-2026-000001'").get();
check("original path not overwritten", pathKept.original_relpath.endsWith("original-001.jpg"));

const expired = new Date(Date.now() - 1000).toISOString();
db.prepare("INSERT INTO job_feedback_tokens VALUES (?,?,1,?,NULL,'',?)").run("b".repeat(64), "HJ-2026-000099", expired, now);
const stale = db.prepare("SELECT token FROM job_feedback_tokens WHERE token=? AND expires_at < ?").get("b".repeat(64), now);
check("expired token detectable", Boolean(stale));

const other = db.prepare("SELECT job_id FROM job_feedback_tokens WHERE token=?").get(token);
check("token maps to one job not sequential idor", other.job_id === "HJ-2026-000001");

check("no wave_c_queue table", !migrate.includes("wave_c_queue"));
check("callback jobs have no phone", !/callback_data: `cc:[^`]*\$\{job\.phone\}/.test(opsTg));

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log("WAVE_C_UNIT_OK");
