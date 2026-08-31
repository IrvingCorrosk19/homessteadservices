import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const behavior = spawnSync("npx", ["tsx", "scripts/homestead-ai-benchmark-behavior.ts"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
if (behavior.stdout) process.stdout.write(behavior.stdout);
if (behavior.stderr) process.stderr.write(behavior.stderr);
if (behavior.status !== 0) process.exit(1);
console.log("HOMESTEAD AI BENCHMARK GATE PASS");
