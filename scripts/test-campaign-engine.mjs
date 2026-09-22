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

const intent = read("src/lib/content-campaign-intent.ts");
const engine = read("src/lib/campaign-engine.ts");
const handler = read("src/lib/content-handler.ts");
const telegram = read("src/lib/campaign-telegram.ts");
const schema = read("src/lib/service-requests.ts");
const form = read("src/components/contact/RequestForm.tsx");
const contactApi = read("src/app/api/contact/route.ts");
const scheduler = read("src/lib/content-scheduler.ts");
const weekly = read("src/app/api/internal/content/weekly-report/route.ts");
const claims = read("src/lib/campaign-claims.ts");
const copy = read("src/lib/campaign-copy.ts");
const visual = read("src/lib/campaign-visual.ts");
const n8nWeek = read("n8n/homestead-n8n-weekly-report.json");

ok("CAM-01 CAMPAIGN_PLAN before AI", /kind: \"CAMPAIGN_PLAN\"/.test(intent) && intent.indexOf("CAMPAIGN_PLAN") < intent.indexOf("AI_CAMPAIGN"));
ok("CAM-02 digital lock drafts", /digitalLocksmithPilotDrafts/.test(copy) && /SCRIPT_READY|script_ready/.test(copy));
ok("CAM-03 illustrative label", /IMAGEN ILUSTRATIVA/.test(visual));
ok("CAM-04 claim guard", /availability_247/.test(claims) && /false_urgency/.test(claims));
ok("CAM-05 telegram ops", ["/campana", "/calendario", "/piezas", "/aprobar_campana", "/pausar_campana", "/cancelar_campana", "/resultados"].every((cmd) => telegram.includes(cmd) || telegram.includes(cmd.replace("ñ", "n"))));
ok("CAM-06 handler wires campaign", /handleCampaignText/.test(handler) && /handleCampaignCallback/.test(handler));
ok("CAM-07 schema campaigns", /CREATE TABLE IF NOT EXISTS campaigns/.test(schema) && /campaign_public_id/.test(schema));
ok("CAM-08 form keeps utm", /utm_campaign/.test(form) && /hs_ref/.test(form));
ok("CAM-09 contact saves campaign", /campaignPublicId/.test(contactApi) && /hs_test/.test(contactApi));
ok("CAM-10 scheduler honors pause", /campaignJobPaused/.test(scheduler));
ok("CAM-11 weekly campaign block", /campaignWeeklyBlock/.test(weekly));
ok("CAM-12 n8n weekly not duplicated", /homestead.lat\/api\/internal\/content\/weekly-report/.test(n8nWeek));
ok("CAM-13 no 24/7 in engine copy", !/24\/7/.test(copy));
ok("CAM-14 budget default 0", /maxGeneration: 0/.test(engine));
ok("CAM-15 dry-run preserved", /CONTENT_DRY_RUN/.test(read("scripts/campaign-engine-behavior.ts")));

const childEnv = {
  ...process.env,
  PATH: `C:\\Program Files\\nodejs;${process.env.PATH || ""}`,
};
const run = spawnSync("npx", ["tsx", "scripts/campaign-engine-behavior.ts"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
  env: childEnv,
});
if (run.stdout) process.stdout.write(run.stdout);
if (run.stderr) process.stderr.write(run.stderr);
ok("CAM-16 behavioral pass", run.status === 0);

if (failed) {
  console.error(`\nCAMPAIGN ENGINE FAILED: ${failed}`);
  process.exit(1);
}
console.log("\nCAMPAIGN ENGINE TESTS PASS");
