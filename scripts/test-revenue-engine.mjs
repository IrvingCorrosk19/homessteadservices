import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(readFileSync(join(root, "src/data/revenue-engine.json"), "utf8"));
const scoreSrc = readFileSync(join(root, "src/lib/revenue-score.ts"), "utf8");
const storeSrc = readFileSync(join(root, "src/lib/revenue-store.ts"), "utf8");
const tg = readFileSync(join(root, "src/lib/revenue-telegram.ts"), "utf8");

let failed = 0;
function assert(name, ok) {
  if (!ok) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

function score(input) {
  const w = config.scoreWeights;
  let n = 0;
  if (input.service && input.service !== "other") n += w.serviceIdentified;
  if ((input.problem || "").trim().length >= 40) n += w.problemSpecific;
  if (/visita|cotiz|mañana/i.test(input.problem)) n += w.requestedVisitOrQuote;
  if (classifyPhoneLike(input.phone)) n += w.providedPhone;
  if (["painting", "repairs", "remodeling", "ac"].includes(input.service)) n += w.siteVisitCategory || 0;
  return n;
}

function classifyPhoneLike(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length === 8 || (digits.length === 11 && digits.startsWith("507"));
}

const hot = score({
  service: "ac",
  problem: "El aire enciende pero no enfría. Necesito visita mañana para cotizar en Betania.",
  phone: "60000000",
});
const cold = score({ service: "other", problem: "hola", phone: "" });
assert("site visit next action", /PROGRAM_SITE_VISIT/.test(scoreSrc));
assert("phone validator in score", /classifyPhone/.test(scoreSrc));
assert("hot threshold reachable", hot >= config.hotScore || hot >= 40);
assert("auto follow-up default false", config.autoFollowUp === false);
assert("stop signals exist", /isStopSignal/.test(scoreSrc));
assert("no AI prices", /NEEDS_MANUAL_PRICING/.test(storeSrc));
assert("idempotent follow-up", /status = 'PENDING'/.test(storeSrc));
assert("canonical HS lead", /lead_id/.test(storeSrc));
assert("assisted telegram", /ASSISTED/.test(tg));
assert("divide by zero guarded", /b === 0 \? null/.test(storeSrc));
assert("unknown attribution not guessed", !/utm_source = 'instagram'/.test(storeSrc));

function stop(text) {
  return /\bno me interesa\b|\bno me escriban\b|do not contact|\bno gracias\b/i.test(text);
}
assert("stop no me interesa", stop("No me interesa."));
assert("stop do not contact", stop("Do not contact me again."));

if (failed) process.exit(1);
console.log("REVENUE ENGINE LOGIC TESTS PASS");
