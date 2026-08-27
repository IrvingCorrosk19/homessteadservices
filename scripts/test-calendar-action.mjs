/**
 * P0 Calendar action execution gate.
 * Run: node scripts/test-calendar-action.mjs
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

ok("calendar-action module", /decideCalendarExecution/.test(read("src/lib/concierge/calendar-action.ts")));
ok("engine consumes pending", /PENDING_ACTION_ACCEPTED|pending_affirmed|consumePendingAvailabilityAction/.test(read("src/lib/concierge-engine.ts")));
ok("engine direct early return", /direct_availability_request|DIRECT_ACTION_DETECTED/.test(read("src/lib/concierge/calendar-action.ts")));
ok("loop guard", /ACTION_OFFER_LOOP_BLOCKED/.test(read("src/lib/concierge/calendar-action.ts")));
ok("integrity pending flag", /offeredPendingAction/.test(read("src/lib/concierge-integrity.ts")));
ok("horarios plural in engine", /horarios\?/.test(read("src/lib/concierge-engine.ts")));

const result = spawnSync("npx", ["tsx", "scripts/calendar-action-behavior.ts"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
ok("behavioral exit 0", result.status === 0);

const identity = spawnSync("npx", ["tsx", "scripts/request-identity-behavior.ts"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
ok("request-identity still pass", identity.status === 0);

const ctx = spawnSync("npx", ["tsx", "scripts/context-switch-behavior.ts"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
ok("context-switch still pass", ctx.status === 0);

if (failed) {
  console.error(`\nFAILED: ${failed}`);
  process.exit(1);
}
console.log("\nCALENDAR ACTION TESTS PASS");
