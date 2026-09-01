/**
 * Customer cancellation engine certification tests.
 * Run: node scripts/test-customer-cancellation-engine.mjs
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
const cancel = read("src/lib/service-request-cancellation.ts");
const intent = read("src/lib/concierge/cancellation-intent.ts");
const tools = read("src/lib/concierge-tools.ts");
const reset = read("src/lib/concierge/conversation-reset.ts");
const store = read("src/lib/revenue-store.ts");
const fanout = read("src/lib/telegram-fanout.ts");
const dispatch = read("src/lib/automation-dispatch.ts");
const c360 = read("src/lib/customer-360.ts");
const admin = read("src/app/api/admin/service-requests/[requestId]/route.ts");
const schema = read("src/lib/service-requests.ts");

ok("cancelServiceRequest exists", /export function cancelServiceRequest/.test(cancel));
ok("no DELETE FROM service_requests", !/DELETE\s+FROM\s+service_requests/i.test(cancel));
ok("intent kinds distinct", /CANCEL_REQUEST/.test(intent) && /CANCEL_APPOINTMENT_ONLY/.test(intent) && /RESET_CONVERSATION/.test(intent));
ok("tool cancel_service_request", /cancel_service_request/.test(tools));
ok("engine intercept", /detectCustomerCancellationIntent/.test(engine));
ok("reset does not cancel HS by default", /cancelExistingHs: false/.test(engine) && /cancelExistingHs === true/.test(reset));
ok("booking eligibility gate", /isRequestEligibleForAppointment/.test(store) && /isRequestEligibleForAppointment/.test(tools));
ok("telegram cancelled fanout", /fanOutServiceRequestCancelledTelegram/.test(fanout));
ok("outbox cancelled dispatch", /service_request.cancelled/.test(dispatch));
ok("customer360 cancel event", /REQUEST_CANCELLED/.test(c360));
ok("admin uses cancelServiceRequest", /cancelServiceRequest/.test(admin));
ok("schema cancellation columns", /cancelled_at/.test(schema) && /cancellation_reason/.test(schema));
ok("reason optional", /NOT_PROVIDED/.test(cancel));

const childEnv = {
  ...process.env,
  PATH: `C:\\Program Files\\nodejs;${process.env.PATH || ""}`,
};

const intentRun = spawnSync("npx", ["tsx", "scripts/customer-cancellation-behavior.ts"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
  env: childEnv,
});
if (intentRun.stdout) process.stdout.write(intentRun.stdout);
if (intentRun.stderr) process.stderr.write(intentRun.stderr);
ok("intent behavioral pass", intentRun.status === 0);

const dbRun = spawnSync("npx", ["tsx", "scripts/customer-cancellation-db.ts"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
  env: childEnv,
});
if (dbRun.stdout) process.stdout.write(dbRun.stdout);
if (dbRun.stderr) process.stderr.write(dbRun.stderr);
ok("db behavioral pass", dbRun.status === 0);

if (failed) {
  console.error(`\nCUSTOMER CANCELLATION ENGINE FAILED: ${failed}`);
  process.exit(1);
}
console.log("\nCUSTOMER CANCELLATION ENGINE TESTS PASS");
