/**
 * Build production n8n workflow export from the isolated source JSON.
 * Shared VPS n8n 2.3.6 blocks $env in Code/IF — production must use $vars only.
 * Does not contact any server. No secrets embedded.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = join(root, "n8n", "homestead-n8n-concierge-turn.json");
const outPath = join(root, "n8n", "homestead-n8n-concierge-turn.prod.json");

const wf = JSON.parse(readFileSync(srcPath, "utf8"));
const raw = JSON.stringify(wf);
if (raw.includes("$env.")) {
  // Replace every $env.X with $vars.X for shared n8n compatibility.
}
const prod = JSON.parse(
  raw
    .replaceAll("$env.CONCIERGE_INTERNAL_SECRET", "$vars.CONCIERGE_INTERNAL_SECRET")
    .replaceAll("$env.HOMESTEAD_INTERNAL_BASE", "$vars.HOMESTEAD_INTERNAL_BASE"),
);

prod.name = "HOMESTEAD — Concierge Turn Coordinator (prod v2)";
prod.active = false;
prod.meta = {
  ...(prod.meta || {}),
  templateCredsSetupCompleted: false,
  homesteadNotes: [
    "SHARED n8n compatible: uses $vars (not $env). n8n 2.3.6 blocks $env in Code/IF.",
    "Required n8n Variables: CONCIERGE_INTERNAL_SECRET, HOMESTEAD_INTERNAL_BASE.",
    "Webhook path: homestead-concierge-turn (do not collide with Telegram/Content/Control push).",
    "Import inactive; activate only after Homestead code deploy + secret match.",
    "Does NOT modify other workflows. No credentials embedded in JSON.",
    "Coordinates via /api/internal/concierge/* only — no SQL from n8n.",
  ],
};

// Sanity: no leftover $env and no secret-looking literals.
const out = JSON.stringify(prod, null, 2);
if (out.includes("$env.")) {
  console.error("FAIL: leftover $env references in prod workflow");
  process.exit(1);
}
if (/sk-|BEGIN PRIVATE|password\s*[:=]/i.test(out)) {
  console.error("FAIL: suspicious secret-like content");
  process.exit(1);
}
if (!out.includes("$vars.CONCIERGE_INTERNAL_SECRET") || !out.includes("$vars.HOMESTEAD_INTERNAL_BASE")) {
  console.error("FAIL: missing $vars bindings");
  process.exit(1);
}

writeFileSync(outPath, `${out}\n`, "utf8");
console.log("Wrote", outPath);
console.log("active=", prod.active, "webhook=homestead-concierge-turn");
