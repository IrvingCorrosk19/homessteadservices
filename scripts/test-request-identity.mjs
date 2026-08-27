/**
 * P0 Request Identity — regression gate.
 * Run: node scripts/test-request-identity.mjs
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
  "ensureActiveServiceRequest never creates on service mismatch",
  !/row\?\.service && row\.service !== service/.test(read("src/lib/concierge/service-request-lifecycle.ts")),
);
ok(
  "createLeadFromConcierge reuses existing HS",
  /lead_service_refined_same_request/.test(read("src/lib/concierge-handoff.ts")),
);
ok(
  "packed-extraction does not clear activeLeadId on service change",
  !/next\.activeLeadId = "";\s*\n\s*next\.appointmentId/.test(read("src/lib/concierge/packed-extraction.ts")),
);
ok("name typo normalization", read("src/lib/concierge/packed-extraction.ts").includes("normalizeNameMarkers"));
ok("isValidPersonName exported", /export function isValidPersonName/.test(read("src/lib/concierge/canonical-state.ts")));
ok("ops-engine WhatsApp gated", /isPublicWhatsAppEnabled/.test(read("src/lib/ops-engine.ts")));
ok("house facts extraction", /extractHouseFacts/.test(read("src/lib/concierge/packed-extraction.ts")));

const result = spawnSync("npx", ["tsx", "scripts/request-identity-behavior.ts"], {
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
console.log("\nALL PASS");
