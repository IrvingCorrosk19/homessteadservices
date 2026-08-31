#!/usr/bin/env node
/**
 * Full adversarial certification runner — all hard gates.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const envPath = join(root, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const env = {
  ...process.env,
  DATA_DIR: process.env.DATA_DIR || "data/e2e-cert",
  AI_CONCIERGE_DRY_RUN: "false",
  CONCIERGE_E2E: "true",
};

function run(cmd, args, label) {
  console.log(`\n>>> ${label}`);
  const result = spawnSync(cmd, args, { cwd: root, encoding: "utf8", shell: true, env });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    console.error(`FAILED: ${label}`);
    process.exit(1);
  }
  console.log(`PASS: ${label}`);
}

run("node", ["scripts/e2e-god-level-cert.mjs"], "BT-01..10 + extended phases");
run("node", ["scripts/e2e-adversarial-closure.mjs"], "Adversarial closure E2E");
run("node", ["scripts/browser-human-adversarial-campaign.mjs"], "Browser human adversarial (10 conversations)");
run("npm", ["test"], "npm test regression");
run("npm", ["run", "build"], "npm run build");

console.log("\n=== ADVERSARIAL CERT FINAL: ALL GATES PASS ===\n");
