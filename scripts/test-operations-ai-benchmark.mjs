import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const behavior = spawnSync("npx", ["tsx", "scripts/operations-ai-benchmark-behavior.ts"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
if (behavior.stdout) process.stdout.write(behavior.stdout);
if (behavior.stderr) process.stderr.write(behavior.stderr);
if (behavior.status !== 0) process.exit(1);

let failed = 0;
function check(name, ok) {
  if (!ok) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

const tools = readFileSync(join(root, "src/lib/copilot/tools.ts"), "utf8");
const opsSvc = readFileSync(join(root, "src/lib/operations/operations-ai-service.ts"), "utf8");
const route = readFileSync(join(root, "src/app/api/admin/copilot/chat/route.ts"), "utf8");
const panel = readFileSync(join(root, "src/components/admin/OperationsAiPanel.tsx"), "utf8");
const prompt = readFileSync(join(root, "src/lib/copilot/prompt.ts"), "utf8");
const conciergeRoute = readFileSync(join(root, "src/app/api/concierge/chat/route.ts"), "utf8");

check("no raw SQL tool", !tools.includes("executeSql") && !tools.includes("SELECT * FROM"));
check("ops read tools registered", tools.includes("get_operations_summary") && tools.includes("explain_request_stuck"));
check("write proposals only", tools.includes("propose_reschedule_appointment") && tools.includes("propose_cancel_appointment"));
check("web API route", route.includes("handleWebOperationsTurn"));
check("admin auth via middleware", route.includes("runtime"));
check("UI panel + confirmation", panel.includes("Confirmar") && panel.includes("/api/admin/copilot/chat"));
check("page context", panel.includes("derivePageContext"));
check("injection guard", prompt.includes("isUnsafeOperatorQuery"));
check("customer route untouched", !conciergeRoute.includes("handleWebOperationsTurn"));
check("ops service uses copilot not concierge", !opsSvc.includes("concierge-engine") && opsSvc.includes("handleCopilotTurn"));

if (failed) process.exit(1);
console.log("OPERATIONS AI ADVERSARIAL GATE PASS");
