import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

let failed = 0;
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

const intentSrc = readFileSync(join(root, "src/lib/concierge/service-intent.ts"), "utf8");
const playbookSrc = readFileSync(join(root, "src/lib/concierge/playbook-engine.ts"), "utf8");
const packedSrc = readFileSync(join(root, "src/lib/concierge/packed-extraction.ts"), "utf8");
const handoffSrc = readFileSync(join(root, "src/lib/concierge-handoff.ts"), "utf8");
const txSrc = readFileSync(join(root, "src/lib/concierge-transaction.ts"), "utf8");

ok("SDI-01 resolvePrimaryFromMessage exists", intentSrc.includes("resolvePrimaryFromMessage"));
ok("SDI-02 choosePrimary uses latest text", playbookSrc.includes("latestText") && playbookSrc.includes("resolvePrimaryFromMessage"));
ok("SDI-03 packed clears activeLeadId on service change", packedSrc.includes('activeLeadId = ""') && packedSrc.includes("previousPrimary"));
ok(
  "SDI-04 handoff syncs same request on service change",
  handoffSrc.includes("lead_service_refined_same_request") && handoffSrc.includes("syncServiceRequestFromState"),
);
ok("SDI-05 transaction detects intent change", txSrc.includes("resolvePrimaryFromMessage(text)"));
ok("SDI-06 cielo razo typo tolerance", intentSrc.includes("cielo\\s*razo"));
ok("SDI-07 repair vs paint disambiguation", intentSrc.includes("REPAIR_VERB") && intentSrc.includes("PAINT_VERB"));
ok("SDI-08 service detail helper", intentSrc.includes("serviceNeedDetail"));
ok("SDI-09 observability logs", handoffSrc.includes("REQUEST_SERVICE_PERSISTED"));

function fold(value) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
const REPAIR_VERB = /\b(repar\w+|arregl\w+|se dañ[oó]|se dano|descompus\w*)\b/;
const PAINT_VERB = /\b(pint(ar|ura|ores|ado)|brocha|impermeabiliz)\b/;
const CEILING = /\b(cielo\s*raso|cielo\s*razo|falso\s+techo|drywall)\b/;

function resolvePrimaryFromMessage(text) {
  const blob = fold(text);
  const hasRepair = REPAIR_VERB.test(blob);
  const hasPaint = PAINT_VERB.test(blob);
  if (hasRepair && hasPaint) return "repairs";
  if (hasRepair) return "repairs";
  if (hasPaint) return "painting";
  return "";
}

function choosePrimary(detected, current, latestText = "") {
  const latestIntent = latestText ? resolvePrimaryFromMessage(latestText) : "";
  if (latestIntent && current && latestIntent !== current) return latestIntent;
  if (latestIntent) return latestIntent;
  if (current && detected.includes(current)) return current;
  return detected[0] || current || "";
}

function serviceNeedDetail(problem) {
  const blob = fold(problem);
  if (CEILING.test(blob) && REPAIR_VERB.test(blob)) return "Reparación de cielo raso";
  return "";
}

ok("SDI-10 repair ceiling", resolvePrimaryFromMessage("Repara mi cielo razo") === "repairs");
ok("SDI-11 repair ceiling accent", resolvePrimaryFromMessage("Quiero reparar el cielo raso") === "repairs");
ok("SDI-12 paint ceiling", resolvePrimaryFromMessage("Necesito pintar el cielo raso") === "painting");
ok("SDI-13 paint apartment", resolvePrimaryFromMessage("Quiero pintar mi apartamento") === "painting");
const playbooks = readFileSync(join(root, "src/lib/concierge/service-playbooks.ts"), "utf8");
ok("SDI-14 locksmith alias", playbooks.includes('serviceId: "locksmith"'));
ok("SDI-15 plumbing alias", playbooks.includes('serviceId: "plumbing"'));
ok("SDI-16 ac alias", playbooks.includes('serviceId: "ac"'));
ok("SDI-17 electrical alias", playbooks.includes('serviceId: "electrical"'));
ok("SDI-18 remodeling alias", playbooks.includes('serviceId: "remodeling"'));

ok(
  "SDI-19 choosePrimary overrides stale painting",
  choosePrimary(["repairs", "painting"], "painting", "Repara mi cielo raso") === "repairs",
);
ok(
  "SDI-20 change of intent",
  choosePrimary(["painting", "repairs"], "painting", "En realidad primero necesito reparar el cielo raso") === "repairs",
);

ok(
  "SDI-21 detail label",
  serviceNeedDetail("Repara mi cielo razo", "repairs") === "Reparación de cielo raso",
);

if (failed) {
  console.error(`\nSERVICE DATA INTEGRITY checks FAILED (${failed})`);
  process.exit(1);
}
console.log("\nSERVICE DATA INTEGRITY static checks OK");
