/**
 * P0 Master conversation state — regression gate.
 * Run: node scripts/test-master-conversation-state.mjs
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
const reset = read("src/lib/concierge/conversation-reset.ts");
const slots = read("src/lib/concierge/slot-state.ts");
const compat = read("src/lib/concierge/response-compatibility.ts");
const transaction = read("src/lib/concierge-transaction.ts");
const route = read("src/app/api/concierge/chat/route.ts");

ok("reset module exists", /applyFullConversationReset/.test(reset));
ok("reset detects olvida todo", /RESET_CONVERSATION_RE/.test(reset));
ok("engine uses reset", /detectFullConversationReset/.test(engine));
ok("engine slot early return", /SLOT_SELECTED_EARLY_RETURN/.test(engine));
ok("engine selectOfferedSlot", /selectOfferedSlot/.test(engine));
ok("slot state machine", /getAvailabilityState/.test(slots));
ok("response compatibility guard", /validateResponseCompatibility/.test(compat));
ok("no lead column rehydrate", !/next\.activeLeadId = conversationLeadId/.test(transaction));
ok("snapshot authoritative lead", /const hsId = state\.activeLeadId/.test(transaction));
ok("GET snapshot authoritative", /state\.activeLeadId \|\| ""/.test(route));
ok("engine syncs lead column", /leadPublicId: state\.activeLeadId/.test(engine));
ok("stale slot block", /logStaleNextActionBlocked/.test(engine));
ok("history lock guard", /activeRequestCleared/.test(engine));

const zombie = spawnSync("npx", ["tsx", "scripts/zombie-context-behavior.ts"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
if (zombie.stdout) process.stdout.write(zombie.stdout);
ok("zombie behavioral pass", zombie.status === 0);

const master = spawnSync("npx", ["tsx", "scripts/master-conversation-state-behavior.ts"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
if (master.stdout) process.stdout.write(master.stdout);
if (master.stderr) process.stderr.write(master.stderr);
ok("master behavioral pass", master.status === 0);

if (failed) {
  console.error(`\nFAILED: ${failed}`);
  process.exit(1);
}
console.log("\nMASTER CONVERSATION STATE TESTS PASS");
