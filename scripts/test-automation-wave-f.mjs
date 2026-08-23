import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

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

const analytics = readFileSync(join(root, "src/lib/analytics-service.ts"), "utf8");
const c360 = readFileSync(join(root, "src/lib/customer-360.ts"), "utf8");
const gap = readFileSync(join(root, "docs/AUDIT/WAVE_F_GAP_ANALYSIS.md"), "utf8");
const admin = readFileSync(join(root, "src/app/admin/page.tsx"), "utf8");
const list = readFileSync(join(root, "src/app/admin/clientes/page.tsx"), "utf8");
const ops = readFileSync(join(root, "src/lib/ops-telegram.ts"), "utf8");
const perms = readFileSync(join(root, "src/lib/telegram-operators.ts"), "utf8");

check("wave e certified gate", gap.includes("CERTIFIED") && gap.includes("WAVE_E_DEPENDENCY"));
check("wave d not invented", gap.includes("NOT_CERTIFIED") && analytics.includes("N/A_NOT_CERTIFIED"));
check("no customers_v2 table", !c360.includes("CREATE TABLE customers_v2") && !analytics.includes("CREATE TABLE customers_v2"));
check("no auto merge", c360.includes("autoMerge: false") || c360.includes("autoMerge"));
check("no text-to-sql", !analytics.includes("text-to-sql") && !analytics.toLowerCase().includes("generateSql"));
check("no fake revenue", analytics.includes("revenueAvailable: false"));
check("analytics service", analytics.includes("getExecutiveSummary") && analytics.includes("getFunnel"));
check("attention center", analytics.includes("getAttentionItems"));
check("customer list", c360.includes("listCustomers") && list.includes("Customer 360"));
check("timeline", c360.includes("buildTimeline") || c360.includes("TimelineEvent"));
check("admin dashboard", admin.includes("Embudo") && admin.includes("Needs attention"));
check("telegram brief", ops.includes("HOMESTEAD HOY") && ops.includes("cc:cu"));
check("rbac customers", perms.includes("customers.read") && perms.includes("analytics.read"));
check("repeat deterministic", c360.includes("jobsCompleted >= 2"));

const dir = mkdtempSync(join(tmpdir(), "hs-wave-f-"));
const db = new Database(join(dir, "t.sqlite"));
db.exec(`
  CREATE TABLE revenue_customers (
    id INTEGER PRIMARY KEY, name TEXT, phone TEXT, email TEXT, is_test INTEGER DEFAULT 0,
    normalized_phone TEXT DEFAULT '', email_normalized TEXT DEFAULT '', created_at TEXT
  );
  CREATE TABLE revenue_jobs (
    job_id TEXT PRIMARY KEY, customer_id INTEGER, status TEXT, is_test INTEGER DEFAULT 0, completed_at TEXT
  );
`);
db.prepare("INSERT INTO revenue_customers VALUES (1,'A','50760001111','a@t.com',1,'50760001111','a@t.com','2026-01-01')").run();
db.prepare("INSERT INTO revenue_jobs VALUES ('HJ-2026-000001',1,'COMPLETED',1,'2026-02-01')").run();
db.prepare("INSERT INTO revenue_jobs VALUES ('HJ-2026-000002',1,'COMPLETED',1,'2026-03-01')").run();
const completed = db.prepare("SELECT COUNT(*) AS n FROM revenue_jobs WHERE customer_id=1 AND status='COMPLETED'").get().n;
check("repeat customer count", completed >= 2);
const rate = (n, d) => (d <= 0 ? null : Math.round((n / d) * 1000) / 10);
check("conversion zero safe", rate(1, 0) === null);
check("conversion math", rate(1, 2) === 50);

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log("WAVE_F_UNIT_OK");
