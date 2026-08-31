#!/usr/bin/env node
/**
 * Master runner — Autonomous Operations Final Certification
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, "data", "e2e-cert", "autonomous-final");
mkdirSync(outDir, { recursive: true });

const log = { at: new Date().toISOString(), steps: [] };
let failed = 0;

function run(name, cmd, args, env = {}) {
  console.log(`\n=== ${name} ===\n`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    shell: true,
    env: { ...process.env, DATA_DIR: join(root, "data", "e2e-cert"), ...env },
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  const ok = r.status === 0;
  if (!ok) failed += 1;
  log.steps.push({ name, ok });
  return ok;
}

run("AUTO-01..20 baseline", "npx", ["tsx", "scripts/autonomous-operations-behavior.ts"]);

run("Autonomous adversarial", "npx", ["tsx", "scripts/autonomous-operations-adversarial.ts"], {
  DATA_DIR: join(root, "data", "e2e-cert", "autonomous-adv-isolated"),
});

run("Browser/API alert center", "node", ["scripts/browser-autonomous-alerts.mjs"], {
  E2E_BASE_URL: "http://localhost:3005",
});

writeFileSync(join(outDir, "final-cert-log.json"), JSON.stringify(log, null, 2));

if (failed) {
  console.error(`\nFINAL CERT: ${failed} step(s) FAILED`);
  process.exit(1);
}
console.log("\nAUTONOMOUS FINAL CERT RUNNER: PASS (automated gates)");
console.log(`Log: ${join(outDir, "final-cert-log.json")}`);
