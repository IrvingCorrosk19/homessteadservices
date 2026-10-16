/**
 * Isolated n8n $vars readiness check (no secret values printed).
 *
 * 1) Confirms isolated health + that prod workflow JSON uses $vars only.
 * 2) Attempts a short timed read of isolated variables table (lengths only).
 * 3) Does NOT mutate shared VPS n8n. Shared 2.3.6 probe:
 *    deploy/vps/verify-n8n-vars-readonly.sh (SSH credentials; readonly).
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const base = (process.env.N8N_ISOLATED_BASE || "http://127.0.0.1:5679").replace(/\/$/, "");
const dbPath = join(process.cwd(), "data", "n8n-isolated", ".n8n", "database.sqlite");
const prodWf = join(process.cwd(), "n8n", "homestead-n8n-concierge-turn.prod.json");
const evidenceDir = join(
  process.cwd(),
  "docs",
  "auditoria-homestead-app",
  "evidence",
  `n8n-vars-isolated-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`,
);
mkdirSync(evidenceDir, { recursive: true });

const results = [];
function record(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${id}] ${detail}`);
}

const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 4000);
let healthOk = false;
try {
  const health = await fetch(`${base}/healthz`, { signal: ctrl.signal });
  healthOk = health.ok;
  record("isolated_health", healthOk, `status=${health.status}`);
} catch (e) {
  record("isolated_health", false, String(e.message || e).slice(0, 120));
} finally {
  clearTimeout(t);
}

const raw = readFileSync(prodWf, "utf8");
record("prod_json_vars_only", raw.includes("$vars.CONCIERGE_INTERNAL_SECRET") && !raw.includes("$env."), "prod workflow expressions");
record(
  "prod_json_no_literal_secret",
  !/sk-|BEGIN PRIVATE|password\s*[:=]/i.test(raw),
  "no secret-like literals in JSON",
);

let varRows = [];
if (existsSync(dbPath)) {
  try {
    const db = new Database(dbPath, { readonly: true, timeout: 2000 });
    varRows = db
      .prepare(
        `SELECT key, length(value) AS len FROM variables
         WHERE key IN ('CONCIERGE_INTERNAL_SECRET','HOMESTEAD_INTERNAL_BASE','HOMESTEAD_WEBHOOK_SECRET')
         ORDER BY key`,
      )
      .all();
    const cred = db.prepare(`SELECT COUNT(*) AS n FROM credentials_entity`).get();
    db.close();
    writeFileSync(join(evidenceDir, "variables-lengths.json"), JSON.stringify(varRows, null, 2));
    record("variables_readable", true, `rows=${varRows.length} cred_count=${cred.n}`);
    record(
      "concierge_vars_present",
      varRows.some((r) => r.key === "CONCIERGE_INTERNAL_SECRET" && r.len > 0) &&
        varRows.some((r) => r.key === "HOMESTEAD_INTERNAL_BASE" && r.len > 0),
      varRows.map((r) => `${r.key}:len=${r.len}`).join(" ") || "none",
    );
  } catch (e) {
    record("variables_readable", false, String(e.message || e).slice(0, 160));
  }
} else {
  record("variables_readable", false, "db missing");
}

const summary = {
  evidenceDir,
  isolatedBase: base,
  sharedVps: {
    status: "BLOCKED_THIS_SESSION",
    reason: "SSH credentials rejected (Access denied). Run deploy/vps/verify-n8n-vars-readonly.sh on VPS or with working SSH.",
    priorEvidence: "docs/auditoria-homestead-app/02-INVENTARIO-N8N.md — variables table + Homestead workflows use $vars; $env blocked; credentials_entity=0",
  },
  results,
  failed: results.filter((r) => !r.ok).length,
};
writeFileSync(join(evidenceDir, "RESULTS.json"), JSON.stringify(summary, null, 2));
writeFileSync(
  join(evidenceDir, "README.md"),
  `# n8n vars probe (isolated + shared status)

- Isolated health: ${healthOk ? "up" : "down"}
- Prod JSON uses \`$vars\` only: checked
- Concierge variables in isolated DB: ${varRows.map((r) => `${r.key}:len=${r.len}`).join(", ") || "(none yet)"}
- Shared 2.3.6 live resolve: **BLOCKED** this session (SSH). Script ready: \`deploy/vps/verify-n8n-vars-readonly.sh\`
- Secrets: never printed; store in n8n Variables / protected env — not workflow JSON
`,
);
console.log(JSON.stringify({ evidenceDir, failed: summary.failed, shared: summary.sharedVps.status }, null, 2));
process.exit(0);
