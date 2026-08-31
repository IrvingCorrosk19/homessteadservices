#!/usr/bin/env node
/**
 * Operations AI adversarial gate: behavior + architecture + long conversation (when server up).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const behavior = spawnSync("npx", ["tsx", "scripts/operations-adversarial-behavior.ts"], {
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

const session = readFileSync(join(root, "src/lib/copilot/session.ts"), "utf8");
const schema = readFileSync(join(root, "src/lib/copilot/schema.ts"), "utf8");
const opsSvc = readFileSync(join(root, "src/lib/operations/operations-ai-service.ts"), "utf8");

check("conversation-scoped sessions table", schema.includes("copilot_sessions_scoped"));
check("session scope helper", session.includes("copilotSessionScope"));
check("web passes conversationId", opsSvc.includes("conversationId"));
check("wrong sí guard", opsSvc.includes("No hay ninguna acción pendiente"));
check("pending confirmation token", session.includes("pendingConfirmationToken"));
check("long conversation script", existsSync(join(root, "scripts/operations-long-conversation.mjs")));

if (failed) process.exit(1);
console.log("OPERATIONS AI ADVERSARIAL GATE PASS");
