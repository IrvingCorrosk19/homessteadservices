/**
 * Natural conversation engine certification tests.
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
const knowledge = read("src/lib/concierge-knowledge.ts");
const nextAction = read("src/lib/concierge/conversation-next-action.ts");
const plan = read("src/lib/concierge/response-plan.ts");
const style = read("src/lib/concierge/natural-style.ts");
const obj = read("src/lib/concierge/conversation-objective.ts");
const obs = read("src/lib/concierge/tool-observation.ts");
const validator = read("src/lib/concierge/natural-response-validator.ts");

ok("response plan module", /buildResponsePlan/.test(plan) && /mustNotAsk/.test(plan));
ok("conversation objective stack", /interruptedGoal/.test(obj) && /updateConversationObjective/.test(obj));
ok("natural style no synonym roulette", /stripRepeatedRoboticOpener/.test(style) && !/synonym/.test(style));
ok("tool observation", /formatToolObservation/.test(obs) && /requestedAvailable/.test(obs));
ok("response validator", /unsupportedCommitment/.test(validator));
ok("engine wires response plan", /responsePlanPromptBlock/.test(engine));
ok("engine wires tool observation", /formatToolObservation/.test(engine));
ok("engine lets OpenAI speak calendar", /!conciergeApiKey\(\)/.test(engine));
ok("ASK_IDENTITY combined", /ASK_IDENTITY/.test(nextAction));
ok("prompt lineage v3.1 kept", /hs-concierge-v3\.1-he/.test(knowledge));
ok("prompt version v3.2", /hs-concierge-v3\.2-nc/.test(knowledge));
ok("no Perfecto booking rewrite", !/Perfecto, con eso ya puedo confirmar/.test(nextAction));
ok("actionable intent module", /classifyActionableServiceIntent/.test(read("src/lib/concierge/actionable-intent.ts")));
ok("lifecycle gates on userText", /userText/.test(read("src/lib/concierge/service-request-lifecycle.ts")));

const childEnv = {
  ...process.env,
  PATH: `C:\\Program Files\\nodejs;${process.env.PATH || ""}`,
};

function run(file) {
  const result = spawnSync("npx", ["tsx", file], {
    cwd: root,
    encoding: "utf8",
    shell: true,
    env: childEnv,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status === 0;
}

ok("behavior pass", run("scripts/natural-conversation-behavior.ts"));
ok("paraphrases pass", run("scripts/natural-conversation-paraphrases.ts"));
ok("explore catalog vs actionable pass", run("scripts/natural-conversation-explore.ts"));
ok("campaign pass", run("scripts/natural-conversation-campaign.ts"));

if (failed) {
  console.error(`\nNATURAL CONVERSATION ENGINE FAILED: ${failed}`);
  process.exit(1);
}
console.log("\nNATURAL CONVERSATION ENGINE TESTS PASS");
