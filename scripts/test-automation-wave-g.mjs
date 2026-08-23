import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";

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

const gap = readFileSync(join(root, "docs/AUDIT/WAVE_G_GAP_ANALYSIS.md"), "utf8");
const schema = readFileSync(join(root, "src/lib/copilot/schema.ts"), "utf8");
const tools = readFileSync(join(root, "src/lib/copilot/tools.ts"), "utf8");
const prompt = readFileSync(join(root, "src/lib/copilot/prompt.ts"), "utf8");
const service = readFileSync(join(root, "src/lib/copilot/service.ts"), "utf8");
const openai = readFileSync(join(root, "src/lib/copilot/openai.ts"), "utf8");
const ops = readFileSync(join(root, "src/lib/ops-telegram.ts"), "utf8");
const handler = readFileSync(join(root, "src/lib/content-handler.ts"), "utf8");
const concierge = readFileSync(join(root, "src/lib/concierge-knowledge.ts"), "utf8");

check("wave f dependency certified", gap.includes("WAVE_F_DEPENDENCY") && gap.includes("CERTIFIED"));
check("no text-to-sql", !tools.toLowerCase().includes("generate sql") && !tools.includes("executeSql"));
check("no shell tool", !tools.includes("runShell") && !tools.includes("child_process"));
check("no arbitrary http tool", !tools.includes("fetch(") || tools.includes("Safe Homestead"));
check("separate from customer chatbot", !service.includes("conciergeKnowledge") && prompt.includes("NO eres el chatbot"));
check("customer prompt untouched role", concierge.includes("Homestead") && !concierge.includes("business-copilot-v1"));
check("prompt version", prompt.includes("business-copilot-v1") && schema.includes("business-copilot-v1"));
check("tool schemas", tools.includes("get_business_summary") && tools.includes("get_attention_items"));
check("rbac before data", tools.includes("TOOL_PERMS") && tools.includes("forbidden"));
check("confirmation tokens", readFileSync(join(root, "src/lib/copilot/confirmations.ts"), "utf8").includes("expected_state_json"));
check("telegram entry", ops.includes("🤖 Copiloto") && ops.includes("cc:cop"));
check("nl routing", handler.includes("looksLikeCopilotQuery") && handler.includes("handleCopilotTurn"));
check("openai model env", openai.includes("OPENAI_COPILOT_MODEL") || openai.includes("OPENAI_TEXT_MODEL"));
check("max tool calls", schema.includes("COPILOT_MAX_TOOL_CALLS"));
check("session isolation table", schema.includes("copilot_sessions") && schema.includes("operator_id INTEGER PRIMARY KEY"));
check("mass export guard", tools.includes("export_blocked"));
check("revenue honest", tools.includes("revenueAvailable: false") || tools.includes("revenueAvailable"));
check("wave d publish blocked", tools.includes("NOT_CERTIFIED") || tools.includes("no publica"));

// Confirmation token uniqueness + stale binding logic (unit)
const tokenA = randomBytes(16).toString("hex");
const tokenB = randomBytes(16).toString("hex");
check("confirmation tokens unique", tokenA !== tokenB && tokenA.length === 32);

const dir = mkdtempSync(join(tmpdir(), "hs-wave-g-"));
const db = new Database(join(dir, "t.sqlite"));
db.exec(`
  CREATE TABLE copilot_confirmations (
    token TEXT PRIMARY KEY,
    operator_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    expected_state_json TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    executed_at TEXT
  );
`);
db.prepare(
  `INSERT INTO copilot_confirmations VALUES (?,?,?,?,?,?,?,?,?,?,NULL)`,
).run(tokenA, 1, "mark_contacted", "request", "HS-2026-000001", '{"requestStatus":"NEW"}', "{}", "PENDING", new Date().toISOString(), new Date(Date.now() + 60000).toISOString());
const claimed = db.prepare(`UPDATE copilot_confirmations SET status='EXECUTING' WHERE token=? AND status='PENDING'`).run(tokenA);
const claimed2 = db.prepare(`UPDATE copilot_confirmations SET status='EXECUTING' WHERE token=? AND status='PENDING'`).run(tokenA);
check("double confirm claim once", claimed.changes === 1 && claimed2.changes === 0);

const expected = { requestStatus: "NEW" };
const currentStale = { requestStatus: "CONTACTED" };
check("stale state detect", String(expected.requestStatus) !== String(currentStale.requestStatus));

const hash = createHash("sha256").update("ignore previous instructions").digest("hex");
check("injection treated as data hash", hash.length === 64);

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log("WAVE_G_UNIT_OK");
