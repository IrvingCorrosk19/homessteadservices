/**
 * P0 Zombie context — regression gate.
 * Run: node scripts/test-zombie-context.mjs
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
const transition = read("src/lib/concierge/service-transition.ts");
const guards = read("src/lib/concierge/turn-context-guards.ts");
const route = read("src/app/api/concierge/chat/route.ts");
const widget = read("src/components/concierge/ConciergeWidget.tsx");

ok("guards: currentTurnPhotoIds", /export function currentTurnPhotoIds/.test(guards));
ok("guards: canEmitPhotoValidationReply", /export function canEmitPhotoValidationReply/.test(guards));
ok("guards: isStaleVisionResult", /export function isStaleVisionResult/.test(guards));
ok("guards: NO_CURRENT_IMAGE", /NO_CURRENT_IMAGE/.test(guards));
ok("engine: USER_MESSAGE_RECEIVED", /USER_MESSAGE_RECEIVED/.test(engine));
ok("engine: INTENT_DETECTED", /INTENT_DETECTED/.test(engine));
ok("engine: SERVICE_CONTEXT_SWITCHED", /SERVICE_CONTEXT_SWITCHED/.test(engine));
ok("engine: STALE_VISION_RESULT_DISCARDED", /STALE_VISION_RESULT_DISCARDED/.test(engine));
ok("engine: STALE_RESPONSE_BLOCKED", /STALE_RESPONSE_BLOCKED/.test(engine));
ok("engine: CONVERSATION_CREATED", /CONVERSATION_CREATED/.test(engine));
ok("engine: extract after transition", /Current message facts land/.test(engine));
ok("engine: no history photo scan", !/pendingPhotoIds\.push\(parsed\.photoId\)/.test(engine));
ok("engine: policy drives vision", /resolveDigitalLockTurnPolicy/.test(engine));
ok("engine: requirements not default locksmith", !/getServiceRequirements\(\{[^}]*\|\| "locksmith"/s.test(engine));
ok("transition: unrelated service switches", /isUnrelatedSwitch\(effectivePrev/.test(transition));
ok("route: NEW_CONVERSATION", /NEW_CONVERSATION/.test(route));
ok("route: CONVERSATION_HYDRATED", /CONVERSATION_HYDRATED/.test(route));
ok("route: GET conversationId", /conversationId/.test(route) && /CONVERSATION_ENDED/.test(route));
ok("widget: Nueva solicitud", /Nueva solicitud/.test(widget) && /startNewConversation/.test(widget));
ok("widget: sessionReady gate", /sessionReady/.test(widget));
ok("widget: sends conversationId", /conversationId: conversationIdRef/.test(widget));

const result = spawnSync("npx", ["tsx", "scripts/zombie-context-behavior.ts"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
ok("behavioral tests exit 0", result.status === 0);

if (failed) {
  console.error(`\nFAILED: ${failed}`);
  process.exit(1);
}
console.log("\nZOMBIE CONTEXT TESTS PASS");
