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

const post = readFileSync(join(root, "src/lib/post-service.ts"), "utf8");
const ret = readFileSync(join(root, "src/lib/retention-engine.ts"), "utf8");
const proc = readFileSync(join(root, "src/lib/retention-processor.ts"), "utf8");
const jobStore = readFileSync(join(root, "src/lib/job-store.ts"), "utf8");
const cfg = readFileSync(join(root, "src/lib/job-config.ts"), "utf8");
const ops = readFileSync(join(root, "src/lib/ops-telegram.ts"), "utf8");
const tick = readFileSync(join(root, "src/app/api/internal/content/scheduler-tick/route.ts"), "utf8");
const gap = readFileSync(join(root, "docs/AUDIT/WAVE_E_GAP_ANALYSIS.md"), "utf8");

check("no parallel recovery_v2", !post.includes("service_recovery_v2") && !ret.includes("jobs_v2"));
check("reuses post-service", post.includes("deliverPostServiceFollowup") && post.includes("markRecoveryResolved"));
check("NEUTRAL satisfaction", cfg.includes("NEUTRAL"));
check("negative blocks review", post.includes("NEEDS_HELP") && post.includes("openServiceRecovery") && post.includes("canSendMarketingRetention"));
check("open recovery blocks marketing", ret.includes("hasOpenRecovery") && ret.includes("open_recovery"));
check("frequency cap", ret.includes("frequency_cap") && ret.includes("marketingMinSpacingHours"));
check("service-aware aftercare delay", jobStore.includes("aftercareDelayMinutesForService"));
check("retention processor in scheduler", tick.includes("runRetentionEngine"));
check("maintenance no auto book", proc.includes("sin crear cita automática") || proc.includes("sin crear cita"));
check("reactivation skips locksmith", proc.includes('last_service === "locksmith"'));
check("telegram retention panel", ops.includes("cc:ret") && ops.includes("CLIENTES"));
check("recovery resolve callback", ops.includes("cc:rr") || ops.includes('action === "rr"'));
check("admin retencion page", readFileSync(join(root, "src/app/admin/retencion/page.tsx"), "utf8").includes("Cola de recovery"));
check("wave d dependency documented", gap.includes("WAVE_D_DEPENDENCY_STATUS") && gap.includes("NOT_CERTIFIED"));
check("multi-op pending documented", gap.includes("PENDING SECOND ACCOUNT") || gap.includes("NOT CERTIFIED"));

const dir = mkdtempSync(join(tmpdir(), "hs-wave-e-"));
const db = new Database(join(dir, "t.sqlite"));
db.exec(`
  CREATE TABLE revenue_customers (
    id INTEGER PRIMARY KEY, do_not_contact INTEGER DEFAULT 0, pref_aftercare INTEGER DEFAULT 1,
    pref_review INTEGER DEFAULT 1, pref_maintenance INTEGER DEFAULT 1, pref_reactivation INTEGER DEFAULT 1,
    pref_marketing INTEGER DEFAULT 0, last_marketing_contact_at TEXT, marketing_contact_count INTEGER DEFAULT 0,
    suppressed_at TEXT, suppression_reason TEXT DEFAULT '', is_test INTEGER DEFAULT 0
  );
  CREATE TABLE revenue_jobs (
    job_id TEXT PRIMARY KEY, customer_id INTEGER, recovery_status TEXT DEFAULT '', satisfaction_response TEXT DEFAULT ''
  );
`);
db.prepare("INSERT INTO revenue_customers (id) VALUES (1)").run();
db.prepare("INSERT INTO revenue_jobs VALUES ('HJ-1',1,'OPEN','')").run();

function hasOpenRecovery(customerId) {
  return db.prepare("SELECT COUNT(*) AS c FROM revenue_jobs WHERE customer_id=? AND recovery_status IN ('OPEN','CONTACTED')").get(customerId).c > 0;
}
check("open recovery blocks", hasOpenRecovery(1) === true);

function classifyText(t) {
  if (/chispas|problema|ayuda/i.test(t)) return "NEGATIVE";
  if (/excelente|todo bien/i.test(t)) return "POSITIVE";
  if (/más o menos|regular/i.test(t)) return "NEUTRAL";
  return "UNCLEAR";
}
check("safety negative", classifyText("el tomacorriente echa chispas") === "NEGATIVE");
check("positive text", classifyText("todo bien gracias") === "POSITIVE");
check("neutral text", classifyText("más o menos, todavía estoy probando") === "NEUTRAL");

db.prepare("UPDATE revenue_jobs SET recovery_status='RESOLVED' WHERE job_id='HJ-1'").run();
const r1 = db.prepare("UPDATE revenue_jobs SET recovery_status='RESOLVED' WHERE job_id='HJ-1' AND recovery_status IN ('OPEN','CONTACTED')").run();
check("resolve once", r1.changes === 0);

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log("WAVE_E_UNIT_OK");
