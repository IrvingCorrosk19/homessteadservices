/**
 * P0 Reprogramming identity — regression gate.
 * Run: node scripts/test-reprogram-identity.mjs
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

const engine = read("src/lib/concierge-engine.ts");
const reprogram = read("src/lib/concierge/appointment-reprogram.ts");
const lifecycle = read("src/lib/concierge/service-request-lifecycle.ts");
const nextAction = read("src/lib/concierge/conversation-next-action.ts");
const tools = read("src/lib/concierge-tools.ts");
const telegram = read("src/lib/revenue-telegram.ts");

ok("reprogram module", /tryReprogramAppointment/.test(reprogram));
ok("detect reprogram intent", /detectReprogramAppointmentIntent/.test(reprogram));
ok("authoritative request id", /resolveAuthoritativeRequestId/.test(reprogram));
ok("engine early reprogram", /tryReprogramAppointment/.test(engine));
ok("lifecycle rehydrate", /rehydrateRequestFromAppointment/.test(lifecycle));
ok("lifecycle blocks new HS with appointment", /hasActiveBookedAppointment/.test(lifecycle));
ok("next action REPROGRAM", /REPROGRAM_APPOINTMENT/.test(nextAction));
ok("tools resolve authoritative lead", /resolveAuthoritativeRequestId/.test(tools));
ok("engine blocks createLead with appointment", /!state\.appointmentId/.test(engine));
ok("telegram reprogram HS", /CITA REPROGRAMADA[\s\S]*appointment\.leadId/.test(telegram));

const behavior = spawnSync("npx", ["tsx", "scripts/reprogram-identity-behavior.ts"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
if (behavior.stdout) process.stdout.write(behavior.stdout);
if (behavior.stderr) process.stderr.write(behavior.stderr);
ok("behavioral pass", behavior.status === 0);

if (failed) {
  console.error(`\nFAILED: ${failed}`);
  process.exit(1);
}
console.log("\nREPROGRAM IDENTITY TESTS PASS");
