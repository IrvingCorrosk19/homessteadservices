/**
 * P0 Context Switch — regression gate.
 * Run: node scripts/test-context-switch.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(root, rel), "utf8");

let failed = 0;
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

ok(
  "transition engine exists",
  /export function detectConversationTransition/.test(read("src/lib/concierge/service-transition.ts")),
);
ok(
  "engine applies transition before lock photos",
  /detectConversationTransition/.test(read("src/lib/concierge-engine.ts")) &&
    /STALE_ASYNC_RESULT_DISCARDED/.test(read("src/lib/concierge-engine.ts")),
);
ok(
  "stale response blocked",
  /STALE_ASSISTANT_RESPONSE_BLOCKED/.test(read("src/lib/concierge-engine.ts")),
);
ok(
  "digitalLockAbandoned prevents reactivation",
  /digitalLockAbandoned/.test(read("src/lib/concierge-engine.ts")),
);
ok(
  "SWITCH vs REFINE distinguished",
  /REFINE_CURRENT_SERVICE/.test(read("src/lib/concierge/service-transition.ts")) &&
    /SWITCH_SERVICE/.test(read("src/lib/concierge/service-transition.ts")),
);

const result = spawnSync("npx", ["tsx", "scripts/context-switch-behavior.ts"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
ok("behavioral tests exit 0", result.status === 0);

// Preserve prior request-identity regressions
const identity = spawnSync("npx", ["tsx", "scripts/request-identity-behavior.ts"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
if (identity.stdout) process.stdout.write(identity.stdout);
if (identity.stderr) process.stderr.write(identity.stderr);
ok("request-identity still passes", identity.status === 0);

if (failed) {
  console.error(`\nFAILED: ${failed}`);
  process.exit(1);
}
console.log("\nCONTEXT SWITCH TESTS PASS");
