import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const result = spawnSync("node", ["scripts/e2e-adversarial-closure.mjs"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
  env: { ...process.env, DATA_DIR: process.env.DATA_DIR || "data/e2e-cert", CONCIERGE_E2E: "true" },
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(1);
console.log("E2E ADVERSARIAL CLOSURE GATE PASS");
