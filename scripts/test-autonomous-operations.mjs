import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const behavior = spawnSync("npx", ["tsx", "scripts/autonomous-operations-behavior.ts"], {
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

const engine = readFileSync(join(root, "src/lib/autonomous/engine.ts"), "utf8");
const schema = readFileSync(join(root, "src/lib/autonomous/schema.ts"), "utf8");
const policy = readFileSync(join(root, "src/lib/autonomous/policy-engine.ts"), "utf8");
const tick = readFileSync(join(root, "src/app/api/internal/content/scheduler-tick/route.ts"), "utf8");

check("operational_signals table", schema.includes("operational_signals"));
check("deduplication_key unique", schema.includes("deduplication_key TEXT NOT NULL UNIQUE"));
check("policy engine", policy.includes("REQUEST_CONFIRMATION"));
check("scheduler integration", tick.includes("runAutonomousOpsScan"));
check("kill switch config", engine.includes("isAutonomousEnabled"));
check("dry run support", engine.includes("dryRun"));
check("architecture audit doc", existsSync(join(root, "docs/AUDIT/HOMESTEAD-AUTONOMOUS-OPERATIONS-ARCHITECTURE-AUDIT.md")));
check("adversarial script", existsSync(join(root, "scripts/autonomous-operations-adversarial.ts")));
check("final cert runner", existsSync(join(root, "scripts/autonomous-operations-final-cert.mjs")));
check("reconcile signals", readFileSync(join(root, "src/lib/autonomous/detectors.ts"), "utf8").includes("reconcileSignalsWithDetectors"));

if (failed) process.exit(1);
console.log("AUTONOMOUS OPERATIONS GATE PASS");

// Optional adversarial when explicitly run via final-cert
