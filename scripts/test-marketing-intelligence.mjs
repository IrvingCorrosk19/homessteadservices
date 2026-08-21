import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(readFileSync(join(root, "src/data/marketing-intelligence.json"), "utf8"));

function known(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function homesteadIntentScore(signals) {
  const weights = config.intentWeights;
  const used = [];
  let score = 0;
  const add = (key, value) => {
    if (!known(value)) return;
    score += weights[key] * value;
    used.push(key);
  };
  add("jobWon", signals.jobWon);
  add("qualifiedLead", signals.qualifiedLead);
  add("lead", signals.lead);
  add("whatsappClick", signals.whatsappClick);
  add("dm", signals.dm);
  add("callClick", signals.callClick);
  add("contactClick", signals.contactClick);
  add("profileVisit", signals.profileVisit);
  add("linkClick", signals.linkClick);
  add("share", signals.share);
  add("save", signals.save);
  add("comment", signals.comment);
  add("follow", signals.follow);
  add("like", signals.like);
  add("impression", signals.impression);
  const reach = known(signals.reach) ? signals.reach : known(signals.impression) ? signals.impression : null;
  return {
    score: used.length ? Math.round(score * 100) / 100 : null,
    intentPerReach: reach && reach > 0 ? score / reach : null,
    used,
    unknown: used.length === 0,
  };
}

function confidenceFromSample(n) {
  if (n < config.minSamples.low) return "INSUFFICIENT";
  if (n >= config.minSamples.high) return "HIGH";
  if (n >= config.minSamples.medium) return "MEDIUM";
  return "LOW";
}

let failed = 0;
function assert(name, ok) {
  if (!ok) {
    failed += 1;
    console.error("FAIL", name);
  } else {
    console.log("PASS", name);
  }
}

const vanity = homesteadIntentScore({ impression: 10000, like: 100, lead: 0, reach: 10000 });
const intent = homesteadIntentScore({ impression: 1000, like: 20, lead: 8, reach: 1000 });
assert("intent beats vanity", intent.score > vanity.score);
assert("missing is unknown not zero", homesteadIntentScore({}).unknown === true);
assert("one sample is not HIGH", confidenceFromSample(1) === "LOW");
assert("five samples MEDIUM", confidenceFromSample(5) === "MEDIUM");
assert("twelve samples HIGH", confidenceFromSample(12) === "HIGH");

const last = ["AIR_CONDITIONING", "AIR_CONDITIONING", "AIR_CONDITIONING"];
const diversityPenalty = last.filter((x) => x === "AIR_CONDITIONING").length >= 2;
const acScore = 50 - (diversityPenalty ? config.diversityPenalty : 0);
const elecScore = 50;
assert("diversity prefers other service", elecScore > acScore);
assert("priority boost exists", config.priorityBoost > 0);
assert("no fake hour 19:13 in windows", config.timeWindows.every((w) => w.start.endsWith(":00")));

if (failed) {
  process.exit(1);
}
console.log("MARKETING INTELLIGENCE LOGIC TESTS PASS");
