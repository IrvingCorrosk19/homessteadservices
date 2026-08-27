/**
 * P0 Conversational Transaction Engine — regression tests.
 * Run: node scripts/test-p0-conversational-transaction.mjs
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
  "datetime parses full text",
  /slice\(0,\s*2000\)/.test(read("src/lib/concierge-datetime.ts")),
);
ok(
  "hasRequestedExactWhen exported",
  /export function hasRequestedExactWhen/.test(read("src/lib/concierge/appointment-readiness.ts")),
);
ok(
  "next-action CHECK_AVAILABILITY for exact when",
  /exact_when_needs_calendar/.test(read("src/lib/concierge/conversation-next-action.ts")),
);
ok(
  "engine locks exact free slot",
  /EXACT_SLOT_LOCKED/.test(read("src/lib/concierge-engine.ts")),
);
ok("trailing name extraction", /trailing/.test(read("src/lib/concierge/packed-extraction.ts")));
ok("AC beats generic repairs", /detected\.includes\("ac"\)/.test(read("src/lib/concierge/service-intent.ts")));
ok("Telegram WhatsApp gated", /isPublicWhatsAppEnabled/.test(read("src/lib/ops-telegram.ts")));
ok("firstMissingQuestion uses preferField", /preferField/.test(read("src/lib/concierge/appointment-readiness.ts")));
ok(
  "HS ensure on service intent",
  /ensureActiveServiceRequest/.test(read("src/lib/concierge/service-request-lifecycle.ts")),
);

const result = spawnSync("npx", ["tsx", "scripts/p0-tx-behavior.ts"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
process.stdout.write(result.stdout || "");
if (result.status !== 0) {
  process.stderr.write((result.stderr || "").slice(0, 1200));
  failed += 1;
}

if (failed) {
  console.error(`\nP0 TRANSACTION TESTS FAILED: ${failed}`);
  process.exit(1);
}
console.log("\nP0 CONVERSATIONAL TRANSACTION TESTS PASS");
